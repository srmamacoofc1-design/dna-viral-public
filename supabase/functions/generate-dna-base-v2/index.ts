import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mostFrequent(arr: string[]): string | null {
  if (!arr.length) return null;
  const freq: Record<string, number> = {};
  arr.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Generate DNA Base V2 — AUTOPROTECT mode
 * 
 * NO invented weights or formulas in snapshots.
 * Documents ONLY what is actually derived from the MVP base.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const body = await req.json().catch(() => ({}));
    const { cohort_id } = body;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let cohortVideoIds: string[] | null = null;
    if (cohort_id) {
      const { data: cohortRow } = await supabase.from("dataset_cohort").select("id").eq("id", cohort_id).maybeSingle();
      if (!cohortRow) {
        return new Response(JSON.stringify({ error: "Cohort not found", cohort_id }), { status: 404, headers: corsHeaders });
      }
      const { data: cv } = await supabase.from("dataset_cohort_videos").select("video_id").eq("cohort_id", cohort_id);
      cohortVideoIds = (cv || []).map(v => v.video_id);
      if (!cohortVideoIds.length) {
        return new Response(JSON.stringify({ error: "Cohort exists but has no videos", cohort_id }), { status: 400, headers: corsHeaders });
      }
    }

    // Get completed videos
    let vQuery = supabase.from("videos").select("id, segmento, duracao, numero_blocos, views, likes, comments").eq("status", "completed").eq("approved_for_global", true);
    if (cohortVideoIds) vQuery = vQuery.in("id", cohortVideoIds);
    const { data: videos } = await vQuery;

    if (!videos?.length) {
      return new Response(JSON.stringify({ error: cohort_id ? "No completed videos in cohort" : "No completed videos" }), { status: 400, headers: corsHeaders });
    }

    const videoIds = videos.map(v => v.id);

    // Get structural sequences
    const { data: blocks } = await supabase
      .from("video_blocks")
      .select("video_id, tipo_bloco, bloco_id")
      .in("video_id", videoIds)
      .order("bloco_id");

    // Get verbal patterns
    const { data: verbal } = await supabase
      .from("block_verbal_analysis")
      .select("video_id, phrase_pattern, tone, linguistic_density")
      .in("video_id", videoIds);

    // Get CTA patterns
    const { data: ctas } = await supabase
      .from("cta_deep_analysis")
      .select("video_id, cta_type, cta_position, cta_tone")
      .in("video_id", videoIds);

    // Build structural sequences per video
    const structSequences: string[] = [];
    const videoBlocksMap: Record<string, string[]> = {};
    for (const b of (blocks || [])) {
      if (!videoBlocksMap[b.video_id]) videoBlocksMap[b.video_id] = [];
      videoBlocksMap[b.video_id].push(b.tipo_bloco.substring(0, 3).toUpperCase());
    }
    for (const seq of Object.values(videoBlocksMap)) {
      structSequences.push(seq.join(" → "));
    }

    // Verbal patterns
    const verbalPatterns = (verbal || []).map(v => v.phrase_pattern).filter(Boolean);
    const verbalTones = (verbal || []).map(v => v.tone).filter(Boolean);
    const densities = (verbal || []).map(v => Number(v.linguistic_density) || 0).filter(d => d > 0);

    // CTA distribution
    const ctaTypes = (ctas || []).map(c => c.cta_type).filter(Boolean);
    const ctaDist: Record<string, number> = {};
    ctaTypes.forEach(t => { ctaDist[t] = (ctaDist[t] || 0) + 1; });

    // Emotional arcs per video
    const { data: emotions } = await supabase
      .from("visual_emotion_sequence")
      .select("sequence_string")
      .in("video_id", videoIds);
    const emotionArcs = (emotions || []).map(e => e.sequence_string).filter(Boolean);

    // Visual layer stats
    const { data: visualBlocks } = await supabase
      .from("visual_block_analysis")
      .select("data_source_type, confidence_score, visual_emotion, human_presence")
      .in("video_id", videoIds);

    const visualAiCount = (visualBlocks || []).filter(v => v.data_source_type === 'ai_extraction').length;
    const visualMetaCount = (visualBlocks || []).filter(v => v.data_source_type === 'metadata_import').length;
    const avgVisualConf = (visualBlocks || []).length > 0
      ? +((visualBlocks || []).reduce((s, v) => s + (v.confidence_score || 0), 0) / (visualBlocks || []).length).toFixed(1)
      : null;
    const humanPresenceCount = (visualBlocks || []).filter(v => v.human_presence).length;

    // Alignment stats
    const { data: alignments } = await supabase
      .from("text_visual_alignment")
      .select("alignment_score")
      .in("video_id", videoIds);
    const avgAlignment = (alignments || []).length > 0
      ? +((alignments || []).reduce((s, a) => s + (a.alignment_score || 0), 0) / (alignments || []).length).toFixed(1)
      : null;

    // Segment breakdown — null segments stay null (not "unknown")
    const segBreakdown: Record<string, number> = {};
    videos.forEach(v => {
      const seg = v.segmento ?? "sem_segmento";
      segBreakdown[seg] = (segBreakdown[seg] || 0) + 1;
    });

    const avgDensity = densities.length ? +(densities.reduce((s, d) => s + d, 0) / densities.length).toFixed(4) : null;
    const verbalDensity = densities.length ? +(densities.reduce((s, d) => s + d, 0) / densities.length).toFixed(4) : null;

    // Engagement rate stats (observational only)
    const eligibleForEngagement = videos.filter(v => (Number(v.views) || 0) > 0);
    const engagementRates = eligibleForEngagement.map(v => (Number(v.likes) + Number(v.comments)) / Number(v.views));
    const maxEngRate = engagementRates.length > 0 ? Math.max(...engagementRates) : null;
    const avgEngRate = engagementRates.length > 0
      ? +(engagementRates.reduce((s, r) => s + r, 0) / engagementRates.length).toFixed(6)
      : null;

    const snapshot = {
      version_name: `DNA_BASE_V2_${new Date().toISOString().split("T")[0]}`,
      dominant_structure_sequence: mostFrequent(structSequences),
      dominant_verbal_pattern: mostFrequent(verbalPatterns),
      dominant_cta_pattern: mostFrequent(ctaTypes),
      dominant_emotional_arc: mostFrequent(emotionArcs),
      avg_density: avgDensity,
      verbal_density: verbalDensity,
      cta_distribution: ctaDist,
      total_videos_used: videos.length,
      total_blocks_used: (blocks || []).length,
      dataset_type: cohort_id ? `cohort_${cohort_id}` : "completed_videos",
      segment_breakdown: segBreakdown,
      formula_registry_snapshot: {
        scoring_method: "engagement_rate_normalized",
        engagement_rate_formula: "(likes + comments) / views",
        engagement_rate_relative_formula: "engagement_rate / max_engagement_rate",
        performance_method: "engagement_rate_zscore_and_percentile",
        note: "no_invented_weights",
        engagement_stats: {
          eligible_videos: eligibleForEngagement.length,
          max_engagement_rate: maxEngRate,
          avg_engagement_rate: avgEngRate,
          insufficient_data: eligibleForEngagement.length < 2,
        },
        visual_layer: {
          ai_extraction_blocks: visualAiCount,
          metadata_import_blocks: visualMetaCount,
          avg_visual_confidence: avgVisualConf,
          human_presence_blocks: humanPresenceCount,
          avg_alignment_score: avgAlignment,
        },
      },
    };

    await supabase.from("dna_base_v2").insert(snapshot);

    return new Response(JSON.stringify({ success: true, ...snapshot }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
