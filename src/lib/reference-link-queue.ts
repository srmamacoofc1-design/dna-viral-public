import type { Database } from "@/integrations/supabase/types";

export const REFERENCE_LINK_CONCURRENCY = 2;
export const REFERENCE_LINK_MAX_ATTEMPTS = 3;
export const REFERENCE_LINK_QUEUE_STORAGE_VERSION = 1;
export const REFERENCE_LINK_QUEUE_STORAGE_PREFIX = "dna-viral:reference-link-queue:v1";
export const MAX_REFERENCE_VIDEO_BYTES = 300 * 1024 * 1024;

const VIDEO_FILE_EXTENSION = /\.(mp4|mov|webm|avi|mpeg|mpg|m4v|3gp)$/i;

export type ReferenceVideoRow = Database["public"]["Tables"]["reference_videos"]["Row"];

export type ReferenceLinkQueueStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "ready"
  | "error";

export interface ReferenceLinkQueueEntry {
  clientId: string;
  rawUrl: string;
  sourceUrl: string;
  canonicalUrl: string;
  idempotencyKey: string;
  status: ReferenceLinkQueueStatus;
  referenceVideoId?: string;
  referenceVideo?: ReferenceVideoRow;
  error?: string;
}

export interface ReadyReferenceGenerationCandidate {
  clientId: string;
  referenceVideoId: string;
  sourceUrl: string;
  canonicalUrl: string;
}

interface PersistedReferenceLinkQueueEntry {
  clientId: string;
  rawUrl: string;
  sourceUrl: string;
  canonicalUrl: string;
  idempotencyKey: string;
  status: ReferenceLinkQueueStatus;
  referenceVideoId?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReferenceLinkQueueStatus(value: unknown): value is ReferenceLinkQueueStatus {
  return value === "queued"
    || value === "downloading"
    || value === "processing"
    || value === "ready"
    || value === "error";
}

export function referenceVideoValidationError(
  file: Pick<File, "name" | "size" | "type">,
): string | null {
  if (!file.type.startsWith("video/") && !VIDEO_FILE_EXTENSION.test(file.name)) {
    return "Selecione um arquivo de vídeo válido (MP4, MOV, WebM, AVI, MPEG ou 3GP).";
  }
  if (file.size <= 0) return "O arquivo de vídeo está vazio.";
  if (file.size > MAX_REFERENCE_VIDEO_BYTES) return "Vídeo muito grande (máximo 300 MB).";
  return null;
}

function nonEmptyString(value: unknown, maxLength = 4096): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

export function referenceLinkQueueStorageKey(userId: string): string {
  const normalizedUserId = nonEmptyString(userId, 128);
  if (!normalizedUserId) throw new Error("userId inválido para a fila de referências.");
  return `${REFERENCE_LINK_QUEUE_STORAGE_PREFIX}:${normalizedUserId}`;
}

/**
 * Persists only the minimum resumable job data. In particular, the Supabase
 * session/access token and the full database row are deliberately excluded.
 */
export function serializeReferenceLinkQueue(entries: ReferenceLinkQueueEntry[]): string {
  const persisted: PersistedReferenceLinkQueueEntry[] = entries.map((entry) => ({
    clientId: entry.clientId,
    rawUrl: entry.rawUrl,
    sourceUrl: entry.sourceUrl,
    canonicalUrl: entry.canonicalUrl,
    idempotencyKey: entry.idempotencyKey,
    status: entry.status,
    ...(entry.referenceVideoId ? { referenceVideoId: entry.referenceVideoId } : {}),
    ...(entry.error ? { error: entry.error.slice(0, 1000) } : {}),
  }));
  return JSON.stringify({ version: REFERENCE_LINK_QUEUE_STORAGE_VERSION, entries: persisted });
}

export function restoreReferenceLinkQueue(raw: string | null | undefined): ReferenceLinkQueueEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.version !== REFERENCE_LINK_QUEUE_STORAGE_VERSION) {
    return [];
  }

  const candidates: unknown[] = Array.isArray(parsed.entries) ? parsed.entries : [];
  const restored: ReferenceLinkQueueEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const clientId = nonEmptyString(candidate.clientId, 128);
    const rawUrl = nonEmptyString(candidate.rawUrl);
    const sourceUrl = nonEmptyString(candidate.sourceUrl);
    const canonicalUrl = nonEmptyString(candidate.canonicalUrl);
    const idempotencyKey = nonEmptyString(candidate.idempotencyKey, 8192);
    if (!clientId || !rawUrl || !sourceUrl || !canonicalUrl || !idempotencyKey || seen.has(idempotencyKey)) continue;

    const persistedStatus: ReferenceLinkQueueStatus = isReferenceLinkQueueStatus(candidate.status)
      ? candidate.status
      : "queued";
    const referenceVideoId = nonEmptyString(candidate.referenceVideoId, 128) ?? undefined;
    // A download was interrupted in the browser and has no durable server job.
    // A processing job is durable only after its reference_videos ID is known.
    const status: ReferenceLinkQueueStatus = persistedStatus === "downloading"
      || (persistedStatus === "processing" && !referenceVideoId)
      || (persistedStatus === "ready" && !referenceVideoId)
      ? "queued"
      : persistedStatus;

    seen.add(idempotencyKey);
    const error = nonEmptyString(candidate.error, 1000) ?? undefined;
    restored.push({
      clientId,
      rawUrl,
      sourceUrl,
      canonicalUrl,
      idempotencyKey,
      status,
      ...(referenceVideoId ? { referenceVideoId } : {}),
      ...(error ? { error } : {}),
    });
  }
  return restored;
}

