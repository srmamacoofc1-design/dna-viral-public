import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  EdgeAuthError,
  internalFunctionHeaders,
  requireResourceOwnerAdminOrService,
  requireUserOrService,
} from "../_shared/edge-auth.ts";
import { asIngestionError, normalizeStoragePath, parseVideoSource } from "../_shared/ingestion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido", code: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const actor = await requireUserOrService({ req, supabaseUrl, serviceRoleKey: serviceKey });
    const body = await req.json();
    const videoId = typeof body?.video_id === "string" ? body.video_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(videoId)) return json({ error: "video_id inválido" }, 422);
    const filePath = body?.file_path ? normalizeStoragePath(body.file_path) : null;
    const source = body?.url ? parseVideoSource(body.url) : null;
    if (source?.kind === "youtube_collection") {
      return json({
        error: "Este link é de canal ou playlist. Cole o link de um vídeo ou Short específico.",
        code: "YOUTUBE_COLLECTION_NOT_A_VIDEO",
      }, 422);
    }
    if (!filePath && !source) return json({ error: "Informe file_path ou url" }, 422);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id, created_by, approved_for_global")
      .eq("id", videoId)
      .maybeSingle();
    if (videoError) throw videoError;
    if (!video) return json({ error: "Vídeo não encontrado", code: "VIDEO_NOT_FOUND" }, 404);
    await requireResourceOwnerAdminOrService({
      actor,
      ownerId: video.created_by,
      supabaseUrl,
      serviceRoleKey: serviceKey,
    });
    const { data: claimed, error: claimError } = await supabase
      .from("processing_queue")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        completed_at: null,
        error_message: null,
      })
      .eq("video_id", videoId)
      .eq("status", "pending")
      .select("video_id");
    if (claimError) throw claimError;
    if (!claimed?.length) {
      const { data: current } = await supabase
        .from("processing_queue")
        .select("status, error_message")
        .eq("video_id", videoId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json({ accepted: false, already_claimed: true, status: current?.status ?? "missing", error: current?.error_message ?? undefined }, 200);
    }

    await supabase.from("videos").update({ status: "processing" }).eq("id", videoId);
    const job = runPipeline({
      videoId,
      filePath,
      sourceUrl: source?.url ?? null,
      videoDuration: Number.isFinite(Number(body?.video_duration)) ? Number(body.video_duration) : undefined,
      includeGlobalAggregation: video.approved_for_global === true,
      supabaseUrl,
      serviceKey,
    });

    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(job);
      return json({ accepted: true, status: "processing", video_id: videoId }, 202);
    }

    const result = await job;
    if (!result.success) {
      return json({ accepted: true, status: "failed", video_id: videoId, error: result.error }, 500);
    }
    return json({ accepted: true, status: "completed", video_id: videoId });
  } catch (error) {
    if (error instanceof EdgeAuthError) {
      return json({ error: error.message, code: error.code, retryable: false }, error.status);
    }
    const failure = asIngestionError(error);
    console.error("process-video-pipeline dispatch error:", failure);
    return json({ error: failure.message, code: failure.code, retryable: failure.retryable }, failure.status);
  }
});

async function runPipeline(options: {
  videoId: string;
  filePath: string | null;
  sourceUrl: string | null;
  videoDuration?: number;
  includeGlobalAggregation: boolean;
  supabaseUrl: string;
  serviceKey: string;
}) {
  const supabase = createClient(options.supabaseUrl, options.serviceKey);
  const log = async (etapa: string, mensagem: string, status = "success") => {
    await supabase.from("video_logs").insert({ video_id: options.videoId, etapa, mensagem, status });
  };
  const call = async (name: string, body: Record<string, unknown>) => {
    const response = await fetch(`${options.supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalFunctionHeaders(options.serviceKey),
      },
      body: JSON.stringify(body),
    });
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error ?? `${name} falhou (HTTP ${response.status})`);
    }
    return payload;
  };
  const optional = async (label: string, name: string) => {
    try {
      const result = await call(name, { video_id: options.videoId });
      await log(label, `✅ ${label} concluído`);
      return result;
    } catch (error) {
      await log(label, `⚠ ${label} não-bloqueante: ${error instanceof Error ? error.message : "erro"}`, "warning");
      return null;
    }
  };

  try {
    let path = options.filePath;
    if (!path && options.sourceUrl) {
      await log("Download", "Baixando o vídeo do link informado...");
      const downloaded = await call("download-video", { video_id: options.videoId, url: options.sourceUrl });
      path = normalizeStoragePath(downloaded.file_path);
    }
    if (!path) throw new Error("O pipeline não recebeu um arquivo processável.");

    await log("Análise Multimodal", "Transcrevendo áudio e observando os pixels reais...");
    const multimodal = await call("transcribe-video", {
      video_id: options.videoId,
      file_path: path,
      video_duration: options.videoDuration,
    });
    if (!multimodal.segments_count || !multimodal.visual_moments) {
      throw new Error("Transcrição ou análise visual voltou vazia.");
    }
    await log("Análise Multimodal", `✅ ${multimodal.segments_count} segmentos e ${multimodal.visual_moments} momentos visuais`);

    const narrative = await call("analyze-narrative", { video_id: options.videoId, orchestrated: true });
    if (!narrative.blocks_count) throw new Error("A análise narrativa não produziu blocos.");
    await log("Análise Narrativa", `✅ ${narrative.blocks_count} blocos narrativos`);

    const visual = await call("extract-visual-blocks", { video_id: options.videoId });
    if (!visual.observed_blocks || !visual.multimodal_moments) {
      throw new Error("Os blocos não foram ligados a observações visuais reais.");
    }
    await log("DNA Visual", `✅ ${visual.observed_blocks}/${visual.blocks_processed} blocos observados`);

    await optional("Semântica por Bloco", "extract-block-semantics");
    await optional("DNA Verbal", "extract-verbal-dna");
    await optional("CTA Profundo", "extract-cta-deep");
    await optional("Alinhamento Texto-Visual", "calculate-text-visual-alignment");
    await optional("Compatibilidade Texto-Imagem", "calculate-text-image-compatibility");
    if (options.includeGlobalAggregation) {
      await optional("Léxico Viral", "update-viral-lexicon");
      await optional("Normalização Performance", "calculate-performance-normalization");
    } else {
      await log("Base pessoal", "Vídeo processado para presets pessoais sem alterar a Base Global.");
    }

    await supabase.from("videos").update({ status: "completed" }).eq("id", options.videoId);
    await supabase.from("processing_queue").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      error_message: null,
    }).eq("video_id", options.videoId);
    await log("Finalização", "✅ Pipeline multimodal completo concluído");
    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no processamento";
    console.error("process-video-pipeline job error:", error);
    await supabase.from("videos").update({ status: "failed" }).eq("id", options.videoId);
    await supabase.from("processing_queue").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
    }).eq("video_id", options.videoId);
    await log("Erro", `❌ ${message}`, "error");
    return { success: false as const, error: message };
  }
}
