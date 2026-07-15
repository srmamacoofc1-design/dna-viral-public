import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "incremental";
    const targetVideoId = body.video_id || null;
    const batchSize = body.batch_size || 10;

    const { data: allVideos } = await supabase
      .from("videos")
      .select("id")
      .eq("status", "completed");

    if (!allVideos?.length) {
      return new Response(JSON.stringify({ message: "No completed videos", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let videosToProcess: string[] = [];

    if (targetVideoId) {
      videosToProcess = [targetVideoId];
    } else if (mode === "force_all") {
      videosToProcess = allVideos.map((v) => v.id).slice(0, batchSize);
    } else {
      const { data: existingEvents } = await supabase
        .from("video_micro_events")
        .select("video_id")
        .eq("processing_status", "completed");

      const coveredVideoIds = new Set((existingEvents || []).map((e) => e.video_id));

      const { data: failedEvents } = await supabase
        .from("video_micro_events")
        .select("video_id")
        .eq("processing_status", "failed");
      const failedVideoIds = new Set((failedEvents || []).map((e) => e.video_id));

      videosToProcess = allVideos
        .filter((v) => !coveredVideoIds.has(v.id) || failedVideoIds.has(v.id))
        .map((v) => v.id)
        .slice(0, batchSize);
    }

    if (!videosToProcess.length) {
      return new Response(JSON.stringify({ message: "All videos already processed", processed: 0, has_more: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalEvents = 0;
    let processedVideos = 0;

    for (const videoId of videosToProcess) {
      try {
        const events = await processVideo(supabase, videoId);
        totalEvents += events;
        processedVideos++;
      } catch (err) {
        console.error(`Error processing video ${videoId}:`, err);
      }
    }

    const hasMore = mode === "incremental" && videosToProcess.length >= batchSize;

    return new Response(
      JSON.stringify({
        processed_videos: processedVideos,
        total_events: totalEvents,
        has_more: hasMore,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("detect-micro-events error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processVideo(supabase: any, videoId: string): Promise<number> {
  const { data: blocks } = await supabase
    .from("video_blocks")
    .select("id, bloco_id, tipo_bloco, tempo_inicio, tempo_fim, texto")
    .eq("video_id", videoId)
    .order("bloco_id", { ascending: true });

  if (!blocks?.length) return 0;

  const { data: frames } = await supabase
    .from("video_frames")
    .select("id, timestamp_seconds, scene_change_flag, visual_intensity_score, block_id")
    .eq("video_id", videoId)
    .order("timestamp_seconds", { ascending: true });

  const { data: temporalData } = await supabase
    .from("video_temporal_profile")
    .select("block_id, cut_count, cut_density, avg_cut_interval, rhythm_level, tempo_pattern")
    .eq("video_id", videoId)
    .eq("processing_status", "completed");

  const { data: alignmentData } = await supabase
    .from("text_visual_alignment")
    .select("block_id, alignment_score, emotion_alignment_score, action_alignment_score, intensity_alignment_score")
    .eq("video_id", videoId);

  const temporalMap = new Map((temporalData || []).map((t: any) => [t.block_id, t]));
  const alignmentMap = new Map((alignmentData || []).map((a: any) => [a.block_id, a]));
  const allFrames = frames || [];

  await supabase.from("video_micro_events").delete().eq("video_id", videoId);

  const allEvents: any[] = [];

  for (const block of blocks) {
    const blockDuration = block.tempo_fim - block.tempo_inicio;
    if (blockDuration <= 0) continue;

    const blockFrames = allFrames.filter(
      (f: any) =>
        f.timestamp_seconds >= block.tempo_inicio && f.timestamp_seconds <= block.tempo_fim
    );

    const temporal = temporalMap.get(block.id);
    const alignment = alignmentMap.get(block.id);
    const alignScore = alignment?.alignment_score ?? 0;
    const cutDensity = temporal?.cut_density ?? 0;
    const tempoPattern = temporal?.tempo_pattern ?? "stable";

    const events: any[] = [];

    const sceneChangeFrames = blockFrames.filter((f: any) => f.scene_change_flag === true);
    for (const f of sceneChangeFrames) {
      const visualScore = normalizeScore(f.visual_intensity_score ?? 50, 0, 100);
      const tempIntensity = normalizeScore(cutDensity, 0, 2);
      const alignNorm = normalizeScore(alignScore, 0, 100);
      const strength = visualScore * 0.4 + tempIntensity * 0.35 + alignNorm * 0.25;

      if (strength > 0.15) {
        events.push({
          timestamp_seconds: f.timestamp_seconds,
          event_type: "sudden_transition",
          event_strength: round(strength),
          visual_change_score: round(visualScore),
          temporal_intensity: round(tempIntensity),
          alignment_score: round(alignNorm),
          confidence_score: round(sceneChangeFrames.length > 1 ? 0.8 : 0.6),
        });
      }
    }

    if (cutDensity >= 0.8 || tempoPattern === "burst") {
      const midTs = block.tempo_inicio + blockDuration / 2;
      const tempIntensity = normalizeScore(cutDensity, 0, 2);
      const visualAvg = avgIntensity(blockFrames);
      const alignNorm = normalizeScore(alignScore, 0, 100);
      const strength = visualAvg * 0.4 + tempIntensity * 0.35 + alignNorm * 0.25;

      if (strength > 0.2) {
        events.push({
          timestamp_seconds: midTs,
          event_type: "burst_sequence",
          event_strength: round(strength),
          visual_change_score: round(visualAvg),
          temporal_intensity: round(tempIntensity),
          alignment_score: round(alignNorm),
          confidence_score: round(tempoPattern === "burst" ? 0.85 : 0.7),
        });
      }
    }

    if (tempoPattern === "pause_before_reveal" || (temporal?.avg_cut_interval > 3 && sceneChangeFrames.length > 0)) {
      const firstCut = sceneChangeFrames[0];
      if (firstCut) {
        const pauseDuration = firstCut.timestamp_seconds - block.tempo_inicio;
        const visualScore = normalizeScore(firstCut.visual_intensity_score ?? 50, 0, 100);
        const tempIntensity = normalizeScore(Math.min(pauseDuration / blockDuration, 1), 0, 1);
        const alignNorm = normalizeScore(alignScore, 0, 100);
        const strength = visualScore * 0.4 + tempIntensity * 0.35 + alignNorm * 0.25;

        if (strength > 0.15) {
          events.push({
            timestamp_seconds: firstCut.timestamp_seconds,
            event_type: "micro_pause",
            event_strength: round(strength),
            visual_change_score: round(visualScore),
            temporal_intensity: round(tempIntensity),
            alignment_score: round(alignNorm),
            confidence_score: round(tempoPattern === "pause_before_reveal" ? 0.8 : 0.55),
          });
        }
      }
    }

    if (alignScore >= 60 && sceneChangeFrames.length > 0) {
      const bestFrame = sceneChangeFrames.reduce((best: any, f: any) =>
        (f.visual_intensity_score ?? 0) > (best.visual_intensity_score ?? 0) ? f : best
      );
      const visualScore = normalizeScore(bestFrame.visual_intensity_score ?? 70, 0, 100);
      const alignNorm = normalizeScore(alignScore, 0, 100);
      const tempIntensity = normalizeScore(cutDensity, 0, 2);
      const strength = visualScore * 0.4 + tempIntensity * 0.35 + alignNorm * 0.25;

      if (strength > 0.3) {
        events.push({
          timestamp_seconds: bestFrame.timestamp_seconds,
          event_type: "visual_reveal",
          event_strength: round(strength),
          visual_change_score: round(visualScore),
          temporal_intensity: round(tempIntensity),
          alignment_score: round(alignNorm),
          confidence_score: round(0.75),
        });
      }
    }

    for (let i = 1; i < blockFrames.length; i++) {
      const prev = blockFrames[i - 1];
      const curr = blockFrames[i];
      const intensityDiff = Math.abs((curr.visual_intensity_score ?? 50) - (prev.visual_intensity_score ?? 50));
      const timeDiff = curr.timestamp_seconds - prev.timestamp_seconds;

      if (intensityDiff > 30 && timeDiff < 1.5 && curr.scene_change_flag) {
        const visualScore = normalizeScore(intensityDiff, 0, 100);
        const tempIntensity = normalizeScore(1 / Math.max(timeDiff, 0.1), 0, 10);
        const alignNorm = normalizeScore(alignScore, 0, 100);
        const strength = visualScore * 0.4 + tempIntensity * 0.35 + alignNorm * 0.25;

        if (strength > 0.25) {
          events.push({
            timestamp_seconds: curr.timestamp_seconds,
            event_type: "shock_visual",
            event_strength: round(strength),
            visual_change_score: round(visualScore),
            temporal_intensity: round(tempIntensity),
            alignment_score: round(alignNorm),
            confidence_score: round(0.7),
          });
          break;
        }
      }
    }

    const hasReveal = events.some((e) => e.event_type === "visual_reveal" || e.event_type === "sudden_transition");
    if (hasReveal && blockFrames.length >= 3) {
      const lastThird = blockFrames.slice(Math.floor(blockFrames.length * 0.66));
      const changeInLast = lastThird.filter((f: any) => f.scene_change_flag).length;
      if (changeInLast > 0) {
        const reactionFrame = lastThird.find((f: any) => f.scene_change_flag) || lastThird[0];
        const visualScore = normalizeScore(reactionFrame.visual_intensity_score ?? 50, 0, 100);
        const tempIntensity = normalizeScore(cutDensity, 0, 2);
        const alignNorm = normalizeScore(alignScore, 0, 100);
        const strength = visualScore * 0.4 + tempIntensity * 0.35 + alignNorm * 0.25;

        if (strength > 0.2) {
          events.push({
            timestamp_seconds: reactionFrame.timestamp_seconds,
            event_type: "reaction_moment",
            event_strength: round(strength),
            visual_change_score: round(visualScore),
            temporal_intensity: round(tempIntensity),
            alignment_score: round(alignNorm),
            confidence_score: round(0.6),
          });
        }
      }
    }

    if (blockFrames.length >= 1 && alignScore >= 50 && (temporal?.cut_count ?? 0) <= 1) {
      const avgVis = avgIntensity(blockFrames);
      const tempIntensity = normalizeScore(1 - cutDensity, 0, 1);
      const alignNorm = normalizeScore(alignScore, 0, 100);
      const strength = avgVis * 0.4 + tempIntensity * 0.35 + alignNorm * 0.25;

      if (strength > 0.25 && blockDuration >= 1) {
        events.push({
          timestamp_seconds: block.tempo_inicio + blockDuration / 2,
          event_type: "attention_lock",
          event_strength: round(strength),
          visual_change_score: round(avgVis),
          temporal_intensity: round(tempIntensity),
          alignment_score: round(alignNorm),
          confidence_score: round(blockDuration >= 2 ? 0.65 : 0.5),
        });
      }
    }

    const deduplicated = deduplicateEvents(events);

    const finalEvents = deduplicated
      .sort((a, b) => b.event_strength - a.event_strength)
      .slice(0, 6);

    for (const evt of finalEvents) {
      allEvents.push({
        video_id: videoId,
        block_id: block.id,
        ...evt,
        processing_status: "completed",
      });
    }
  }

  // Insert detected events
  if (allEvents.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < allEvents.length; i += chunkSize) {
      const chunk = allEvents.slice(i, i + chunkSize);
      const { error } = await supabase.from("video_micro_events").insert(chunk);
      if (error) {
        console.error(`Insert error for video ${videoId}:`, error);
        throw error;
      }
    }
  }

  // For blocks with no events detected, insert a completed_no_signal marker
  const blocksWithEvents = new Set(allEvents.map((e) => e.block_id));
  const noSignalRecords = blocks
    .filter((b: any) => !blocksWithEvents.has(b.id))
    .map((b: any) => ({
      video_id: videoId,
      block_id: b.id,
      timestamp_seconds: b.tempo_inicio,
      event_type: "no_signal",
      event_strength: 0,
      visual_change_score: 0,
      temporal_intensity: 0,
      alignment_score: 0,
      confidence_score: 0,
      processing_status: "completed_no_signal",
    }));

  if (noSignalRecords.length > 0) {
    await supabase.from("video_micro_events").insert(noSignalRecords);
  }

  return allEvents.length;
}

function normalizeScore(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function avgIntensity(frames: any[]): number {
  if (!frames.length) return 0.5;
  const sum = frames.reduce((s: number, f: any) => s + (f.visual_intensity_score ?? 50), 0);
  return normalizeScore(sum / frames.length, 0, 100);
}

function deduplicateEvents(events: any[]): any[] {
  const map = new Map<number, any>();
  for (const e of events) {
    const ts = e.timestamp_seconds;
    if (!map.has(ts) || map.get(ts).event_strength < e.event_strength) {
      map.set(ts, e);
    }
  }
  return Array.from(map.values());
}
