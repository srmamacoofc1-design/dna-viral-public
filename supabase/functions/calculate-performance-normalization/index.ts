import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Performance normalization — AUTOPROTECT mode
 * 
 * NO invented weights. NO composite formulas.
 * Uses ONLY engagement_rate = (likes + comments) / views.
 * z-score and percentile are purely observational from the dataset.
 * If insufficient data → null + logged.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { video_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get all completed videos
    const { data: allVideos } = await supabase
      .from("videos")
      .select("id, views, likes, comments, duracao, segmento")
      .eq("status", "completed")
      .eq("approved_for_global", true);

    if (!allVideos?.length) {
      return new Response(JSON.stringify({ success: true, updated: 0, reason: "no_completed_videos" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate engagement_rate for each video (only if views > 0)
    const withRate = allVideos.map(v => {
      const views = Number(v.views) || 0;
      const likes = Number(v.likes) || 0;
      const comments = Number(v.comments) || 0;
      return {
        ...v,
        engagement_rate: views > 0 ? (likes + comments) / views : null,
      };
    });

    // Only videos with calculable engagement_rate
    const eligible = withRate.filter(v => v.engagement_rate !== null);

    if (eligible.length < 2) {
      // insufficient_data for comparative statistics
      const toUpdate = video_id ? allVideos.filter(v => v.id === video_id) : allVideos;
      for (const v of toUpdate) {
        await supabase.from("videos").update({
          normalized_performance_score: null,
          performance_z_score: null,
          segment_adjusted_score: null,
        }).eq("id", v.id);
      }

      await supabase.from("extraction_logs").insert({
        video_id: video_id || allVideos[0].id,
        extraction_step: "calculate_performance_normalization",
        field_name: "normalized_performance_score",
        extracted_value: JSON.stringify({ reason: "insufficient_data", eligible_count: eligible.length }),
        confidence_score: 0,
        source_type: "calculated",
        origin_level: "calculated",
      });

      return new Response(JSON.stringify({ success: true, updated: 0, reason: "insufficient_data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate mean and stddev of engagement_rate
    const rates = eligible.map(v => v.engagement_rate as number);
    const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
    const variance = rates.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / rates.length;
    const stddev = Math.sqrt(variance);

    // Segment means — using real segment values, null when absent
    const segmentRates: Record<string, number[]> = {};
    for (const v of eligible) {
      const seg = v.segmento ?? null;
      if (seg === null) continue;
      if (!segmentRates[seg]) segmentRates[seg] = [];
      segmentRates[seg].push(v.engagement_rate as number);
    }

    const segmentMeans: Record<string, number> = {};
    for (const [seg, segRates] of Object.entries(segmentRates)) {
      segmentMeans[seg] = segRates.reduce((s, r) => s + r, 0) / segRates.length;
    }

    // Percentile rank based on engagement_rate
    const sortedRates = [...rates].sort((a, b) => a - b);

    const toUpdate = video_id ? withRate.filter(v => v.id === video_id) : withRate;
    let updated = 0;

    for (const v of toUpdate) {
      if (v.engagement_rate === null) {
        // No views → no engagement_rate → null
        await supabase.from("videos").update({
          normalized_performance_score: null,
          performance_z_score: null,
          segment_adjusted_score: null,
        }).eq("id", v.id);
        updated++;
        continue;
      }

      const rate = v.engagement_rate;

      // z-score (only if stddev > 0)
      const zScore = stddev > 0 ? +((rate - mean) / stddev).toFixed(6) : null;

      // Percentile rank (pure position in sorted list)
      const belowCount = sortedRates.filter(r => r < rate).length;
      const pctRank = +(belowCount / (sortedRates.length - 1)).toFixed(6);

      // Segment-adjusted: ratio to segment mean (only if segment exists and has data)
      const seg = v.segmento ?? null;
      const segMean = seg !== null ? segmentMeans[seg] ?? null : null;
      const segAdjusted = segMean !== null && segMean > 0 ? +(rate / segMean).toFixed(6) : null;

      // normalized_performance_score = percentile rank * 100
      await supabase.from("videos").update({
        normalized_performance_score: +(pctRank * 100).toFixed(4),
        performance_z_score: zScore,
        segment_adjusted_score: segAdjusted,
      }).eq("id", v.id);
      updated++;
    }

    // Outlier detection based on z-score of engagement_rate
    const outlierTargets = video_id ? eligible.filter(v => v.id === video_id) : eligible;
    for (const target of outlierTargets) {
      const rate = target.engagement_rate as number;
      const zScore = stddev > 0 ? (rate - mean) / stddev : null;

      if (zScore === null) continue;

      const isOutlier = Math.abs(zScore) > 2;
      await supabase.from("outlier_detection").upsert({
        video_id: target.id,
        outlier_flag: isOutlier,
        outlier_reason: isOutlier ? (zScore > 0 ? "engagement_rate z > 2" : "engagement_rate z < -2") : null,
        outlier_type: "performance",
        z_score: +zScore.toFixed(4),
        reference_mean: +mean.toFixed(6),
        reference_stddev: +stddev.toFixed(6),
        confidence_score: null, // no hardcoded confidence
      }, { onConflict: "video_id,outlier_type" });
    }

    await supabase.from("extraction_logs").insert({
      video_id: video_id || allVideos[0].id,
      extraction_step: "calculate_performance_normalization",
      field_name: "normalized_performance_score",
      extracted_value: JSON.stringify({
        method: "engagement_rate_zscore_and_percentile",
        formula: "engagement_rate = (likes+comments)/views",
        eligible_count: eligible.length,
        mean: +mean.toFixed(6),
        stddev: +stddev.toFixed(6),
        updated,
      }),
      confidence_score: 100,
      source_type: "calculated",
      origin_level: "calculated",
    });

    return new Response(JSON.stringify({
      success: true, updated,
      method: "engagement_rate_zscore_and_percentile",
      mean: +mean.toFixed(6),
      stddev: +stddev.toFixed(6),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
