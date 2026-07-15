import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authorizeUserOrServiceRequest } from "../_shared/edge-auth.ts";
import {
  geminiOpenAIChat,
  hasGeminiApiKeys,
} from "../_shared/gemini-rotation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authFailure = await authorizeUserOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { hook_profile, previous_suggestions } = await req.json();

    // AUTOPROTECT: All values come from client (which fetched from DB)
    const narrativeFn = hook_profile?.narrative_function || null;
    const positionRole = hook_profile?.position_role || null;
    const expectedIntensity = hook_profile?.expected_intensity ?? null;
    const emotionVector = hook_profile?.emotion_vector || null;
    const patternType = hook_profile?.pattern_type || null;
    const expectedFirstEventPct = hook_profile?.expected_first_event_pct || null;
    const expectedTensionDensity = hook_profile?.expected_tension_density || null;
    const micropikeDensity = hook_profile?.micropike_density || null;
    const expectedLengthWords = hook_profile?.expected_length_words || null;

    // Real word lists from DB passed by client
    const realEmotionalWords = hook_profile?.real_emotional_words || [];
    const realImpactWords = hook_profile?.real_impact_words || [];

    // Real few-shot examples from top performing hooks
    const realTopHooks: string[] = hook_profile?.real_top_hooks || [];

    const avoidList = (previous_suggestions || []).map((s: any) => s.text).join("\n- ");

    // Build dynamic context — only include what exists in DB
    const contextLines: string[] = [];
    if (narrativeFn) contextLines.push(`- Narrative function: ${narrativeFn}`);
    if (positionRole) contextLines.push(`- Position: ${positionRole}`);
    if (expectedIntensity) contextLines.push(`- Expected intensity: ${expectedIntensity}`);
    if (emotionVector) contextLines.push(`- Emotional vector: ${emotionVector}`);
    if (patternType) contextLines.push(`- Pattern type: ${patternType}`);
    if (expectedFirstEventPct) contextLines.push(`- Expected first event position: ${expectedFirstEventPct}%`);
    if (expectedTensionDensity) contextLines.push(`- Expected tension density: ${expectedTensionDensity}`);
    if (micropikeDensity) contextLines.push(`- Micropike density: ${micropikeDensity}`);

    // AUTOPROTECT: Block if no context from DB
    if (contextLines.length === 0) {
      return new Response(JSON.stringify({
        error: "autoprotect_block",
        reason: "no_dna_context",
        message: "Nenhum dado de DNA disponível. Geração bloqueada pelo AUTOPROTECT."
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Word count constraints from real data
    let wordCountRule = "";
    if (expectedLengthWords) {
      wordCountRule = `- Word count range (from real data): ${expectedLengthWords} words`;
    }

    // Real vocabulary reference
    let vocabRef = "";
    if (realEmotionalWords.length > 0) {
      vocabRef += `\nREAL EMOTIONAL VOCABULARY FROM DATABASE (use as reference, not copy):\n${realEmotionalWords.slice(0, 30).join(", ")}`;
    }
    if (realImpactWords.length > 0) {
      vocabRef += `\nREAL IMPACT VOCABULARY FROM DATABASE (use as reference, not copy):\n${realImpactWords.slice(0, 30).join(", ")}`;
    }

    // Few-shot examples from real top-performing hooks
    let fewShotSection = "";
    if (realTopHooks.length > 0) {
      fewShotSection = `\nREAL TOP-PERFORMING HOOKS FROM DATABASE (study the style, tone, and structure — do NOT copy):\n${realTopHooks.map((h, i) => `${i + 1}. "${h}"`).join("\n")}`;
    }

    const systemPrompt = `You are a hook writer for short-form video scripts.

CRITICAL: You must generate hooks that match the patterns observed in the real database.

Rules for generated hooks (Portuguese BR):
${wordCountRule ? `${wordCountRule}` : ""}
- Each hook must be structurally different from the others
${vocabRef}
${fewShotSection}

IMPORTANT: All generation parameters come from a real database of ${contextLines.length > 0 ? "analyzed videos" : "NO DATA"}. 
Do NOT invent styles, patterns, or structures not reflected in the context provided.

You respond ONLY with valid JSON. No markdown, no explanation.`;

    const userPrompt = `Generate exactly 3 hook suggestions for a video script block.

Context from real DNA analysis:
${contextLines.join("\n")}

${avoidList ? `AVOID these hooks (do not repeat or paraphrase):\n- ${avoidList}` : ""}

Return JSON format:
{"suggestions":[{"id":1,"text":"..."},{"id":2,"text":"..."},{"id":3,"text":"..."}]}`;

    if (!hasGeminiApiKeys()) throw new Error("GEMINI_API_KEYS not configured");

    let parsed: { suggestions: Array<{ id: number; text: string }> } = { suggestions: [] };
    for (let outputAttempt = 0; outputAttempt < 2; outputAttempt++) {
      const response = await geminiOpenAIChat({
          model: "gemini-3.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded, tente novamente em alguns segundos." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI API error: ${response.status} - ${errText}`);
      }

      const result = await response.json();
      const rawContent = result.choices?.[0]?.message?.content;
      const content = Array.isArray(rawContent)
        ? rawContent.map((part: { text?: string }) => part?.text ?? "").join("")
        : String(rawContent ?? "{}");
      try {
        const candidate = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
        if (Array.isArray(candidate?.suggestions) && candidate.suggestions.length === 3 &&
          candidate.suggestions.every((item: unknown) =>
            !!item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" &&
            (item as { text: string }).text.trim().length > 0
          )) {
          parsed = candidate;
          break;
        }
      } catch {
        // Retry once with the next pool position when structured output is malformed.
      }
    }
    if (parsed.suggestions.length !== 3) {
      throw new Error("Gemini não retornou as 3 sugestões estruturadas após 2 tentativas.");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
