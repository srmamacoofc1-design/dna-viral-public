import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Plugin, ViteDevServer } from "vite";
import {
  LOCAL_VIDEO_MAX_INPUT_BYTES,
  LOCAL_VIDEO_STORAGE_TARGET_BYTES,
  normalizeLocalVideoForStorage,
} from "./local-video-normalizer";

export const LOCAL_YTDLP_MAX_VIDEO_BYTES = LOCAL_VIDEO_MAX_INPUT_BYTES;
export const LOCAL_YTDLP_STORAGE_BUCKET = "reference-videos";
export const LOCAL_YTDLP_IMPORT_LEASE_MS = 20 * 60_000;
export const LOCAL_REFERENCE_UPLOAD_MAX_CONCURRENCY = 1;

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_STDIO_BYTES = 128 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const AUTH_TIMEOUT_MS = 20 * 1000;
const PROCESS_CLOSE_TIMEOUT_MS = 8 * 1000;
const SUPPORTED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "x.com",
  "twitter.com",
  "reddit.com",
  "drive.google.com",
] as const;

const VIDEO_FORMATS = {
  ".mp4": { extension: "mp4", contentType: "video/mp4" },
  ".mov": { extension: "mov", contentType: "video/quicktime" },
  ".webm": { extension: "webm", contentType: "video/webm" },
  ".avi": { extension: "avi", contentType: "video/x-msvideo" },
  ".mpeg": { extension: "mpeg", contentType: "video/mpeg" },
  ".mpg": { extension: "mpg", contentType: "video/mpeg" },
  ".3gp": { extension: "3gp", contentType: "video/3gpp" },
} as const;

interface Options {
  supabaseUrl?: string;
  publishableKey?: string;
}

interface VideoFormat {
  extension: string;
  contentType: string;
}

export interface DownloadedVideo {
  filePath: string;
  size: number;
  format: VideoFormat;
}

type SpawnYtDlp = (
  executable: string,
  args: readonly string[],
) => ChildProcessWithoutNullStreams;

interface RunYtDlpOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  spawnProcess?: SpawnYtDlp;
  terminateProcess?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
}

interface UploadDependencies {
  fetchImpl?: typeof fetch;
  createFileStream?: typeof createReadStream;
  timeoutMs?: number;
  randomId?: () => string;
}

interface UploadOptions {
  filePath: string;
  fileSize: number;
  userId: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
  signal?: AbortSignal;
  storagePath?: string;
  upsert?: boolean;
}

export interface LocalReferenceUploadMetadata {
  contentLength: number;
  contentType: string;
  referenceVideoId: string;
  storagePath: string;
  fileName: string;
}

interface ReferenceVideoRecord extends Record<string, unknown> {
  id: string;
  file_name: string;
  storage_path: string | null;
  storage_bucket: string;
  status: string;
  user_id: string;
  updated_at?: string;
}

interface ReferenceRecordResult {
  row: ReferenceVideoRecord;
  inserted: boolean;
}

interface LinkedAbortSignal {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
}

interface LocalParsedSource {
  url: string;
  kind: "youtube_video" | "social_video";
  videoId: string | null;
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): boolean {
  if (res.destroyed || res.writableEnded) return false;
  try {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
    return true;
  } catch {
    return false;
  }
}

export class LocalReferenceUploadError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status = 422, retryable = false) {
    super(message);
    this.name = "LocalReferenceUploadError";
    this.status = status;
    this.retryable = retryable;
  }
}

function singleHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function safeHeaderFileName(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new LocalReferenceUploadError("X-File-Name possui codificação inválida.", 400);
  }
  const withoutControls = [...decoded]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join("")
    .trim();
  const baseName = path.basename(withoutControls).slice(0, 255);
  return baseName || "video-referencia.mp4";
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateLocalReferenceUploadHeaders(
  headers: IncomingMessage["headers"],
  userId: string,
): LocalReferenceUploadMetadata {
  const declaredLength = Number(singleHeader(headers["content-length"]));
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new LocalReferenceUploadError("Content-Length é obrigatório para o upload local.", 411);
  }
  if (declaredLength > LOCAL_VIDEO_MAX_INPUT_BYTES) {
    throw new LocalReferenceUploadError("O vídeo excede o limite de 300 MB.", 413);
  }

  const contentType = singleHeader(headers["content-type"]).split(";", 1)[0].trim().toLowerCase();
  if (!(contentType.startsWith("video/") || contentType === "application/octet-stream")) {
    throw new LocalReferenceUploadError("Envie um arquivo de vídeo válido.", 415);
  }
  const referenceVideoId = singleHeader(headers["x-reference-video-id"]).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(referenceVideoId)) {
    throw new LocalReferenceUploadError("X-Reference-Video-Id inválido.", 400);
  }

  const storagePath = singleHeader(headers["x-storage-path"]).trim();
  const expectedPath = new RegExp(`^reference/${regexEscape(userId)}/upload-[0-9a-f]{40}\\.mp4$`, "i");
  if (!expectedPath.test(storagePath)) {
    throw new LocalReferenceUploadError("X-Storage-Path não pertence ao usuário autenticado.", 403);
  }

  return {
    contentLength: declaredLength,
    contentType,
    referenceVideoId,
    storagePath,
    fileName: safeHeaderFileName(singleHeader(headers["x-file-name"]) || "video-referencia.mp4"),
  };
}

