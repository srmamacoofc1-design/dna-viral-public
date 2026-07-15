import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import {
  authorizeLibraryAdminOrServiceRequest,
  internalFunctionHeaders,
} from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const videoIds: string[] | undefined = body.video_ids;

    // Fetch eligible videos
    let query = supabase
      .from("videos")
      .select("id, titulo, block_segmentation_version, status")
      .eq("status", "completed")
      .order("created_at");

    const { data: allVideos, error: fetchErr } = await query;
    if (fetchErr) throw new Error(fetchErr.message);

    let eligible = (allVideos ?? []).filter(
      (v: any) =>
        !v.block_segmentation_version ||
        v.block_segmentation_version === "v1_legacy"
    );

    // If specific video IDs provided, filter to those
    if (videoIds?.length) {
      const idSet = new Set(videoIds);
      eligible = eligible.filter((v: any) => idSet.has(v.id));
    }

    if (eligible.length === 0) {
      return new Response(
        JSON.stringify({ error: "No eligible videos found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cancel any existing running jobs
    await supabase
      .from("reprocess_jobs")
      .update({ status: "canceled", finished_at: new Date().toISOString() })
      .in("status", ["queued", "running"]);

    // Create job
    const { data: job, error: jobErr } = await supabase
      .from("reprocess_jobs")
      .insert({
        status: "queued",
        total_videos: eligible.length,
        completed_videos: 0,
        failed_videos: 0,
        skipped_videos: (allVideos?.length ?? 0) - eligible.length,
      })
      .select("id")
      .single();

    if (jobErr) throw new Error(jobErr.message);

    // Create job items
    const items = eligible.map((v: any) => ({
      job_id: job.id,
      video_id: v.id,
      video_title: v.titulo,
      status: "queued",
    }));

    const { error: itemsErr } = await supabase
      .from("reprocess_job_items")
      .insert(items);

    if (itemsErr) throw new Error(itemsErr.message);

    // Trigger the worker (fire-and-forget)
    const workerUrl = `${supabaseUrl}/functions/v1/reprocess-v2-worker`;
    
    fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalFunctionHeaders(serviceKey),
      },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        job_id: job.id,
        total_videos: eligible.length,
        skipped: (allVideos?.length ?? 0) - eligible.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
