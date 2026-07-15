import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  authorizeLibraryAdminOrServiceRequest,
  internalFunctionHeaders,
} from "../_shared/edge-auth.ts";
import {
  geminiOpenAIChat,
  hasGeminiApiKeys,
} from "../_shared/gemini-rotation.ts";
import {
  assignExactTranscriptTextToBlocks,
  assertNarrativeBlockContract,
  assertTranscriptTimelineMatchesSource,
  enforceNarrativeBlockLimit,
} from "../_shared/narrative-blocks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Modular Tool Schema ──────────────────────────────────────────────
const blockSchema = {
  type: "object",
  properties: {
    bloco_id: { type: "number" },
    tipo_bloco: {
      type: "string",
      enum: ["hook", "setup", "desenvolvimento", "tensao", "revelacao", "payoff", "transicao", "loop"],
    },
    tempo_inicio: { type: "number" },
    tempo_fim: { type: "number" },
    texto: { type: "string" },
    emocao: {
      type: "string",
      enum: ["curiosidade", "surpresa", "medo", "tensao", "alivio", "expectativa", "impacto"],
    },
    funcao_narrativa: { type: "string" },
    semantic_shift_score: { type: "number", description: "0-100 how strongly this block differs semantically from the previous one" },
    visual_shift_score: { type: "number", description: "0-100 estimated visual change at block boundary" },
  },
  required: ["bloco_id", "tipo_bloco", "tempo_inicio", "tempo_fim", "texto", "emocao", "funcao_narrativa"],
  additionalProperties: false,
};

const structuralAnalysis = {
  type: "object",
  description: "Core structural/temporal analysis of the video",
  properties: {
    emocao_predominante: { type: "string", enum: ["curiosidade", "surpresa", "medo", "tensao", "alivio", "expectativa", "impacto"] },
    intensidade_emocional: { type: "string", enum: ["baixa", "media", "alta"] },
    gancho_detectado: { type: "boolean" },
    tipo_gancho: { type: "string", enum: ["visual", "texto", "acao", "pergunta"] },
    tempo_gancho: { type: "number" },
    duracao_gancho: { type: "number" },
    tempo_primeiro_evento: { type: "number" },
    tempo_primeira_revelacao: { type: "number" },
    tempo_payoff: { type: "number" },
    loop_detectado: { type: "boolean" },
    tipo_viral: { type: "string" },
  },
  required: ["emocao_predominante", "intensidade_emocional", "gancho_detectado"],
  additionalProperties: false,
};

const verbalAnalysis = {
  type: "object",
  description: "Verbal/emotional analysis of the hook and narrative progression",
  properties: {
    first_impact_time: { type: "number", description: "Exact seconds (3 decimals) of first attention-capturing stimulus" },
    hook_text: { type: "string", description: "Exact text spoken during the hook block" },
    hook_keywords: { type: "array", items: { type: "string" }, description: "3-6 semantically/emotionally strongest words" },
    hook_phrase_pattern: { type: "string", enum: ["pergunta", "afirmação", "negação", "alerta", "promessa", "mistério", "descoberta", "erro", "proibição"] },
    hook_type_verbal: { type: "string", enum: ["emocional", "técnico", "misterioso", "alerta", "familiar", "curioso", "sensacionalista", "informativo"] },
    hook_emotion_verbal: { type: "string", enum: ["curiosidade", "medo", "alerta", "surpresa", "expectativa", "choque", "interesse"] },
    hook_emotion_intensity: { type: "number", description: "0-100 intensity" },
    narrative_progression_type: { type: "string", enum: ["linear", "crescente", "oscilante", "fragmentada", "escalonada"] },
    micro_turn_count: { type: "number" },
    micro_turn_types: { type: "array", items: { type: "string", enum: ["visual", "emocional", "informacional", "revelação", "surpresa"] } },
  },
  required: ["first_impact_time", "hook_text", "hook_keywords", "hook_phrase_pattern", "hook_type_verbal", "hook_emotion_verbal", "hook_emotion_intensity", "narrative_progression_type"],
  additionalProperties: false,
};

