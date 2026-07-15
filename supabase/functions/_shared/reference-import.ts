import {
  assertVideoSize,
  extensionForMimeType,
  IngestionError,
  MAX_REFERENCE_VIDEO_BYTES,
  parseVideoSource,
  REFERENCE_VIDEO_BUCKET,
} from "./ingestion.ts";

const WORKER_TIMEOUT_MS = 150_000;
const STORAGE_UPLOAD_TIMEOUT_MS = 180_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
export const REFERENCE_WORKER_FORMAT = "best[height<=720][ext=mp4]/best[height<=720]/best";

export interface ResolvedWorkerVideo {
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
}

export function requirePrivateYtDlpWorker(rawUrl: string | undefined): URL {
  if (!rawUrl?.trim()) {
    throw new IngestionError(
      "YTDLP_WORKER_REQUIRED",
      "A importação por link não está configurada no servidor.",
      503,
      false,
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(rawUrl.trim());
  } catch {
    throw new IngestionError("YTDLP_WORKER_INVALID", "YTDLP_SERVICE_URL não é uma URL válida.", 500);
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new IngestionError("YTDLP_WORKER_INSECURE", "O worker yt-dlp precisa usar HTTPS sem credenciais na URL.", 500);
  }
  return endpoint;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new IngestionError("REMOTE_TIMEOUT", "O worker de vídeo excedeu o tempo limite.", 504, true);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveReferenceWithWorker(options: {
  endpoint: URL;
  token?: string;
  sourceUrl: string;
}): Promise<ResolvedWorkerVideo> {
  const response = await fetchWithTimeout(options.endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.token?.trim() ? { Authorization: `Bearer ${options.token.trim()}` } : {}),
    },
    body: JSON.stringify({ url: options.sourceUrl, format: REFERENCE_WORKER_FORMAT }),
  }, WORKER_TIMEOUT_MS);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || `HTTP ${response.status}`;
    throw new IngestionError(
      "YTDLP_WORKER_FAILED",
      `O worker yt-dlp recusou o vídeo: ${String(message).slice(0, 240)}`,
      response.status === 429 ? 429 : 502,
      response.status === 429 || RETRYABLE_STATUS.has(response.status),
    );
  }

  const downloadUrl = typeof payload?.download_url === "string" ? payload.download_url : "";
  let parsedDownload: URL;
  try {
    parsedDownload = new URL(downloadUrl);
  } catch {
    throw new IngestionError("YTDLP_DOWNLOAD_URL_INVALID", "O worker não retornou uma URL de download válida.", 502, true);
  }
  if (parsedDownload.protocol !== "https:" || parsedDownload.username || parsedDownload.password) {
    throw new IngestionError("YTDLP_DOWNLOAD_URL_INSECURE", "O worker retornou uma URL de download insegura.", 502);
  }
  if (parsedDownload.origin !== options.endpoint.origin) {
    throw new IngestionError(
      "YTDLP_DOWNLOAD_HOST_MISMATCH",
      "O worker retornou o arquivo em uma origem diferente da origem privada configurada.",
      502,
    );
  }
  // Reuse the ingestion SSRF guard for the worker's signed public URL.
  parseVideoSource(parsedDownload.toString());
  const sizeBytes = Number(payload?.size_bytes);
  assertVideoSize(sizeBytes, MAX_REFERENCE_VIDEO_BYTES);
  const contentType = typeof payload?.content_type === "string"
    ? payload.content_type.split(";", 1)[0].trim().toLowerCase()
    : "video/mp4";
  if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") {
    throw new IngestionError("YTDLP_CONTENT_TYPE_INVALID", "O worker não retornou um arquivo de vídeo.", 502);
  }
  return { downloadUrl: parsedDownload.toString(), contentType, sizeBytes };
}

async function fetchValidatedDownload(url: string, maxRedirects = 5): Promise<Response> {
  let current = parseVideoSource(url).url;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetchWithTimeout(current, { redirect: "manual" }, WORKER_TIMEOUT_MS);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new IngestionError("INVALID_REDIRECT", "O download redirecionou sem informar um destino.", 502, true);
    current = parseVideoSource(new URL(location, current).toString()).url;
  }
  throw new IngestionError("TOO_MANY_REDIRECTS", "O download entrou em um ciclo de redirecionamentos.", 422);
}

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function streamWorkerVideoToPrivateStorage(options: {
  resolved: ResolvedWorkerVideo;
  supabaseUrl: string;
  serviceRoleKey: string;
  storagePath: string;
}): Promise<number> {
  const response = await fetchValidatedDownload(options.resolved.downloadUrl);
  if (!response.ok || !response.body) {
    throw new IngestionError("VIDEO_DOWNLOAD_FAILED", `Falha ao baixar o vídeo do worker (HTTP ${response.status}).`, 502, response.status >= 500);
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > 0) assertVideoSize(declaredSize, MAX_REFERENCE_VIDEO_BYTES);
  const receivedContentType = (response.headers.get("content-type") ?? options.resolved.contentType).split(";", 1)[0].toLowerCase();
  if (!receivedContentType.startsWith("video/") && receivedContentType !== "application/octet-stream") {
    await response.body.cancel();
    throw new IngestionError("URL_IS_NOT_VIDEO", "O worker entregou um conteúdo que não é vídeo.", 422);
  }

  let receivedBytes = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.error(
      new IngestionError("DOWNLOAD_STALLED", "O download parou de transmitir dados.", 504, true),
    ), DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    start: resetIdle,
    transform(chunk, controller) {
      resetIdle(controller);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_REFERENCE_VIDEO_BYTES) {
        controller.error(new IngestionError("VIDEO_TOO_LARGE", "O vídeo excede o limite de 300 MB.", 413));
        return;
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    },
  });

  let upload: Response;
  const uploadController = new AbortController();
  const uploadTimeout = setTimeout(() => uploadController.abort(), STORAGE_UPLOAD_TIMEOUT_MS);
  const uploadBody = response.body.pipeThrough(limiter);
  try {
    upload = await fetch(
      `${options.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${REFERENCE_VIDEO_BUCKET}/${encodedPath(options.storagePath)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.serviceRoleKey}`,
          apikey: options.serviceRoleKey,
          "Content-Type": receivedContentType,
          "x-upsert": "true",
          ...(Number.isFinite(declaredSize) && declaredSize > 0 ? { "Content-Length": String(declaredSize) } : {}),
        },
        body: uploadBody,
        signal: uploadController.signal,
      },
    );
  } catch (error) {
    await uploadBody.cancel().catch(() => undefined);
    if (uploadController.signal.aborted) {
      throw new IngestionError("STORAGE_UPLOAD_TIMEOUT", "O envio da referência ao Storage excedeu o tempo limite.", 504, true);
    }
    throw error;
  } finally {
    clearTimeout(uploadTimeout);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
  }
  if (!upload.ok) {
    const message = await upload.text();
    throw new IngestionError("STORAGE_UPLOAD_FAILED", `O Storage recusou a referência (HTTP ${upload.status}): ${message.slice(0, 200)}`, 502, upload.status >= 500);
  }
  assertVideoSize(receivedBytes, MAX_REFERENCE_VIDEO_BYTES);
  if (receivedBytes !== options.resolved.sizeBytes) {
    throw new IngestionError("VIDEO_SIZE_MISMATCH", "O tamanho recebido não corresponde ao arquivo validado pelo worker.", 502, true);
  }
  return receivedBytes;
}

export function referenceExtension(contentType: string, downloadUrl: string): string {
  return extensionForMimeType(contentType, downloadUrl);
}
