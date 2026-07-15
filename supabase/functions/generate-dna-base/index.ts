import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function mostFrequent(arr: string[]): string {
  const freq: Record<string, number> = {};
  for (const v of arr) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const body = await req.json().catch(() => ({}));
    const datasetType = body.dataset_type || "completed_videos";
    const minBlocks = body.min_blocks || 3;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get eligible videos
    let query = supabase.from("videos").select("id, titulo, duracao, engagement_rate_relative, segmento, tempo_gancho, tempo_primeira_revelacao, tempo_payoff, micro_turn_count, numero_blocos, tipo_gancho, emocao_predominante, cta_type").eq("status", "completed").eq("approved_for_global", true);

    if (datasetType === "eligible_dna_videos") {
      query = query.gte("numero_blocos", minBlocks);
    }

    const { data: videos, error: vErr } = await query;
    if (vErr) throw new Error(`Failed to fetch videos: ${vErr.message}`);
    if (!videos || videos.length === 0) {
      return new Response(JSON.stringify({ error: "No eligible videos found" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all blocks for these videos
    const videoIds = videos.map((v: any) => v.id);
    const { data: allBlocks } = await supabase
      .from("video_blocks").select("video_id, tipo_bloco, tempo_inicio, tempo_fim, emocao")
      .in("video_id", videoIds)
      .order("tempo_inicio");

    const blocksByVideo: Record<string, any[]> = {};
    for (const b of (allBlocks || [])) {
      (blocksByVideo[b.video_id] ||= []).push(b);
    }

    // Calculate aggregates
    const hookTimes = videos.map((v: any) => Number(v.tempo_gancho)).filter((t: number) => t > 0);
    const revealTimes = videos.map((v: any) => Number(v.tempo_primeira_revelacao)).filter((t: number) => t > 0);
    const payoffTimes = videos.map((v: any) => Number(v.tempo_payoff)).filter((t: number) => t > 0);
    const turnCounts = videos.map((v: any) => Number(v.micro_turn_count)).filter((t: number) => t > 0);
    const densities = videos.map((v: any) => {
      const dur = Number(v.duracao) || 1;
      const blocks = blocksByVideo[v.id] || [];
      return blocks.length / dur;
    });

    // Dominant structure sequence
    const sequences: Record<string, number> = {};
    let totalBlocks = 0;
    for (const v of videos) {
      const blocks = blocksByVideo[v.id] || [];
      totalBlocks += blocks.length;
      const seq = blocks.map((b: any) => b.tipo_bloco.substring(0, 3).toUpperCase()).join(" → ");
      if (seq) sequences[seq] = (sequences[seq] || 0) + 1;
    }
    const dominantSequence = Object.entries(sequences).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    // Dominant hook type
    const hookTypes = videos.map((v: any) => v.tipo_gancho).filter(Boolean);
    const dominantHookType = mostFrequent(hookTypes);

    // Dominant emotion sequence
    const emotions = videos.map((v: any) => v.emocao_predominante).filter(Boolean);
    const dominantEmotionSeq = mostFrequent(emotions);

    // Dominant CTA type
    const ctaTypes = videos.map((v: any) => v.cta_type).filter(Boolean);
    const dominantCtaType = mostFrequent(ctaTypes);

    // Segment breakdown
    const segmentData: Record<string, { count: number; scores: number[]; sequences: Record<string, number> }> = {};
    for (const v of videos) {
      const seg = v.segmento || "outros";
      if (!segmentData[seg]) segmentData[seg] = { count: 0, scores: [], sequences: {} };
      segmentData[seg].count++;
      if (v.engagement_rate_relative != null) segmentData[seg].scores.push(Number(v.engagement_rate_relative));
      const blocks = blocksByVideo[v.id] || [];
      const seq = blocks.map((b: any) => b.tipo_bloco.substring(0, 3).toUpperCase()).join(" → ");
      if (seq) segmentData[seg].sequences[seq] = (segmentData[seg].sequences[seq] || 0) + 1;
    }

    const segmentBreakdown: Record<string, any> = {};
    for (const [seg, data] of Object.entries(segmentData)) {
      segmentBreakdown[seg] = {
        count: data.count,
        avg_score: Math.round(avg(data.scores)),
        dominant_sequence: Object.entries(data.sequences).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      };
    }

    const formulaSnapshot = {
      engagement_observation_method: "engagement_rate_normalized",
      engagement_observation_note: "engagement_rate_relative = engagement_rate / max_engagement_rate — sem pesos inventados",
      dataset_filter: datasetType,
      min_blocks_required: minBlocks,
      aggregation: "mean",
      generated_by: "generate-dna-base edge function",
    };

    const record = {
      version_name: "DNA_BASE_V1",
      dataset_type: datasetType,
      total_videos_used: videos.length,
      total_blocks_used: totalBlocks,
      avg_hook_time: Number(avg(hookTimes).toFixed(3)),
      avg_reveal_time: Number(avg(revealTimes).toFixed(3)),
      avg_payoff_time: Number(avg(payoffTimes).toFixed(3)),
      avg_turn_count: Number(avg(turnCounts).toFixed(1)),
      avg_density: Number(avg(densities).toFixed(4)),
      dominant_structure_sequence: dominantSequence,
      dominant_hook_type: dominantHookType,
      dominant_emotion_sequence: dominantEmotionSeq,
      dominant_cta_type: dominantCtaType,
      segment_breakdown: segmentBreakdown,
      formula_registry_snapshot: formulaSnapshot,
      generated_at: new Date().toISOString(),
    };

    const { error: insertErr } = await supabase.from("dna_base_versions").insert(record);
    if (insertErr) throw new Error(`Failed to insert DNA Base: ${insertErr.message}`);

    // Log
    await supabase.from("extraction_logs").insert({
      video_id: videoIds[0],
      extraction_step: "generate-dna-base-v1",
      field_name: "dna_base_snapshot",
      extracted_value: JSON.stringify({ videos: videos.length, blocks: totalBlocks }).substring(0, 500),
      confidence_score: 95,
      source_type: "calculated",
      origin_level: "calculated",
      error_flag: false,
    });

    return new Response(JSON.stringify({
      success: true,
      total_videos: videos.length,
      total_blocks: totalBlocks,
      dataset_type: datasetType,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-dna-base error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
