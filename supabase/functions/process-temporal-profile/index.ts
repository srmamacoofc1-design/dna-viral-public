import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode || "incremental"; // "incremental" | "single" | "force_all"
    const targetVideoId: string | null = body.video_id || null;
    const batchSize: number = body.batch_size || 10;

    // ── DETERMINE WHICH VIDEOS NEED PROCESSING ──
    let videoIds: string[] = [];

    if (mode === "single" && targetVideoId) {
      // Process a single specific video
      videoIds = [targetVideoId];
    } else if (mode === "force_all") {
      // Force reprocess everything (delete + regenerate) – batch limited
      const { data: vids } = await sb
        .from("videos")
        .select("id")
        .eq("status", "completed")
        .limit(batchSize);
      videoIds = (vids || []).map((v) => v.id);
    } else {
      // INCREMENTAL: find videos that are missing or have failed temporal profiles
      // Step 1: all completed videos
      const { data: allVideos } = await sb
        .from("videos")
        .select("id")
        .eq("status", "completed");

      // Step 2: videos that already have ALL blocks completed
      const { data: completedProfiles } = await sb
        .from("video_temporal_profile")
        .select("video_id")
        .eq("processing_status", "completed");

      const completedVideoIds = new Set(
        (completedProfiles || []).map((p) => p.video_id)
      );

      // Step 3: find videos with failed profiles (need retry)
      const { data: failedProfiles } = await sb
        .from("video_temporal_profile")
        .select("video_id")
        .eq("processing_status", "failed");

      const failedVideoIds = new Set(
        (failedProfiles || []).map((p) => p.video_id)
      );

      // Step 4: get block counts per video to verify completeness
      const { data: blockCounts } = await sb
        .from("video_blocks")
        .select("video_id");

      const blocksPerVideo = new Map<string, number>();
      (blockCounts || []).forEach((b) => {
        blocksPerVideo.set(b.video_id, (blocksPerVideo.get(b.video_id) || 0) + 1);
      });

      const { data: profileCounts } = await sb
        .from("video_temporal_profile")
        .select("video_id")
        .eq("processing_status", "completed");

      const profilesPerVideo = new Map<string, number>();
      (profileCounts || []).forEach((p) => {
        profilesPerVideo.set(
          p.video_id,
          (profilesPerVideo.get(p.video_id) || 0) + 1
        );
      });

      // Video needs processing if: missing profiles, has failed, or block count mismatch
      for (const v of allVideos || []) {
        const totalBlocks = blocksPerVideo.get(v.id) || 0;
        const totalProfiles = profilesPerVideo.get(v.id) || 0;

        if (totalBlocks === 0) continue; // no blocks = skip

        if (
          totalProfiles < totalBlocks || // missing profiles
          failedVideoIds.has(v.id) // has failed items
        ) {
          videoIds.push(v.id);
        }
      }

      // Limit batch size
      videoIds = videoIds.slice(0, batchSize);
    }

    if (videoIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No videos need temporal processing",
          videos_processed: 0,
          blocks_processed: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // ── PROCESS EACH VIDEO INCREMENTALLY ──
    let totalVideos = 0;
    let totalBlocks = 0;

    for (const videoId of videoIds) {
      try {
        // Mark existing failed/pending as processing
        await sb
          .from("video_temporal_profile")
          .update({ processing_status: "processing", updated_at: new Date().toISOString() })
          .eq("video_id", videoId)
          .in("processing_status", ["pending", "failed"]);

        // Get blocks for this video
        const { data: blocks } = await sb
          .from("video_blocks")
          .select("id, video_id, tempo_inicio, tempo_fim, tipo_bloco")
          .eq("video_id", videoId);

        if (!blocks || blocks.length === 0) continue;

        // Check which blocks already have completed profiles
        const { data: existingProfiles } = await sb
          .from("video_temporal_profile")
          .select("block_id, processing_status")
          .eq("video_id", videoId);

        const existingMap = new Map(
          (existingProfiles || []).map((p) => [p.block_id, p.processing_status])
        );

        // Filter blocks that need processing
        const blocksToProcess = blocks.filter((b) => {
          const status = existingMap.get(b.id);
          return !status || status !== "completed";
        });

        if (blocksToProcess.length === 0) {
          totalVideos++;
          continue;
        }

        // Get frames for this video
        const { data: frames } = await sb
          .from("video_frames")
          .select(
            "id, video_id, timestamp_seconds, scene_change_flag, block_id, source_method"
          )
          .eq("video_id", videoId)
          .order("timestamp_seconds", { ascending: true });

        const videoFrames = frames || [];

        // Detect cut timestamps
        const cutTimestamps: number[] = [];
        for (const f of videoFrames) {
          if (f.scene_change_flag) {
            cutTimestamps.push(Number(f.timestamp_seconds));
          }
        }

        if (cutTimestamps.length === 0 && videoFrames.length > 1) {
          for (let i = 1; i < videoFrames.length; i++) {
            const prev = videoFrames[i - 1];
            const curr = videoFrames[i];
            if (
              prev.block_id !== curr.block_id ||
              Number(curr.timestamp_seconds) - Number(prev.timestamp_seconds) > 2
            ) {
              cutTimestamps.push(Number(curr.timestamp_seconds));
            }
          }
        }

        cutTimestamps.sort((a, b) => a - b);

        // Process each pending block
        for (const block of blocksToProcess) {
          const blockStart = Number(block.tempo_inicio);
          const blockEnd = Number(block.tempo_fim);
          const blockDuration = blockEnd - blockStart;

          if (blockDuration <= 0) continue;

          const blockCuts = cutTimestamps.filter(
            (t) => t >= blockStart && t <= blockEnd
          );
          const cutCount = blockCuts.length;
          const cutDensity = cutCount / blockDuration;

          let avgCutInterval = 0;
          if (blockCuts.length >= 2) {
            const intervals: number[] = [];
            for (let i = 1; i < blockCuts.length; i++) {
              intervals.push(blockCuts[i] - blockCuts[i - 1]);
            }
            avgCutInterval =
              intervals.reduce((a, b) => a + b, 0) / intervals.length;
          } else if (blockCuts.length === 1) {
            avgCutInterval = blockDuration;
          }

          let rhythmLevel = "low";
          if (cutDensity >= 1.0) rhythmLevel = "explosive";
          else if (cutDensity >= 0.5) rhythmLevel = "high";
          else if (cutDensity >= 0.2) rhythmLevel = "medium";

          let tempoPattern = "stable";
          if (blockCuts.length >= 3) {
            const intervals: number[] = [];
            for (let i = 1; i < blockCuts.length; i++) {
              intervals.push(blockCuts[i] - blockCuts[i - 1]);
            }
            let accelerating = true;
            for (let i = 1; i < intervals.length; i++) {
              if (intervals[i] >= intervals[i - 1]) {
                accelerating = false;
                break;
              }
            }
            if (accelerating) {
              tempoPattern = "accelerating";
            } else {
              const burstCount = intervals.filter((iv) => iv < 0.5).length;
              if (burstCount >= intervals.length * 0.6) {
                tempoPattern = "burst";
              }
            }
          } else if (blockCuts.length === 1) {
            const cutPos = blockCuts[0] - blockStart;
            if (cutPos > blockDuration * 0.6) {
              tempoPattern = "pause_before_reveal";
            }
          }

          const framesInBlock = videoFrames.filter(
            (f) =>
              Number(f.timestamp_seconds) >= blockStart &&
              Number(f.timestamp_seconds) <= blockEnd
          ).length;
          let confidence = Math.min(framesInBlock / 5, 1.0);
          if (cutCount > 0) confidence = Math.min(confidence + 0.2, 1.0);
          confidence = Math.round(confidence * 100) / 100;

          const row = {
            video_id: videoId,
            block_id: block.id,
            cut_count: cutCount,
            cut_density: Math.round(cutDensity * 1000) / 1000,
            avg_cut_interval: Math.round(avgCutInterval * 1000) / 1000,
            rhythm_level: rhythmLevel,
            tempo_pattern: tempoPattern,
            confidence_score: confidence,
            processing_status: "completed",
            updated_at: new Date().toISOString(),
            error_message: null,
          };

          // Upsert using unique constraint
          const { error: upsertErr } = await sb
            .from("video_temporal_profile")
            .upsert(row, { onConflict: "video_id,block_id" });

          if (upsertErr) {
            // Mark as failed
            await sb
              .from("video_temporal_profile")
              .upsert(
                {
                  video_id: videoId,
                  block_id: block.id,
                  processing_status: "failed",
                  error_message: upsertErr.message,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "video_id,block_id" }
              );
            continue;
          }

          totalBlocks++;
        }

        totalVideos++;
      } catch (videoErr) {
        // Mark all blocks for this video as failed
        await sb
          .from("video_temporal_profile")
          .update({
            processing_status: "failed",
            error_message: videoErr.message,
            updated_at: new Date().toISOString(),
          })
          .eq("video_id", videoId)
          .neq("processing_status", "completed");
      }
    }

    // Check if there are still pending videos for continuation
    const { count: remainingCount } = await sb
      .from("videos")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed");

    const { data: completedCheck } = await sb
      .from("video_temporal_profile")
      .select("video_id")
      .eq("processing_status", "completed");

    const completedSet = new Set(
      (completedCheck || []).map((p) => p.video_id)
    );

    // Count unique completed videos
    const uniqueCompleted = completedSet.size;
    const totalVideosInDb = remainingCount || 0;
    const hasMore = uniqueCompleted < totalVideosInDb;

    return new Response(
      JSON.stringify({
        success: true,
        videos_processed: totalVideos,
        blocks_processed: totalBlocks,
        videos_remaining: hasMore ? totalVideosInDb - uniqueCompleted : 0,
        has_more: hasMore,
        coverage: `${uniqueCompleted}/${totalVideosInDb}`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
