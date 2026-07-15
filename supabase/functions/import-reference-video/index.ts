import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUserOrService } from "../_shared/edge-auth.ts";
import {
  asIngestionError,
  canonicalizeVideoSource,
  IngestionError,
  jsonResponse,
  parseVideoSource,
  REFERENCE_VIDEO_BUCKET,
  sourceIdempotencyKey,
} from "../_shared/ingestion.ts";
import {
  referenceExtension,
  requirePrivateYtDlpWorker,
  resolveReferenceWithWorker,
  streamWorkerVideoToPrivateStorage,
} from "../_shared/reference-import.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
// Longer than the worker resolve + Storage upload ceilings. A second tab or a
// reload can observe this lease, but cannot take over a still-running download.
const ACTIVE_IMPORT_MS = 20 * 60_000;

function safeName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return normalized || "video-referencia";
}

function dispatchVisualAnalysis(options: {
  authorization: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  referenceVideoId: string;
  storagePath: string;
  fileName: string;
}): boolean {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  }).EdgeRuntime;
  if (!runtime?.waitUntil) return false;
  const processing = fetch(`${options.supabaseUrl.replace(/\/$/, "")}/functions/v1/process-reference-video`, {
    method: "POST",
    headers: {
      Authorization: options.authorization,
      apikey: options.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reference_video_id: options.referenceVideoId,
      storage_path: options.storagePath,
      file_name: options.fileName,
      user_id: options.userId,
    }),
  }).then(async (response) => {
    if (!response.ok) {
      console.error("Falha ao disparar process-reference-video", response.status, (await response.text()).slice(0, 300));
    }
  }).catch((error) => console.error("Falha de rede ao disparar process-reference-video", error));
  runtime.waitUntil(processing);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido", code: "METHOD_NOT_ALLOWED" }, 405, {
      ...corsHeaders,
      Allow: "POST, OPTIONS",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let referenceVideoId: string | null = null;
  let committedStoragePath: string | null = null;
  let ownsDownload = false;

  try {
    const actor = await requireUserOrService({ req, supabaseUrl, serviceRoleKey });
    if (actor.kind !== "user" || !actor.userId) {
      throw new IngestionError("USER_AUTH_REQUIRED", "Esta importação precisa da sessão do usuário.", 401);
    }
    const userId = actor.userId;
    const workerEndpoint = requirePrivateYtDlpWorker(Deno.env.get("YTDLP_SERVICE_URL") ?? undefined);
    const body = await req.json();
    const source = parseVideoSource(body?.url ?? "");
    if (source.kind === "youtube_collection") {
      throw new IngestionError("YOUTUBE_COLLECTION_NOT_A_VIDEO", "Cole o link de um vídeo ou Short, não de um canal/playlist.", 422);
    }
    const idempotencyKey = sourceIdempotencyKey(source);
    const canonicalUrl = canonicalizeVideoSource(source);

    let { data: existing, error: existingError } = await supabase
      .from("reference_videos")
      .select("*")
      .eq("user_id", userId)
      .eq("source_idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;

    if (!existing) {
      const reservedId = crypto.randomUUID();
      const { data: inserted, error: insertError } = await supabase
        .from("reference_videos")
        .insert({
          id: reservedId,
          user_id: userId,
          file_name: `referencia-${reservedId}.mp4`,
          storage_path: null,
          storage_bucket: REFERENCE_VIDEO_BUCKET,
          source_url: canonicalUrl,
          source_idempotency_key: idempotencyKey,
          status: "uploading",
          error_message: null,
        })
        .select("*")
        .maybeSingle();
      if (insertError) {
        // A concurrent browser/reload may have won the unique source key.
        if (insertError.code !== "23505") throw insertError;
        const winner = await supabase
          .from("reference_videos")
          .select("*")
          .eq("user_id", userId)
          .eq("source_idempotency_key", idempotencyKey)
          .maybeSingle();
        if (winner.error || !winner.data) throw winner.error || insertError;
        existing = winner.data;
      } else if (inserted) {
        existing = inserted;
        ownsDownload = true;
      }
    }
    if (!existing?.id) throw new IngestionError("REFERENCE_RESERVATION_FAILED", "Não foi possível reservar a referência.", 500, true);
    referenceVideoId = existing.id;

    if (existing.storage_path) {
      if (existing.storage_bucket !== REFERENCE_VIDEO_BUCKET) {
        throw new IngestionError("REFERENCE_BUCKET_INVALID", "A importação por link não pode reutilizar o bucket público.", 409);
      }
      const dispatched = existing.status === "ready" ? false : dispatchVisualAnalysis({
        authorization: req.headers.get("authorization") ?? "",
        supabaseUrl,
        serviceRoleKey,
        userId,
        referenceVideoId: existing.id,
        storagePath: existing.storage_path,
        fileName: existing.file_name,
      });
      return jsonResponse({
        status: existing.status,
        reused: true,
        process_dispatched: dispatched,
        reference_video_id: existing.id,
        storage_path: existing.storage_path,
        file_name: existing.file_name,
        reference_video: existing,
      }, existing.status === "ready" ? 200 : 202, corsHeaders);
    }

    const updatedAt = Date.parse(existing.updated_at ?? "");
    if (!ownsDownload && existing.status === "uploading" && Number.isFinite(updatedAt) && Date.now() - updatedAt < ACTIVE_IMPORT_MS) {
      return jsonResponse({
        status: "uploading",
        reused: true,
        process_dispatched: false,
        reference_video_id: existing.id,
        reference_video: existing,
      }, 202, corsHeaders);
    }
    if (!ownsDownload) {
      const { data: claimed, error: claimError } = await supabase
        .from("reference_videos")
        .update({ status: "uploading", error_message: null, storage_bucket: REFERENCE_VIDEO_BUCKET })
        .eq("id", existing.id)
        .eq("user_id", userId)
        .eq("updated_at", existing.updated_at)
        .select("*")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) {
        return jsonResponse({ status: "uploading", reused: true, reference_video_id: existing.id }, 202, corsHeaders);
      }
      existing = claimed;
      ownsDownload = true;
    }

    const resolved = await resolveReferenceWithWorker({
      endpoint: workerEndpoint,
      token: Deno.env.get("YTDLP_SERVICE_TOKEN") ?? undefined,
      sourceUrl: source.url,
    });
    const extension = referenceExtension(resolved.contentType, resolved.downloadUrl);
    const storagePath = `reference/${userId}/${existing.id}.${extension}`;
    const fileName = `${safeName(source.videoId || canonicalUrl.split("/").filter(Boolean).pop() || "video-referencia")}.${extension}`;
    // Mark the deterministic target before streaming so every failure path,
    // including a post-upload size mismatch, removes a possible orphan.
    committedStoragePath = storagePath;
    await streamWorkerVideoToPrivateStorage({
      resolved,
      supabaseUrl,
      serviceRoleKey,
      storagePath,
    });
    const { data: readyForAnalysis, error: updateError } = await supabase
      .from("reference_videos")
      .update({
        file_name: fileName,
        storage_path: storagePath,
        storage_bucket: REFERENCE_VIDEO_BUCKET,
        status: "pending",
        error_message: null,
      })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (updateError || !readyForAnalysis) throw updateError || new Error("Referência não atualizada.");
    const dispatched = dispatchVisualAnalysis({
      authorization: req.headers.get("authorization") ?? "",
      supabaseUrl,
      serviceRoleKey,
      userId,
      referenceVideoId: existing.id,
      storagePath,
      fileName,
    });
    return jsonResponse({
      status: "pending",
      reused: false,
      process_dispatched: dispatched,
      reference_video_id: existing.id,
      storage_path: storagePath,
      file_name: fileName,
      size_bytes: resolved.sizeBytes,
      reference_video: readyForAnalysis,
    }, 202, corsHeaders);
  } catch (error) {
    const failure = asIngestionError(error);
    console.error("import-reference-video error", failure);
    if (committedStoragePath) {
      await supabase.storage.from(REFERENCE_VIDEO_BUCKET).remove([committedStoragePath]);
    }
    if (referenceVideoId) {
      await supabase.from("reference_videos").update({
        status: "error",
        error_message: `[${failure.code}] ${failure.message}`,
      }).eq("id", referenceVideoId);
    }
    return jsonResponse({
      error: failure.message,
      code: failure.code,
      retryable: failure.retryable,
      details: failure.details,
      reference_video_id: referenceVideoId,
    }, failure.status, corsHeaders);
  }
});
