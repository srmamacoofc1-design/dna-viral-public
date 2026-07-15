import {
  extensionForMimeType,
  IngestionError,
  MAX_REFERENCE_VIDEO_BYTES,
  normalizeStoragePath,
} from "./ingestion.ts";
import {
  getGeminiApiKeys,
  isRetryableGeminiStatus,
  rotateGeminiKeys,
} from "./gemini-rotation.ts";
import { sanitizePostgresJsonUnicode } from "./unicode-safety.ts";

const DEFAULT_GEMINI_VIDEO_MODEL = "gemini-3.5-flash";
const GEMINI_VIDEO_FALLBACK_MODEL = "gemini-2.5-flash";
const DEFAULT_FILE_POLL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_STORAGE_FETCH_TIMEOUT_MS = 45_000;
const DEFAULT_GEMINI_CONTROL_TIMEOUT_MS = 30_000;
const DEFAULT_GEMINI_UPLOAD_TIMEOUT_MS = 12 * 60_000;
const DEFAULT_GEMINI_GENERATE_TIMEOUT_MS = 4 * 60_000;
// Supabase Edge requests have a harder wall-clock ceiling than the provider.
// Keep the multimodal generation loop bounded so a slow primary model can
// fall back and still return a durable error/success instead of being killed
// while the reference remains stuck in processing_visual.
const DEFAULT_GEMINI_GENERATION_ATTEMPT_TIMEOUT_MS = 60_000;
const DEFAULT_GEMINI_GENERATION_TOTAL_TIMEOUT_MS = 115_000;
const DEFAULT_GEMINI_DELETE_TIMEOUT_MS = 15_000;
const DEFAULT_VIDEO_KEY_ATTEMPTS = 3;

export interface PrepareVideoMediaOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  storageBucket?: string;
  storagePath: string;
  displayName?: string;
  maxBytes?: number;
  onLog?: (message: string) => Promise<void> | void;
  signal?: AbortSignal;
}

interface PreparedVideoSource extends PrepareVideoMediaOptions {
  storageBucket: string;
  storagePath: string;
  displayName: string;
  maxBytes: number;
}

export type PreparedVideoMedia = {
  kind: "gemini_file";
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  fileUri: string;
  geminiApiKey: string;
  /** Private retry metadata; never serialize or return this object to a client. */
  source: PreparedVideoSource;
};

function env(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  };
  return runtime.Deno?.env?.get?.(name)?.trim() || undefined;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function configuredInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(env(name));
  return Number.isSafeInteger(value) && value >= minimum
    ? Math.min(value, maximum)
    : fallback;
}