export async function streamLocalReferenceBodyToFile(options: {
  request: IncomingMessage;
  destinationPath: string;
  expectedBytes: number;
  signal?: AbortSignal;
}): Promise<number> {
  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.byteLength;
      if (receivedBytes > LOCAL_VIDEO_MAX_INPUT_BYTES || receivedBytes > options.expectedBytes) {
        callback(new LocalReferenceUploadError("O corpo recebido excedeu o tamanho declarado.", 413));
        return;
      }
      callback(null, buffer);
    },
  });
  await pipeline(
    options.request,
    limiter,
    createWriteStream(options.destinationPath, { flags: "wx" }),
    { signal: options.signal },
  );
  if (receivedBytes !== options.expectedBytes) {
    throw new LocalReferenceUploadError("O upload terminou antes de receber todos os bytes.", 400, true);
  }
  return receivedBytes;
}

function hostMatches(hostname: string, suffix: string) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function abortReason(signal: AbortSignal | undefined, fallback: string): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error(fallback);
}

function throwIfAborted(signal: AbortSignal | undefined, fallback = "A conexão foi encerrada antes do processamento terminar.") {
  if (signal?.aborted) throw abortReason(signal, fallback);
}

function createLinkedTimeoutSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): LinkedAbortSignal {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(abortReason(parentSignal, "A conexão foi encerrada."));

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(timeoutMessage));
  }, timeoutMs);
  timeout.unref?.();

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function extractYouTubeVideoId(parsed: URL): string | null {
  const hostname = parsed.hostname.toLowerCase();
  let candidate: string | null = null;
  if (hostMatches(hostname, "youtu.be")) {
    candidate = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (hostMatches(hostname, "youtube.com") || hostMatches(hostname, "youtube-nocookie.com")) {
    candidate = parsed.searchParams.get("v");
    if (!candidate) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0] ?? "")) candidate = parts[1] ?? null;
    }
  }
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

function isYouTubeCollection(parsed: URL): boolean {
  if (!hostMatches(parsed.hostname.toLowerCase(), "youtube.com")) return false;
  const parts = parsed.pathname.split("/").filter(Boolean);
  return parsed.pathname === "/playlist"
    || parts[0]?.startsWith("@") === true
    || ["channel", "c", "user", "feed"].includes(parts[0] ?? "");
}

function parseLocalSource(raw: unknown): LocalParsedSource {
  const value = String(raw ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Link inválido.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("A contingência local aceita somente links HTTPS de plataformas de vídeo conhecidas.");
  }
  if (!SUPPORTED_HOSTS.some((host) => hostMatches(parsed.hostname.toLowerCase(), host))) {
    throw new Error("A contingência local aceita somente links HTTPS de plataformas de vídeo conhecidas.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Links com credenciais embutidas não são aceitos.");
  }

  parsed.hash = "";
  const isYouTube = ["youtube.com", "youtu.be", "youtube-nocookie.com"]
    .some((host) => hostMatches(parsed.hostname.toLowerCase(), host));
  if (isYouTube) {
    const videoId = extractYouTubeVideoId(parsed);
    if (videoId) return { url: parsed.toString(), kind: "youtube_video", videoId };
    if (isYouTubeCollection(parsed)) {
      throw new Error("Cole o link de um vídeo ou Short específico, não um canal ou playlist.");
    }
    throw new Error("O link do YouTube não contém um vídeo identificável. Use a URL de um vídeo ou Short.");
  }
  return { url: parsed.toString(), kind: "social_video", videoId: null };
}

function localSourceIdempotencyKey(source: LocalParsedSource): string {
  if (source.kind === "youtube_video" && source.videoId) return `youtube:${source.videoId}`;
  const parsed = new URL(source.url);
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol === "https:" && parsed.port === "443") parsed.port = "";
  parsed.searchParams.sort();
  return `${source.kind}:${parsed.toString()}`;
}

export function validateLocalYtDlpSourceUrl(raw: unknown): string {
  return parseLocalSource(raw).url;
}

