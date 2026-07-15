import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Explicit CTA keywords — require clear action intent
const CTA_KEYWORDS: Record<string, string[]> = {
  seguir: ["segue aí", "siga o", "seguir", "me segue", "segue agora"],
  comentar: ["comenta aí", "comenta aqui", "deixa um comentário", "diz nos comentários", "conta pra gente"],
  compartilhar: ["compartilha", "envia pra", "manda pro", "compartilhe", "reposta"],
  clicar: ["link na bio", "clique no link", "clica no link", "acesse o link", "saiba mais no link"],
  comprar: ["compre agora", "adquira", "garanta o seu", "oferta limitada", "aproveite o desconto"],
};

const CTA_TONE_INDICATORS: Record<string, string[]> = {
  urgente: ["agora mesmo", "rápido", "corre que", "última chance", "vai acabar", "não perca"],
  sugestivo: ["que tal", "poderia", "talvez você", "pense em"],
  autoridade: ["eu garanto", "confie em mim", "pode confiar", "como especialista", "anos de experiência"],
  curiosidade: ["quer saber mais", "descubra como", "saiba o que", "você não vai acreditar"],
};

function detectCTATarget(text: string): string | null {
  const t = text.toLowerCase();
  for (const [target, phrases] of Object.entries(CTA_KEYWORDS)) {
    if (phrases.some(p => t.includes(p))) return target;
  }
  return null;
}

function detectCTATone(text: string): { tone: string; confidence: number } {
  const t = text.toLowerCase();
  for (const [tone, indicators] of Object.entries(CTA_TONE_INDICATORS)) {
    const matches = indicators.filter(w => t.includes(w)).length;
    if (matches >= 1) return { tone, confidence: Math.min(90, 50 + matches * 20) };
  }
  return { tone: "sugestivo", confidence: 30 };
}

function detectCTAType(text: string, isImplicit: boolean, target: string | null): string {
  if (isImplicit) return "implicito";
  const t = text.toLowerCase();
  // Direct: has clear action verb targeting audience
  if (target && ["seguir", "comentar", "compartilhar", "clicar", "comprar"].includes(target)) return "direto";
  if (t.includes("emoção") || t.includes("coração") || t.includes("sente")) return "emocional";
  if (t.includes("dados") || t.includes("prova") || t.includes("estudo")) return "racional";
  return "indireto";
}

// Stricter implicit CTA detection: needs real engagement intent, not just "você" or "?"
function detectImplicitCTA(text: string, blockType: string): { detected: boolean; confidence: number } {
  const t = text.toLowerCase();
  
  // Must have engagement-driving intent, not just conversational language
  const implicitPatterns = [
    { pattern: /o que voc[êe] acha/i, score: 60 },
    { pattern: /concorda\s*\?/i, score: 55 },
    { pattern: /j[aá] passou por isso/i, score: 50 },
    { pattern: /conta\s+(pra|para)\s+(a gente|n[oó]s|mim)/i, score: 65 },
    { pattern: /deixa\s+(eu|a gente)\s+saber/i, score: 60 },
    { pattern: /marca\s+(algu[eé]m|um amigo|aquele)/i, score: 70 },
    { pattern: /salva\s+(esse|este|pra|para)/i, score: 65 },
    { pattern: /se\s+voc[êe]\s+gostou/i, score: 55 },
  ];
  
  for (const { pattern, score } of implicitPatterns) {
    if (pattern.test(t)) {
      return { detected: true, confidence: score };
    }
  }
  
  return { detected: false, confidence: 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { video_id } = await req.json();
    if (!video_id) return new Response(JSON.stringify({ error: "video_id required" }), { status: 400, headers: corsHeaders });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: blocks } = await supabase
      .from("video_blocks")
      .select("id, tipo_bloco, texto, tempo_inicio, tempo_fim")
      .eq("video_id", video_id)
      .order("bloco_id");

    const { data: video } = await supabase
      .from("videos")
      .select("duracao")
      .eq("id", video_id)
      .maybeSingle();

    if (!blocks?.length) {
      return new Response(JSON.stringify({ error: "No blocks", count: 0 }), { headers: corsHeaders });
    }

    await supabase.from("cta_deep_analysis").delete().eq("video_id", video_id);

    const totalDuration = Number(video?.duracao) || blocks[blocks.length - 1]?.tempo_fim || 60;
    const results = [];

    for (const block of blocks) {
      const text = block.texto || "";
      if (!text.trim() || text.trim().length < 10) continue;

      const target = detectCTATarget(text);
      const hasExplicitCTA = !!target;
      const implicitResult = !hasExplicitCTA ? detectImplicitCTA(text, block.tipo_bloco) : { detected: false, confidence: 0 };
      const hasImplicitCTA = implicitResult.detected;

      if (!hasExplicitCTA && !hasImplicitCTA) continue;

      const midpoint = (Number(block.tempo_inicio) + Number(block.tempo_fim)) / 2;
      const relativePosition = midpoint / totalDuration;
      const position = relativePosition < 0.33 ? "inicio" : relativePosition < 0.66 ? "meio" : "final";
      const { tone, confidence: toneConf } = detectCTATone(text);
      const type = detectCTAType(text, hasImplicitCTA, target);
      
      // Recalibrated intensity: not inflated by default
      let intensity = 0;
      if (hasExplicitCTA) {
        intensity += 40; // Base for explicit
        if (tone === "urgente") intensity += 25;
        else if (tone === "autoridade") intensity += 15;
        else intensity += 5;
        if (target === "comprar") intensity += 15;
        else if (target) intensity += 10;
      } else {
        intensity = 15 + Math.min(25, implicitResult.confidence * 0.4);
      }
      intensity = Math.min(95, intensity);

      const confidence = hasExplicitCTA ? Math.min(90, 70 + toneConf * 0.2) : Math.min(60, implicitResult.confidence);

      results.push({
        video_id,
        cta_text: text.substring(0, 500),
        cta_position: position,
        cta_type: type,
        cta_tone: tone,
        cta_target: target || "engajar",
        cta_intensity: Math.round(intensity),
        implicit_cta_detected: hasImplicitCTA,
        confidence_score: Math.round(confidence),
        data_source_type: "ai_extraction",
        origin_level: "calculated",
      });
    }

    if (results.length) {
      await supabase.from("cta_deep_analysis").insert(results);
    }

    await supabase.from("extraction_logs").insert({
      video_id,
      extraction_step: "extract_cta_deep",
      field_name: "cta_deep_analysis",
      extracted_value: JSON.stringify({ 
        count: results.length, 
        explicit: results.filter(r => !r.implicit_cta_detected).length,
        implicit: results.filter(r => r.implicit_cta_detected).length,
        avg_intensity: results.length ? Math.round(results.reduce((s, r) => s + r.cta_intensity, 0) / results.length) : 0,
      }),
      confidence_score: results.length ? Math.round(results.reduce((s, r) => s + r.confidence_score, 0) / results.length) : 0,
      source_type: "ai_extraction",
      origin_level: "calculated",
    });

    return new Response(JSON.stringify({ success: true, count: results.length }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