async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  options: {
    timeoutMs: number;
    code: string;
    message: string;
    signal?: AbortSignal;
  },
): Promise<Response> {
  if (options.signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new IngestionError(
        options.code,
        options.message,
        504,
        true,
        { timeout_ms: options.timeoutMs },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function normalizeVideoModel(configured: string | undefined): string {
  return (configured || DEFAULT_GEMINI_VIDEO_MODEL)
    .replace(/^models\//i, "")
    .replace(/^google\//i, "")
    .replace(/^gemini\//i, "") || DEFAULT_GEMINI_VIDEO_MODEL;
}

function geminiVideoModel(): string {
  return normalizeVideoModel(env("GEMINI_VIDEO_MODEL") || env("GEMINI_MODEL"));
}

function filePollTimeoutMs(): number {
  const configured = Number(env("GEMINI_FILE_POLL_TIMEOUT_MS"));
  return Number.isSafeInteger(configured) && configured >= 30_000
    ? Math.min(configured, 30 * 60_000)
    : DEFAULT_FILE_POLL_TIMEOUT_MS;
}

function storageFetchTimeoutMs(): number {
  return configuredInteger(
    "GEMINI_STORAGE_FETCH_TIMEOUT_MS",
    DEFAULT_STORAGE_FETCH_TIMEOUT_MS,
    1_000,
    2 * 60_000,
  );
}

function controlFetchTimeoutMs(): number {
  return configuredInteger(
    "GEMINI_CONTROL_FETCH_TIMEOUT_MS",
    DEFAULT_GEMINI_CONTROL_TIMEOUT_MS,
    1_000,
    2 * 60_000,
  );
}

function uploadFetchTimeoutMs(): number {
  return configuredInteger(
    "GEMINI_UPLOAD_TIMEOUT_MS",
    DEFAULT_GEMINI_UPLOAD_TIMEOUT_MS,
    30_000,
    20 * 60_000,
  );
}

function generateFetchTimeoutMs(): number {
  return configuredInteger(
    "GEMINI_GENERATE_TIMEOUT_MS",
    DEFAULT_GEMINI_GENERATE_TIMEOUT_MS,
    10_000,
    10 * 60_000,
  );
}

function generationAttemptTimeoutMs(): number {
  return configuredInteger(
    "GEMINI_VIDEO_GENERATION_ATTEMPT_TIMEOUT_MS",
    DEFAULT_GEMINI_GENERATION_ATTEMPT_TIMEOUT_MS,
    10_000,
    90_000,
  );
}

function generationTotalTimeoutMs(): number {
  return configuredInteger(
    "GEMINI_VIDEO_GENERATION_TOTAL_TIMEOUT_MS",
    DEFAULT_GEMINI_GENERATION_TOTAL_TIMEOUT_MS,
    20_000,
    130_000,
  );
}

function videoKeyAttemptLimit(available: number): number {
  return Math.min(
    available,
    configuredInteger("GEMINI_VIDEO_MAX_KEY_ATTEMPTS", DEFAULT_VIDEO_KEY_ATTEMPTS, 1, 5),
  );
}

/**
 * Selects a stable first key for a stored video without inspecting or hashing
 * any credential. The normalized Storage path is already a non-secret routing
 * identifier, so retries and fresh Edge isolates choose the same pool offset.
 */
export function stableVideoKeyStartIndex(storagePath: string, keyCount: number): number {
  if (!Number.isSafeInteger(keyCount) || keyCount <= 0) return 0;
  const bytes = new TextEncoder().encode(normalizeStoragePath(storagePath));
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0) % keyCount;
}

function videoThinkingLevel(): string {
  const value = env("GEMINI_VIDEO_THINKING_LEVEL")?.toLowerCase();
  return value && ["minimal", "low", "medium", "high"].includes(value) ? value : "minimal";
}

function storageObjectUrl(supabaseUrl: string, storageBucket: string, storagePath: string): string {
  const path = normalizeStoragePath(storagePath);
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(storageBucket)) {
    throw new IngestionError("INVALID_STORAGE_BUCKET", "Bucket de video invalido.", 500);
  }
  return `${supabaseUrl}/storage/v1/object/${encodeURIComponent(storageBucket)}/${
    path.split("/").map(encodeURIComponent).join("/")
  }`;
}

function storageHeaders(serviceRoleKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
  };
}

function geminiHeaders(apiKey: string, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  // Header authentication keeps credentials out of URLs, network errors and
  // provider diagnostics.
  headers.set("x-goog-api-key", apiKey);
  return headers;
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeVideoMime(value: string | null, storagePath: string): string {
  const raw = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  if (raw.startsWith("video/")) return raw;
  const extension = extensionForMimeType(raw, `https://storage.invalid/${storagePath}`);
  const byExtension: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    "3gp": "video/3gpp",
  };
  return byExtension[extension] ?? "video/mp4";
}

function safeProviderMessage(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .slice(0, 500);
}

function providerError(
  code: string,
  message: string,
  providerStatus: number,
  body?: string,
): IngestionError {
  return new IngestionError(
    code,
    `${message} (HTTP ${providerStatus}).`,
    providerStatus === 408 || providerStatus === 429 || providerStatus >= 500 ? 502 : 422,
    isRetryableGeminiStatus(providerStatus),
    {
      provider_status: providerStatus,
      ...(body ? { provider_message: safeProviderMessage(body) } : {}),
    },
  );
}

function normalizedSource(options: PrepareVideoMediaOptions): PreparedVideoSource {
  const storagePath = normalizeStoragePath(options.storagePath);
  return {
    ...options,
    storageBucket: options.storageBucket ?? "videos",
    storagePath,
    displayName: options.displayName ?? storagePath.split("/").pop() ?? "video",
    maxBytes: options.maxBytes ?? MAX_REFERENCE_VIDEO_BYTES,
  };
}

async function fetchStorageObject(source: PreparedVideoSource): Promise<Response> {
  const response = await fetchWithTimeout(
    storageObjectUrl(source.supabaseUrl, source.storageBucket, source.storagePath),
    { headers: storageHeaders(source.serviceRoleKey) },
    {
      timeoutMs: storageFetchTimeoutMs(),
      code: "STORAGE_FETCH_TIMEOUT",
      message: "O Storage demorou demais para abrir o video.",
      signal: source.signal,
    },
  );
  if (!response.ok || !response.body) {
    throw new IngestionError(
      "STORAGE_OBJECT_UNAVAILABLE",
      `Nao foi possivel abrir o video no Storage (HTTP ${response.status}).`,
      response.status === 404 ? 404 : 502,
      response.status >= 500,
    );
  }
  return response;
}

async function deleteGeminiFile(fileName: string, apiKey: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
        { method: "DELETE", headers: geminiHeaders(apiKey) },
        {
          timeoutMs: DEFAULT_GEMINI_DELETE_TIMEOUT_MS,
          code: "GEMINI_DELETE_TIMEOUT",
          message: "A limpeza temporaria da Gemini excedeu o tempo limite.",
        },
      );
      if (response.ok || response.status === 404) return;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt > 0) return;
    } catch (error) {
      // Only our bounded timeout is retried. Arbitrary cleanup/network errors
      // are abandoned silently because Gemini files expire automatically.
      if (!(error instanceof IngestionError) || error.code !== "GEMINI_DELETE_TIMEOUT" || attempt > 0) return;
    }
    await wait(100);
  }
}