export function referenceQueueEntriesToResume(entries: ReferenceLinkQueueEntry[]): ReferenceLinkQueueEntry[] {
  return entries.filter((entry) => entry.status !== "ready");
}

/**
 * Returns every analyzed reference that can safely enter the generation
 * pipeline. IDs are de-duplicated so a restored/duplicated browser queue can
 * never generate the same reference twice in one batch.
 */
export function referenceQueueReadyForGeneration(
  entries: ReferenceLinkQueueEntry[],
): ReadyReferenceGenerationCandidate[] {
  const seen = new Set<string>();
  const ready: ReadyReferenceGenerationCandidate[] = [];
  for (const entry of entries) {
    const referenceVideoId = entry.referenceVideoId?.trim();
    if (entry.status !== "ready" || !referenceVideoId || seen.has(referenceVideoId)) continue;
    seen.add(referenceVideoId);
    ready.push({
      clientId: entry.clientId,
      referenceVideoId,
      sourceUrl: entry.sourceUrl,
      canonicalUrl: entry.canonicalUrl,
    });
  }
  return ready;
}

export interface RetryableReferenceError extends Error {
  retryable?: boolean;
  status?: number;
}

export function isRetryableReferenceError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as RetryableReferenceError;
  return candidate.retryable === true
    || candidate.status === 429
    || (typeof candidate.status === "number" && candidate.status >= 500);
}

export async function withReferenceRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    maxAttempts?: number;
    delaysMs?: number[];
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(REFERENCE_LINK_MAX_ATTEMPTS, options.maxAttempts ?? REFERENCE_LINK_MAX_ATTEMPTS));
  const delays = options.delaysMs ?? [600, 1_800];
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableReferenceError(error)) throw error;
      await wait(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0);
    }
  }
  throw lastError;
}

function safeFilePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function storageExtension(storagePath: string): string {
  const extension = storagePath.split("?")[0].split(".").pop()?.toLowerCase();
  return extension && /^(mp4|mov|webm|avi|mpeg|mpg|m4v|3gp)$/.test(extension)
    ? extension
    : "mp4";
}

export function referenceLinkFileName(canonicalUrl: string, extension = "mp4"): string {
  try {
    const parsed = new URL(canonicalUrl);
    const youtubeId = parsed.hostname.includes("youtube.com")
      ? parsed.searchParams.get("v")
      : null;
    const encodedPathName = parsed.pathname.split("/").filter(Boolean).pop()?.replace(/\.[^.]+$/, "");
    let pathName = encodedPathName;
    try {
      pathName = encodedPathName ? decodeURIComponent(encodedPathName) : encodedPathName;
    } catch {
      // Keep the encoded path if a provider sent malformed percent escapes.
    }
    const sourceName = youtubeId || pathName || parsed.hostname;
    const safeName = safeFilePart(sourceName) || "video-referencia";
    return `${safeName}.${storageExtension(`video.${extension}`)}`;
  } catch {
    return `video-referencia.${storageExtension(`video.${extension}`)}`;
  }
}

export function referenceStoragePath(
  userId: string,
  canonicalUrl: string,
  downloadedStoragePath: string,
  uniqueId: string,
): string {
  const extension = storageExtension(downloadedStoragePath);
  const fileName = referenceLinkFileName(canonicalUrl, extension).replace(`.${extension}`, "");
  return `reference/${userId}/${safeFilePart(fileName) || "video-referencia"}-${safeFilePart(uniqueId)}.${extension}`;
}

export function updateReferenceQueueEntry(
  entries: ReferenceLinkQueueEntry[],
  clientId: string,
  patch: Partial<ReferenceLinkQueueEntry>,
): ReferenceLinkQueueEntry[] {
  return entries.map((entry) => entry.clientId === clientId ? { ...entry, ...patch } : entry);
}

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker(),
    ),
  );
}
