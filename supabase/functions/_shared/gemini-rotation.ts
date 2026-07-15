const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_OPENAI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEFAULT_MAX_ATTEMPTS = 32;

type EnvironmentReader = { get(name: string): string | undefined };

export interface GeminiRotationContext {
  attempt: number;
  maxAttempts: number;
  keyIndex: number;
  totalKeys: number;
  /** Milliseconds left in the optional total budget when this attempt starts. */
  remainingTimeMs?: number;
}

export interface GeminiRotationOptions<T = unknown> {
  /** Overrides the environment-backed pool. Intended for same-key file lifecycles and tests. */
  keys?: readonly string[];
  /** The first index in `keys`. Defaults to a process-wide round-robin cursor. */
  startIndex?: number;
  /** Defaults to at least three attempts and at most one pass through a 32-key pool. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  /**
   * Maximum wall-clock time for the complete rotation, including operations,
   * retry classification and backoff. Omit to preserve the unbounded behavior.
   */
  totalTimeoutMs?: number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  shouldRetryResult?: (result: T) => boolean | Promise<boolean>;
}

export interface GeminiOpenAIChatOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  attemptTimeoutMs?: number;
  /** Total wall-clock budget shared by every key attempt and retry delay. */
  totalTimeoutMs?: number;
}

export class GeminiConfigurationError extends Error {
  readonly code = "GEMINI_API_KEYS_MISSING";

  constructor() {
    super(
      "Gemini is not configured. Add GEMINI_API_KEYS (recommended), GEMINI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.",
    );
    this.name = "GeminiConfigurationError";
  }
}

let rotationCursor = 0;
const preferredPoolCursors = new Map<string, number>();

function preferredPoolFingerprint(keys: readonly string[], preferredCount: number): string {
  let hash = 2166136261;
  for (const key of keys.slice(0, preferredCount)) {
    for (let index = 0; index < key.length; index++) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31;
    hash = Math.imul(hash, 16777619);
  }
  return `${keys.length}:${preferredCount}:${(hash >>> 0).toString(16)}`;
}

/**
 * Distribute simultaneous text requests deterministically across the healthy
 * prefix. Pure random selection caused seven parallel slot requests to collide
 * on the same free-tier key even when several healthy keys were configured.
 */
function nextPreferredStartIndex(keys: readonly string[], preferredCount: number): number | undefined {
  if (preferredCount <= 0) return undefined;
  const fingerprint = preferredPoolFingerprint(keys, preferredCount);
  const cursor = preferredPoolCursors.get(fingerprint) ?? 0;
  preferredPoolCursors.set(fingerprint, (cursor + 1) % preferredCount);
  return cursor % preferredCount;
}

/**
 * Rotates the healthy prefix as a unit for one request. Retrying from a raw
 * numeric start index could leave that prefix before wrapping, which meant a
 * request starting on the last healthy key tried an unverified key next.
 */
function preferredCallOrder(
  keys: readonly string[],
  preferredCount: number,
): { keys: readonly string[]; startIndex?: number } {
  const boundedCount = Math.max(0, Math.min(keys.length, Math.trunc(preferredCount)));
  const start = nextPreferredStartIndex(keys, boundedCount);
  if (start === undefined) return { keys };
  return {
    keys: [
      ...keys.slice(start, boundedCount),
      ...keys.slice(0, start),
      ...keys.slice(boundedCount),
    ],
    startIndex: 0,
  };
}

function environment(): EnvironmentReader {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (name: string) => string | undefined } };
  }).Deno;
  if (typeof deno?.env?.get === "function") {
    return { get: (name) => deno.env!.get!(name) };
  }

  const processLike = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return { get: (name) => processLike?.env?.[name] };
}