async function uploadToGemini(
  apiKey: string,
  response: Response,
  mimeType: string,
  sizeBytes: number,
  displayName: string,
  signal?: AbortSignal,
): Promise<{ name: string; uri: string; mimeType: string }> {
  const startResponse = await fetchWithTimeout(
    "https://generativelanguage.googleapis.com/upload/v1beta/files",
    {
      method: "POST",
      headers: geminiHeaders(apiKey, {
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(sizeBytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
      }),
      body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
    },
    {
      timeoutMs: controlFetchTimeoutMs(),
      code: "GEMINI_UPLOAD_START_TIMEOUT",
      message: "A Gemini demorou demais para iniciar o upload.",
      signal,
    },
  );
  if (!startResponse.ok) {
    const body = await startResponse.text();
    throw providerError(
      "GEMINI_UPLOAD_START_FAILED",
      "A Gemini Files API recusou o inicio do upload",
      startResponse.status,
      body,
    );
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new IngestionError(
      "GEMINI_UPLOAD_URL_MISSING",
      "A Gemini Files API nao retornou a URL resumivel.",
      502,
      true,
    );
  }

  let uploadResponse: Response;
  try {
    uploadResponse = await fetchWithTimeout(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(sizeBytes),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: response.body,
    }, {
      timeoutMs: uploadFetchTimeoutMs(),
      code: "GEMINI_UPLOAD_TIMEOUT",
      message: "A transmissao do video para a Gemini excedeu o tempo limite.",
      signal,
    });
  } catch (error) {
    try {
      await response.body?.cancel();
    } catch {
      // The upload already owns or closed the stream.
    }
    throw error;
  }
  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw providerError(
      "GEMINI_UPLOAD_FAILED",
      "Falha ao transmitir o video para analise multimodal",
      uploadResponse.status,
      body,
    );
  }

  const payload = await uploadResponse.json();
  const file = payload?.file ?? payload;
  if (!file?.name || !file?.uri) {
    if (file?.name) await deleteGeminiFile(String(file.name), apiKey);
    throw new IngestionError(
      "GEMINI_FILE_INVALID",
      "A Gemini Files API retornou um arquivo invalido.",
      502,
      true,
    );
  }

  const uploadedFileName = file.name as string;
  try {
    const deadline = Date.now() + filePollTimeoutMs();
    let current = file;
    while (current?.state === "PROCESSING" && Date.now() < deadline) {
      await wait(Math.min(2_000, Math.max(1, deadline - Date.now())), signal);
      const poll = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/${current.name}`,
        { headers: geminiHeaders(apiKey) },
        {
          timeoutMs: controlFetchTimeoutMs(),
          code: "GEMINI_FILE_POLL_TIMEOUT",
          message: "A consulta de processamento do video excedeu o tempo limite.",
          signal,
        },
      );
      if (!poll.ok) {
        const body = await poll.text();
        throw providerError(
          "GEMINI_FILE_POLL_FAILED",
          "Falha ao aguardar o processamento do video pela Gemini",
          poll.status,
          body,
        );
      }
      current = await poll.json();
    }

    if (current?.state !== "ACTIVE") {
      throw new IngestionError(
        "GEMINI_FILE_NOT_ACTIVE",
        current?.state === "FAILED"
          ? "A Gemini nao conseguiu preparar este formato de video. Converta-o para MP4 (H.264/AAC) e tente novamente."
          : "O preparo multimodal do video excedeu o tempo limite; tente novamente.",
        current?.state === "FAILED" ? 422 : 504,
        current?.state !== "FAILED",
        { state: current?.state ?? "UNKNOWN" },
      );
    }

    return {
      name: current.name,
      uri: current.uri,
      mimeType: current.mimeType ?? mimeType,
    };
  } catch (error) {
    await deleteGeminiFile(uploadedFileName, apiKey);
    throw error;
  }
}

async function prepareWithKey(
  source: PreparedVideoSource,
  apiKey: string,
): Promise<PreparedVideoMedia> {
  const response = await fetchStorageObject(source);
  const declaredSize = parsePositiveInteger(response.headers.get("content-length"));
  if (declaredSize && declaredSize > source.maxBytes) {
    await response.body?.cancel();
    throw new IngestionError(
      "VIDEO_TOO_LARGE",
      `O video excede o limite de ${Math.floor(source.maxBytes / 1024 / 1024)} MB.`,
      413,
      false,
      { size_bytes: declaredSize, max_bytes: source.maxBytes },
    );
  }
  if (!declaredSize) {
    await response.body?.cancel();
    throw new IngestionError(
      "STORAGE_SIZE_UNKNOWN",
      "O Storage nao informou o tamanho do video; nao foi possivel iniciar o upload multimodal resumivel.",
      502,
      false,
    );
  }

  const mimeType = normalizeVideoMime(response.headers.get("content-type"), source.storagePath);
  await source.onLog?.(
    `Transmitindo ${(declaredSize / 1024 / 1024).toFixed(1)} MB para analise multimodal sem base64...`,
  );
  let file: { name: string; uri: string; mimeType: string };
  try {
    file = await uploadToGemini(
      apiKey,
      response,
      mimeType,
      declaredSize,
      source.displayName,
      source.signal,
    );
  } catch (error) {
    try {
      await response.body?.cancel();
    } catch {
      // The upload may already have consumed or closed the Storage stream.
    }
    throw error;
  }
  return {
    kind: "gemini_file",
    mimeType: file.mimeType,
    sizeBytes: declaredSize,
    fileName: file.name,
    fileUri: file.uri,
    geminiApiKey: apiKey,
    source,
  };
}

export async function prepareVideoMedia(
  options: PrepareVideoMediaOptions,
): Promise<PreparedVideoMedia> {
  const source = normalizedSource(options);
  const keys = getGeminiApiKeys("GEMINI_VIDEO_PREFERRED_KEY_INDEXES");
  if (keys.length === 0) {
    throw new IngestionError(
      "VIDEO_AI_NOT_CONFIGURED",
      "Configure GEMINI_API_KEYS no Supabase para habilitar a analise visual.",
      503,
      false,
    );
  }

  return rotateGeminiKeys(
    (apiKey) => prepareWithKey(source, apiKey),
    {
      keys,
      startIndex: stableVideoKeyStartIndex(source.storagePath, keys.length),
      maxAttempts: videoKeyAttemptLimit(keys.length),
      baseDelayMs: 100,
      maxDelayMs: 750,
    },
  );
}

function parseJsonText(value: string): unknown {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // JSON.parse accepts U+0000 and isolated UTF-16 surrogates. Postgres jsonb
  // does not, so sanitize the complete provider result at the shared boundary
  // used by both library and reference-video multimodal analysis.
  return sanitizePostgresJsonUnicode(JSON.parse(cleaned));
}

async function generateOnce<T>(
  media: PreparedVideoMedia,
  options: {
    systemPrompt: string;
    userPrompt: string;
    jsonSchema: Record<string, unknown>;
    maxOutputTokens?: number;
    timeoutMs?: number;
  },
  modelOverride?: string,
): Promise<T> {
  // The selected model must drive both the endpoint and its generation
  // config. In particular, the Gemini 2.5 fallback does not understand the
  // Gemini 3 thinking-level shape used by the configured primary model.
  const model = normalizeVideoModel(modelOverride || geminiVideoModel());
  const gemini3 = /^gemini-3(?:[.\-]|$)/i.test(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${
    encodeURIComponent(model)
  }:generateContent`;
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: options.jsonSchema,
    maxOutputTokens: options.maxOutputTokens ?? 16384,
    ...(gemini3
      ? { thinkingConfig: { thinkingLevel: videoThinkingLevel() } }
      : { temperature: 0.1 }),
  };
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: geminiHeaders(media.geminiApiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.systemPrompt }] },
        contents: [{
          role: "user",
          parts: [
            { fileData: { mimeType: media.mimeType, fileUri: media.fileUri } },
            { text: options.userPrompt },
          ],
        }],
        generationConfig,
      }),
    },
    {
      timeoutMs: options.timeoutMs ?? generateFetchTimeoutMs(),
      code: "GEMINI_GENERATE_TIMEOUT",
      message: "A analise multimodal excedeu o tempo limite.",
      signal: media.source.signal,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw providerError(
      "GEMINI_ANALYSIS_FAILED",
      "A analise multimodal falhou",
      response.status,
      body,
    );
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? "")
    .join("");
  if (!text) {
    throw new IngestionError(
      "GEMINI_EMPTY_RESPONSE",
      "A analise multimodal retornou vazia.",
      502,
      true,
    );
  }

  try {
    return parseJsonText(text) as T;
  } catch (error) {
    throw new IngestionError(
      "GEMINI_INVALID_JSON",
      "A analise multimodal retornou JSON invalido.",
      502,
      true,
      { parser_message: error instanceof Error ? error.message : String(error) },
    );
  }
}

