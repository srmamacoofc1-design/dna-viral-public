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

const PIPELINE_STEPS = [
  { name: "Limpeza Segura", fn: "cleanup", critical: true },
  { name: "Análise Narrativa v2", fn: "analyze-narrative", critical: true },
  { name: "Frames Estruturais", fn: "structural-frames", critical: true },
  { name: "Extração Visual por Bloco", fn: "extract-visual-blocks", critical: true },
  { name: "Semântica por Bloco", fn: "extract-block-semantics", critical: true },
  { name: "DNA Verbal", fn: "extract-verbal-dna", critical: true },
  { name: "CTA Deep v2", fn: "extract-cta-deep-v2", critical: false },
  { name: "Alinhamento Texto-Visual", fn: "calculate-text-visual-alignment", critical: true },
  { name: "Sequência Emocional", fn: "emotion-sequence", critical: false },
  { name: "Compatibilidade Texto-Imagem", fn: "calculate-text-image-compatibility", critical: true },
  { name: "Léxico Viral", fn: "update-viral-lexicon", critical: false },
  { name: "Normalização Performance", fn: "calculate-performance-normalization", critical: false },
  { name: "Combinações Virais", fn: "extract-viral-combinations", critical: false },
];

async function invokeEdge(
  supabaseUrl: string,
  serviceRoleKey: string,
  fnName: string,
  body: any,
  timeoutMs = 50000,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalFunctionHeaders(serviceRoleKey),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function cleanDependentData(supabase: any, videoId: string) {
  await Promise.all([
    supabase.from("block_word_patterns").delete().eq("video_id", videoId),
    supabase.from("block_phrase_patterns").delete().eq("video_id", videoId),
    supabase.from("block_semantic_patterns").delete().eq("video_id", videoId),
    supabase.from("block_verbal_analysis").delete().eq("video_id", videoId),
    supabase.from("visual_block_analysis").delete().eq("video_id", videoId),
    supabase.from("text_visual_alignment").delete().eq("video_id", videoId),
    supabase.from("text_image_compatibility").delete().eq("video_id", videoId),
    supabase.from("cta_deep_analysis").delete().eq("video_id", videoId),
    supabase.from("video_cta_events").delete().eq("video_id", videoId),
    supabase.from("semantic_patterns").delete().eq("video_id", videoId),
    supabase.from("visual_emotion_sequence").delete().eq("video_id", videoId),
    supabase.from("cta_profiles").delete().eq("video_id", videoId),
    supabase.from("video_frames").delete().eq("video_id", videoId).eq("source_method", "block_structural_extraction"),
  ]);
}

async function generateStructuralFrames(supabase: any, videoId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: blocks, error: bErr } = await supabase
    .from("video_blocks").select("id, bloco_id, tempo_inicio, tempo_fim")
    .eq("video_id", videoId).order("bloco_id");
  if (bErr || !blocks?.length) return { ok: false, error: bErr?.message || "No blocks" };

  // Idempotência: remove frames estruturais anteriores antes de recriar
  await supabase
    .from("video_frames")
    .delete()
    .eq("video_id", videoId)
    .eq("source_method", "block_structural_extraction");

  const { data: existingFrames } = await supabase.from("video_frames")
    .select("timestamp_seconds, file_path, frame_hash")
    .eq("video_id", videoId).eq("source_method", "scene_detection").order("timestamp_seconds");

  const sceneFrames = existingFrames ?? [];
  const framesToInsert: any[] = [];
  let frameNumber = 1000;

  for (const block of blocks) {
    const start = Number(block.tempo_inicio), end = Number(block.tempo_fim), mid = (start + end) / 2;
    for (const { role, ts } of [{ role: "start", ts: start }, { role: "middle", ts: mid }, { role: "end", ts: Math.max(end - 0.1, start + 0.1) }]) {
      let closest: any = null, closestDist = Infinity;
      for (const sf of sceneFrames) {
        const d = Math.abs(Number(sf.timestamp_seconds) - ts);
        if (d < closestDist) { closestDist = d; closest = sf; }
      }
      const filePath = closest?.file_path || `videos/frames/${videoId}/structural/block_${String(block.bloco_id).padStart(3, "0")}_${role}.jpg`;
      const frameHash = closest?.frame_hash || `structural_${videoId}_${block.bloco_id}_${role}_${Date.now()}`;
      framesToInsert.push({
        video_id: videoId, block_id: block.id, frame_number: frameNumber++,
        timestamp_seconds: ts, frame_role: role, source_method: "block_structural_extraction",
        file_path: filePath, frame_hash: frameHash, scene_change_flag: role === "start",
      });
    }
  }
  if (framesToInsert.length > 0) {
    const { error } = await supabase.from("video_frames").insert(framesToInsert);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function buildEmotionSequence(supabase: any, videoId: string) {
  const { data: be } = await supabase.from("video_blocks").select("emocao, bloco_id").eq("video_id", videoId).order("bloco_id");
  if (!be?.length) return;
  const emotions = be.map((b: any) => b.emocao).filter(Boolean);
  const transitions = emotions.slice(1).map((e: any, i: number) => `${emotions[i]}→${e}`);
  const counts: Record<string, number> = {};
  transitions.forEach((t: string) => { counts[t] = (counts[t] || 0) + 1; });
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  await supabase.from("visual_emotion_sequence").upsert({
    video_id: videoId, emotion_sequence: emotions, sequence_string: emotions.join(" → "),
    dominant_transition: dominant, transition_count: transitions.length,
    confidence_score: Math.min(100, emotions.length * 15),
  }, { onConflict: "video_id" });
}

async function runCheckpoints(supabase: any, videoId: string): Promise<{ ok: boolean; details: string }> {
  const [{ count: bc }, { count: vc }, { count: ac }, { count: cc }, { count: sc }, { count: vbc }, { count: stc }] = await Promise.all([
    supabase.from("video_blocks").select("*", { count: "exact", head: true }).eq("video_id", videoId),
    supabase.from("visual_block_analysis").select("*", { count: "exact", head: true }).eq("video_id", videoId),
    supabase.from("text_visual_alignment").select("*", { count: "exact", head: true }).eq("video_id", videoId),
    supabase.from("text_image_compatibility").select("*", { count: "exact", head: true }).eq("video_id", videoId),
    supabase.from("block_semantic_patterns").select("*", { count: "exact", head: true }).eq("video_id", videoId),
    supabase.from("block_verbal_analysis").select("*", { count: "exact", head: true }).eq("video_id", videoId),
    supabase.from("video_frames").select("*", { count: "exact", head: true }).eq("video_id", videoId).eq("source_method", "block_structural_extraction"),
  ]);
  const blocks = bc ?? 0, ef = blocks * 3;
  const f: string[] = [];
  if (blocks === 0) f.push("blocks=0");
  if ((stc ?? 0) !== ef) f.push(`structural=${stc}/${ef}`);
  if ((vc ?? 0) < blocks) f.push(`visual=${vc}/${blocks}`);
  if ((ac ?? 0) < blocks) f.push(`align=${ac}/${blocks}`);
  if ((cc ?? 0) < blocks) f.push(`compat=${cc}/${blocks}`);
  if ((sc ?? 0) === 0) f.push("semantic=0");
  if ((vbc ?? 0) === 0) f.push("verbal=0");
  if (f.length > 0) return { ok: false, details: f.join("; ") };
  return { ok: true, details: `blocks=${blocks} structural=${stc} visual=${vc} align=${ac} compat=${cc}` };
}

function selfInvoke(supabaseUrl: string, serviceRoleKey: string, jobId: string) {
  setTimeout(() => {
    fetch(`${supabaseUrl}/functions/v1/reprocess-v2-worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalFunctionHeaders(serviceRoleKey),
      },
      body: JSON.stringify({ job_id: jobId }),
    }).catch(() => {});
  }, 2000);
}

async function claimNextItem(supabase: any, jobId: string) {
  const now = new Date().toISOString();

  // Hard concurrency cap: processa 1 item por vez por job
  const { count: processingCount } = await supabase
    .from("reprocess_job_items")
    .select("*", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "processing");

  if ((processingCount ?? 0) > 0) {
    return { item: null, state: "busy" as const };
  }

  // 1) tenta retomar item running
  const { data: runningCandidate } = await supabase
    .from("reprocess_job_items")
    .select("*")
    .eq("job_id", jobId)
    .eq("status", "running")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (runningCandidate) {
    const { data: lockedRunning } = await supabase
      .from("reprocess_job_items")
      .update({ status: "processing", started_at: now })
      .eq("id", runningCandidate.id)
      .eq("status", "running")
      .select("*")
      .maybeSingle();

    if (lockedRunning) {
      return { item: lockedRunning, state: "claimed" as const };
    }
  }

  // 2) se não houver running, tenta pegar o próximo queued
  const { data: queuedCandidate } = await supabase
    .from("reprocess_job_items")
    .select("*")
    .eq("job_id", jobId)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!queuedCandidate) {
    return { item: null, state: "empty" as const };
  }

  const { data: lockedQueued } = await supabase
    .from("reprocess_job_items")
    .update({
      status: "processing",
      started_at: now,
      attempts: (queuedCandidate.attempts || 0) + 1,
      current_step: queuedCandidate.current_step || PIPELINE_STEPS[0].name,
      error_message: null,
    })
    .eq("id", queuedCandidate.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (lockedQueued) {
    return { item: lockedQueued, state: "claimed" as const };
  }

  return { item: null, state: "busy" as const };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const jobId: string = body.job_id;

    if (!jobId) return new Response(JSON.stringify({ error: "job_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Recovery: reset stuck item lease (>3 min sem heartbeat)
    const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    await supabase.from("reprocess_job_items")
      .update({ status: "queued", started_at: null, error_message: "Recovered stale processing lease" })
      .eq("job_id", jobId)
      .in("status", ["running", "processing"])
      .lt("started_at", staleTime);

    const { data: job } = await supabase.from("reprocess_jobs").select("*").eq("id", jobId).single();
    if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (job.status === "completed" || job.status === "canceled") {
      return new Response(JSON.stringify({ message: "Job finished", status: job.status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("reprocess_jobs").update({
      status: "running", started_at: job.started_at || new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    const claim = await claimNextItem(supabase, jobId);
    const item = claim.item;

    if (!item && claim.state === "busy") {
      return new Response(
        JSON.stringify({ status: "worker_busy", message: "Outro worker já está processando este job" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!item) {
      const { count: remainingItems } = await supabase
        .from("reprocess_job_items")
        .select("*", { count: "exact", head: true })
        .eq("job_id", jobId)
        .in("status", ["queued", "running", "processing"]);

      if ((remainingItems ?? 0) > 0) {
        return new Response(
          JSON.stringify({ status: "waiting_other_worker", remaining: remainingItems }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // No more items — global finalization
      await supabase.from("reprocess_jobs").update({
        current_step: "Finalizando: DNA Base v2 + Correlações", updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      await invokeEdge(supabaseUrl, serviceKey, "generate-dna-base-v2", {});
      await invokeEdge(supabaseUrl, serviceKey, "calculate-pattern-correlations", {});
      await invokeEdge(supabaseUrl, serviceKey, "validate-mvp-layers", {});
      await invokeEdge(supabaseUrl, serviceKey, "recalculate-viral-scores", { triggered_by: "reprocess_finalization" });
      await invokeEdge(supabaseUrl, serviceKey, "consolidate-block-patterns", {});

      await supabase.from("reprocess_jobs").update({
        status: "completed", finished_at: new Date().toISOString(), current_step: null, current_video_id: null,
      }).eq("id", jobId);

      return new Response(JSON.stringify({ status: "completed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const videoId = item.video_id;

    // Determine current step index from current_step field
    let stepIndex = 0;
    if (item.current_step) {
      const idx = PIPELINE_STEPS.findIndex((s) => s.name === item.current_step);
      if (idx >= 0) stepIndex = idx;
    }

    await supabase.from("reprocess_jobs").update({
      current_video_id: videoId, updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    // Execute ONE step
    const step = PIPELINE_STEPS[stepIndex];
    const pct = Math.round(((stepIndex + 1) / PIPELINE_STEPS.length) * 100);

    await supabase.from("reprocess_job_items").update({
      current_step: step.name, progress_pct: pct,
    }).eq("id", item.id);

    await supabase.from("reprocess_jobs").update({
      current_step: `${item.video_title || videoId}: ${step.name}`, updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    let result: { ok: boolean; error?: string };

    if (step.fn === "cleanup") {
      await cleanDependentData(supabase, videoId);
      result = { ok: true };
    } else if (step.fn === "structural-frames") {
      result = await generateStructuralFrames(supabase, videoId);
    } else if (step.fn === "emotion-sequence") {
      await buildEmotionSequence(supabase, videoId);
      result = { ok: true };
    } else {
        const maxRetries = step.critical ? 3 : 0;
      let attempt = 0;
      result = { ok: false };
      do {
        result = await invokeEdge(
          supabaseUrl,
          serviceKey,
          step.fn,
          step.fn === "analyze-narrative"
            ? { video_id: videoId, orchestrated: true }
            : { video_id: videoId },
          step.fn === "analyze-narrative" ? 58000 : 50000,
        );
        if (result.ok) break;
        attempt++;
        if (attempt <= maxRetries) {
          const backoffMs = Math.min(8000, 2000 * attempt);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      } while (attempt <= maxRetries);
    }

    if (!result.ok) {
      const errMsg = result.error || "Unknown error";
      await supabase.from("video_logs").insert({
        video_id: videoId, etapa: step.name, status: "error", mensagem: `❌ ${step.name}: ${errMsg.slice(0, 300)}`,
      });

      if (step.critical) {
          const isTransientAbort = /signal has been aborted|aborterror|aborted|upstream request timeout|gateway timeout|deadline exceeded/i.test(errMsg);

          if (isTransientAbort && (item.attempts ?? 0) < 6) {
          await supabase.from("reprocess_job_items").update({
            status: "queued",
            current_step: step.name,
            started_at: null,
            error_message: `${step.name}: transient timeout, requeue automático`,
            progress_pct: Math.max(0, item.progress_pct ?? 0),
          }).eq("id", item.id);

          await supabase.from("video_logs").insert({
            video_id: videoId,
            etapa: step.name,
            status: "warning",
            mensagem: `⏱️ Timeout transitório em ${step.name}; item reenfileirado automaticamente.`,
          });

          selfInvoke(supabaseUrl, serviceKey, jobId);
          return new Response(JSON.stringify({ status: "step_requeued", step: step.name }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Critical failure — mark video as failed, move to next
        await supabase.from("videos").update({ status: "failed" }).eq("id", videoId);
        await supabase.from("reprocess_job_items").update({
          status: "failed", error_message: `${step.name}: ${errMsg.slice(0, 500)}`,
          finished_at: new Date().toISOString(), progress_pct: 100,
        }).eq("id", item.id);
        await supabase.from("reprocess_jobs").update({
          failed_videos: (job.failed_videos ?? 0) + 1, updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        selfInvoke(supabaseUrl, serviceKey, jobId);
        return new Response(JSON.stringify({ status: "step_failed_critical", step: step.name }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Non-critical — continue to next step
    }

    const nextStepIndex = stepIndex + 1;

    if (nextStepIndex < PIPELINE_STEPS.length) {
      // More steps for this video — update current_step to next and self-invoke
      await supabase.from("reprocess_job_items").update({
        status: "running",
        current_step: PIPELINE_STEPS[nextStepIndex].name,
        progress_pct: Math.round(((nextStepIndex + 1) / PIPELINE_STEPS.length) * 100),
        started_at: new Date().toISOString(),
      }).eq("id", item.id);
      selfInvoke(supabaseUrl, serviceKey, jobId);
    } else {
      // All steps done for this video — run checkpoint
      const checkpoint = await runCheckpoints(supabase, videoId);
      if (!checkpoint.ok) {
        await supabase.from("videos").update({ status: "failed" }).eq("id", videoId);
        await supabase.from("reprocess_job_items").update({
          status: "failed", error_message: `Checkpoint: ${checkpoint.details}`,
          finished_at: new Date().toISOString(), progress_pct: 100,
        }).eq("id", item.id);
        await supabase.from("reprocess_jobs").update({
          failed_videos: (job.failed_videos ?? 0) + 1, updated_at: new Date().toISOString(),
        }).eq("id", jobId);
      } else {
        await supabase.from("videos").update({ block_segmentation_version: "v2_refined", status: "completed" }).eq("id", videoId);
        await supabase.from("reprocess_job_items").update({
          status: "completed", finished_at: new Date().toISOString(), progress_pct: 100,
        }).eq("id", item.id);
        await supabase.from("reprocess_jobs").update({
          completed_videos: (job.completed_videos ?? 0) + 1, updated_at: new Date().toISOString(),
        }).eq("id", jobId);
      }
      selfInvoke(supabaseUrl, serviceKey, jobId);
    }

    return new Response(
      JSON.stringify({ status: "step_done", video: item.video_title, step: step.name, nextStep: nextStepIndex < PIPELINE_STEPS.length ? PIPELINE_STEPS[nextStepIndex].name : "checkpoint" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