const payoffAnalysis = {
  type: "object",
  description: "Verbal analysis of the narrative payoff",
  properties: {
    payoff_text: { type: "string", description: "Exact text spoken during the payoff block" },
    payoff_type: { type: "string", enum: ["resposta", "revelação", "choque", "confirmação", "descoberta", "solução"] },
    payoff_emotion: { type: "string", enum: ["alívio", "choque", "surpresa", "satisfação", "admiração"] },
  },
  required: ["payoff_type", "payoff_emotion"],
  additionalProperties: false,
};

const ctaAnalysis = {
  type: "object",
  description: "Call-to-action detection and classification. All fields null if no CTA present.",
  properties: {
    cta_text: { type: "string", description: "Full CTA text, empty string if none" },
    cta_type: { type: "string", enum: ["direta", "emocional", "familiar", "reflexiva", "provocativa", "social"] },
    cta_position_time: { type: "number", description: "Exact timestamp of CTA in seconds" },
  },
  required: [],
  additionalProperties: false,
};

const classificationAnalysis = {
  type: "object",
  description: "AI-based classification of segment and visual style",
  properties: {
    segmento_ia: { type: "string", enum: ["meme", "curiosidade", "misterio", "terror", "historia_real", "narrativa_biblica"] },
    confianca_segmento: { type: "number" },
    estilo_visual_ia: { type: "string", enum: ["filme", "3d", "live_action", "animacao", "cgi", "stock_footage"] },
    confianca_estilo: { type: "number" },
  },
  required: ["segmento_ia", "confianca_segmento", "estilo_visual_ia", "confianca_estilo"],
  additionalProperties: false,
};

// Full tool schema composed from groups
const toolSchema = {
  type: "object",
  properties: {
    blocks: { type: "array", items: blockSchema },
    structural_analysis: structuralAnalysis,
    verbal_analysis: verbalAnalysis,
    payoff_analysis: payoffAnalysis,
    cta_analysis: ctaAnalysis,
    classification_analysis: classificationAnalysis,
  },
  required: ["blocks", "structural_analysis", "verbal_analysis", "payoff_analysis", "classification_analysis"],
  additionalProperties: false,
};

// ── Flatten helper: maps modular AI response → flat DB columns ───────
function flattenAnalysis(a: any) {
  const s = a.structural_analysis || {};
  const v = a.verbal_analysis || {};
  const p = a.payoff_analysis || {};
  const c = a.cta_analysis || {};
  const cl = a.classification_analysis || {};
  return {
    emocao_predominante: s.emocao_predominante ?? null,
    intensidade_emocional: s.intensidade_emocional ?? null,
    gancho_detectado: s.gancho_detectado ?? false,
    tipo_gancho: s.tipo_gancho ?? null,
    tempo_gancho: s.tempo_gancho ?? null,
    duracao_gancho: s.duracao_gancho ?? null,
    tempo_primeiro_evento: s.tempo_primeiro_evento ?? null,
    tempo_primeira_revelacao: s.tempo_primeira_revelacao ?? null,
    tempo_payoff: s.tempo_payoff ?? null,
    loop_detectado: s.loop_detectado ?? false,
    tipo_viral: s.tipo_viral ?? null,
    first_impact_time: v.first_impact_time ?? null,
    hook_text: v.hook_text ?? null,
    hook_keywords: v.hook_keywords ?? null,
    hook_phrase_pattern: v.hook_phrase_pattern ?? null,
    hook_type_verbal: v.hook_type_verbal ?? null,
    hook_emotion_verbal: v.hook_emotion_verbal ?? null,
    hook_emotion_intensity: v.hook_emotion_intensity != null ? Math.round(v.hook_emotion_intensity <= 1 ? v.hook_emotion_intensity * 100 : v.hook_emotion_intensity) : null,
    narrative_progression_type: v.narrative_progression_type ?? null,
    micro_turn_count: v.micro_turn_count != null ? Math.round(v.micro_turn_count) : null,
    micro_turn_types: v.micro_turn_types ?? null,
    payoff_text: p.payoff_text ?? null,
    payoff_type: p.payoff_type ?? null,
    payoff_emotion: p.payoff_emotion ?? null,
    cta_text: c.cta_text || null,
    cta_type: c.cta_type ?? null,
    cta_position_time: c.cta_position_time ?? null,
    segmento_ia: cl.segmento_ia ?? null,
    confianca_segmento: cl.confianca_segmento != null ? Math.round(cl.confianca_segmento <= 1 ? cl.confianca_segmento * 100 : cl.confianca_segmento) : null,
    estilo_visual_ia: cl.estilo_visual_ia ?? null,
    confianca_estilo: cl.confianca_estilo != null ? Math.round(cl.confianca_estilo <= 1 ? cl.confianca_estilo * 100 : cl.confianca_estilo) : null,
  };
}

