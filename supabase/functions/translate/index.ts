import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authorizeUserOrServiceRequest } from "../_shared/edge-auth.ts";
import {
  geminiOpenAIChat,
  hasGeminiApiKeys,
} from "../_shared/gemini-rotation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LANG_NAMES: Record<string, string> = {
  pt: "Portuguese",
  en: "English",
  es: "Spanish",
  fr: "French",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeUserOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { texts, source_lang, target_lang } = await req.json();

    if (!texts || !Array.isArray(texts) || !source_lang || !target_lang) {
      return new Response(JSON.stringify({ error: "Missing texts, source_lang, or target_lang" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasGeminiApiKeys()) throw new Error("GEMINI_API_KEYS is not configured");

    const sourceName = LANG_NAMES[source_lang] || source_lang;
    const targetName = LANG_NAMES[target_lang] || target_lang;

    const prompt = `Translate the following texts from ${sourceName} to ${targetName}. 
Return ONLY a JSON array of translated strings in the same order. No explanations, no markdown.

Texts to translate:
${JSON.stringify(texts)}`;

    const response = await geminiOpenAIChat({
        model: "gemini-3.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a professional translator. You translate text accurately while preserving meaning, tone, and context. Return only the JSON array of translated strings."
          },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_translations",
              description: "Return the translated texts as a JSON array",
              parameters: {
                type: "object",
                properties: {
                  translations: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of translated strings in the same order as input"
                  }
                },
                required: ["translations"],
                additionalProperties: false,
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "return_translations" } },
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Gemini quota is currently unavailable." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Gemini translation error:", response.status, t);
      return new Response(JSON.stringify({ error: "Translation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract from tool call response
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let translations: string[];
    
    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments);
      translations = args.translations;
    } else {
      // Fallback: try parsing content directly
      const content = data.choices?.[0]?.message?.content || "[]";
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      translations = JSON.parse(cleaned);
    }

    return new Response(JSON.stringify({ translations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("translate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
