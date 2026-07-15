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
    const { early_event_profile, previous_suggestions } = await req.json();

    // AUTOPROTECT: All values from client (DB-sourced). No fallbacks.
    const hookText = early_event_profile?.hook_text || "";
    const emotionVector = early_event_profile?.emotion_vector || null;
    const patternType = early_event_profile?.pattern_type || null;
    const tensionDensity = early_event_profile?.expected_tension_density || null;
    const micropikeDensity = early_event_profile?.micropike_density || null;
    const narrativeFunction = early_event_profile?.narrative_function || null;

    // Real word lists from DB
    const realTensionWords = early_event_profile?.real_tension_words || [];
    const realActionWords = early_event_profile?.real_action_words || [];

    // Real few-shot examples
    const realTopEarlyEvents: string[] = early_event_profile?.real_top_early_events || [];

    // Word count from real data
    const p10 = early_event_profile?.word_count_p10;
    const p90 = early_event_profile?.word_count_p90;

    const avoidList = (previous_suggestions || []).map((s: any) => s.text).join("\n- ");

    // Build dynamic context — only include what exists in DB
    const contextLines: string[] = [];
    if (narrativeFunction) contextLines.push(`- Narrative function: ${narrativeFunction}`);
    if (emotionVector) contextLines.push(`- Emotional vector: ${emotionVector}`);
    if (patternType) contextLines.push(`- Pattern type: ${patternType}`);
    if (tensionDensity) contextLines.push(`- Expected tension density: ${tensionDensity}`);
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

    let wordCountRule = "";
    if (p10 != null && p90 != null) {
      wordCountRule = `- Word count range (from real data): ${Math.round(p10)}-${Math.round(p90)} words`;
    }

    let vocabRef = "";
    if (realTensionWords.length > 0) {
      vocabRef += `\nREAL TENSION VOCABULARY FROM DATABASE:\n${realTensionWords.slice(0, 30).join(", ")}`;
    }
    if (realActionWords.length > 0) {
      vocabRef += `\nREAL ACTION VOCABULARY FROM DATABASE:\n${realActionWords.slice(0, 30).join(", ")}`;
    }

    // Few-shot examples from real top-performing early events
    let fewShotSection = "";
    if (realTopEarlyEvents.length > 0) {
      fewShotSection = `\nREAL TOP-PERFORMING EARLY EVENTS FROM DATABASE (study the style — do NOT copy):\n${realTopEarlyEvents.map((h, i) => `${i + 1}. "${h}"`).join("\n")}`;
    }

    const systemPrompt = `You are a narrative event writer for short-form video scripts.

CRITICAL: You must generate text that matches the patterns observed in the real database.

Rules for generated text (Portuguese BR):
${wordCountRule ? `${wordCountRule}` : ""}
- Each suggestion must be structurally different from the others
${vocabRef}
${fewShotSection}

IMPORTANT: All generation parameters come from a real database of analyzed videos.
Do NOT invent styles, patterns, or structures not reflected in the context provided.

You respond ONLY with valid JSON. No markdown, no explanation.`;

    const userPrompt = `Generate exactly 3 early event suggestions that continue this hook:

HOOK TEXT: "${hookText}"

Context from real DNA analysis:
${contextLines.join("\n")}

${avoidList ? `AVOID these texts (do not repeat or paraphrase):\n- ${avoidList}` : ""}

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
