import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  geminiOpenAIChat,
  getGeminiApiKeys,
  hasGeminiApiKeys,
  normalizeGeminiModel,
  rotateGeminiKeys,
} from "../../../supabase/functions/_shared/gemini-rotation";

const originalDeno = (globalThis as { Deno?: unknown }).Deno;
let values: Record<string, string | undefined> = {};

beforeEach(() => {
  values = {};
  Object.defineProperty(globalThis, "Deno", {
    configurable: true,
    value: { env: { get: (name: string) => values[name] } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalDeno === undefined) delete (globalThis as { Deno?: unknown }).Deno;
  else Object.defineProperty(globalThis, "Deno", { configurable: true, value: originalDeno });
});

describe("Gemini key-pool configuration", () => {
  it("parses JSON and delimited pools, includes fallbacks and de-duplicates", () => {
    values.GEMINI_API_KEYS = '["key-a", "key-b", "key-a"]';
    values.GEMINI_API_KEY = "key-c";
    values.GOOGLE_GENERATIVE_AI_API_KEY = "key-b";
    expect(getGeminiApiKeys()).toEqual(["key-a", "key-b", "key-c"]);
    expect(hasGeminiApiKeys()).toBe(true);

    values.GEMINI_API_KEYS = "key-d, key-e\nkey-f";
    values.GEMINI_API_KEY = undefined;
    values.GOOGLE_GENERATIVE_AI_API_KEY = undefined;
    expect(getGeminiApiKeys()).toEqual(["key-d", "key-e", "key-f"]);
  });

  it("prefers valid unique CSV indexes and appends every remaining key", () => {
    values.GEMINI_API_KEYS = "key-a,key-b,key-c,key-d";
    values.TEST_PREFERRED_INDEXES = "2, 0,2,-1,99,invalid,1.5, 1";
    expect(getGeminiApiKeys("TEST_PREFERRED_INDEXES")).toEqual([
      "key-c",
      "key-a",
      "key-b",
      "key-d",
    ]);
  });

  it("falls back to canonical order and leaves no-argument probe reads untouched", () => {
    values.GEMINI_API_KEYS = "key-a,key-b,key-c";
    values.INVALID_PREFERRED_INDEXES = "-1,3,nope,1.5";
    values.GEMINI_TEXT_PREFERRED_KEY_INDEXES = "2,0";
    expect(getGeminiApiKeys("INVALID_PREFERRED_INDEXES")).toEqual(["key-a", "key-b", "key-c"]);
    expect(getGeminiApiKeys("MISSING_PREFERRED_INDEXES")).toEqual(["key-a", "key-b", "key-c"]);
    expect(getGeminiApiKeys()).toEqual(["key-a", "key-b", "key-c"]);
  });

  it("normalizes gateway model names and honors the text model override", () => {
    values.GEMINI_TEXT_MODEL = "google/gemini-2.5-pro";
    expect(normalizeGeminiModel(undefined)).toBe("gemini-2.5-pro");
    expect(normalizeGeminiModel("models/gemini-2.5-flash")).toBe("gemini-2.5-pro");
    values.GEMINI_TEXT_MODEL = undefined;
    expect(normalizeGeminiModel("models/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(normalizeGeminiModel(undefined)).toBe("gemini-3.5-flash");
  });
});

describe("Gemini key rotation", () => {
  it("rotates on retryable responses and tries the complete pool", async () => {
    const visited: string[] = [];
    const slept: number[] = [];
    const response = await rotateGeminiKeys(
      async (key) => {
        visited.push(key);
        return new Response(key === "key-c" ? "ok" : "quota", {
          status: key === "key-c" ? 200 : 429,
        });
      },
      {
        keys: ["key-a", "key-b", "key-c"],
        startIndex: 0,
        maxAttempts: 3,
        jitterRatio: 0,
        sleep: async (ms) => void slept.push(ms),
      },
    );

    expect(response.status).toBe(200);
    expect(visited).toEqual(["key-a", "key-b", "key-c"]);
    expect(slept).toEqual([100, 200]);
  });

  it("does not retry ordinary 4xx schema errors", async () => {
    const operation = vi.fn(async () => new Response("invalid schema", { status: 400 }));
    const response = await rotateGeminiKeys(operation, {
      keys: ["key-a", "key-b"],
      maxAttempts: 2,
      sleep: async () => {},
    });
    expect(response.status).toBe(400);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("advances immediately on unauthorized keys and redacts secrets from network errors", async () => {
    const slept: number[] = [];
    const key = "gemini-test-secret-that-must-never-escape";
    await expect(rotateGeminiKeys(
      async (_active, context) => {
        if (context.attempt === 1) {
          return new Response("forbidden", { status: 403 });
        }
        throw new TypeError(`network failed for ${key}`);
      },
      {
        keys: [key, "second-key"],
        startIndex: 0,
        maxAttempts: 2,
        sleep: async (ms) => void slept.push(ms),
      },
    )).rejects.not.toThrow(key);
    expect(slept).toEqual([0]);
  });

  it("sweeps unauthorized keys immediately inside a total deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    const visited: string[] = [];
    const slept: number[] = [];
    const response = await rotateGeminiKeys(
      async (key) => {
        visited.push(key);
        const status = key === "key-a" ? 401 : key === "key-b" ? 403 : 200;
        return new Response(status === 200 ? "ok" : "invalid credential", { status });
      },
      {
        keys: ["key-a", "key-b", "key-c"],
        startIndex: 0,
        maxAttempts: 3,
        totalTimeoutMs: 25,
        sleep: async (ms) => void slept.push(ms),
      },
    );

    expect(response.status).toBe(200);
    expect(visited).toEqual(["key-a", "key-b", "key-c"]);
    expect(slept).toEqual([0, 0]);
  });

  it("fails a slow rotation at the total deadline with a sanitized retryable error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    const secret = "gemini-total-timeout-secret-that-must-not-escape";
    const operation = vi.fn(() => new Promise<Response>(() => {}));
    const captured = rotateGeminiKeys(operation, {
      keys: [secret, "second-key"],
      startIndex: 0,
      maxAttempts: 2,
      totalTimeoutMs: 125,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(125);
    const error = await captured;
    expect(error).toMatchObject({
      name: "GeminiTotalTimeoutError",
      code: "GEMINI_TOTAL_TIMEOUT",
      status: 408,
      retryable: true,
    });
    expect(String((error as Error).message)).not.toContain(secret);
    expect(String((error as Error).stack)).not.toContain(secret);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("Gemini OpenAI-compatible client", () => {
  it("starts text requests with the configured preferred healthy index", async () => {
    values.GEMINI_API_KEYS = "text-key-a,text-key-b,text-key-c";
    values.GEMINI_TEXT_PREFERRED_KEY_INDEXES = "2,0";
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer text-key-c");
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });

    await expect(geminiOpenAIChat({ messages: [] }, { fetchImpl })).resolves.toHaveProperty("ok", true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("round-robins consecutive text requests across the healthy preferred prefix", async () => {
    values.GEMINI_API_KEYS = "text-key-a,text-key-b,text-key-c,text-key-d";
    values.GEMINI_TEXT_PREFERRED_KEY_INDEXES = "2,0,3";
    // Repeated random values used to collide every parallel request on key-c.
    // Distribution is now deterministic inside the preferred healthy prefix.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visited: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      visited.push(new Headers(init?.headers).get("authorization") || "");
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });

    await geminiOpenAIChat({ messages: [] }, { fetchImpl });
    await geminiOpenAIChat({ messages: [] }, { fetchImpl });
    await geminiOpenAIChat({ messages: [] }, { fetchImpl });

    expect(new Set(visited)).toEqual(new Set([
      "Bearer text-key-c",
      "Bearer text-key-a",
      "Bearer text-key-d",
    ]));
  });

  it("wraps retries inside the healthy prefix before visiting the remaining pool", async () => {
    values.GEMINI_API_KEYS = "retry-key-a,retry-key-b,retry-key-c,retry-key-d";
    values.GEMINI_TEXT_PREFERRED_KEY_INDEXES = "2,0,3";
    const visited: string[] = [];
    let warmupCalls = 2;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("authorization") || "";
      visited.push(authorization);
      if (warmupCalls > 0) {
        warmupCalls -= 1;
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }
      if (authorization === "Bearer retry-key-a") {
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }
      return new Response("quota", { status: 429 });
    });

    await geminiOpenAIChat({ messages: [] }, { fetchImpl });
    await geminiOpenAIChat({ messages: [] }, { fetchImpl });
    const response = await geminiOpenAIChat(
      { messages: [] },
      { fetchImpl, maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    );

    expect(response.ok).toBe(true);
    expect(visited.slice(-3)).toEqual([
      "Bearer retry-key-d",
      "Bearer retry-key-c",
      "Bearer retry-key-a",
    ]);
    expect(visited).not.toContain("Bearer retry-key-b");
  });

  it("keeps credentials out of the URL and normalizes the request model", async () => {
    values.GEMINI_API_KEYS = "test-key";
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-key");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gemini-3.5-flash");
      expect(body.reasoning_effort).toBe("low");
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });

    const response = await geminiOpenAIChat(
      { model: "google/gemini-3.5-flash", messages: [] },
      { fetchImpl },
    );
    expect(response.ok).toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("test-key");
  });

  it("rotates HTTP 400 only when the provider identifies an invalid credential", async () => {
    values.GEMINI_API_KEYS = "first-key,second-key";
    values.GEMINI_TEXT_PREFERRED_KEY_INDEXES = "0";
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const key = new Headers(init?.headers).get("authorization");
      if (key === "Bearer first-key") {
        return new Response(JSON.stringify({
          error: { code: 400, status: "INVALID_ARGUMENT", message: "Please pass a valid API key." },
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      });
    });

    const response = await geminiOpenAIChat(
      { messages: [{ role: "user", content: "test" }] },
      { fetchImpl, maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
    );
    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not rotate an HTTP 400 schema error", async () => {
    values.GEMINI_API_KEYS = "first-key,second-key";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 400, status: "INVALID_ARGUMENT", message: "Unknown field response_schema." },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    const response = await geminiOpenAIChat(
      { messages: [] },
      { fetchImpl, maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
    );
    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("Unknown field");
  });

  it("redacts and bounds the final provider error body", async () => {
    const secret = ["AI", "za", "0123456789abcdefghijklmnopqrstuvwxyz"].join("");
    values.GEMINI_API_KEYS = secret;
    const fetchImpl = vi.fn(async () => new Response(`trace=${secret}:${"x".repeat(3_000)}`, {
      status: 400,
      statusText: "Bad Request",
      headers: { "content-type": "text/plain", "x-goog-request-id": "request-1" },
    }));
    const response = await geminiOpenAIChat(
      { messages: [] },
      { fetchImpl, maxAttempts: 1 },
    );
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(response.statusText).toBe("Bad Request");
    expect(response.headers.get("x-goog-request-id")).toBe("request-1");
    expect(body).not.toContain(secret);
    expect(body).toContain("[REDACTED]");
    expect(body.length).toBeLessThanOrEqual(2_000);
  });

  it("aborts and classifies each provider attempt at its internal timeout", async () => {
    vi.useFakeTimers();
    values.GEMINI_API_KEYS = "timeout-key";
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
    const pending = geminiOpenAIChat(
      { messages: [] },
      { fetchImpl, maxAttempts: 1, attemptTimeoutMs: 100 },
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: "GEMINI_REQUEST_TIMEOUT", status: 408 });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    vi.useRealTimers();
  });

  it("caps a slow provider attempt to the remaining total budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    values.GEMINI_API_KEYS = "slow-key";
    let abortedAt = -1;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortedAt = Date.now();
          reject(new DOMException("aborted", "AbortError"));
        });
      }));
    const pending = geminiOpenAIChat(
      { messages: [] },
      {
        fetchImpl,
        maxAttempts: 1,
        attemptTimeoutMs: 5_000,
        totalTimeoutMs: 150,
      },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: "GEMINI_TOTAL_TIMEOUT",
      status: 408,
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(abortedAt).toBe(new Date("2026-07-14T00:00:00Z").getTime() + 150);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