function parsePool(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) return [];

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // A malformed JSON-looking value is treated as a delimited list. This
      // keeps configuration recoverable without echoing the secret value.
    }
  }

  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function uniqueKeys(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function preferredKeyIndexes(keyCount: number, raw: string | undefined): number[] {
  if (!raw?.trim() || keyCount <= 0) return [];
  const preferred: number[] = [];
  const seen = new Set<number>();
  for (const token of raw.split(",")) {
    const value = token.trim();
    if (!/^\d+$/.test(value)) continue;
    const index = Number(value);
    if (!Number.isSafeInteger(index) || index < 0 || index >= keyCount || seen.has(index)) continue;
    seen.add(index);
    preferred.push(index);
  }
  return preferred;
}

function preferKeyIndexes(keys: readonly string[], raw: string | undefined): string[] {
  const preferred = preferredKeyIndexes(keys.length, raw);
  if (preferred.length === 0) return [...keys];
  const preferredSet = new Set(preferred);
  return [
    ...preferred.map((index) => keys[index]),
    ...keys.filter((_key, index) => !preferredSet.has(index)),
  ];
}

/**
 * Reads and de-duplicates the Gemini key pool without logging it. When an env
 * name is supplied, its zero-based CSV indexes are moved to the front while
 * every other key keeps its original relative order. Calls without an env name
 * intentionally preserve the canonical order used by the health probe.
 */
export function getGeminiApiKeys(preferredIndexesEnvName?: string): string[] {
  const env = environment();
  const keys = uniqueKeys([
    ...parsePool(env.get("GEMINI_API_KEYS")),
    env.get("GEMINI_API_KEY"),
    env.get("GOOGLE_GENERATIVE_AI_API_KEY"),
  ]);
  const preferenceName = preferredIndexesEnvName?.trim();
  return preferenceName ? preferKeyIndexes(keys, env.get(preferenceName)) : keys;
}

export function hasGeminiApiKeys(): boolean {
  return getGeminiApiKeys().length > 0;
}

export function normalizeGeminiModel(value: unknown): string {
  const env = environment();
  // The environment override intentionally wins over hardcoded call-site
  // models so upgrades do not require redeploying every Edge Function.
  const configured = env.get("GEMINI_TEXT_MODEL")?.trim() ||
    (typeof value === "string" && value.trim()
      ? value.trim()
      : env.get("GEMINI_MODEL")?.trim() ||
        env.get("GOOGLE_GENERATIVE_AI_MODEL")?.trim() ||
        DEFAULT_GEMINI_MODEL);

  return configured
    .replace(/^models\//i, "")
    .replace(/^google\//i, "")
    .replace(/^gemini\//i, "") || DEFAULT_GEMINI_MODEL;
}

export function isRetryableGeminiStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function statusFromError(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const providerValue = (error as { details?: { provider_status?: unknown } }).details?.provider_status;
  if (typeof providerValue === "number" && Number.isFinite(providerValue)) return providerValue;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isRetryableGeminiError(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error) {
    return (error as { retryable?: unknown }).retryable === true;
  }
  const status = statusFromError(error);
  if (status !== null) return isRetryableGeminiStatus(status);
  // Fetch rejects for network failures instead of returning a Response. Abort
  // is caller-controlled and must not be retried.
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof TypeError;
}

function redactSecrets(message: string, keys: readonly string[]): string {
  let safe = message;
  for (const key of keys) {
    if (key) safe = safe.split(key).join("[REDACTED]");
  }
  // Also redact accidentally surfaced Google-style credentials that were not
  // in the active pool (for example, a provider response mentioning a key).
  return safe.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]");
}

function sanitizeError(error: unknown, keys: readonly string[]): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const safe = Object.create(Object.getPrototypeOf(source)) as Error;
  Object.defineProperties(safe, {
    name: { configurable: true, writable: true, value: source.name || "Error" },
    message: {
      configurable: true,
      writable: true,
      value: redactSecrets(source.message || "Gemini provider request failed.", keys),
    },
    stack: {
      configurable: true,
      writable: true,
      value: source.stack ? redactSecrets(source.stack, keys) : undefined,
    },
  });

  for (const property of Object.getOwnPropertyNames(source)) {
    if (property === "name" || property === "message" || property === "stack") continue;
    const value = (source as unknown as Record<string, unknown>)[property];
    let sanitized = value;
    if (typeof value === "string") sanitized = redactSecrets(value, keys);
    else if (value !== undefined) {
      try {
        sanitized = JSON.parse(redactSecrets(JSON.stringify(value), keys));
      } catch {
        sanitized = undefined;
      }
    }
    Object.defineProperty(safe, property, { configurable: true, writable: true, value: sanitized });
  }
  return safe;
}

function defaultShouldRetryResult(result: unknown): boolean {
  return result instanceof Response && !result.ok && isRetryableGeminiStatus(result.status);
}

function invalidCredentialBody(value: string): boolean {
  return /API_KEY_INVALID|please\s+pass\s+a\s+valid\s+api\s+key|api\s*key\s+(?:is\s+)?not\s+valid|invalid\s+api\s*key|invalid[^\n]{0,40}(?:api\s*)?credential/i
    .test(value);
}

async function shouldRetryChatResponse(response: Response): Promise<boolean> {
  if (isRetryableGeminiStatus(response.status)) return true;
  if (response.status !== 400) return false;
  try {
    return invalidCredentialBody(await response.clone().text());
  } catch {
    return false;
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

class GeminiTotalTimeoutError extends Error {
  readonly code = "GEMINI_TOTAL_TIMEOUT";
  readonly status = 408;
  readonly retryable = true;

  constructor(timeoutMs: number) {
    super(`Gemini key rotation exceeded its total timeout of ${timeoutMs} ms.`);
    this.name = "GeminiTotalTimeoutError";
  }
}

interface GeminiRotationDeadline {
  timeoutMs: number;
  expiresAt: number;
}

function rotationDeadline(totalTimeoutMs: number | undefined): GeminiRotationDeadline | null {
  if (totalTimeoutMs === undefined || !Number.isFinite(totalTimeoutMs)) return null;
  const timeoutMs = Math.max(0, Math.floor(totalTimeoutMs));
  return { timeoutMs, expiresAt: Date.now() + timeoutMs };
}

function deadlineRemainingMs(deadline: GeminiRotationDeadline): number {
  return Math.max(0, deadline.expiresAt - Date.now());
}

function totalTimeoutError(deadline: GeminiRotationDeadline, keys: readonly string[]): Error {
  return sanitizeError(new GeminiTotalTimeoutError(deadline.timeoutMs), keys);
}

async function withinRotationDeadline<T>(
  operation: () => Promise<T>,
  deadline: GeminiRotationDeadline | null,
  keys: readonly string[],
): Promise<T> {
  if (!deadline) return operation();
  const remainingMs = deadlineRemainingMs(deadline);
  if (remainingMs <= 0) throw totalTimeoutError(deadline, keys);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(totalTimeoutError(deadline, keys)), remainingMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs an operation against a rotating key pool. Retryable HTTP Responses,
 * network failures, 401/403, 408/429 and 5xx move to the next key. Ordinary
 * 4xx errors return immediately so schema/prompt bugs are never amplified.
 */
export async function rotateGeminiKeys<T>(
  operation: (apiKey: string, context: GeminiRotationContext) => Promise<T>,
  options: GeminiRotationOptions<T> = {},
): Promise<T> {
  const keys = uniqueKeys(options.keys ?? getGeminiApiKeys());
  if (keys.length === 0) throw new GeminiConfigurationError();

  const explicitStart = options.startIndex;
  const startIndex = Number.isInteger(explicitStart)
    ? Math.abs(explicitStart as number) % keys.length
    : rotationCursor++ % keys.length;
  const requestedAttempts = options.maxAttempts ?? Math.max(keys.length, 3);
  const finiteAttempts = Number.isFinite(requestedAttempts) ? Math.floor(requestedAttempts) : 1;
  const maxAttempts = Math.max(1, Math.min(finiteAttempts, DEFAULT_MAX_ATTEMPTS));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 750);
  const jitterRatio = Math.max(0, Math.min(1, options.jitterRatio ?? 0.2));
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number) => defaultSleep(ms, options.signal));
  const shouldRetryResult = options.shouldRetryResult ?? defaultShouldRetryResult;
  const deadline = rotationDeadline(options.totalTimeoutMs);
  let lastResult: T | undefined;
  let lastError: unknown;
  let lastRetryStatus: number | null = null;

  for (let index = 0; index < maxAttempts; index++) {
    if (options.signal?.aborted) throw abortError();
    if (deadline && deadlineRemainingMs(deadline) <= 0) {
      throw totalTimeoutError(deadline, keys);
    }
    const keyIndex = (startIndex + index) % keys.length;
    const context: GeminiRotationContext = {
      attempt: index + 1,
      maxAttempts,
      keyIndex,
      totalKeys: keys.length,
      ...(deadline ? { remainingTimeMs: deadlineRemainingMs(deadline) } : {}),
    };

    try {
      const result = await withinRotationDeadline(
        () => {
          if (deadline) context.remainingTimeMs = deadlineRemainingMs(deadline);
          return operation(keys[keyIndex], context);
        },
        deadline,
        keys,
      );
      lastResult = result;
      const shouldRetry = await withinRotationDeadline(
        () => Promise.resolve(shouldRetryResult(result)),
        deadline,
        keys,
      );
      if (!shouldRetry || context.attempt >= maxAttempts) return result;
      lastRetryStatus = result instanceof Response ? result.status : null;
      lastError = undefined;
    } catch (error) {
      lastError = error;
      if (error instanceof GeminiTotalTimeoutError ||
        (deadline && deadlineRemainingMs(deadline) <= 0)) {
        throw totalTimeoutError(deadline!, keys);
      }
      if (!isRetryableGeminiError(error) || context.attempt >= maxAttempts) {
        throw sanitizeError(error, keys);
      }
      lastRetryStatus = statusFromError(error);
    }

    // Invalid/forbidden keys cannot recover by waiting, so advance immediately.
    // Quota and provider failures receive bounded exponential backoff.
    const exponential = lastRetryStatus === 401 || lastRetryStatus === 403
      ? 0
      : Math.min(maxDelayMs, baseDelayMs * (2 ** index));
    const jitter = exponential * jitterRatio * ((random() * 2) - 1);
    const retryDelayMs = Math.max(0, Math.round(exponential + jitter));
    const boundedDelayMs = deadline
      ? Math.min(retryDelayMs, deadlineRemainingMs(deadline))
      : retryDelayMs;
    await withinRotationDeadline(() => sleep(boundedDelayMs), deadline, keys);
  }

  if (lastResult !== undefined) return lastResult;
  throw sanitizeError(lastError ?? new TypeError("Gemini provider request failed."), keys);
}

class GeminiAttemptTimeoutError extends Error {
  readonly code = "GEMINI_REQUEST_TIMEOUT";
  readonly status = 408;
  readonly retryable = true;

  constructor(timeoutMs: number) {
    super(`Gemini request timed out after ${timeoutMs} ms.`);
    this.name = "GeminiAttemptTimeoutError";
  }
}

function chatAttemptTimeoutMs(explicit?: number): number {
  const configured = explicit ?? Number(environment().get("GEMINI_TEXT_REQUEST_TIMEOUT_MS"));
  return Number.isFinite(configured) && configured >= 100
    ? Math.min(Math.floor(configured), 5 * 60_000)
    : 60_000;
}

function textReasoningEffort(): "minimal" | "low" | "medium" | "high" {
  const configured = environment().get("GEMINI_TEXT_REASONING_EFFORT")?.trim().toLowerCase();
  return configured === "minimal" || configured === "medium" || configured === "high"
    ? configured
    : "low";
}

function nativeTextTransportEnabled(): boolean {
  return /^(1|true|yes|native)$/i.test(environment().get("GEMINI_TEXT_TRANSPORT")?.trim() ?? "");
}

async function fetchChatAttempt(
  fetchImpl: typeof fetch,
  apiKey: string,
  body: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(GEMINI_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new GeminiAttemptTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function nativeBodyFromOpenAI(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const systemParts: Array<{ text: string }> = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const rawMessage of Array.isArray(body.messages) ? body.messages : []) {
    if (!rawMessage || typeof rawMessage !== "object") continue;
    const message = rawMessage as { role?: unknown; content?: unknown };
    const text = messageText(message.content).trim();
    if (!text) continue;
    if (message.role === "system") {
      systemParts.push({ text });
    } else {
      contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text }] });
    }
  }
  if (contents.length === 0) contents.push({ role: "user", parts: [{ text: "Continue." }] });

  const declarations = (Array.isArray(body.tools) ? body.tools : [])
    .map((rawTool) => rawTool && typeof rawTool === "object" ? (rawTool as { function?: unknown }).function : null)
    .filter((tool): tool is Record<string, unknown> => !!tool && typeof tool === "object" && typeof tool.name === "string")
    .map((tool) => ({
      name: tool.name,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      ...(tool.parameters && typeof tool.parameters === "object" ? { parameters: tool.parameters } : {}),
    }));
  const requestedFunction = body.tool_choice && typeof body.tool_choice === "object"
    ? ((body.tool_choice as { function?: { name?: unknown } }).function?.name)
    : undefined;
  const maxOutputTokens = Number(body.max_tokens ?? body.max_completion_tokens);
  const reasoning = typeof body.reasoning_effort === "string" ? body.reasoning_effort : textReasoningEffort();
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? Math.min(Math.floor(maxOutputTokens), 8192)
      : 4096,
    ...(/^gemini-3(?:[.\-]|$)/i.test(model) && /^(minimal|low|medium|high)$/.test(reasoning)
      ? { thinkingConfig: { thinkingLevel: reasoning } }
      : { temperature: 0.1 }),
  };
  return {
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
    contents,
    ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
    ...(typeof requestedFunction === "string" && requestedFunction
      ? { toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [requestedFunction] } } }
      : {}),
    generationConfig,
  };
}