async function readBody(req: IncomingMessage, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    throwIfAborted(signal);
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error("Requisição muito grande.");
    chunks.push(buffer);
  }
  throwIfAborted(signal);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function requireSupabaseUser(
  req: IncomingMessage,
  options: Options,
  signal?: AbortSignal,
): Promise<{ id: string; authorization: string }> {
  const authorization = String(req.headers.authorization ?? "");
  if (!authorization.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  if (!options.supabaseUrl || !options.publishableKey) throw new Error("AUTH_NOT_CONFIGURED");

  const linked = createLinkedTimeoutSignal(signal, AUTH_TIMEOUT_MS, "A validação da sessão excedeu o tempo limite.");
  try {
    const response = await fetch(`${options.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        Authorization: authorization,
        apikey: options.publishableKey,
      },
      signal: linked.signal,
    });
    if (!response.ok) throw new Error("AUTH_INVALID");
    const user = await response.json() as { id?: unknown };
    if (typeof user?.id !== "string" || !user.id) throw new Error("AUTH_INVALID");
    return { id: user.id, authorization };
  } catch (error) {
    if (linked.didTimeout()) throw new Error("A validação da sessão excedeu o tempo limite.");
    throwIfAborted(signal);
    throw error;
  } finally {
    linked.cleanup();
  }
}

function appendBounded(current: string, chunk: unknown): string {
  const combined = current + String(chunk);
  return combined.length <= MAX_STDIO_BYTES ? combined : combined.slice(-MAX_STDIO_BYTES);
}

function childExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (childExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("close", onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
    child.once("close", onClose);
  });
}

function taskkillTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true, timeout: PROCESS_CLOSE_TIMEOUT_MS },
      () => resolve(),
    );
  });
}

/** Ends yt-dlp and descendants (including ffmpeg), then waits for `close`. */
export async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (childExited(child)) return;

  const closeAttempt = waitForChildClose(child, PROCESS_CLOSE_TIMEOUT_MS);
  if (process.platform === "win32" && child.pid) {
    await taskkillTree(child.pid);
  } else {
    child.kill("SIGTERM");
  }
  if (await closeAttempt) return;

  if (!childExited(child)) child.kill("SIGKILL");
  if (!(await waitForChildClose(child, PROCESS_CLOSE_TIMEOUT_MS))) {
    throw new Error("O processo yt-dlp não confirmou o encerramento.");
  }
}

export function runYtDlp(url: string, outputTemplate: string, options: RunYtDlpOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = process.env.YT_DLP_BINARY || "yt-dlp";
    const spawnProcess = options.spawnProcess ?? ((command, args) => spawn(command, args, {
      shell: false,
      windowsHide: true,
    }));
    const terminateProcess = options.terminateProcess ?? terminateProcessTree;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(executable, [
        "--no-playlist",
        "--max-filesize", String(LOCAL_YTDLP_MAX_VIDEO_BYTES),
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",
        "--restrict-filenames",
        "--no-progress",
        "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "-o", outputTemplate,
        url,
      ]);
    } catch (error) {
      reject(error);
      return;
    }

    let stderr = "";
    let stdout = "";
    let settled = false;
    let terminationStarted = false;
    let requestedError: Error | null = null;

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      child.stdout.removeListener("data", onStdout);
      child.stderr.removeListener("data", onStderr);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const requestTermination = async (error: Error) => {
      if (settled || terminationStarted) return;
      terminationStarted = true;
      requestedError = error;
      clearTimeout(timeout);
      try {
        await terminateProcess(child);
      } catch (terminationError) {
        if (!settled) {
          const detail = terminationError instanceof Error ? terminationError.message : String(terminationError);
          finish(new Error(`${error.message} ${detail}`));
        }
        return;
      }
      if (!settled) finish(requestedError);
    };
    const onAbort = () => {
      void requestTermination(abortReason(options.signal, "O download foi cancelado porque a conexão foi encerrada."));
    };
    const onStdout = (chunk: unknown) => {
      stdout = appendBounded(stdout, chunk);
    };
    const onStderr = (chunk: unknown) => {
      stderr = appendBounded(stderr, chunk);
    };

    const timeout = setTimeout(() => {
      void requestTermination(new Error("O yt-dlp excedeu 10 minutos."));
    }, options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", (error) => finish(requestedError ?? error));
    child.once("close", (code) => {
      if (requestedError) {
        finish(requestedError);
      } else if (code === 0) {
        finish();
      } else {
        finish(new Error((stderr || stdout || `yt-dlp terminou com código ${code}`).trim().slice(-1200)));
      }
    });

    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function formatFor(filePath: string): VideoFormat | null {
  const extension = path.extname(filePath).toLowerCase() as keyof typeof VIDEO_FORMATS;
  return VIDEO_FORMATS[extension] ?? null;
}

export async function findDownloadedVideo(jobDirectory: string): Promise<DownloadedVideo> {
  const names = await readdir(jobDirectory);
  const candidates: DownloadedVideo[] = [];
  for (const name of names) {
    if (/\.(part|ytdl|json)$/i.test(name)) continue;
    const filePath = path.join(jobDirectory, name);
    const format = formatFor(filePath);
    if (!format) continue;
    const info = await stat(filePath);
    if (info.isFile()) candidates.push({ filePath, size: info.size, format });
  }
  candidates.sort((a, b) => b.size - a.size);
  const winner = candidates[0];
  if (!winner || winner.size < 10 * 1024) throw new Error("O yt-dlp não produziu um vídeo válido.");
  if (winner.size > LOCAL_YTDLP_MAX_VIDEO_BYTES) throw new Error("O vídeo excede o limite de 300 MB.");
  return winner;
}

export function contentTypeFor(filePath: string): string {
  const format = formatFor(filePath);
  if (!format) throw new Error(`Formato de vídeo não suportado: ${path.extname(filePath) || "sem extensão"}.`);
  return format.contentType;
}

function encodedStoragePath(storagePath: string) {
  return storagePath.split("/").map(encodeURIComponent).join("/");
}

function storageObjectUrl(supabaseUrl: string, storagePath: string) {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${LOCAL_YTDLP_STORAGE_BUCKET}/${encodedStoragePath(storagePath)}`;
}

function referenceVideosRestUrl(supabaseUrl: string, query = "") {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/reference_videos${query}`;
}

function postgrestHeaders(authorization: string, publishableKey: string): Record<string, string> {
  return {
    Authorization: authorization,
    apikey: publishableKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function asReferenceVideoRecord(value: unknown): ReferenceVideoRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string"
    || typeof row.file_name !== "string"
    || (row.storage_path !== null && typeof row.storage_path !== "string")
    || typeof row.storage_bucket !== "string"
    || typeof row.status !== "string"
    || typeof row.user_id !== "string"
  ) return null;
  return row as ReferenceVideoRecord;
}

async function findReferenceVideoById(options: {
  referenceVideoId: string;
  userId: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
  signal?: AbortSignal;
}): Promise<ReferenceVideoRecord | null> {
  const linked = createLinkedTimeoutSignal(
    options.signal,
    20_000,
    "A consulta da referência reservada excedeu o tempo limite.",
  );
  const query = `?id=eq.${encodeURIComponent(options.referenceVideoId)}`
    + `&user_id=eq.${encodeURIComponent(options.userId)}`
    + "&select=*&limit=1";
  try {
    const response = await fetch(referenceVideosRestUrl(options.supabaseUrl, query), {
      headers: postgrestHeaders(options.authorization, options.publishableKey),
      signal: linked.signal,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new LocalReferenceUploadError(
        `Não foi possível consultar a referência (HTTP ${response.status}): ${message.slice(0, 300)}`,
        response.status >= 500 ? 503 : response.status,
        response.status >= 500,
      );
    }
    const payload = await response.json();
    return asReferenceVideoRecord(Array.isArray(payload) ? payload[0] : null);
  } finally {
    linked.cleanup();
  }
}

async function findReferenceVideoByIdentity(options: {
  userId: string;
  sourceKey: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
  signal?: AbortSignal;
}): Promise<ReferenceVideoRecord | null> {
  const linked = createLinkedTimeoutSignal(
    options.signal,
    20_000,
    "A consulta da referência existente excedeu o tempo limite.",
  );
  const query = `?user_id=eq.${encodeURIComponent(options.userId)}`
    + `&source_idempotency_key=eq.${encodeURIComponent(options.sourceKey)}`
    + "&select=*&limit=1";
  try {
    const response = await fetch(referenceVideosRestUrl(options.supabaseUrl, query), {
      headers: postgrestHeaders(options.authorization, options.publishableKey),
      signal: linked.signal,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Não foi possível consultar a referência existente (HTTP ${response.status}): ${message.slice(0, 300)}`);
    }
    const payload = await response.json();
    return asReferenceVideoRecord(Array.isArray(payload) ? payload[0] : null);
  } catch (error) {
    if (linked.didTimeout()) throw new Error("A consulta da referência existente excedeu o tempo limite.");
    throwIfAborted(options.signal);
    throw error;
  } finally {
    linked.cleanup();
  }
}

