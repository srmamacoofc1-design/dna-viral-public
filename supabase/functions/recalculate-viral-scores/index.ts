import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Recalculate engagement metrics — AUTOPROTECT mode
 * 
 * ONLY metric: engagement_rate = (likes + comments) / views
 * NO invented weights. NO composite formulas.
 * engagement_rate_relative = engagement_rate / max_engagement_rate (relative within dataset)
 * If insufficient data → null + logged.
 * 
 * DB column mapping (post-migration):
 *   engagement_rate_relative (formerly viral_score)
 *   engagement_percentile (formerly viral_score_pct)
 *   engagement_percentile_display (formerly hero_score_pct)
 *   dataset_weight_pct (formerly peso_percentual)
 * 
 * Uses infrastructure table viral_score_recalc_queue (name kept for cron/trigger compat).
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Mutex: prevent concurrent execution ──
    const LOCK_ID = "00000000-0000-0000-0000-000000000001";
    const LOCK_TTL_SECONDS = 120;

    const { data: existingLock } = await supabase
      .from("viral_score_recalc_queue")
      .select("id, requested_at")
      .eq("id", LOCK_ID)
      .eq("processed", false)
      .maybeSingle();

    if (existingLock) {
      const lockAge = (Date.now() - new Date(existingLock.requested_at).getTime()) / 1000;
      if (lockAge < LOCK_TTL_SECONDS) {
        return new Response(
          JSON.stringify({ message: "Recalculation already in progress, skipped", lock_age_seconds: Math.round(lockAge) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      await supabase.from("viral_score_recalc_queue").delete().eq("id", LOCK_ID);
    }

    await supabase.from("viral_score_recalc_queue").insert({
      id: LOCK_ID,
      requested_at: new Date().toISOString(),
      processed: false,
    });

    const releaseLock = async () => {
      await supabase.from("viral_score_recalc_queue").delete().eq("id", LOCK_ID);
    };

    // Fetch all completed videos
    const { data: videos, error: fetchError } = await supabase
      .from("videos")
      .select("id, titulo, views, likes, comments, status")
      .eq("status", "completed");

    if (fetchError) throw fetchError;
    if (!videos || videos.length === 0) {
      await releaseLock();
      return new Response(
        JSON.stringify({ message: "No eligible videos found", total_recalculated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter: only videos with views > 0 (engagement_rate requires views)
    const eligible = videos.filter((v) => (Number(v.views) || 0) > 0);

    // If fewer than 2 eligible → insufficient_data for comparative scoring
    if (eligible.length < 2) {
      for (const v of videos) {
        await supabase.from("videos").update({
          engagement_rate_relative: null,
          dataset_weight_pct: null,
          views_norm: null,
          likes_norm: null,
          comments_norm: null,
          engagement_rate: eligible.length === 1 && v.id === eligible[0]?.id
            ? +((Number(v.likes) + Number(v.comments)) / Number(v.views)).toFixed(6)
            : null,
          engagement_rate_norm: null,
          engagement_percentile: null,
          engagement_percentile_display: null,
        }).eq("id", v.id);
      }

      await supabase.from("extraction_logs").insert({
        video_id: videos[0].id,
        extraction_step: "recalculate_engagement_metrics",
        field_name: "engagement_rate_relative",
        extracted_value: JSON.stringify({ reason: "insufficient_data", eligible_count: eligible.length }),
        confidence_score: 0,
        source_type: "calculated",
        origin_level: "calculated",
      });

      await releaseLock();
      return new Response(
        JSON.stringify({ message: "insufficient_data", eligible_count: eligible.length, total_recalculated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate engagement_rate for each eligible video
    const withRate = eligible.map((v) => {
      const views = Number(v.views) || 0;
      const likes = Number(v.likes) || 0;
      const comments = Number(v.comments) || 0;
      return {
        ...v,
        views_num: views,
        likes_num: likes,
        comments_num: comments,
        engagement_rate: (likes + comments) / views,
      };
    });

    const max_engagement_rate = Math.max(...withRate.map((v) => v.engagement_rate));

    if (max_engagement_rate <= 0) {
      for (const v of videos) {
        await supabase.from("videos").update({
          engagement_rate_relative: null, dataset_weight_pct: null,
          views_norm: null, likes_norm: null, comments_norm: null,
          engagement_rate: 0, engagement_rate_norm: null,
          engagement_percentile: null, engagement_percentile_display: null,
        }).eq("id", v.id);
      }
      await releaseLock();
      return new Response(
        JSON.stringify({ message: "insufficient_data", reason: "all_engagement_rates_zero" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // engagement_rate_relative = engagement_rate / max_engagement_rate (pure normalization)
    const scored = withRate.map((v) => ({
      id: v.id,
      engagement_rate: +v.engagement_rate.toFixed(6),
      engagement_rate_relative: +(v.engagement_rate / max_engagement_rate).toFixed(6),
    }));

    const total_score = scored.reduce((s, v) => s + v.engagement_rate_relative, 0);

    // Percentile scoring — pure rank position, no weights
    const sortedByEngagement = [...scored].sort((a, b) => a.engagement_rate - b.engagement_rate);

    const percentileMap = new Map<string, number>();
    for (let i = 0; i < sortedByEngagement.length; i++) {
      const pct = +(i / (sortedByEngagement.length - 1)).toFixed(6);
      percentileMap.set(sortedByEngagement[i].id, pct);
    }

    // Persist
    let updated = 0;
    for (const r of scored) {
      const pct = percentileMap.get(r.id) ?? null;
      const { error } = await supabase.from("videos").update({
        engagement_rate_relative: r.engagement_rate_relative,
        dataset_weight_pct: total_score > 0 ? +((r.engagement_rate_relative / total_score) * 100).toFixed(3) : null,
        views_norm: null,
        likes_norm: null,
        comments_norm: null,
        engagement_rate: r.engagement_rate,
        engagement_rate_norm: r.engagement_rate_relative,
        engagement_percentile: pct,
        engagement_percentile_display: pct !== null ? +(pct * 100).toFixed(2) : null,
      }).eq("id", r.id);

      if (!error) updated++;
    }

    // Null out non-eligible completed videos
    const eligibleIds = new Set(eligible.map((v) => v.id));
    const nonEligible = videos.filter((v) => !eligibleIds.has(v.id));
    for (const v of nonEligible) {
      await supabase.from("videos").update({
        engagement_rate_relative: null,
        dataset_weight_pct: null,
        views_norm: null,
        likes_norm: null,
        comments_norm: null,
        engagement_rate: null,
        engagement_rate_norm: null,
        engagement_percentile: null,
        engagement_percentile_display: null,
      }).eq("id", v.id);
    }

    // Audit log
    await supabase.from("extraction_logs").insert({
      video_id: eligible[0].id,
      extraction_step: "recalculate_engagement_metrics",
      field_name: "engagement_rate_relative",
      extracted_value: JSON.stringify({
        method: "engagement_rate_normalized",
        formula: "(likes+comments)/views normalized to max",
        eligible_count: eligible.length,
        max_engagement_rate: +max_engagement_rate.toFixed(6),
        updated,
      }),
      confidence_score: 100,
      source_type: "calculated",
      origin_level: "calculated",
    });

    await releaseLock();

    return new Response(
      JSON.stringify({
        message: "Engagement metrics recalculated (AUTOPROTECT)",
        method: "engagement_rate_normalized",
        total_recalculated: updated,
        total_eligible: eligible.length,
        max_engagement_rate: +max_engagement_rate.toFixed(6),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await sb.from("viral_score_recalc_queue").delete().eq("id", "00000000-0000-0000-0000-000000000001");
    } catch (_) { /* ignore */ }
    console.error("Error recalculating engagement metrics:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
