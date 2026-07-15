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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { cohort_id } = await req.json();
    if (!cohort_id) {
      return new Response(JSON.stringify({ error: "cohort_id is required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get cohort
    const { data: cohort } = await supabase.from("dataset_cohort").select("*").eq("id", cohort_id).single();
    if (!cohort) {
      return new Response(JSON.stringify({ error: "Cohort not found" }), { status: 404, headers: corsHeaders });
    }

    // Get video IDs from junction table
    const { data: cohortVideos } = await supabase
      .from("dataset_cohort_videos")
      .select("video_id")
      .eq("cohort_id", cohort_id);

    const videoIds = (cohortVideos || []).map(cv => cv.video_id);
    if (!videoIds.length) {
      return new Response(JSON.stringify({ error: "No videos in cohort" }), { status: 400, headers: corsHeaders });
    }

    // Get video data
    const { data: videos } = await supabase
      .from("videos")
      .select("id, engagement_rate_relative, normalized_performance_score, avg_alignment_score, segmento, emocao_predominante")
      .in("id", videoIds);

    // Get structural sequences
    const { data: blocks } = await supabase
      .from("video_blocks")
      .select("video_id, tipo_bloco, bloco_id")
      .in("video_id", videoIds)
      .order("bloco_id");

    const videoBlocksMap: Record<string, string[]> = {};
    for (const b of (blocks || [])) {
      if (!videoBlocksMap[b.video_id]) videoBlocksMap[b.video_id] = [];
      videoBlocksMap[b.video_id].push(b.tipo_bloco.substring(0, 3).toUpperCase());
    }
    const structSequences = Object.values(videoBlocksMap).map(seq => seq.join(" → "));

    // Verbal patterns
    const { data: verbal } = await supabase
      .from("block_verbal_analysis")
      .select("video_id, phrase_pattern, tone")
      .in("video_id", videoIds);
    const verbalPatterns = (verbal || []).map(v => v.phrase_pattern).filter(Boolean);

    // CTA patterns
    const { data: ctas } = await supabase
      .from("cta_deep_analysis")
      .select("video_id, cta_type")
      .in("video_id", videoIds);
    const ctaTypes = (ctas || []).map(c => c.cta_type).filter(Boolean);

    // Emotional arcs
    const { data: emotions } = await supabase
      .from("visual_emotion_sequence")
      .select("sequence_string")
      .in("video_id", videoIds);
    const emotionArcs = (emotions || []).map(e => e.sequence_string).filter(Boolean);

    // Calculate averages
    const vids = videos || [];
    const avgViral = vids.length ? +(vids.reduce((s, v) => s + (Number(v.engagement_rate_relative) || 0), 0) / vids.length).toFixed(2) : null;
    const avgPerf = vids.length ? +(vids.reduce((s, v) => s + (Number(v.normalized_performance_score) || 0), 0) / vids.length).toFixed(2) : null;
    const vidsWithAlign = vids.filter(v => v.avg_alignment_score != null);
    const avgAlign = vidsWithAlign.length ? +(vidsWithAlign.reduce((s, v) => s + (Number(v.avg_alignment_score) || 0), 0) / vidsWithAlign.length).toFixed(2) : null;

    const dominantStructure = mostFrequent(structSequences);
    const dominantVerbal = mostFrequent(verbalPatterns);
    const dominantCta = mostFrequent(ctaTypes);
    const dominantEmotion = mostFrequent(emotionArcs) || mostFrequent(vids.map(v => v.emocao_predominante).filter(Boolean));

    const summaryData = {
      cohort_id,
      cohort_name: cohort.cohort_name,
      video_count: videoIds.length,
      dominant_structure: dominantStructure,
      dominant_verbal_pattern: dominantVerbal,
      dominant_cta_pattern: dominantCta,
      dominant_emotional_arc: dominantEmotion,
      dominant_emotion: dominantEmotion,
      avg_engagement_rate: avgViral,
      avg_normalized_performance_score: avgPerf,
      avg_alignment_score: avgAlign,
      avg_performance: avgPerf,
      summary_json: {
        segment_breakdown: vids.reduce((acc: Record<string, number>, v) => {
          const seg = v.segmento || "unknown";
          acc[seg] = (acc[seg] || 0) + 1;
          return acc;
        }, {}),
        total_blocks: (blocks || []).length,
        verbal_count: (verbal || []).length,
        cta_count: (ctas || []).length,
      },
      confidence_score: cohort.confidence_score || 0,
      data_source_type: "calculated",
      origin_level: "calculated",
      dominant_patterns: {
        structure: dominantStructure,
        verbal: dominantVerbal,
        cta: dominantCta,
        emotion: dominantEmotion,
      },
    };

    // Delete old summary for this cohort, then insert new
    await supabase.from("cohort_analysis_summary").delete().eq("cohort_id", cohort_id);
    const { error: insertErr } = await supabase.from("cohort_analysis_summary").insert(summaryData);
    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({ success: true, summary: summaryData }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