function orderedMediaKeys(media: PreparedVideoMedia): string[] {
  const keys = getGeminiApiKeys("GEMINI_VIDEO_PREFERRED_KEY_INDEXES");
  const mediaIndex = keys.indexOf(media.geminiApiKey);
  if (mediaIndex < 0) return [...new Set([media.geminiApiKey, ...keys])];
  return [...keys.slice(mediaIndex), ...keys.slice(0, mediaIndex)];
}

async function replacePreparedFile(
  target: PreparedVideoMedia,
  replacement: PreparedVideoMedia,
  deletePrevious = true,
): Promise<void> {
  const oldName = target.fileName;
  const oldKey = target.geminiApiKey;
  target.mimeType = replacement.mimeType;
  target.sizeBytes = replacement.sizeBytes;
  target.fileName = replacement.fileName;
  target.fileUri = replacement.fileUri;
  target.geminiApiKey = replacement.geminiApiKey;
  target.source = replacement.source;
  if (deletePrevious) await deleteGeminiFile(oldName, oldKey);
}

function providerStatusFromError(error: unknown): number | null {
  if (!(error instanceof IngestionError)) return null;
  const value = error.details?.provider_status;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isStructuredOutputError(error: unknown): boolean {
  return error instanceof IngestionError &&
    (error.code === "GEMINI_INVALID_JSON" || error.code === "GEMINI_EMPTY_RESPONSE");
}

function isGenerationBudgetError(error: unknown): boolean {
  return error instanceof IngestionError && error.code === "GEMINI_GENERATION_BUDGET_EXHAUSTED";
}

function isRetryableVideoError(error: unknown): boolean {
  if (error instanceof IngestionError) return error.retryable;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof TypeError;
}

function shouldTryFallbackModel(
  error: unknown,
  primaryModel: string,
  fallbackModel: string,
): boolean {
  if (primaryModel === fallbackModel) return false;
  if (isStructuredOutputError(error)) return true;
  if (!isRetryableVideoError(error)) return false;
  const status = providerStatusFromError(error);
  // Authentication/authorization and quota failures are project/key scoped;
  // changing models on the same key cannot repair them and only adds latency.
  if (status === 401 || status === 403 || status === 429) return false;
  // Includes the bounded generation timeout (no provider status), network
  // failures, HTTP 408 and provider-side 5xx responses.
  return status === null || status === 408 || status >= 500;
}

function shouldRetrySameMedia(error: unknown, localAttempt: number, hasNextKey: boolean): boolean {
  if (localAttempt > 0) return false;
  if (isStructuredOutputError(error)) return true;
  if (!isRetryableVideoError(error)) return false;
  const status = providerStatusFromError(error);
  // Credential and quota failures are key-specific. With another key ready,
  // changing projects is safer than waiting on the same quota. With one key,
  // one generation retry is still allowed and never re-uploads the file.
  return !hasNextKey || (status !== 401 && status !== 403 && status !== 429);
}

async function videoRetryWait(error: unknown, signal?: AbortSignal): Promise<void> {
  const status = providerStatusFromError(error);
  if (status === 401 || status === 403) return;
  await wait(status === 429 ? 250 : 100, signal);
}

export async function generateVideoJson<T>(options: {
  media: PreparedVideoMedia;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  toolName: string;
  maxOutputTokens?: number;
}): Promise<T> {
  const generationDeadlineAt = Date.now() + generationTotalTimeoutMs();
  const generateWithinBudget = (media: PreparedVideoMedia, model: string): Promise<T> => {
    const remainingMs = generationDeadlineAt - Date.now();
    if (remainingMs < 10_000) {
      throw new IngestionError(
        "GEMINI_GENERATION_BUDGET_EXHAUSTED",
        "A analise multimodal esgotou o tempo seguro da funcao.",
        504,
        true,
        { total_timeout_ms: generationTotalTimeoutMs() },
      );
    }
    const timeoutMs = Math.max(
      10_000,
      Math.min(generateFetchTimeoutMs(), generationAttemptTimeoutMs(), remainingMs - 1_000),
    );
    return generateOnce<T>(media, { ...options, timeoutMs }, model);
  };
  const primaryModel = geminiVideoModel();
  const fallbackModel = normalizeVideoModel(GEMINI_VIDEO_FALLBACK_MODEL);
  const availableKeys = orderedMediaKeys(options.media);
  const keys = availableKeys.slice(0, videoKeyAttemptLimit(availableKeys.length));
  let lastError: unknown;
  let originalReleased = false;

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const apiKey = keys[keyIndex];
    let attemptMedia: PreparedVideoMedia;
    if (keyIndex === 0) {
      attemptMedia = options.media;
    } else {
      try {
        attemptMedia = await prepareWithKey(options.media.source, apiKey);
      } catch (error) {
        lastError = error;
        const hasNextKey = keyIndex + 1 < keys.length;
        if (!isRetryableVideoError(error) || !hasNextKey) throw error;
        await videoRetryWait(error, options.media.source.signal);
        continue;
      }
    }

    const temporary = attemptMedia !== options.media;
    const hasNextKey = keyIndex + 1 < keys.length;
    try {
      const result = await generateWithinBudget(attemptMedia, primaryModel);
      if (temporary) {
        await replacePreparedFile(options.media, attemptMedia, !originalReleased);
      }
      return result;
    } catch (primaryError) {
      lastError = primaryError;
      if (!isGenerationBudgetError(primaryError)
        && shouldTryFallbackModel(primaryError, primaryModel, fallbackModel)) {
        // Reuse the already ACTIVE Gemini file and the exact same API key. A
        // model outage or structured-output regression must not force another
        // 300 MB upload before the stable 2.5 fallback gets one bounded try.
        await videoRetryWait(primaryError, options.media.source.signal);
        try {
          const result = await generateWithinBudget(attemptMedia, fallbackModel);
          if (temporary) {
            await replacePreparedFile(options.media, attemptMedia, !originalReleased);
          }
          return result;
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      } else if (!isGenerationBudgetError(primaryError)
        && shouldRetrySameMedia(primaryError, 0, hasNextKey)) {
        // Keep the established single same-model retry for one-key pools and
        // for deployments whose configured primary is already 2.5 Flash.
        await videoRetryWait(primaryError, options.media.source.signal);
        try {
          const result = await generateWithinBudget(attemptMedia, primaryModel);
          if (temporary) {
            await replacePreparedFile(options.media, attemptMedia, !originalReleased);
          }
          return result;
        } catch (retryError) {
          lastError = retryError;
        }
      }
    }

    // Once a key is abandoned, its uploaded file is not reused by a different
    // project. Cleanup happens even for retryable HTTP failures.
    await deleteGeminiFile(attemptMedia.fileName, attemptMedia.geminiApiKey);
    if (!temporary) originalReleased = true;
    if (isGenerationBudgetError(lastError)
      || (!isRetryableVideoError(lastError) && !isStructuredOutputError(lastError))
      || !hasNextKey) {
      throw lastError;
    }
    await videoRetryWait(lastError, options.media.source.signal);
  }

  throw lastError ?? new IngestionError(
    "GEMINI_ANALYSIS_FAILED",
    "A analise multimodal esgotou as tentativas seguras.",
    502,
    true,
  );
}

export async function releaseVideoMedia(media: PreparedVideoMedia): Promise<void> {
  await deleteGeminiFile(media.fileName, media.geminiApiKey);
}