function exactSpokenHookKeywords(spokenHook: string): string[] {
  const stopwords = new Set([
    "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "um", "uma",
    "que", "se", "com", "para", "por", "na", "no", "nas", "nos", "the", "and", "is",
  ]);
  const counts = new Map<string, { word: string; count: number; first: number }>();
  const tokens = spokenHook.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]+/gu) || [];
  tokens.forEach((word, first) => {
    const key = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (word.length < 3 || stopwords.has(key)) return;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { word, count: 1, first });
  });
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.first - right.first)
    .slice(0, 6)
    .map((entry) => entry.word);
}

// ── Block validation & enforcement ───────────────────────────────────
const MIN_BLOCK_DURATION = 1.2;

function validateAndEnforceBlocks(blocks: any[], totalDuration: number): any[] {
  if (!blocks || blocks.length === 0) return blocks;

  // Sort by tempo_inicio without mutating the provider payload.
  const sortedBlocks = [...blocks].sort((a, b) => a.tempo_inicio - b.tempo_inicio);

  // Filter out blocks shorter than minimum
  const filteredBlocks = sortedBlocks.filter(b => {
    const dur = b.tempo_fim - b.tempo_inicio;
    return dur >= MIN_BLOCK_DURATION;
  });

  // Gemini can occasionally over-segment despite the requested range. Merge
  // the weakest semantic boundaries instead of truncating facts or payoff.
  const validBlocks = enforceNarrativeBlockLimit(filteredBlocks, 18);

  // Re-number bloco_id sequentially
  validBlocks.forEach((b, i) => { b.bloco_id = i + 1; });

  // Calculate block_density_score per block
  const avgDur = totalDuration / validBlocks.length;
  validBlocks.forEach(b => {
    const dur = Number(b.tempo_fim) - Number(b.tempo_inicio);
    // Density: shorter blocks relative to average = higher density
    b.block_density_score = Math.round(Math.min(100, Math.max(0, (avgDur / Math.max(dur, 0.1)) * 50)));
  });

  return validBlocks;
}

function throwIfDatabaseError(
  operation: string,
  error: { message?: string } | null | undefined,
): void {
  if (!error) return;
  throw new Error(`${operation} failed: ${error.message || "unknown database error"}`);
}

