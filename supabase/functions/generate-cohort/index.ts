import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const body = await req.json();
    const {
      cohort_name,
      cohort_type = "combinado",
      filter_segment,
      min_views,
      max_views,
      min_duration,
      max_duration,
      min_performance,
      max_performance,
      min_score,
      max_score,
    } = body;

    if (!cohort_name) {
      return new Response(JSON.stringify({ error: "cohort_name is required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Build query with filters
    let query = supabase.from("videos").select("id").eq("status", "completed");

    if (filter_segment) query = query.eq("segmento", filter_segment);
    if (min_views != null) query = query.gte("views", min_views);
    if (max_views != null) query = query.lte("views", max_views);
    if (min_duration != null) query = query.gte("duracao", min_duration);
    if (max_duration != null) query = query.lte("duracao", max_duration);
    if (min_performance != null) query = query.gte("normalized_performance_score", min_performance);
    if (max_performance != null) query = query.lte("normalized_performance_score", max_performance);
    if (min_score != null) query = query.gte("engagement_rate_relative", min_score);
    if (max_score != null) query = query.lte("engagement_rate_relative", max_score);

    const { data: videos, error: queryError } = await query;
    if (queryError) throw queryError;

    const videoIds = (videos || []).map(v => v.id);
    const videoCount = videoIds.length;

    // Confidence based on sample size
    let confidence = 0;
    if (videoCount >= 20) confidence = 90;
    else if (videoCount >= 10) confidence = 70;
    else if (videoCount >= 5) confidence = 50;
    else if (videoCount >= 3) confidence = 30;
    else if (videoCount >= 1) confidence = 15;

    const rulesJson = {
      filter_segment: filter_segment || null,
      min_views: min_views ?? null,
      max_views: max_views ?? null,
      min_duration: min_duration ?? null,
      max_duration: max_duration ?? null,
      min_performance: min_performance ?? null,
      max_performance: max_performance ?? null,
      min_score: min_score ?? null,
      max_score: max_score ?? null,
    };

    // Insert cohort
    const { data: cohort, error: insertError } = await supabase.from("dataset_cohort").insert({
      cohort_name,
      cohort_type,
      rules_json: rulesJson,
      video_count: videoCount,
      video_ids: videoIds,
      active: true,
      confidence_score: confidence,
      filter_segment: filter_segment || null,
      filter_views_min: min_views ?? null,
      filter_views_max: max_views ?? null,
      filter_duration_min: min_duration ?? null,
      filter_duration_max: max_duration ?? null,
      filter_score_min: min_score ?? null,
      filter_score_max: max_score ?? null,
      data_source_type: "calculated",
      origin_level: "calculated",
    }).select().single();

    if (insertError) throw insertError;

    // Insert video associations
    if (videoIds.length > 0) {
      const associations = videoIds.map(vid => ({
        cohort_id: cohort.id,
        video_id: vid,
      }));
      // Insert in batches of 100
      for (let i = 0; i < associations.length; i += 100) {
        await supabase.from("dataset_cohort_videos").insert(associations.slice(i, i + 100));
      }
    }

    // Log
    await supabase.from("extraction_logs").insert({
      video_id: videoIds[0] || "00000000-0000-0000-0000-000000000000",
      extraction_step: "generate_cohort",
      field_name: "dataset_cohort",
      extracted_value: JSON.stringify({ cohort_id: cohort.id, video_count: videoCount, confidence }),
      confidence_score: confidence,
      source_type: "calculated",
      origin_level: "calculated",
    });

    return new Response(JSON.stringify({
      success: true,
      cohort_id: cohort.id,
      video_count: videoCount,
      confidence_score: confidence,
    }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
