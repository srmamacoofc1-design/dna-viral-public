import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// =============================================
// FORMULA REGISTRY — AUDITABLE WEIGHTS
// =============================================
const ALIGNMENT_WEIGHTS = {
  action: 0.40,   // 40%
  emotion: 0.40,  // 40%
  intensity: 0.20 // 20%
};

const ACTION_GROUPS: string[][] = [
  ["revelar", "mostrar", "abrir"],
  ["esconder", "sair", "transitar"],
  ["olhar", "observar", "reagir"],
  ["correr", "entrar", "apontar"],
  ["falar", "narrar", "explicar"],
];

const EMOTION_GROUPS: string[][] = [
  ["curiosidade", "expectativa"],
  ["surpresa", "impacto"],
  ["medo", "tensao"],
  ["alivio", "neutra"],
];

const INTENSITY_MAP: Record<string, number> = {
  baixa: 1,
  media: 2,
  alta: 3,
};

const EMOTIONAL_INTENSITY_MAP: Record<string, number> = {
  baixa: 1,
  media: 2,
  alta: 3,
};

function calcActionScore(textAction: string | null, visualAction: string | null): number | null {
  if (!textAction && !visualAction) return null;
  if (!textAction || !visualAction) return 10;
  const ta = textAction.toLowerCase().trim();
  const va = visualAction.toLowerCase().trim();
  if (ta === va) return 100;
  const tGroup = ACTION_GROUPS.find(g => g.some(w => ta.includes(w)));
  const vGroup = ACTION_GROUPS.find(g => g.some(w => va.includes(w)));
  if (tGroup && vGroup && tGroup === vGroup) return 70;
  return 20;
}

function calcEmotionScore(textEmotion: string | null, visualEmotion: string | null): number | null {
  if (!textEmotion && !visualEmotion) return null;
  if (!textEmotion || !visualEmotion) return 10;
  const te = textEmotion.toLowerCase().trim();
  const ve = visualEmotion.toLowerCase().trim();
  if (te === ve) return 100;
  const teG = EMOTION_GROUPS.find(g => g.includes(te));
  const veG = EMOTION_GROUPS.find(g => g.includes(ve));
  if (teG && veG && teG === veG) return 65;
  return 15;
}

function calcIntensityScore(
  textIntensity: string | null,
  visualIntensity: string | null,
): { score: number | null; lowConfidence: boolean } {
  if (!visualIntensity) return { score: null, lowConfidence: true };
  const vi = INTENSITY_MAP[visualIntensity.toLowerCase()] || null;
  if (!vi) return { score: null, lowConfidence: true };
  if (!textIntensity) {
    // Fallback: assume media with low confidence
    const diff = Math.abs(2 - vi);
    return { score: diff === 0 ? 60 : diff === 1 ? 40 : 20, lowConfidence: true };
  }
  const ti = EMOTIONAL_INTENSITY_MAP[textIntensity.toLowerCase()] || null;
  if (!ti) return { score: null, lowConfidence: true };
  const diff = Math.abs(ti - vi);
  return { score: diff === 0 ? 100 : diff === 1 ? 55 : 20, lowConfidence: false };
}

function calcFinalScore(
  actionScore: number | null,
  emotionScore: number | null,
  intensityScore: number | null,
): number {
  let totalWeight = 0;
  let weightedSum = 0;
  if (actionScore !== null) {
    weightedSum += actionScore * ALIGNMENT_WEIGHTS.action;
    totalWeight += ALIGNMENT_WEIGHTS.action;
  }
  if (emotionScore !== null) {
    weightedSum += emotionScore * ALIGNMENT_WEIGHTS.emotion;
    totalWeight += ALIGNMENT_WEIGHTS.emotion;
  }
  if (intensityScore !== null) {
    weightedSum += intensityScore * ALIGNMENT_WEIGHTS.intensity;
    totalWeight += ALIGNMENT_WEIGHTS.intensity;
  }
  if (totalWeight === 0) return 0;
  return Math.round(weightedSum / totalWeight);
}

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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const [blocksRes, visualRes, videoRes] = await Promise.all([
      supabase.from("video_blocks").select("*").eq("video_id", video_id).order("tempo_inicio"),
      supabase.from("visual_block_analysis").select("*").eq("video_id", video_id),
      supabase.from("videos").select("intensidade_emocional").eq("id", video_id).single(),
    ]);

    const blocks = blocksRes.data || [];
    const visuals = visualRes.data || [];
    const videoIntensity = videoRes.data?.intensidade_emocional || null;

    if (blocks.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No blocks to align", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("text_visual_alignment").delete().eq("video_id", video_id);

    const visualMap = new Map(visuals.map((v: any) => [v.block_id, v]));
    const alignments: any[] = [];

    for (const block of blocks) {
      const visual = visualMap.get(block.id);
      const textAction = block.funcao_narrativa || null;
      const visualAction = visual?.main_action || null;
      const textEmotion = block.emocao || null;
      const visualEmotion = visual?.visual_emotion || null;
      const visualIntensityLevel = visual?.visual_intensity_level || null;
      // Text intensity: use block emotion mapped to intensity, or video-level
      const textIntensity = block.emocao
        ? (["medo", "tensao", "impacto"].includes(block.emocao) ? "alta"
          : ["surpresa", "expectativa"].includes(block.emocao) ? "media" : "baixa")
        : videoIntensity;

      const actionScore = calcActionScore(textAction, visualAction);
      const emotionScore = calcEmotionScore(textEmotion, visualEmotion);
      const { score: intensityScore, lowConfidence: intensityLowConf } = calcIntensityScore(textIntensity, visualIntensityLevel);

      const alignmentScore = calcFinalScore(actionScore, emotionScore, intensityScore);

      const hasVisual = !!visual;
      let confidence = hasVisual ? 60 : 15;
      if (visualEmotion) confidence += 15;
      if (intensityLowConf) confidence -= 10;
      confidence = Math.max(0, Math.min(confidence, 100));

      alignments.push({
        video_id,
        block_id: block.id,
        text_action: textAction,
        visual_action: visualAction,
        text_emotion: textEmotion,
        visual_emotion: visualEmotion,
        action_alignment_score: actionScore,
        emotion_alignment_score: emotionScore,
        intensity_alignment_score: intensityScore,
        alignment_score: alignmentScore,
        confidence_score: confidence,
        data_source_type: "calculated",
        origin_level: "calculated",
      });
    }

    if (alignments.length > 0) {
      const { error: insertErr } = await supabase.from("text_visual_alignment").insert(alignments);
      if (insertErr) throw insertErr;
    }

    const avg = Math.round(alignments.reduce((s, a) => s + a.alignment_score, 0) / alignments.length);
    await supabase.from("videos").update({ avg_alignment_score: avg }).eq("id", video_id);

    // Log with formula snapshot
    await supabase.from("extraction_logs").insert({
      video_id,
      extraction_step: "text_visual_alignment",
      field_name: "alignment_score",
      extracted_value: JSON.stringify({
        avg,
        formula: "action*0.40 + emotion*0.40 + intensity*0.20",
        weights: ALIGNMENT_WEIGHTS,
      }),
      confidence_score: 70,
      source_type: "calculated",
      origin_level: "calculated",
    });

    return new Response(JSON.stringify({ success: true, count: alignments.length, avg_alignment_score: avg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