// ── Main handler ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { video_id, orchestrated = false } = await req.json();
    if (!video_id) {
      return new Response(JSON.stringify({ error: "Missing video_id" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasGeminiApiKeys()) throw new Error("GEMINI_API_KEYS is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const [videoRes, transcriptsRes] = await Promise.all([
      supabase.from("videos").select("*").eq("id", video_id).single(),
      supabase.from("video_transcripts").select("*").eq("video_id", video_id).order("tempo_inicio"),
    ]);

    const video = videoRes.data;
    const transcripts = transcriptsRes.data || [];
    if (!video) throw new Error("Video not found");
    if (transcripts.length === 0) {
      return new Response(JSON.stringify({ error: "No transcripts found" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("video_logs").insert({
      video_id, etapa: "Análise Narrativa v2", status: "success",
      mensagem: "Analisando estrutura narrativa com segmentação refinada v2...",
    });

    const transcriptText = transcripts
      .map((t: any) => `[${t.tempo_inicio}s - ${t.tempo_fim}s] ${t.texto}`)
      .join("\n");

    // The media/container duration persisted by ingestion (ffprobe) is the
    // authoritative timeline. A longer or materially incomplete transcript is
    // evidence from the wrong source and must fail before spending AI quota.
    const totalDuration = assertTranscriptTimelineMatchesSource(transcripts, video.duracao);

    // Calculate target block count based on video duration
    const targetBlockCount = Math.max(6, Math.min(14, Math.round(totalDuration / 4)));

    const aiResponse = await geminiOpenAIChat({
        model: "gemini-3.5-flash",
        // Large 14-18 block schemas can exceed the Edge gateway at high
        // reasoning. Medium keeps the full structured output inside the
        // request lifetime; the importer supplies the larger retry budget.
        reasoning_effort: "medium",
        messages: [
          {
            role: "system",
            content: `You are an expert narrative analyst for short-form viral videos.
Analyze the transcription and produce a MODULAR analysis with these groups:

1. BLOCKS: Produce ${targetBlockCount}-${targetBlockCount + 4} narrative blocks with precise timestamps (3 decimal places).
   Types: hook, setup, desenvolvimento, tensao, revelacao, payoff, transicao, loop
   Emotions: curiosidade, surpresa, medo, tensao, alivio, expectativa, impacto

   SEGMENTATION RULES (v2_refined):
   - Detect NATURAL micro-transitions — do NOT use fixed time slicing
   - Split blocks at semantic boundaries using these signals:
     a) Meaning shift: the transcript changes topic, subject, or argument direction
     b) Sentence boundary: a clear sentence ends and a new idea begins
     c) Speech pause: a gap or hesitation in the transcript flow
     d) Emotion shift: the emotional tone changes (e.g., curiosity → fear)
     e) CTA boundary: a call-to-action starts or ends
     f) Revelation moment: new information is disclosed
   - A block boundary should be placed when ANY TWO of these signals occur together
   - MINIMUM block duration: 1.2 seconds (never shorter)
   - MAXIMUM block duration: 6.5 seconds (if exceeded, evaluate for internal semantic split)
   - Each block MUST have real transcript text — no empty blocks
   - For each block, provide semantic_shift_score (0-100) indicating how different this block is from the previous one
   - For each block, provide visual_shift_score (0-100) estimating visual change at this boundary

2. STRUCTURAL_ANALYSIS: dominant emotion, hook detection, key timestamps, loop detection.

3. VERBAL_ANALYSIS: 
   - hook_text: EXACT transcript text from the hook block only
   - hook_keywords: 3-6 words with highest semantic/emotional weight (NO stopwords like "the","and","is")
   - hook_phrase_pattern: structure of opening phrase
   - hook_type_verbal: narrative classification of hook
   - hook_emotion_verbal: dominant emotion from hook WORDS
   - hook_emotion_intensity: 0-100 scale
   - first_impact_time: exact second (3 decimals) of FIRST attention stimulus — not hook start, but first real impact moment
   - narrative_progression_type: how narrative evolves across blocks
   - micro_turn_count / micro_turn_types: narrative direction changes

4. PAYOFF_ANALYSIS:
   - payoff_text: EXACT transcript text from the payoff block
   - payoff_type: type of narrative delivery
   - payoff_emotion: emotion generated

5. CTA_ANALYSIS:
   - If a call-to-action exists: extract text, type, timestamp
   - If none: leave all fields empty/omitted

6. CLASSIFICATION_ANALYSIS: segment type, visual style with confidence %.

CRITICAL RULES:
- Use REAL transcript timestamps with 3 decimal places
- hook_text must match ONLY transcript segments within the hook block timerange
- hook_keywords must be semantically strong, never generic words
- first_impact_time must be the actual first moment of attention capture
- payoff_text must match transcript segments within the payoff block timerange
- Aim for ${targetBlockCount}-${targetBlockCount + 4} blocks — higher granularity than before
- Each block must represent a coherent narrative micro-unit`,
          },
          {
            role: "user",
            content: `Analyze this video (${video.segmento} / ${video.estilo_visual}, ~${totalDuration}s):

${transcriptText}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_analysis",
            description: "Save modular narrative analysis with refined v2 segmentation",
            parameters: toolSchema,
          },
        }],
        tool_choice: { type: "function", function: { name: "save_analysis" } },
    }, {
      // Sweep the configured pool, but never exceed the Edge request budget.
      // Invalid/forbidden keys advance immediately inside this deadline.
      totalTimeoutMs: 140_000,
      baseDelayMs: 200,
      maxDelayMs: 2_000,
      // Keep two complete provider attempts inside the total Edge budget. A
      // stalled key must not consume 75% of the rotation deadline by itself.
      attemptTimeoutMs: 65_000,
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errorText);
      if (aiResponse.status === 429) throw new Error("Rate limit exceeded");
      if (aiResponse.status === 402) throw new Error("Gemini quota exhausted");
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI did not return structured analysis");

    const analysis = JSON.parse(toolCall.function.arguments);
    const flat = flattenAnalysis(analysis);

    // Validate and enforce block constraints
    const providerBlocks = validateAndEnforceBlocks(analysis.blocks || [], totalDuration);
    const validatedBlocks = assignExactTranscriptTextToBlocks(providerBlocks, transcripts);
    assertNarrativeBlockContract(validatedBlocks, totalDuration);

    const langCode = transcripts[0]?.language_code || "pt";
    const blocks = validatedBlocks.map((b: any) => ({
      video_id, bloco_id: b.bloco_id, tipo_bloco: b.tipo_bloco,
      tempo_inicio: b.tempo_inicio, tempo_fim: b.tempo_fim,
      texto: b.texto, emocao: b.emocao, funcao_narrativa: b.funcao_narrativa,
      language_code: langCode,
      block_density_score: b.block_density_score ?? null,
      semantic_shift_score: b.semantic_shift_score ?? null,
      visual_shift_score: b.visual_shift_score ?? null,
    }));
    // Derive hook timing from blocks
    const hookBlock = validatedBlocks.find((b: any) => b.tipo_bloco === "hook");
    const finalTempoGancho = hookBlock ? Number(hookBlock.tempo_inicio) : (flat.tempo_gancho ?? null);
    const finalDuracaoGancho = hookBlock
      ? Number(hookBlock.tempo_fim) - Number(hookBlock.tempo_inicio)
      : (flat.duracao_gancho ?? null);
    const finalGanchoDetectado = !!hookBlock || !!flat.gancho_detectado;

    // Spoken hook/payoff text is always the exact caption text assigned above.
    // Never persist an AI paraphrase or publication title in these fields.
    const hookText = hookBlock ? String(hookBlock.texto || "").trim() || null : null;
    if (!hookText) throw new Error("NARRATIVE_HOOK_TRANSCRIPT_TEXT_MISSING");
    const hookKeywords = exactSpokenHookKeywords(hookText);

    // Fallback payoff_text
    const payoffBlock = validatedBlocks.find((b: any) => b.tipo_bloco === "payoff");
    const payoffText = payoffBlock ? String(payoffBlock.texto || "").trim() || null : null;

    // Save to videos table
    const updatePayload: any = {
      numero_blocos: validatedBlocks.length,
      gancho_detectado: finalGanchoDetectado,
      tipo_gancho: flat.tipo_gancho || (hookBlock ? "visual" : null),
      tempo_gancho: finalTempoGancho,
      duracao_gancho: finalDuracaoGancho,
      emocao_predominante: flat.emocao_predominante,
      intensidade_emocional: flat.intensidade_emocional,
      tempo_primeiro_evento: flat.tempo_primeiro_evento,
      tempo_primeira_revelacao: flat.tempo_primeira_revelacao,
      tempo_payoff: flat.tempo_payoff,
      loop_detectado: flat.loop_detectado,
      tipo_viral: flat.tipo_viral,
      segmento_ia: flat.segmento_ia,
      confianca_segmento: flat.confianca_segmento,
      estilo_visual_ia: flat.estilo_visual_ia,
      confianca_estilo: flat.confianca_estilo,
      ...(flat.segmento_ia ? { segmento: flat.segmento_ia } : {}),
      ...(flat.estilo_visual_ia ? { estilo_visual: flat.estilo_visual_ia } : {}),
      first_impact_time: flat.first_impact_time,
      hook_text: hookText,
      hook_keywords: hookKeywords,
      hook_phrase_pattern: flat.hook_phrase_pattern,
      hook_type_verbal: flat.hook_type_verbal,
      hook_emotion_verbal: flat.hook_emotion_verbal,
      hook_emotion_intensity: flat.hook_emotion_intensity,
      narrative_progression_type: flat.narrative_progression_type,
      micro_turn_count: flat.micro_turn_count,
      micro_turn_types: flat.micro_turn_types,
      payoff_text: payoffText,
      payoff_type: flat.payoff_type,
      payoff_emotion: flat.payoff_emotion,
      cta_text: flat.cta_text,
      cta_type: flat.cta_type,
      cta_position_time: flat.cta_position_time,
      // The orchestrated browser pipeline still has critical visual stages to run.
      status: orchestrated ? "processing" : "completed",
      block_segmentation_version: "v2_refined",
    };
    // The database function validates the same block envelope and replaces
    // blocks + structural video fields in one transaction. No delete is issued
    // by the Edge function, so an insertion/cast failure cannot erase a valid
    // prior narrative analysis.
    const { error: atomicNarrativeError } = await (supabase as any).rpc(
      "replace_video_narrative_atomic",
      {
        p_video_id: video_id,
        p_blocks: blocks,
        p_video_update: updatePayload,
      },
    );
    throwIfDatabaseError("replace narrative atomically", atomicNarrativeError);

    if (!orchestrated) {
      const { error: queueUpdateError } = await supabase.from("processing_queue").update({
        status: "completed", completed_at: new Date().toISOString(),
      }).eq("video_id", video_id);
      throwIfDatabaseError("update processing_queue", queueUpdateError);
    }

    // === Extraction Logs — rastreabilidade de cada campo extraído ===
    const extractionLogs: any[] = [];
    const logField = (step: string, field: string, value: any, confidence: number, source: string, origin: string = 'raw') => {
      extractionLogs.push({
        video_id, extraction_step: step, field_name: field,
        extracted_value: value != null ? String(value).substring(0, 500) : null,
        confidence_score: Math.min(100, Math.max(0, Math.round(confidence))),
        source_type: source, origin_level: origin,
        error_flag: value == null || value === '',
        error_message: value == null ? 'Field not detected by AI' : null,
      });
    };

    // Log structural fields
    const structFields = [
      ['emocao_predominante', flat.emocao_predominante, 85],
      ['intensidade_emocional', flat.intensidade_emocional, 80],
      ['gancho_detectado', flat.gancho_detectado, finalGanchoDetectado ? 95 : 50],
      ['tipo_gancho', flat.tipo_gancho, flat.tipo_gancho ? 80 : 0],
      ['tempo_gancho', finalTempoGancho, finalTempoGancho != null ? 90 : 0],
      ['tempo_primeiro_evento', flat.tempo_primeiro_evento, flat.tempo_primeiro_evento != null ? 85 : 0],
      ['tempo_payoff', flat.tempo_payoff, flat.tempo_payoff != null ? 85 : 0],
      ['loop_detectado', flat.loop_detectado, 75],
      ['tipo_viral', flat.tipo_viral, flat.tipo_viral ? 70 : 0],
    ];
    for (const [f, v, c] of structFields) logField('analyze-narrative:structural', f as string, v, c as number, 'ai_extraction');

    // Log verbal fields
    const verbalFields = [
      ['hook_text', hookText, hookText ? 90 : 0],
      ['hook_keywords', JSON.stringify(hookKeywords), hookKeywords.length ? 100 : 0],
      ['hook_phrase_pattern', flat.hook_phrase_pattern, flat.hook_phrase_pattern ? 80 : 0],
      ['hook_emotion_verbal', flat.hook_emotion_verbal, flat.hook_emotion_verbal ? 80 : 0],
      ['hook_emotion_intensity', flat.hook_emotion_intensity, flat.hook_emotion_intensity != null ? 75 : 0],
      ['first_impact_time', flat.first_impact_time, flat.first_impact_time != null ? 85 : 0],
      ['narrative_progression_type', flat.narrative_progression_type, flat.narrative_progression_type ? 75 : 0],
    ];
    for (const [f, v, c] of verbalFields) logField('analyze-narrative:verbal', f as string, v, c as number, 'ai_extraction');

    // Log segmentation version
    logField('analyze-narrative:segmentation', 'block_segmentation_version', 'v2_refined', 100, 'calculated', 'calculated');
    logField('analyze-narrative:segmentation', 'block_count', validatedBlocks.length, 95, 'calculated', 'calculated');

    // Log payoff/CTA
    logField('analyze-narrative:payoff', 'payoff_text', payoffText, payoffText ? 85 : 0, 'ai_extraction');
    logField('analyze-narrative:payoff', 'payoff_type', flat.payoff_type, flat.payoff_type ? 80 : 0, 'ai_extraction');
    logField('analyze-narrative:cta', 'cta_text', flat.cta_text, flat.cta_text ? 85 : 0, 'ai_extraction');

    // Log classification
    logField('analyze-narrative:classification', 'segmento_ia', flat.segmento_ia, flat.confianca_segmento || 0, 'ai_extraction');
    logField('analyze-narrative:classification', 'estilo_visual_ia', flat.estilo_visual_ia, flat.confianca_estilo || 0, 'ai_extraction');

    // Log calculated fields
    logField('analyze-narrative:derived', 'duracao_gancho', finalDuracaoGancho, finalDuracaoGancho != null ? 95 : 0, 'calculated', 'calculated');
    logField('analyze-narrative:derived', 'numero_blocos', validatedBlocks.length, 95, 'calculated', 'calculated');

    // Batch insert extraction logs
    if (extractionLogs.length > 0) {
      const { error: extractionDeleteError } = await supabase
        .from("extraction_logs")
        .delete()
        .eq("video_id", video_id)
        .like("extraction_step", "analyze-narrative%");
      throwIfDatabaseError("delete extraction_logs", extractionDeleteError);
      for (let i = 0; i < extractionLogs.length; i += 100) {
        const { error: extractionInsertError } = await supabase
          .from("extraction_logs")
          .insert(extractionLogs.slice(i, i + 100));
        throwIfDatabaseError("insert extraction_logs", extractionInsertError);
      }
    }

    const { error: completionLogError } = await supabase.from("video_logs").insert({
      video_id, etapa: "Análise Narrativa v2", status: "success",
      mensagem: `Segmentação v2_refined: ${validatedBlocks.length} blocos (target ${targetBlockCount}-${targetBlockCount + 4}) + camada verbal + ${extractionLogs.length} logs`,
    });
    throwIfDatabaseError("insert narrative completion log", completionLogError);

    // Em execução orquestrada, as etapas seguintes são executadas pelo worker (evita timeout em cascata)
    if (!orchestrated) {
      // === AUTO: Extract block-level semantics (non-blocking, errors isolated) ===
      try {
        const fnUrl = `${SUPABASE_URL}/functions/v1/extract-block-semantics`;
        const blockSemResp = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...internalFunctionHeaders(SUPABASE_SERVICE_ROLE_KEY),
          },
          body: JSON.stringify({ video_id }),
        });
        const blockSemData = await blockSemResp.json();
        if (blockSemData.error) {
          console.error("Block semantics auto-extraction error:", blockSemData.error);
          await supabase.from("video_logs").insert({
            video_id, etapa: "Auto Semântica por Bloco", status: "warning",
            mensagem: `Extração automática falhou (não-crítico): ${blockSemData.error}`,
          });
        } else {
          await supabase.from("video_logs").insert({
            video_id, etapa: "Auto Semântica por Bloco", status: "success",
            mensagem: `Extração automática: ${blockSemData.blocks_processed || 0} blocos processados`,
          });
        }
      } catch (blockSemErr) {
        console.error("Block semantics auto-extraction exception:", blockSemErr);
        await supabase.from("video_logs").insert({
          video_id, etapa: "Auto Semântica por Bloco", status: "warning",
          mensagem: `Exceção na extração automática (não-crítico): ${blockSemErr instanceof Error ? blockSemErr.message : "unknown"}`,
        });
      }

      // === AUTO: Extract visual blocks (non-blocking) ===
      try {
        const visUrl = `${SUPABASE_URL}/functions/v1/extract-visual-blocks`;
        const visResp = await fetch(visUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...internalFunctionHeaders(SUPABASE_SERVICE_ROLE_KEY),
          },
          body: JSON.stringify({ video_id }),
        });
        const visData = await visResp.json();
        if (visData.error) {
          console.error("Visual blocks extraction error:", visData.error);
        } else {
          await supabase.from("video_logs").insert({
            video_id, etapa: "Extração Visual por Bloco", status: "success",
            mensagem: `Auto: ${visData.blocks_processed || 0} blocos visuais persistidos`,
          });
        }
      } catch (visErr) {
        console.error("Visual blocks extraction exception:", visErr);
      }

      // === AUTO: Validate data consistency (non-blocking) ===
      try {
        const valUrl = `${SUPABASE_URL}/functions/v1/validate-data-consistency`;
        const valResp = await fetch(valUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...internalFunctionHeaders(SUPABASE_SERVICE_ROLE_KEY),
          },
          body: JSON.stringify({ video_id }),
        });
        const valData = await valResp.json();
        if (valData.issues > 0) {
          await supabase.from("video_logs").insert({
            video_id, etapa: "Validação de Consistência", status: "warning",
            mensagem: `${valData.issues} inconsistência(s) detectada(s)`,
          });
        } else {
          await supabase.from("video_logs").insert({
            video_id, etapa: "Validação de Consistência", status: "success",
            mensagem: "Dados consistentes — sem problemas detectados",
          });
        }
      } catch (valErr) {
        console.error("Validation exception:", valErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      segmentation_version: "v2_refined",
      blocks_count: validatedBlocks.length,
      target_range: `${targetBlockCount}-${targetBlockCount + 4}`,
      verbal_layer: {
        hook_text: !!hookText,
        hook_keywords: hookKeywords.length > 0,
        hook_phrase_pattern: !!flat.hook_phrase_pattern,
        hook_type_verbal: !!flat.hook_type_verbal,
        hook_emotion_verbal: !!flat.hook_emotion_verbal,
        hook_emotion_intensity: flat.hook_emotion_intensity,
        first_impact_time: flat.first_impact_time,
        narrative_progression: !!flat.narrative_progression_type,
        payoff_type: !!flat.payoff_type,
        payoff_emotion: !!flat.payoff_emotion,
        cta_detected: !!flat.cta_text,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("analyze-narrative error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    const providerStatus = Number(message.match(/(?:failed:\s*|HTTP\s*)(\d{3})/i)?.[1] || 0) || null;
    const status = message === "Rate limit exceeded"
      ? 429
      : message === "Gemini quota exhausted"
      ? 402
      : providerStatus === 401 || providerStatus === 403
      ? 502
      : 500;
    return new Response(
      JSON.stringify({
        error: message,
        success: false,
        retryable: status === 429 || status >= 500,
        provider_status: providerStatus,
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
