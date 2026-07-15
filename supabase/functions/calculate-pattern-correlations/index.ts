import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_SAMPLE_SIZE = 5;

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xd = x[i] - mx, yd = y[i] - my;
    num += xd * yd;
    dx += xd * xd;
    dy += yd * yd;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : +(num / denom).toFixed(6);
}

function reliabilityScore(sampleSize: number, corrValue: number): number {
  if (sampleSize < MIN_SAMPLE_SIZE) return 0;
  const sampleFactor = Math.min(1, sampleSize / 20); // Scales up to n=20
  const strengthFactor = Math.abs(corrValue);
  return Math.round(sampleFactor * strengthFactor * 100);
}

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

    let vQuery = supabase.from("videos")
      .select("id, views, likes, comments, engagement_rate, engagement_rate_relative, numero_blocos, duracao, tipo_gancho, segmento, avg_alignment_score, normalized_performance_score")
      .eq("status", "completed")
      .eq("approved_for_global", true);
    if (cohortVideoIds) vQuery = vQuery.in("id", cohortVideoIds);
    const { data: videos } = await vQuery;

    if (!videos || videos.length < 3) {
      return new Response(JSON.stringify({ error: cohort_id ? "Cohort has fewer than 3 completed videos" : "Need at least 3 completed videos", count: 0 }), { status: 400, headers: corsHeaders });
    }

    const views = videos.map(v => Number(v.views) || 0);
    const engagement = videos.map(v => Number(v.engagement_rate) || 0);

    const correlations: Array<{ 
      pattern_type: string; pattern_name: string; 
      correlation_with_views: number; correlation_with_engagement: number; 
      confidence_score: number; sample_size: number 
    }> = [];

    // Block count vs views
    const blockCounts = videos.map(v => Number(v.numero_blocos) || 0);
    const bcCorr = pearson(blockCounts, views);
    correlations.push({
      pattern_type: "structural",
      pattern_name: "block_count",
      correlation_with_views: bcCorr,
      correlation_with_engagement: pearson(blockCounts, engagement),
      confidence_score: reliabilityScore(videos.length, bcCorr),
      sample_size: videos.length,
    });

    // Duration vs views
    const durations = videos.map(v => Number(v.duracao) || 0);
    const durCorr = pearson(durations, views);
    correlations.push({
      pattern_type: "structural",
      pattern_name: "duration",
      correlation_with_views: durCorr,
      correlation_with_engagement: pearson(durations, engagement),
      confidence_score: reliabilityScore(videos.length, durCorr),
      sample_size: videos.length,
    });

    // Alignment vs views
    const vidsWithAlignment = videos.filter(v => v.avg_alignment_score != null);
    if (vidsWithAlignment.length >= MIN_SAMPLE_SIZE) {
      const alScores = vidsWithAlignment.map(v => Number(v.avg_alignment_score) || 0);
      const alViews = vidsWithAlignment.map(v => Number(v.views) || 0);
      const alEng = vidsWithAlignment.map(v => Number(v.engagement_rate) || 0);
      const alCorr = pearson(alScores, alViews);
      correlations.push({
        pattern_type: "visual",
        pattern_name: "text_visual_alignment",
        correlation_with_views: alCorr,
        correlation_with_engagement: pearson(alScores, alEng),
        confidence_score: reliabilityScore(vidsWithAlignment.length, alCorr),
        sample_size: vidsWithAlignment.length,
      });
    }

    // Verbal density + pressure
    const { data: verbal } = await supabase
      .from("block_verbal_analysis")
      .select("video_id, linguistic_density, emotional_intensity, semantic_pressure_score")
      .in("video_id", videos.map((video) => video.id));

    if (verbal?.length) {
      const videoVerbal: Record<string, { densities: number[]; pressures: number[] }> = {};
      for (const v of verbal) {
        if (!videoVerbal[v.video_id]) videoVerbal[v.video_id] = { densities: [], pressures: [] };
        videoVerbal[v.video_id].densities.push(Number(v.linguistic_density) || 0);
        videoVerbal[v.video_id].pressures.push(Number(v.semantic_pressure_score) || 0);
      }

      const vidsWithVerbal = videos.filter(v => videoVerbal[v.id]);
      if (vidsWithVerbal.length >= MIN_SAMPLE_SIZE) {
        const avgDensities = vidsWithVerbal.map(v => {
          const d = videoVerbal[v.id].densities;
          return d.reduce((s, x) => s + x, 0) / d.length;
        });
        const vViews = vidsWithVerbal.map(v => Number(v.views) || 0);
        const vEng = vidsWithVerbal.map(v => Number(v.engagement_rate) || 0);
        const dCorr = pearson(avgDensities, vViews);

        correlations.push({
          pattern_type: "verbal",
          pattern_name: "linguistic_density",
          correlation_with_views: dCorr,
          correlation_with_engagement: pearson(avgDensities, vEng),
          confidence_score: reliabilityScore(vidsWithVerbal.length, dCorr),
          sample_size: vidsWithVerbal.length,
        });

        const avgPressures = vidsWithVerbal.map(v => {
          const p = videoVerbal[v.id].pressures;
          return p.reduce((s, x) => s + x, 0) / p.length;
        });
        const pCorr = pearson(avgPressures, vViews);
        correlations.push({
          pattern_type: "verbal",
          pattern_name: "semantic_pressure",
          correlation_with_views: pCorr,
          correlation_with_engagement: pearson(avgPressures, vEng),
          confidence_score: reliabilityScore(vidsWithVerbal.length, pCorr),
          sample_size: vidsWithVerbal.length,
        });
      }
    }

    // Hook type correlation (only for types with enough samples)
    const hookTypes = [...new Set(videos.map(v => v.tipo_gancho).filter(Boolean))];
    for (const ht of hookTypes) {
      const count = videos.filter(v => v.tipo_gancho === ht).length;
      if (count < MIN_SAMPLE_SIZE) continue; // Skip unreliable
      const binary = videos.map(v => v.tipo_gancho === ht ? 1 : 0);
      const htCorr = pearson(binary, views);
      correlations.push({
        pattern_type: "structural",
        pattern_name: `hook_type_${ht}`,
        correlation_with_views: htCorr,
        correlation_with_engagement: pearson(binary, engagement),
        confidence_score: reliabilityScore(count, htCorr),
        sample_size: videos.length,
      });
    }

    // Upsert all
    for (const c of correlations) {
      await supabase.from("performance_correlation").upsert({
        ...c,
        correlation_with_retention: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "pattern_type,pattern_name" });
    }

    return new Response(JSON.stringify({ success: true, correlations_count: correlations.length }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
