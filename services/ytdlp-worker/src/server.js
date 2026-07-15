import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { ALLOWED_FORMATS, DEFAULT_FORMAT } from "./config.js";
import { DownloadError, downloadYouTubeVideo } from "./downloader.js";
import { parseYouTubeVideoUrl, YouTubeUrlError } from "./youtube.js";

class HttpError extends Error {
  constructor(code, message, status, retryable = false) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(response, status, payload, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) return;
  const body = JSON.stringify(payload);
  setSecurityHeaders(response);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function tokenMatches(received, expected) {
  const left = createHash("sha256").update(received || "").digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function assertAuthorized(request, expectedToken) {
  const header = request.headers.authorization || "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match || !tokenMatches(match[1], expectedToken)) {
    throw new HttpError("UNAUTHORIZED", "Token de serviço ausente ou inválido.", 401);
  }
}

async function readJson(request, maxBytes) {
  const contentType = request.headers["content-type"] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError("UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json.", 415);
  }
  let total = 0;
  const chunks = [];
  let tooLarge = false;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new HttpError("REQUEST_TOO_LARGE", "O corpo da requisição é muito grande.", 413);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed;
  } catch {
    throw new HttpError("INVALID_JSON", "O corpo JSON é inválido.", 400);
  }
}

function signFileUrl(serviceToken, fileId, expiresAt) {
  return createHmac("sha256", serviceToken)
    .update(`${fileId}.${expiresAt}`)
    .digest("base64url");
}