function nativePayloadAsOpenAIResponse(payload: any, requestedModel: string): Response {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    const error = new Error("Gemini native response was empty.");
    Object.assign(error, { status: 502, retryable: true });
    throw error;
  }
  const functionCall = parts.find((part: any) => part?.functionCall && typeof part.functionCall.name === "string")?.functionCall;
  const textContent = parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
  const message = functionCall
    ? {
        role: "assistant",
        tool_calls: [{
          id: `native-${crypto.randomUUID()}`,
          type: "function",
          function: {
            name: functionCall.name,
            arguments: JSON.stringify(functionCall.args ?? {}),
          },
        }],
      }
    : {
        role: "assistant",
        content: textContent,
      };
  if (!functionCall && !textContent.trim()) {
    const error = new Error("Gemini native response contained no text or function call.");
    Object.assign(error, { status: 502, retryable: true });
    throw error;
  }
  return new Response(JSON.stringify({
    model: String(payload?.modelVersion || requestedModel),
    choices: [{ message }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function fetchNativeOpenAIAttempt(
  fetchImpl: typeof fetch,
  apiKey: string,
  model: string,
  requestBody: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: requestBody,
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (timedOut) throw new GeminiAttemptTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function geminiNativeOpenAICompatibleChat(
  body: Record<string, unknown>,
  options: GeminiOpenAIChatOptions,
  model: string,
  keys: readonly string[],
  startIndex?: number,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestBody = JSON.stringify(nativeBodyFromOpenAI(body, model));
  const attemptTimeoutMs = chatAttemptTimeoutMs(options.attemptTimeoutMs);
  const response = await rotateGeminiKeys(
    async (apiKey, context) => {
      const nativeResponse = await fetchNativeOpenAIAttempt(
        fetchImpl,
        apiKey,
        model,
        requestBody,
        options.signal,
        Math.max(1, Math.min(attemptTimeoutMs, context.remainingTimeMs ?? attemptTimeoutMs)),
      );
      if (!nativeResponse.ok) return nativeResponse;
      try {
        return nativePayloadAsOpenAIResponse(await nativeResponse.json(), model);
      } catch (error) {
        const retryable = error instanceof Error ? error : new Error("Gemini native response parse failed.");
        if (!("retryable" in retryable)) Object.assign(retryable, { status: 502, retryable: true });
        throw retryable;
      }
    },
    {
      keys,
      startIndex,
      maxAttempts: options.maxAttempts,
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
      totalTimeoutMs: options.totalTimeoutMs,
      signal: options.signal,
      shouldRetryResult: shouldRetryChatResponse,
    },
  );
  return response.ok ? response : sanitizedErrorResponse(response, keys);
}

async function sanitizedErrorResponse(response: Response, keys: readonly string[]): Promise<Response> {
  let body = "Gemini provider request failed.";
  try {
    body = await response.text();
  } catch {
    // Keep a generic body when the provider stream itself failed.
  }
  const headers = new Headers();
  for (const name of ["content-type", "retry-after", "x-request-id", "x-goog-request-id"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(redactSecrets(body, keys).slice(0, 2_000), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Calls Gemini's OpenAI-compatible endpoint with transparent key rotation. */
export async function geminiOpenAIChat(
  body: Record<string, unknown>,
  options: GeminiOpenAIChatOptions = {},
): Promise<Response> {
  const model = normalizeGeminiModel(body.model);
  const requestBody = {
    ...body,
    model,
    ...(/^gemini-3(?:[.\-]|$)/i.test(model) && body.reasoning_effort === undefined
      ? { reasoning_effort: textReasoningEffort() }
      : {}),
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const preferredIndexesEnvName = "GEMINI_TEXT_PREFERRED_KEY_INDEXES";
  const keys = getGeminiApiKeys(preferredIndexesEnvName);
  // getGeminiApiKeys() already moves configured healthy indexes to the front.
  // Do not interpret the original pool indexes a second time after that
  // reordering: doing so could route a request back to an unhealthy key.
  const configuredPreferredIndexes = preferredKeyIndexes(
    keys.length,
    environment().get(preferredIndexesEnvName),
  );
  const preferredIndexes = configuredPreferredIndexes.length > 0
    ? Array.from({ length: configuredPreferredIndexes.length }, (_value, index) => index)
    : [];
  const callOrder = preferredCallOrder(keys, preferredIndexes.length);
  // Gemini's native generateContent transport is more reliable for structured
  // function calls on some projects. It is opt-in so the established
  // OpenAI-compatible behavior remains the default outside this deployment.
  if (nativeTextTransportEnabled()) {
    return geminiNativeOpenAICompatibleChat(
      requestBody,
      options,
      model,
      callOrder.keys,
      callOrder.startIndex,
    );
  }
  const serializedRequestBody = JSON.stringify(requestBody);
  const attemptTimeoutMs = chatAttemptTimeoutMs(options.attemptTimeoutMs);
  const response = await rotateGeminiKeys(
    (apiKey, context) => fetchChatAttempt(
      fetchImpl,
      apiKey,
      serializedRequestBody,
      options.signal,
      Math.max(1, Math.min(attemptTimeoutMs, context.remainingTimeMs ?? attemptTimeoutMs)),
    ),
    {
      keys: callOrder.keys,
      // One Edge request can issue several slot/guard calls at once. Round
      // robin across the validated prefix prevents those calls from randomly
      // piling onto one key; retries still continue through the full pool.
      startIndex: callOrder.startIndex,
      maxAttempts: options.maxAttempts,
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
      totalTimeoutMs: options.totalTimeoutMs,
      signal: options.signal,
      shouldRetryResult: shouldRetryChatResponse,
    },
  );
  return response.ok ? response : sanitizedErrorResponse(response, callOrder.keys);
}
