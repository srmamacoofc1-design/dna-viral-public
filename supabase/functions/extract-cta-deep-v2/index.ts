import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";
import { geminiOpenAIChat, hasGeminiApiKeys } from "../_shared/gemini-rotation.ts";
import { groundCtaText } from "../_shared/cta-evidence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { video_id } = await req.json();
    if (!video_id) {
      return new Response(JSON.stringify({ error: "video_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);
    if (!hasGeminiApiKeys()) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada", error_code: "AI_NOT_CONFIGURED" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get video data
    const { data: video, error: vErr } = await sb.from("videos").select("*").eq("id", video_id).single();
    if (vErr || !video) {
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get blocks with text
    const { data: blocks } = await sb.from("video_blocks").select("*").eq("video_id", video_id).order("bloco_id");

    // Build prompt with full context
    const blockTexts = (blocks || []).map((b: any) => ({
      block_id: b.id,
      bloco_id: b.bloco_id,
      tipo: b.tipo_bloco,
      texto: b.texto || "",
      tempo_inicio: b.tempo_inicio,
      tempo_fim: b.tempo_fim,
    }));
    const prompt = `You are a CTA (Call-to-Action) detection expert for viral video analysis.
Analyze this video's narrative blocks and detect ALL types of CTAs.

VIDEO INFO:
- Language: ${video.idioma || "unknown"}
- Duration: ${video.duracao || 0}s

NARRATIVE BLOCKS:
${JSON.stringify(blockTexts, null, 2)}

CRITICAL CLASSIFICATION RULES:

A phrase is ONLY a CTA if ALL conditions are met:
1) Contains imperative or directive structure
2) Targets the viewer directly (you/your/você)
3) Encourages an external action from the viewer

CTA indicators:
English: you, your, now, click, watch, follow, subscribe, buy now, don't skip, stay until, wait until, see what happens
Portuguese: você, agora, clique, assista, veja, inscreva-se, siga, não pule, espere, até o final

NEVER classify these as CTA - they are ACTION (narrative actions):
- First-person verbs: "I bought", "I watched", "I opened", "comprei", "assisti", "abri", "fiz", "vi"
- Third-person verbs: "he bought", "she opened", "they watched", "ele comprou", "ela abriu"
- Past tense descriptions of what someone did

If the phrase describes what someone DID (past action) rather than telling the VIEWER to DO something (directive), classify as "action" NOT as CTA.

DETECTION TYPES:

1. **explicit** — Direct commands to the viewer:
   "subscribe", "like", "follow", "share", "se inscreva", "curta", "compartilhe"
   "watch until the end", "don't miss", "stay tuned"

2. **implicit** — Indirect inducement to continue watching:
   "you won't believe what happens next", "wait for it"
   "o final vai te chocar", "você precisa ver isso"

3. **emotional** — Creates urgency/curiosity targeting the viewer:
   "isso vai te assustar", "this will shock you"
   Must target the VIEWER, not describe a character's emotion.

4. **narrative** — Structural retention elements:
   "mas então algo aconteceu...", "but then..."
   Cliffhangers, open loops.

5. **action** — Narrative actions (NOT CTA):
   "comprei a coca", "I watched", "he bought", "we opened"
   These describe what someone did. They are NOT calls to action.

INTENSITY SCALE (1-5):
1 = weak/subtle suggestion
2 = moderate nudge
3 = strong call
4 = very strong/urgent call
5 = critical/unmissable command

IMPORTANT:
- Detect in Portuguese, English, AND Spanish
- "action" type phrases should have LOW intensity (1-2)
- Only "explicit" and "implicit" types targeting the viewer get high intensity
- If no viewer-directed structure exists, reject CTA classification
- A hook creating curiosity IS a narrative CTA only if it addresses the viewer

Return a JSON array. Each object must have:
- block_id: string (UUID) or null
- cta_type: "explicit" | "implicit" | "emotional" | "narrative" | "action"
- cta_text: the actual text
- cta_intensity: 1-5
- cta_position_seconds: numeric
- cta_language: "pt" | "en" | "es"
- cta_confidence: 0-100

Return ONLY a valid JSON array, no other text.`;

    const aiResponse = await geminiOpenAIChat({
        model: "gemini-3.5-flash",
        messages: [
          { role: "system", content: "You are a precise CTA detection engine. Return only valid JSON arrays. Return [] when the spoken narrative has no CTA." },
          { role: "user", content: prompt },
        ],
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("Gemini error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Gemini API error", status: aiResponse.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "[]";
    
    // Parse JSON from response (handle markdown code blocks)
    let ctas: any[];
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      ctas = JSON.parse(cleaned);
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      return new Response(JSON.stringify({ error: "CTA_JSON_INVALID", error_code: "CTA_JSON_INVALID" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(ctas)) {
      return new Response(JSON.stringify({ error: "CTA_JSON_INVALID", error_code: "CTA_JSON_INVALID" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete old CTA events for this video
    await sb.from("video_cta_events").delete().eq("video_id", video_id);

    // Validate block_ids
    const validBlockIds = new Set((blocks || []).map((b: any) => b.id));

    // Insert new events
    const allowedCtaTypes = new Set(["explicit", "implicit", "emotional", "narrative"]);
    const records = ctas.flatMap((c: any) => {
      // `action` e apenas uma classe negativa do prompt: descreve a historia e
      // nunca pode virar evento CTA nem disputar o CTA principal.
      if (!allowedCtaTypes.has(c?.cta_type)) return [];
      const grounded = groundCtaText(c.cta_text, blocks || [], c.block_id);
      if (!grounded || !validBlockIds.has(grounded.block.id)) return [];
      return [{
        video_id,
        block_id: grounded.block.id,
        cta_type: c.cta_type,
        cta_text: grounded.text.slice(0, 500),
        cta_intensity: Math.max(1, Math.min(5, Math.round(Number(c.cta_intensity) || 2))),
        cta_position_seconds: Number(grounded.block.tempo_inicio) || 0,
        cta_language: ["pt", "en", "es"].includes(c.cta_language) ? c.cta_language : (video.idioma || "pt"),
        cta_confidence: Math.max(0, Math.min(100, Math.round(Number(c.cta_confidence) || 50))),
      }];
    });

    const { error: insertErr } = records.length > 0
      ? await sb.from("video_cta_events").insert(records)
      : { error: null };
    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to save CTAs", details: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert cta_deep_analysis (consolidated profile per video)
    const avgConfidence = records.length > 0
      ? Math.round(records.reduce((s: number, r: any) => s + r.cta_confidence, 0) / records.length)
      : 0;
    const primaryCta = records.length > 0
      ? records.reduce((best: any, r: any) => (r.cta_intensity > (best?.cta_intensity || 0)) ? r : best, records[0])
      : null;
    const hasImplicit = records.some((r: any) => r.cta_type === "implicit" || r.cta_type === "emotional" || r.cta_type === "narrative");

    await sb.from("cta_deep_analysis").delete().eq("video_id", video_id);
    if (primaryCta) await sb.from("cta_deep_analysis").insert({
      video_id,
      cta_text: primaryCta.cta_text,
      cta_position: primaryCta.cta_position_seconds <= (video.duracao || 999) * 0.33 ? "inicio" : primaryCta.cta_position_seconds <= (video.duracao || 999) * 0.66 ? "meio" : "fim",
      cta_type: primaryCta.cta_type,
      cta_tone: records.some((r: any) => r.cta_type === "emotional") ? "emocional" : records.some((r: any) => r.cta_type === "explicit") ? "direto" : "sutil",
      cta_target: "engagement",
      cta_intensity: primaryCta.cta_intensity,
      implicit_cta_detected: hasImplicit,
      confidence_score: avgConfidence,
      data_source_type: "ai_extraction",
      origin_level: "calculated",
    });

    // Log to extraction_logs
    await sb.from("extraction_logs").insert({
      video_id,
      extraction_step: "cta_deep_v2",
      field_name: "cta_events",
      extracted_value: `${records.length} CTAs detected`,
      source_type: "ai_extraction",
      origin_level: "calculated",
      confidence_score: avgConfidence,
      error_flag: false,
    });

    return new Response(JSON.stringify({
      success: true,
      video_id,
      ctas_detected: records.length,
      by_type: {
        explicit: records.filter((r: any) => r.cta_type === "explicit").length,
        implicit: records.filter((r: any) => r.cta_type === "implicit").length,
        emotional: records.filter((r: any) => r.cta_type === "emotional").length,
        narrative: records.filter((r: any) => r.cta_type === "narrative").length,
      },
      avg_intensity: records.length > 0
        ? +(records.reduce((s: number, r: any) => s + r.cta_intensity, 0) / records.length).toFixed(2)
        : 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("CTA Deep V2 error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