export function canReclaimLocalReference(row: ReferenceVideoRecord, now = Date.now()): boolean {
  if (row.storage_path) return false;
  if (row.status === "error") return true;
  const updatedAt = Date.parse(row.updated_at ?? "");
  return Number.isFinite(updatedAt) && now - updatedAt >= LOCAL_YTDLP_IMPORT_LEASE_MS;
}

async function patchReferenceVideo(options: {
  referenceVideoId: string;
  userId: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
  patch: Record<string, unknown>;
  expectedUpdatedAt?: string;
  signal?: AbortSignal;
}): Promise<ReferenceVideoRecord | null> {
  const linked = createLinkedTimeoutSignal(options.signal, 20_000, "A atualização da referência excedeu o tempo limite.");
  const filters = `?id=eq.${encodeURIComponent(options.referenceVideoId)}`
    + `&user_id=eq.${encodeURIComponent(options.userId)}`
    + (options.expectedUpdatedAt ? `&updated_at=eq.${encodeURIComponent(options.expectedUpdatedAt)}` : "")
    + "&select=*";
  try {
    const response = await fetch(referenceVideosRestUrl(options.supabaseUrl, filters), {
      method: "PATCH",
      headers: {
        ...postgrestHeaders(options.authorization, options.publishableKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify(options.patch),
      signal: linked.signal,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Não foi possível atualizar a referência (HTTP ${response.status}): ${message.slice(0, 300)}`);
    }
    const payload = await response.json();
    return asReferenceVideoRecord(Array.isArray(payload) ? payload[0] : null);
  } finally {
    linked.cleanup();
  }
}

export async function claimLocalReferenceRetry(options: {
  row: ReferenceVideoRecord;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
  signal?: AbortSignal;
}): Promise<ReferenceVideoRecord | null> {
  if (!canReclaimLocalReference(options.row)) return null;
  return patchReferenceVideo({
    referenceVideoId: options.row.id,
    userId: options.row.user_id,
    authorization: options.authorization,
    supabaseUrl: options.supabaseUrl,
    publishableKey: options.publishableKey,
    expectedUpdatedAt: options.row.updated_at,
    patch: { status: "uploading", error_message: null, storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET },
    signal: options.signal,
  });
}

async function attachDownloadedReference(options: {
  row: ReferenceVideoRecord;
  fileName: string;
  storagePath: string;
  sourceUrl: string;
  sourceKey: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
  signal?: AbortSignal;
}): Promise<ReferenceVideoRecord> {
  const attached = await patchReferenceVideo({
    referenceVideoId: options.row.id,
    userId: options.row.user_id,
    authorization: options.authorization,
    supabaseUrl: options.supabaseUrl,
    publishableKey: options.publishableKey,
    patch: {
      file_name: options.fileName,
      storage_path: options.storagePath,
      storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
      source_url: options.sourceUrl,
      source_idempotency_key: options.sourceKey,
      status: "pending",
      error_message: null,
    },
    signal: options.signal,
  });
  if (!attached) throw new Error("A reserva da referência mudou antes de anexar o arquivo.");
  return attached;
}

async function referenceVideoExistsById(options: {
  referenceVideoId: string;
  expectedStoragePath: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
}): Promise<boolean> {
  const linked = createLinkedTimeoutSignal(undefined, 20_000, "A verificação da referência excedeu o tempo limite.");
  try {
    const query = `?id=eq.${encodeURIComponent(options.referenceVideoId)}&select=id,storage_path&limit=1`;
    const response = await fetch(referenceVideosRestUrl(options.supabaseUrl, query), {
      headers: postgrestHeaders(options.authorization, options.publishableKey),
      signal: linked.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json();
    const row = Array.isArray(payload) ? payload[0] : null;
    return row?.id === options.referenceVideoId && row?.storage_path === options.expectedStoragePath;
  } catch {
    // If commit state is unknowable, preserving the object is safer than
    // deleting bytes that may already be referenced by a committed row.
    return true;
  } finally {
    linked.cleanup();
  }
}

export async function createReferenceVideoRecord(options: {
  referenceVideoId: string;
  fileName: string;
  storagePath: string;
  sourceUrl: string;
  sourceKey: string;
  userId: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
  signal?: AbortSignal;
}): Promise<ReferenceRecordResult> {
  const linked = createLinkedTimeoutSignal(
    options.signal,
    30_000,
    "A criação da referência excedeu o tempo limite.",
  );
  try {
    const response = await fetch(referenceVideosRestUrl(options.supabaseUrl, "?select=*"), {
      method: "POST",
      headers: {
        ...postgrestHeaders(options.authorization, options.publishableKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: options.referenceVideoId,
        file_name: options.fileName,
        storage_path: options.storagePath,
        storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
        status: "pending",
        user_id: options.userId,
        source_url: options.sourceUrl,
        source_idempotency_key: options.sourceKey,
      }),
      signal: linked.signal,
    });

    if (response.ok) {
      const payload = await response.json();
      const row = asReferenceVideoRecord(Array.isArray(payload) ? payload[0] : null);
      if (!row) throw new Error("O banco não retornou a referência criada.");
      return { row, inserted: true };
    }

    if (response.status === 409) {
      const existing = await findReferenceVideoByIdentity({
        userId: options.userId,
        sourceKey: options.sourceKey,
        authorization: options.authorization,
        supabaseUrl: options.supabaseUrl,
        publishableKey: options.publishableKey,
        signal: linked.signal,
      });
      if (existing) return { row: existing, inserted: false };
    }

    const message = await response.text();
    throw new Error(`Não foi possível registrar a referência (HTTP ${response.status}): ${message.slice(0, 300)}`);
  } catch (error) {
    if (linked.didTimeout()) throw new Error("A criação da referência excedeu o tempo limite.");
    throwIfAborted(options.signal, "A criação da referência foi cancelada porque a conexão foi encerrada.");
    throw error;
  } finally {
    linked.cleanup();
  }
}

export async function uploadDownloadedReference(
  options: UploadOptions,
  dependencies: UploadDependencies = {},
): Promise<string> {
  if (!Number.isSafeInteger(options.fileSize) || options.fileSize <= 0) {
    throw new Error("O arquivo baixado possui tamanho inválido.");
  }
  if (options.fileSize > LOCAL_YTDLP_MAX_VIDEO_BYTES) {
    throw new Error("O vídeo excede o limite de 300 MB.");
  }

  const format = formatFor(options.filePath);
  if (!format) throw new Error("O formato produzido pelo yt-dlp não é suportado.");
  const storagePath = options.storagePath
    ?? `reference/${options.userId}/${(dependencies.randomId ?? randomUUID)()}.${format.extension}`;
  const safePrefix = `reference/${options.userId}/`;
  if (!storagePath.startsWith(safePrefix) || storagePath.includes("..") || storagePath.includes("\\")) {
    throw new Error("O caminho de upload não pertence ao usuário autenticado.");
  }
  const linked = createLinkedTimeoutSignal(
    options.signal,
    dependencies.timeoutMs ?? UPLOAD_TIMEOUT_MS,
    "O envio do vídeo ao Storage excedeu o tempo limite.",
  );
  const fileStream = (dependencies.createFileStream ?? createReadStream)(options.filePath);
  const webStream = Readable.toWeb(fileStream);
  const destroyStream = () => fileStream.destroy();
  linked.signal.addEventListener("abort", destroyStream, { once: true });

  try {
    const requestInit: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        Authorization: options.authorization,
        apikey: options.publishableKey,
        "Content-Type": format.contentType,
        "Content-Length": String(options.fileSize),
        "x-upsert": options.upsert ? "true" : "false",
      },
      body: webStream,
      duplex: "half",
      signal: linked.signal,
    };
    const response = await (dependencies.fetchImpl ?? fetch)(
      storageObjectUrl(options.supabaseUrl, storagePath),
      requestInit,
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Não foi possível enviar o vídeo baixado ao Storage (HTTP ${response.status}): ${message.slice(0, 300)}`);
    }
    return storagePath;
  } catch (error) {
    const uploadError = linked.didTimeout()
      ? new Error("O envio do vídeo ao Storage excedeu o tempo limite.")
      : options.signal?.aborted
        ? abortReason(options.signal, "O envio foi cancelado porque a conexão foi encerrada.")
        : error;
    try {
      await deleteUploadedReference({
        storagePath,
        authorization: options.authorization,
        supabaseUrl: options.supabaseUrl,
        publishableKey: options.publishableKey,
      }, dependencies.fetchImpl ?? fetch);
    } catch {
      // Preserve the upload error; the object may never have been created and
      // this independent best-effort cleanup has already exhausted its timeout.
    }
    throw uploadError;
  } finally {
    linked.signal.removeEventListener("abort", destroyStream);
    linked.cleanup();
    if (!fileStream.destroyed) fileStream.destroy();
  }
}

async function deleteUploadedReference(options: {
  storagePath: string;
  authorization: string;
  supabaseUrl: string;
  publishableKey: string;
}, fetchImpl: typeof fetch = fetch): Promise<void> {
  const linked = createLinkedTimeoutSignal(undefined, 20_000, "A limpeza do upload excedeu o tempo limite.");
  try {
    const response = await fetchImpl(storageObjectUrl(options.supabaseUrl, options.storagePath), {
      method: "DELETE",
      headers: {
        Authorization: options.authorization,
        apikey: options.publishableKey,
      },
      signal: linked.signal,
    });
    if (!response.ok && response.status !== 404) {
      const message = await response.text();
      throw new Error(`Storage respondeu HTTP ${response.status}: ${message.slice(0, 300)}`);
    }
  } finally {
    linked.cleanup();
  }
}

export async function safeRemoveDirectory(
  directory: string,
  warn: (message: string) => void = () => undefined,
  removeDirectory: typeof rm = rm,
): Promise<void> {
  try {
    await removeDirectory(directory, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 150,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn(`Não foi possível remover o diretório temporário ${directory}: ${detail}`);
  }
}

function createRequestAbortController(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new Error("A conexão foi encerrada antes do processamento terminar."));
  };
  const onResponseClose = () => {
    if (!res.writableFinished) abort();
  };
  req.once("aborted", abort);
  req.once("error", abort);
  res.once("close", onResponseClose);
  return {
    signal: controller.signal,
    cleanup: () => {
      req.removeListener("aborted", abort);
      req.removeListener("error", abort);
      res.removeListener("close", onResponseClose);
    },
  };
}

export function localYtDlpPlugin(options: Options): Plugin {
  let activeDownloads = 0;
  let activeReferenceUploads = 0;

  return {
    name: "dna-viral-local-ytdlp",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/local-reference-upload", async (req, res) => {
        if (req.method !== "POST") {
          json(res, 405, { error: "Método não permitido.", retryable: false });
          return;
        }

        const requestAbort = createRequestAbortController(req, res);
        let counted = false;
        let actor: { id: string; authorization: string } | null = null;
        let metadata: LocalReferenceUploadMetadata | null = null;
        let referenceRow: ReferenceVideoRecord | null = null;
        let jobDirectory: string | null = null;
        let uploaded = false;
        try {
          // Authenticate before reading any part of a potentially 300 MiB body.
          actor = await requireSupabaseUser(req, options, requestAbort.signal);
          if (activeReferenceUploads >= LOCAL_REFERENCE_UPLOAD_MAX_CONCURRENCY) {
            throw new LocalReferenceUploadError(
              "Outro vídeo grande já está sendo preparado. Aguarde e tente novamente.",
              429,
              true,
            );
          }
          activeReferenceUploads += 1;
          counted = true;
          metadata = validateLocalReferenceUploadHeaders(req.headers, actor.id);
          if (!options.supabaseUrl || !options.publishableKey) {
            throw new LocalReferenceUploadError("O Supabase local não está configurado.", 503);
          }

          referenceRow = await findReferenceVideoById({
            referenceVideoId: metadata.referenceVideoId,
            userId: actor.id,
            authorization: actor.authorization,
            supabaseUrl: options.supabaseUrl,
            publishableKey: options.publishableKey,
            signal: requestAbort.signal,
          });
          if (!referenceRow) {
            throw new LocalReferenceUploadError("A reserva autenticada do vídeo não foi encontrada.", 404);
          }
          if (
            referenceRow.user_id !== actor.id
            || referenceRow.storage_bucket !== LOCAL_YTDLP_STORAGE_BUCKET
            || referenceRow.storage_path !== metadata.storagePath
          ) {
            throw new LocalReferenceUploadError("A reserva não corresponde ao caminho autenticado do upload.", 403);
          }
          if (referenceRow.status !== "uploading" && referenceRow.status !== "error") {
            throw new LocalReferenceUploadError(
              `A referência não pode receber bytes enquanto está no estado ${referenceRow.status}.`,
              409,
              referenceRow.status === "processing",
            );
          }

          jobDirectory = path.join(tmpdir(), "dna-viral-reference-upload", randomUUID());
          await mkdir(jobDirectory, { recursive: true });
          const sourcePath = path.join(jobDirectory, "source-upload");
          await streamLocalReferenceBodyToFile({
            request: req,
            destinationPath: sourcePath,
            expectedBytes: metadata.contentLength,
            signal: requestAbort.signal,
          });
          throwIfAborted(requestAbort.signal);

          const normalized = await normalizeLocalVideoForStorage(sourcePath, jobDirectory, {
            signal: requestAbort.signal,
            force: true,
            targetBytes: LOCAL_VIDEO_STORAGE_TARGET_BYTES,
          });
          if (normalized.size > LOCAL_VIDEO_STORAGE_TARGET_BYTES) {
            throw new LocalReferenceUploadError("O vídeo normalizado excedeu o teto seguro de 45 MB.", 422);
          }

          await uploadDownloadedReference({
            filePath: normalized.filePath,
            fileSize: normalized.size,
            userId: actor.id,
            authorization: actor.authorization,
            supabaseUrl: options.supabaseUrl,
            publishableKey: options.publishableKey,
            storagePath: metadata.storagePath,
            upsert: true,
            signal: requestAbort.signal,
          });
          uploaded = true;
          throwIfAborted(requestAbort.signal);

          const completedRow = await patchReferenceVideo({
            referenceVideoId: metadata.referenceVideoId,
            userId: actor.id,
            authorization: actor.authorization,
            supabaseUrl: options.supabaseUrl,
            publishableKey: options.publishableKey,
            patch: {
              file_name: metadata.fileName,
              storage_path: metadata.storagePath,
              storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
              status: "pending",
              error_message: null,
              duration_seconds: normalized.durationSeconds,
            },
            signal: requestAbort.signal,
          });
          if (!completedRow) {
            throw new LocalReferenceUploadError("A reserva mudou antes da confirmação do upload.", 409, true);
          }

          json(res, 200, {
            success: true,
            reference_video_id: completedRow.id,
            reference_video: completedRow,
            storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
            storage_path: metadata.storagePath,
            file_name: metadata.fileName,
            duration_seconds: normalized.durationSeconds,
            source_size_bytes: metadata.contentLength,
            size_bytes: normalized.size,
            content_type: normalized.contentType,
            normalized: normalized.normalized,
          });
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : "Falha ao preparar o vídeo local.";
          const safeMessage = (jobDirectory ? rawMessage.split(jobDirectory).join("<temporário>") : rawMessage)
            .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer <oculto>")
            .slice(-1200);
          if (
            referenceRow
            && actor
            && metadata
            && options.supabaseUrl
            && options.publishableKey
            && (referenceRow.status === "uploading" || referenceRow.status === "error")
          ) {
            await patchReferenceVideo({
              referenceVideoId: referenceRow.id,
              userId: actor.id,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl,
              publishableKey: options.publishableKey,
              patch: {
                status: "error",
                error_message: safeMessage,
                // A successful object upload remains attached to the already
                // reserved deterministic path and can be safely retried.
                ...(uploaded ? { storage_path: metadata.storagePath } : {}),
              },
            }).catch(() => undefined);
          }
          if (!res.headersSent && !res.destroyed && !requestAbort.signal.aborted) {
            const typed = error instanceof LocalReferenceUploadError ? error : null;
            const authFailure = safeMessage.startsWith("AUTH_");
            const executableMissing = /(?:ffmpeg|ffprobe).*ENOENT|spawn .* ENOENT/i.test(safeMessage);
            const retryable = typed?.retryable === true || /timeout|excedeu o tempo|ECONN|temporariamente/i.test(safeMessage);
            const status = typed?.status
              ?? (authFailure ? 401 : executableMissing || retryable ? 503 : 422);
            json(res, status, {
              error: executableMissing
                ? "FFmpeg/ffprobe não está disponível no servidor local. Instale-o e reinicie o app."
                : safeMessage,
              retryable: typed?.retryable ?? retryable,
            });
          }
        } finally {
          if (counted) activeReferenceUploads = Math.max(0, activeReferenceUploads - 1);
          requestAbort.cleanup();
          if (jobDirectory) {
            await safeRemoveDirectory(jobDirectory, (message) => server.config.logger.warn(message));
          }
        }
      });

      server.middlewares.use("/api/local-ytdlp", async (req, res) => {
        if (req.method !== "POST") {
          json(res, 405, { error: "Método não permitido." });
          return;
        }
        if (activeDownloads >= 2) {
          json(res, 429, { error: "Dois downloads já estão em andamento. Aguarde e tente novamente." });
          return;
        }

        const requestAbort = createRequestAbortController(req, res);
        let actor: { id: string; authorization: string } | null = null;
        let jobDirectory: string | null = null;
        let uploadedStoragePath: string | null = null;
        let referenceVideoId: string | null = null;
        let referenceRow: ReferenceVideoRecord | null = null;
        let reusedReference = false;
        let uploadedObjectAttachedToRow = false;
        let orphanCleanupStarted = false;
        const cleanupOrphanUpload = async () => {
          if (
            orphanCleanupStarted
            || uploadedObjectAttachedToRow
            || !uploadedStoragePath
            || !actor
            || !options.supabaseUrl
            || !options.publishableKey
          ) return;
          orphanCleanupStarted = true;
          try {
            if (referenceVideoId && await referenceVideoExistsById({
              referenceVideoId,
              expectedStoragePath: uploadedStoragePath,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl,
              publishableKey: options.publishableKey,
            })) {
              uploadedObjectAttachedToRow = true;
              return;
            }
            await deleteUploadedReference({
              storagePath: uploadedStoragePath,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl,
              publishableKey: options.publishableKey,
            });
            uploadedStoragePath = null;
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            server.config.logger.warn(`Falha ao remover upload órfão ${uploadedStoragePath}: ${detail}`);
          }
        };

        activeDownloads += 1;
        try {
          actor = await requireSupabaseUser(req, options, requestAbort.signal);
          const body = await readBody(req, requestAbort.signal);
          const parsedSource = parseLocalSource(body.url);
          const url = parsedSource.url;
          const sourceKey = localSourceIdempotencyKey(parsedSource);
          const existingReference = await findReferenceVideoByIdentity({
            userId: actor.id,
            sourceKey,
            authorization: actor.authorization,
            supabaseUrl: options.supabaseUrl!,
            publishableKey: options.publishableKey!,
            signal: requestAbort.signal,
          });
          if (existingReference) {
            if (existingReference.storage_path || !canReclaimLocalReference(existingReference)) {
              json(res, existingReference.storage_path ? 200 : 202, {
                success: Boolean(existingReference.storage_path),
                retryable: !existingReference.storage_path,
                reused: true,
                reference_video_id: existingReference.id,
                reference_video: existingReference,
                storage_bucket: existingReference.storage_bucket,
                storage_path: existingReference.storage_path,
                file_name: existingReference.file_name,
                status: existingReference.status,
              });
              return;
            }
            const claimed = await claimLocalReferenceRetry({
              row: existingReference,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl!,
              publishableKey: options.publishableKey!,
              signal: requestAbort.signal,
            });
            if (!claimed) {
              json(res, 202, {
                success: false,
                retryable: true,
                reused: true,
                reference_video_id: existingReference.id,
                reference_video: existingReference,
                status: "uploading",
              });
              return;
            }
            referenceRow = claimed;
            referenceVideoId = claimed.id;
            reusedReference = true;
          }
          jobDirectory = path.join(tmpdir(), "dna-viral-ytdlp", randomUUID());
          await mkdir(jobDirectory, { recursive: true });
          await runYtDlp(url, path.join(jobDirectory, "video.%(ext)s"), { signal: requestAbort.signal });
          const downloaded = await findDownloadedVideo(jobDirectory);
          const storageArtifact = downloaded.size > LOCAL_VIDEO_STORAGE_TARGET_BYTES
            ? await normalizeLocalVideoForStorage(downloaded.filePath, jobDirectory, {
              signal: requestAbort.signal,
              targetBytes: LOCAL_VIDEO_STORAGE_TARGET_BYTES,
            })
            : {
              filePath: downloaded.filePath,
              size: downloaded.size,
              durationSeconds: 0,
              hadAudio: false,
              normalized: false,
              contentType: downloaded.format.contentType,
            };
          throwIfAborted(requestAbort.signal);
          const fileName = path.basename(storageArtifact.filePath).replace(/[^A-Za-z0-9._-]/g, "_");
          uploadedStoragePath = await uploadDownloadedReference({
            filePath: storageArtifact.filePath,
            fileSize: storageArtifact.size,
            userId: actor.id,
            authorization: actor.authorization,
            supabaseUrl: options.supabaseUrl!,
            publishableKey: options.publishableKey!,
            signal: requestAbort.signal,
          });
          throwIfAborted(requestAbort.signal);
          let inserted = false;
          if (referenceRow) {
            referenceRow = await attachDownloadedReference({
              row: referenceRow,
              fileName,
              storagePath: uploadedStoragePath,
              sourceUrl: url,
              sourceKey,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl!,
              publishableKey: options.publishableKey!,
              signal: requestAbort.signal,
            });
            uploadedObjectAttachedToRow = true;
          } else {
            referenceVideoId = randomUUID();
            const referenceResult = await createReferenceVideoRecord({
              referenceVideoId,
              fileName,
              storagePath: uploadedStoragePath,
              sourceUrl: url,
              sourceKey,
              userId: actor.id,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl!,
              publishableKey: options.publishableKey!,
              signal: requestAbort.signal,
            });
            referenceRow = referenceResult.row;
            inserted = referenceResult.inserted;
          }
          if (inserted) {
            uploadedObjectAttachedToRow = true;
          } else if (!reusedReference && !uploadedObjectAttachedToRow) {
            await deleteUploadedReference({
              storagePath: uploadedStoragePath,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl!,
              publishableKey: options.publishableKey!,
            });
            uploadedStoragePath = null;
          }
          throwIfAborted(requestAbort.signal);
          json(res, referenceRow.storage_path ? 200 : 202, {
            success: Boolean(referenceRow.storage_path),
            retryable: !referenceRow.storage_path,
            reused: reusedReference || !inserted,
            reference_video_id: referenceRow.id,
            reference_video: referenceRow,
            storage_bucket: referenceRow.storage_bucket,
            storage_path: referenceRow.storage_path,
            file_name: referenceRow.file_name,
            status: referenceRow.status,
            source_size_bytes: downloaded.size,
            size_bytes: storageArtifact.size,
            content_type: storageArtifact.contentType,
            normalized: storageArtifact.normalized,
          });
        } catch (error) {
          if (
            referenceRow
            && !referenceRow.storage_path
            && actor
            && options.supabaseUrl
            && options.publishableKey
          ) {
            const detail = error instanceof Error ? error.message : "Falha no yt-dlp local.";
            await patchReferenceVideo({
              referenceVideoId: referenceRow.id,
              userId: actor.id,
              authorization: actor.authorization,
              supabaseUrl: options.supabaseUrl,
              publishableKey: options.publishableKey,
              patch: { status: "error", error_message: detail.slice(0, 1000) },
            }).catch((patchError) => server.config.logger.warn(
              `Falha ao registrar erro da importação ${referenceRow?.id}: ${patchError instanceof Error ? patchError.message : String(patchError)}`,
            ));
          }
          if (!res.headersSent && !res.destroyed && !requestAbort.signal.aborted) {
            const message = error instanceof Error ? error.message : "Falha no yt-dlp local.";
            const retryable = /timeout|excedeu|econn|tempor|busy|indispon/i.test(message);
            const status = message.startsWith("AUTH_") ? 401 : retryable ? 503 : 422;
            json(res, status, { error: message, retryable });
          }
        } finally {
          activeDownloads = Math.max(0, activeDownloads - 1);
          requestAbort.cleanup();
          if (uploadedStoragePath && !uploadedObjectAttachedToRow) await cleanupOrphanUpload();
          if (jobDirectory) {
            await safeRemoveDirectory(jobDirectory, (message) => server.config.logger.warn(message));
          }
        }
      });
    },
  };
}