function validSignature(serviceToken, fileId, expiresAt, signature) {
  const expected = signFileUrl(serviceToken, fileId, expiresAt);
  return tokenMatches(signature, expected);
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

export function createYtdlpWorker({
  config,
  downloader = downloadYouTubeVideo,
  now = Date.now,
  randomId = randomUUID,
  logger = console,
} = {}) {
  if (!config) throw new Error("config é obrigatório");
  const files = new Map();
  let activeJobs = 0;

  async function removeFile(fileId) {
    const entry = files.get(fileId);
    if (!entry) return;
    files.delete(fileId);
    await rm(entry.jobDir, { recursive: true, force: true }).catch((error) => {
      logger.error?.("Falha ao remover arquivo temporário do yt-dlp", error);
    });
  }

  async function cleanupExpired() {
    const currentTime = now();
    await Promise.all(
      [...files.entries()]
        .filter(([, entry]) => entry.expiresAt <= currentTime)
        .map(([fileId]) => removeFile(fileId)),
    );
  }

  async function resolveVideo(request, response) {
    assertAuthorized(request, config.serviceToken);
    const body = await readJson(request, config.requestBodyMaxBytes);
    if (typeof body.url !== "string") {
      throw new HttpError("URL_REQUIRED", "Informe a URL do vídeo.", 400);
    }
    const source = parseYouTubeVideoUrl(body.url);
    const format = body.format === undefined ? DEFAULT_FORMAT : body.format;
    if (typeof format !== "string" || !ALLOWED_FORMATS.has(format)) {
      throw new HttpError("UNSUPPORTED_FORMAT", "O formato solicitado não está na lista permitida.", 422);
    }
    // Check and increment without an await in between so concurrent requests
    // cannot both pass the same slot.
    if (activeJobs >= config.maxConcurrentJobs) {
      throw new HttpError("WORKER_BUSY", "O worker atingiu o limite de downloads simultâneos.", 429, true);
    }

    const abortController = new AbortController();
    request.once("aborted", () => abortController.abort());
    activeJobs += 1;
    let downloaded;
    try {
      downloaded = await downloader({
        canonicalUrl: source.canonicalUrl,
        videoId: source.videoId,
        format,
        ytDlpBinary: config.ytDlpBinary,
        tmpRoot: config.tmpRoot,
        maxBytes: config.maxBytes,
        timeoutMs: config.downloadTimeoutMs,
        signal: abortController.signal,
      });
    } finally {
      activeJobs -= 1;
    }

    const fileId = randomId();
    const expiresAt = now() + config.signedUrlTtlMs;
    files.set(fileId, { ...downloaded, expiresAt });
    const signature = signFileUrl(config.serviceToken, fileId, expiresAt);
    const downloadUrl = new URL(`/v1/files/${encodeURIComponent(fileId)}`, config.publicBaseUrl);
    downloadUrl.searchParams.set("expires", String(expiresAt));
    downloadUrl.searchParams.set("signature", signature);

    sendJson(response, 200, {
      download_url: downloadUrl.toString(),
      content_type: downloaded.contentType,
      size_bytes: downloaded.sizeBytes,
      expires_at: new Date(expiresAt).toISOString(),
    });
  }

  async function serveFile(request, response, url, fileId) {
    const expiresRaw = url.searchParams.get("expires") || "";
    const signature = url.searchParams.get("signature") || "";
    const expiresAt = Number(expiresRaw);
    if (!Number.isSafeInteger(expiresAt) || !validSignature(config.serviceToken, fileId, expiresAt, signature)) {
      throw new HttpError("INVALID_DOWNLOAD_SIGNATURE", "A URL de download é inválida.", 403);
    }
    if (expiresAt <= now()) {
      await removeFile(fileId);
      throw new HttpError("DOWNLOAD_URL_EXPIRED", "A URL de download expirou.", 410);
    }
    const entry = files.get(fileId);
    if (!entry || entry.expiresAt !== expiresAt) {
      throw new HttpError("DOWNLOAD_NOT_FOUND", "O arquivo temporário não está mais disponível.", 404);
    }

    let fileStat;
    try {
      fileStat = await stat(entry.path);
    } catch {
      await removeFile(fileId);
      throw new HttpError("DOWNLOAD_NOT_FOUND", "O arquivo temporário não está mais disponível.", 404);
    }
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > config.maxBytes) {
      await removeFile(fileId);
      throw new HttpError("INVALID_DOWNLOAD", "O arquivo temporário é inválido.", 500);
    }

    const range = parseRange(request.headers.range, fileStat.size);
    if (range?.invalid) {
      setSecurityHeaders(response);
      response.writeHead(416, {
        "Content-Range": `bytes */${fileStat.size}`,
        "Cache-Control": "private, no-store",
      });
      return response.end();
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? fileStat.size - 1;
    const length = end - start + 1;
    setSecurityHeaders(response);
    response.writeHead(range ? 206 : 200, {
      "Content-Type": entry.contentType || "application/octet-stream",
      "Content-Length": length,
      "Content-Disposition": `attachment; filename="youtube-${fileId}.${entry.extension || "mp4"}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${fileStat.size}` } : {}),
    });
    if (request.method === "HEAD") return response.end();
    const stream = createReadStream(entry.path, { start, end });
    stream.once("error", (error) => {
      logger.error?.("Falha ao transmitir arquivo temporário", error);
      response.destroy(error);
    });
    stream.pipe(response);
  }

  async function handler(request, response) {
    try {
      const url = new URL(request.url || "/", "http://worker.invalid");
      if (request.method === "GET" && url.pathname === "/healthz") {
        return sendJson(response, 200, {
          status: "ok",
          active_jobs: activeJobs,
          max_concurrent_jobs: config.maxConcurrentJobs,
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/resolve") {
        return await resolveVideo(request, response);
      }
      const fileMatch = /^\/v1\/files\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (["GET", "HEAD"].includes(request.method || "") && fileMatch) {
        return await serveFile(request, response, url, fileMatch[1]);
      }
      throw new HttpError("NOT_FOUND", "Endpoint não encontrado.", 404);
    } catch (error) {
      if (request.aborted || response.destroyed) return;
      const known = error instanceof HttpError || error instanceof YouTubeUrlError || error instanceof DownloadError;
      const status = known ? error.status : 500;
      if (!known || status >= 500) logger.error?.("Erro no worker yt-dlp", error);
      sendJson(response, status, {
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known && status < 500 ? error.message : "Falha interna no worker de vídeo.",
          retryable: known ? Boolean(error.retryable) : true,
        },
      }, status === 401 ? { "WWW-Authenticate": "Bearer" } : status === 429 ? { "Retry-After": "10" } : {});
    }
  }

  const server = createServer(handler);
  server.requestTimeout = config.downloadTimeoutMs + 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  const cleanupTimer = setInterval(cleanupExpired, Math.min(config.signedUrlTtlMs, 60_000));
  cleanupTimer.unref();

  return {
    server,
    get activeJobs() { return activeJobs; },
    get retainedFiles() { return files.size; },
    async close() {
      clearInterval(cleanupTimer);
      await new Promise((resolveClose, rejectClose) => {
        if (!server.listening) return resolveClose();
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
      await Promise.all([...files.keys()].map(removeFile));
    },
  };
}
