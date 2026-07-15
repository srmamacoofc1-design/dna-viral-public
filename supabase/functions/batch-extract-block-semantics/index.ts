import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  authorizeLibraryAdminOrServiceRequest,
  internalFunctionHeaders,
} from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(body.batch_size || 10, 1), 50);
    const forceReprocess = body.force_reprocess === true;
    const offset = Math.max(body.offset || 0, 0);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Find all completed videos that have blocks with text
    const { data: completedVideos, error: vErr } = await supabase
      .from("videos")
      .select("id, titulo")
      .eq("status", "completed")
      .order("created_at", { ascending: true });

    if (vErr) throw new Error(`Failed to fetch videos: ${vErr.message}`);
    if (!completedVideos || completedVideos.length === 0) {
      return new Response(JSON.stringify({
        success: true, message: "No completed videos found",
        total_eligible: 0, processed: 0, remaining: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Filter: must have blocks with text
    const videoIds = completedVideos.map(v => v.id);
    const { data: blocksCheck } = await supabase
      .from("video_blocks")
      .select("video_id, texto")
      .in("video_id", videoIds)
      .not("texto", "is", null);

    const videosWithTextBlocks = new Set(
      (blocksCheck || [])
        .filter(b => b.texto && b.texto.trim().length > 0)
        .map(b => b.video_id)
    );

    let eligibleIds = completedVideos
      .filter(v => videosWithTextBlocks.has(v.id))
      .map(v => v.id);

    // 3. If not force reprocess, exclude videos that already have block_semantic_patterns
    if (!forceReprocess && eligibleIds.length > 0) {
      const { data: existingPatterns } = await supabase
        .from("block_semantic_patterns")
        .select("video_id")
        .in("video_id", eligibleIds);

      const alreadyProcessed = new Set((existingPatterns || []).map(p => p.video_id));
      eligibleIds = eligibleIds.filter(id => !alreadyProcessed.has(id));
    }

    const totalEligible = eligibleIds.length;

    // 4. Apply pagination
    const batch = eligibleIds.slice(offset, offset + batchSize);
    const remaining = Math.max(0, totalEligible - offset - batch.length);

    if (batch.length === 0) {
      return new Response(JSON.stringify({
        success: true, message: "No videos to process",
        total_eligible: totalEligible, processed: 0, remaining: 0,
        offset, batch_size: batchSize,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. Process each video by calling extract-block-semantics
    const results: Array<{ video_id: string; status: string; blocks_processed?: number; error?: string }> = [];

    for (const videoId of batch) {
      try {
        const fnUrl = `${SUPABASE_URL}/functions/v1/extract-block-semantics`;
        const resp = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...internalFunctionHeaders(SUPABASE_SERVICE_ROLE_KEY),
          },
          body: JSON.stringify({ video_id: videoId }),
        });

        const data = await resp.json();

        if (data.error) {
          results.push({ video_id: videoId, status: "error", error: data.error });
          await supabase.from("video_logs").insert({
            video_id: videoId,
            etapa: "Batch Semântica por Bloco",
            status: "error",
            mensagem: `Falha: ${data.error}`,
          });
        } else {
          results.push({
            video_id: videoId,
            status: "success",
            blocks_processed: data.blocks_processed || 0,
          });
          await supabase.from("video_logs").insert({
            video_id: videoId,
            etapa: "Batch Semântica por Bloco",
            status: "success",
            mensagem: `Processado em lote: ${data.blocks_processed || 0} blocos`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ video_id: videoId, status: "error", error: msg });
        await supabase.from("video_logs").insert({
          video_id: videoId,
          etapa: "Batch Semântica por Bloco",
          status: "error",
          mensagem: `Erro inesperado: ${msg}`,
        });
      }
    }

    const successCount = results.filter(r => r.status === "success").length;
    const errorCount = results.filter(r => r.status === "error").length;

    return new Response(JSON.stringify({
      success: true,
      total_eligible: totalEligible,
      batch_size: batchSize,
      offset,
      processed: batch.length,
      success_count: successCount,
      error_count: errorCount,
      remaining,
      next_offset: remaining > 0 ? offset + batch.length : null,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("batch-extract-block-semantics error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
