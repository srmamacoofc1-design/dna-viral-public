import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  ExactBlockCoverageError,
  normalizeExactBlockCoverage,
} from "../_shared/exact-block-coverage.ts";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";
import {
  geminiOpenAIChat,
  hasGeminiApiKeys,
} from "../_shared/gemini-rotation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type SemanticExtractionResult = {
  // The exact-coverage helper owns identity/timing, while the schema-validated
  // model payload contributes the remaining semantic fields.
  blocks: any[];
  cta_profile?: {
    cta_text?: string;
    cta_position_seconds?: number;
    cta_type?: string;
    cta_emotion?: string;
    cta_action?: string;
    cta_intensity?: number;
  } | null;
};

// Large tool payloads with 15-18 blocks were repeatedly timing out before the
// provider could finish the JSON arguments. Six blocks keeps every request
// small enough to validate strictly, while two concurrent chunks use the
// independently validated key pool without recreating a quota burst.
export const SEMANTIC_CHUNK_SIZE = 6;
export const SEMANTIC_CHUNK_CONCURRENCY = 2;

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index], index);
      }
    },
  ));
  return results;
}

const blockSemanticSchema = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "UUID of the video_blocks row" },
          block_type: { type: "string" },
          block_text: { type: "string", description: "Full text of the block" },
          timestamp_start: { type: "number" },
          timestamp_end: { type: "number" },
          block_keywords: {
            type: "array", items: { type: "string" },
            description: "Up to 10 main keywords, no stopwords, prioritize emotional words",
          },
          block_emotional_words: {
            type: "array", items: { type: "string" },
            description: "Up to 8 emotionally strong words (e.g. secret, shocking, suddenly)",
          },
          block_repeated_words: {
            type: "array", items: { type: "string" },
            description: "Up to 8 words repeated within the block",
          },
          block_strong_phrases: {
            type: "array", items: { type: "string" },
            description: "Up to 3 most impactful short phrases from the block",
          },
          rare_words: {
            type: "array", items: { type: "string" },
            description: "Up to 5 unusual/uncommon words that stand out",
          },
          dominant_words: {
            type: "array", items: { type: "string" },
            description: "Up to 5 most dominant/central words defining the block's core message",
          },
          impact_words: {
            type: "array", items: { type: "string" },
            description: "Up to 5 words with strongest emotional/rhetorical impact",
          },
          word_frequencies: {
            type: "array",
            items: {
              type: "object",
              properties: {
                word: { type: "string" },
                frequency: { type: "number" },
              },
              required: ["word", "frequency"],
              additionalProperties: false,
            },
            description: "Top 15 non-stopword words with their frequency count in this block",
          },
          phrases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "The phrase text" },
                category: {
                  type: "string",
                  enum: ["afirmacao", "pergunta", "negacao", "misterio", "alerta", "promessa", "revelacao", "provocacao", "cta"],
                  description: "Classification of the phrase type",
                },
                is_emotional: { type: "boolean" },
                is_strong: { type: "boolean" },
                is_repeated: { type: "boolean" },
                strength_score: {
                  type: "number",
                  description: "Linguistic strength 0-100 based on: strong words, contrast, surprise, negation, question, brevity",
                },
              },
              required: ["text", "category", "is_emotional", "is_strong", "strength_score"],
              additionalProperties: false,
            },
            description: "All meaningful phrases (2-15 words) from the block with classification and strength score",
          },
          block_emotional_type: {
            type: "string",
            enum: ["curiosidade", "surpresa", "tensao", "expectativa", "impacto", "medo", "humor", "revelacao", "misterio", "alivio", "recompensa", "engajamento", "urgencia", "choque"],
          },
          block_emotional_intensity: {
            type: "number", description: "0 to 100 scale (0=none, 100=maximum intensity)",
          },
          block_verbal_tone: {
            type: "string",
            enum: ["urgente", "misterioso", "intimo", "tecnico", "alarmante", "familiar", "provocativo", "emocional", "curioso"],
          },
        },
        required: [
          "block_id", "block_type", "block_text", "timestamp_start", "timestamp_end",
          "block_keywords", "block_emotional_words",
          "block_strong_phrases", "block_emotional_type",
          "block_emotional_intensity", "block_verbal_tone",
          "rare_words", "dominant_words", "impact_words",
          "word_frequencies", "phrases",
        ],
        additionalProperties: false,
      },
    },
    cta_profile: {
      type: "object",
      description: "CTA extraction if a call-to-action exists. null if none.",
      properties: {
        cta_text: { type: "string" },
        cta_position_seconds: { type: "number" },
        cta_type: { type: "string", enum: ["provocativa", "social", "direta", "emocional", "implicita"] },
        cta_emotion: { type: "string", enum: ["engajamento", "curiosidade", "medo", "surpresa", "recompensa", "urgencia"] },
        cta_action: { type: "string", enum: ["follow", "subscribe", "comment", "like", "share", "watch_more", "question", "provocation", "curiosity"] },
        cta_intensity: { type: "number", description: "CTA intensity 0-100" },
      },
      required: ["cta_text", "cta_type", "cta_emotion", "cta_action", "cta_intensity"],
      additionalProperties: false,
    },
  },
  required: ["blocks"],
  additionalProperties: false,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { video_id } = await req.json();
    if (!video_id) {
      return new Response(JSON.stringify({ error: "Missing video_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasGeminiApiKeys()) throw new Error("GEMINI_API_KEYS not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch blocks and video engagement_rate_relative
    const [blocksRes, videoRes] = await Promise.all([
      supabase.from("video_blocks").select("*").eq("video_id", video_id).order("bloco_id"),
      supabase.from("videos").select("engagement_rate_relative").eq("id", video_id).single(),
    ]);

    if (blocksRes.error) throw new Error(`Failed to fetch blocks: ${blocksRes.error.message}`);
    const blocks = blocksRes.data;
    const engagementRate = Number(videoRes.data?.engagement_rate_relative) || 0;

    if (!blocks || blocks.length === 0) {
      return new Response(JSON.stringify({ error: "No blocks found for this video" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blocksWithText = blocks.filter((b: any) => b.texto && b.texto.trim().length > 0);
    if (blocksWithText.length === 0) {
      return new Response(JSON.stringify({ error: "No blocks with text found" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (blocksWithText.length > 18) {
      return new Response(JSON.stringify({
        error: `Narrative block limit exceeded: ${blocksWithText.length}/18`,
        code: "NARRATIVE_BLOCK_LIMIT_EXCEEDED",
        success: false,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("video_logs").insert({
      video_id, etapa: "Verbal DNA Engine", status: "success",
      mensagem: `Iniciando extração verbal completa de ${blocksWithText.length} blocos...`,
    });

    const semanticSystemPrompt = `You are an expert linguistic analyst for viral video scripts (VERBAL DNA ENGINE).

For EACH narrative block provided, extract COMPLETE verbal/linguistic data:

1. block_keywords: Up to 10 main keywords. Remove stopwords. Prioritize emotional weight.
2. block_emotional_words: Up to 8 emotionally strong/impactful words.
3. block_repeated_words: Up to 8 words that appear more than once.
4. block_strong_phrases: Up to 3 most impactful short phrases from actual text.
5. rare_words: Up to 5 unusual/uncommon words.
6. dominant_words: Up to 5 most central words defining the block's core message.
7. impact_words: Up to 5 words with strongest emotional/rhetorical impact.
8. word_frequencies: Top 15 non-stopword words with their exact frequency count in the block.
9. phrases: Extract ALL meaningful phrases (2-15 words). For each:
   - category: afirmacao, pergunta, negacao, misterio, alerta, promessa, revelacao, provocacao, cta
   - is_emotional: true if contains emotional language
   - is_strong: true if high-impact phrase
   - is_repeated: true if pattern appears elsewhere
   - strength_score: 0-100 based on: strong words (+20), contrast/opposition (+15), surprise element (+15), negation (+10), question form (+10), brevity under 8 words (+10), emotional words (+20)
10. block_emotional_type: curiosidade, surpresa, tensao, expectativa, impacto, medo, humor, revelacao, misterio, alivio, recompensa, engajamento, urgencia, choque
11. block_emotional_intensity: 0-100 scale
12. block_verbal_tone: urgente, misterioso, intimo, tecnico, alarmante, familiar, provocativo, emocional, curioso

ALSO: If there is a CTA, extract cta_profile with:
- cta_text, cta_position_seconds
- cta_type: provocativa, social, direta, emocional, implicita
- cta_emotion: engajamento, curiosidade, medo, surpresa, recompensa, urgencia
- cta_action: follow, subscribe, comment, like, share, watch_more, question, provocation, curiosity
- cta_intensity: 0-100

CRITICAL:
- Use EXACT block_id (UUID), timestamp_start, timestamp_end from input
- Keywords and phrases must come FROM the actual block text
- Analyze in the ORIGINAL language
- Provide ALL phrases found, not just top 3
- Return exactly one object for every input block; partial coverage is invalid`;

    const chunks = chunkValues(blocksWithText, SEMANTIC_CHUNK_SIZE);
    const chunkResults = await mapWithConcurrency(
      chunks,
      SEMANTIC_CHUNK_CONCURRENCY,
      async (chunk, chunkIndex): Promise<SemanticExtractionResult> => {
        const blocksContext = chunk.map((block: any) =>
          `[Block ID: ${block.id}] [Type: ${block.tipo_bloco}] [${block.tempo_inicio}s–${block.tempo_fim}s]\n"${block.texto}"`
        ).join("\n\n");
        const maxAiAttempts = 2;
        let lastOutputError = "No AI attempt completed";

        for (let attempt = 1; attempt <= maxAiAttempts; attempt++) {
          const retryInstruction = attempt === 1
            ? ""
            : `\n\nRETRY ${attempt}/${maxAiAttempts}. The previous output was rejected because: ${lastOutputError.slice(0, 1200)}\n`
              + `Return EXACTLY ${chunk.length} block objects. Every required block_id must appear once and only once; do not invent or omit IDs.`;
          let aiResponse: Response;
          try {
            aiResponse = await geminiOpenAIChat({
              model: "gemini-3.5-flash",
              messages: [
                { role: "system", content: semanticSystemPrompt },
                {
                  role: "user",
                  content: `Analyze chunk ${chunkIndex + 1}/${chunks.length}. Analyze each block individually:\n\n${blocksContext}${retryInstruction}`,
                },
              ],
              tools: [{
                type: "function",
                function: {
                  name: "save_block_semantics",
                  description: "Save per-block linguistic extraction with granular word/phrase data",
                  parameters: blockSemanticSchema,
                },
              }],
              tool_choice: { type: "function", function: { name: "save_block_semantics" } },
            }, {
              totalTimeoutMs: 65_000,
              baseDelayMs: 200,
              maxDelayMs: 2_000,
              attemptTimeoutMs: 55_000,
            });
          } catch (error) {
            lastOutputError = error instanceof Error ? error.message : String(error);
            if (attempt < maxAiAttempts) continue;
            throw new ExactBlockCoverageError(
              `AI request failed for chunk ${chunkIndex + 1} after ${maxAiAttempts} attempts: ${lastOutputError}`,
            );
          }

          if (!aiResponse.ok) {
            const errText = await aiResponse.text();
            console.error("AI error:", aiResponse.status, errText.slice(0, 500));
            if (aiResponse.status === 429) throw new Error("Rate limit exceeded");
            if (aiResponse.status === 402) throw new Error("Gemini quota exhausted");
            lastOutputError = `AI extraction failed: ${aiResponse.status} ${errText.slice(0, 500)}`;
            if (attempt < maxAiAttempts && aiResponse.status >= 500) continue;
            throw new Error(lastOutputError);
          }

          try {
            const aiData = await aiResponse.json();
            const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
            if (!toolCall?.function?.arguments) {
              throw new ExactBlockCoverageError("AI did not return structured block data");
            }
            const candidate = JSON.parse(toolCall.function.arguments) as {
              blocks?: unknown;
              cta_profile?: SemanticExtractionResult["cta_profile"];
            };
            return {
              blocks: normalizeExactBlockCoverage(chunk, candidate.blocks),
              cta_profile: candidate.cta_profile,
            };
          } catch (error) {
            lastOutputError = error instanceof Error ? error.message : String(error);
            console.warn(
              `Rejected semantic extraction chunk ${chunkIndex + 1} attempt ${attempt}/${maxAiAttempts}:`,
              lastOutputError,
            );
            if (attempt === maxAiAttempts) {
              throw new ExactBlockCoverageError(
                `AI failed exact block coverage after ${maxAiAttempts} attempts for chunk ${chunkIndex + 1}: ${lastOutputError}`,
                error instanceof ExactBlockCoverageError
                  ? {
                    missingIds: error.missingIds,
                    duplicateIds: error.duplicateIds,
                    unknownIds: error.unknownIds,
                  }
                  : {},
              );
            }
          }
        }
        throw new ExactBlockCoverageError(`AI failed semantic chunk ${chunkIndex + 1}`);
      },
    );

    const normalizedBlocks = normalizeExactBlockCoverage(
      blocksWithText,
      chunkResults.flatMap((chunk) => chunk.blocks),
    );
    const ctaProfile = chunkResults
      .map((chunk) => chunk.cta_profile)
      .filter((profile): profile is NonNullable<SemanticExtractionResult["cta_profile"]> =>
        !!profile && typeof profile.cta_text === "string" && profile.cta_text.trim().length > 0
      )
      .sort((left, right) => Number(right.cta_intensity || 0) - Number(left.cta_intensity || 0))[0] ?? null;
    const result: SemanticExtractionResult = {
      blocks: normalizedBlocks,
      cta_profile: ctaProfile,
    };

    // Delete existing data for this video (safe reprocessing)
    const cleanupResults = await Promise.all([
      supabase.from("block_semantic_patterns").delete().eq("video_id", video_id),
      supabase.from("block_word_patterns").delete().eq("video_id", video_id),
      supabase.from("block_phrase_patterns").delete().eq("video_id", video_id),
    ]);
    const cleanupError = cleanupResults.find((entry) => entry.error)?.error;
    if (cleanupError) {
      throw new Error(`Failed to clear previous semantic extraction: ${cleanupError.message}`);
    }

    // Insert block_semantic_patterns (legacy + enhanced)
    const semanticRows = (result.blocks || []).map((b: any) => {
      const intensity = Math.min(100, Math.max(0, Number(b.block_emotional_intensity) || 0));
      const keywordCount = (b.block_keywords || []).length;
      const phraseCount = (b.block_strong_phrases || []).length;

      return {
        video_id,
        block_id: b.block_id,
        block_type: b.block_type || "unknown",
        block_text: b.block_text || null,
        block_keywords: b.block_keywords || [],
        block_emotional_words: b.block_emotional_words || [],
        block_repeated_words: b.block_repeated_words || [],
        block_strong_phrases: b.block_strong_phrases || [],
        rare_words: b.rare_words || [],
        dominant_words: b.dominant_words || [],
        block_emotional_type: b.block_emotional_type || null,
        block_emotional_intensity: Math.round(intensity / 20), // Store as 1-5 for backward compat
        block_verbal_tone: b.block_verbal_tone || null,
        weighted_word_score: engagementRate > 0 ? +(keywordCount * engagementRate).toFixed(4) : null,
        weighted_phrase_score: engagementRate > 0 ? +(phraseCount * engagementRate).toFixed(4) : null,
      };
    });

    if (semanticRows.length > 0) {
      const { error: insertErr } = await supabase.from("block_semantic_patterns").insert(semanticRows);
      if (insertErr) {
        console.error("Insert error:", insertErr);
        throw new Error(`Failed to save patterns: ${insertErr.message}`);
      }
    }

    // Insert granular word patterns
    const wordRows: any[] = [];
    for (const b of (result.blocks || [])) {
      const emotionalSet = new Set((b.block_emotional_words || []).map((w: string) => w.toLowerCase()));
      const rareSet = new Set((b.rare_words || []).map((w: string) => w.toLowerCase()));
      const dominantSet = new Set((b.dominant_words || []).map((w: string) => w.toLowerCase()));
      const impactSet = new Set((b.impact_words || []).map((w: string) => w.toLowerCase()));
      const freqMap = new Map<string, number>();
      (b.word_frequencies || []).forEach((wf: any) => freqMap.set(wf.word.toLowerCase(), wf.frequency));

      // Collect all unique words
      const allWords = new Set<string>();
      [...(b.block_keywords || []), ...(b.block_emotional_words || []), ...(b.rare_words || []),
       ...(b.dominant_words || []), ...(b.impact_words || []),
       ...(b.word_frequencies || []).map((wf: any) => wf.word),
      ].forEach((w: string) => allWords.add(w.toLowerCase().trim()));

      for (const word of allWords) {
        if (!word) continue;
        wordRows.push({
          video_id,
          block_id: b.block_id,
          block_type: b.block_type || "unknown",
          word,
          word_frequency: freqMap.get(word) || 1,
          is_emotional: emotionalSet.has(word),
          is_rare: rareSet.has(word),
          is_dominant: dominantSet.has(word),
          is_impact: impactSet.has(word),
          weighted_score: engagementRate > 0 ? +((freqMap.get(word) || 1) * engagementRate).toFixed(4) : null,
          timestamp_start: b.timestamp_start || null,
          timestamp_end: b.timestamp_end || null,
        });
      }
    }

    if (wordRows.length > 0) {
      // Insert in batches of 200
      for (let i = 0; i < wordRows.length; i += 200) {
        const batch = wordRows.slice(i, i + 200);
        const { error } = await supabase.from("block_word_patterns").insert(batch);
        if (error) throw new Error(`Failed to save word patterns: ${error.message}`);
      }
    }

    // Insert granular phrase patterns
    const phraseRows: any[] = [];
    for (const b of (result.blocks || [])) {
      for (const p of (b.phrases || [])) {
        const text = (p.text || "").trim();
        if (!text) continue;
        phraseRows.push({
          video_id,
          block_id: b.block_id,
          block_type: b.block_type || "unknown",
          phrase: text,
          phrase_type: p.is_strong ? "strong" : p.is_emotional ? "emotional" : "standard",
          phrase_category: p.category || null,
          is_emotional: p.is_emotional || false,
          is_repeated: p.is_repeated || false,
          is_strong: p.is_strong || false,
          phrase_length: text.split(/\s+/).length,
          phrase_position: b.timestamp_start || null,
          phrase_strength_score: Math.min(100, Math.max(0, Number(p.strength_score) || 0)),
          weighted_score: engagementRate > 0 ? +(Math.min(100, Number(p.strength_score) || 0) * engagementRate).toFixed(4) : null,
        });
      }
    }

    if (phraseRows.length > 0) {
      for (let i = 0; i < phraseRows.length; i += 200) {
        const batch = phraseRows.slice(i, i + 200);
        const { error } = await supabase.from("block_phrase_patterns").insert(batch);
        if (error) throw new Error(`Failed to save phrase patterns: ${error.message}`);
      }
    }

    // Save CTA profile
    if (result.cta_profile) {
      await supabase.from("cta_profiles").delete().eq("video_id", video_id);
      const { error: ctaErr } = await supabase.from("cta_profiles").insert({
        video_id,
        cta_text: result.cta_profile.cta_text || null,
        cta_position_seconds: result.cta_profile.cta_position_seconds || null,
        cta_type: result.cta_profile.cta_type || null,
        cta_emotion: result.cta_profile.cta_emotion || null,
        cta_action: result.cta_profile.cta_action || null,
        cta_intensity: result.cta_profile.cta_intensity || null,
      });
      if (ctaErr) throw new Error(`Failed to save CTA profile: ${ctaErr.message}`);
    }

    // === Extraction Logs — rastreabilidade verbal por bloco ===
    const extractionLogs: any[] = [];
    for (const b of (result.blocks || [])) {
      const fields = [
        ['block_keywords', JSON.stringify(b.block_keywords), (b.block_keywords || []).length > 0 ? 85 : 0],
        ['block_emotional_type', b.block_emotional_type, b.block_emotional_type ? 80 : 0],
        ['block_emotional_intensity', b.block_emotional_intensity, b.block_emotional_intensity != null ? 75 : 0],
        ['block_verbal_tone', b.block_verbal_tone, b.block_verbal_tone ? 80 : 0],
        ['rare_words', JSON.stringify(b.rare_words), (b.rare_words || []).length > 0 ? 70 : 0],
        ['dominant_words', JSON.stringify(b.dominant_words), (b.dominant_words || []).length > 0 ? 80 : 0],
        ['word_frequencies', `${(b.word_frequencies || []).length} words`, (b.word_frequencies || []).length > 0 ? 90 : 0],
        ['phrases', `${(b.phrases || []).length} phrases`, (b.phrases || []).length > 0 ? 85 : 0],
      ];
      for (const [field, value, confidence] of fields) {
        extractionLogs.push({
          video_id, extraction_step: `verbal-dna:${b.block_type}:${b.block_id}`,
          field_name: field as string,
          extracted_value: value != null ? String(value).substring(0, 500) : null,
          confidence_score: Math.min(100, Math.max(0, Math.round(confidence as number))),
          source_type: 'ai_extraction', origin_level: 'raw',
          error_flag: value == null, error_message: value == null ? 'Not detected' : null,
        });
      }
    }
    // CTA extraction log
    if (result.cta_profile) {
      extractionLogs.push({
        video_id, extraction_step: 'verbal-dna:cta',
        field_name: 'cta_profile', extracted_value: JSON.stringify(result.cta_profile).substring(0, 500),
        confidence_score: result.cta_profile.cta_intensity || 75,
        source_type: 'ai_extraction', origin_level: 'raw', error_flag: false,
      });
    }
    // Weighted scores are calculated
    extractionLogs.push({
      video_id, extraction_step: 'verbal-dna:weighted',
      field_name: 'weighted_scores', extracted_value: `engagement_rate=${engagementRate}, words=${wordRows.length}, phrases=${phraseRows.length}`,
      confidence_score: engagementRate > 0 ? 95 : 0,
      source_type: 'calculated', origin_level: 'calculated', error_flag: engagementRate === 0,
      error_message: engagementRate === 0 ? 'engagement_rate_relative is 0, weighted scores unavailable' : null,
    });

    // Persist extraction logs
    const { error: deleteLogsError } = await supabase
      .from("extraction_logs")
      .delete()
      .eq("video_id", video_id)
      .like("extraction_step", "verbal-dna%");
    if (deleteLogsError) throw new Error(`Failed to clear extraction logs: ${deleteLogsError.message}`);
    for (let i = 0; i < extractionLogs.length; i += 100) {
      const { error: insertLogsError } = await supabase
        .from("extraction_logs")
        .insert(extractionLogs.slice(i, i + 100));
      if (insertLogsError) throw new Error(`Failed to save extraction logs: ${insertLogsError.message}`);
    }

    await supabase.from("video_logs").insert({
      video_id, etapa: "Verbal DNA Engine", status: "success",
      mensagem: `Extração completa: ${semanticRows.length} blocos, ${wordRows.length} palavras, ${phraseRows.length} frases, CTA: ${result.cta_profile ? 'sim' : 'não'}, ${extractionLogs.length} logs rastreabilidade`,
    });

    return new Response(JSON.stringify({
      success: true,
      blocks_processed: semanticRows.length,
      words_extracted: wordRows.length,
      phrases_extracted: phraseRows.length,
      cta_extracted: !!result.cta_profile,
      extraction_logs: extractionLogs.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("extract-block-semantics error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = e instanceof ExactBlockCoverageError
      ? 422
      : message === "Rate limit exceeded"
      ? 429
      : message === "Gemini quota exhausted"
      ? 402
      : 500;
    return new Response(
      JSON.stringify({ error: message, success: false }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
