import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateVideoJson,
  prepareVideoMedia,
  releaseVideoMedia,
  stableVideoKeyStartIndex,
} from "../../../supabase/functions/_shared/gemini-video";
import { MAX_REFERENCE_VIDEO_BYTES } from "../../../supabase/functions/_shared/ingestion";

const originalDeno = (globalThis as { Deno?: unknown }).Deno;
let values: Record<string, string> = {};

beforeEach(() => {
  vi.useFakeTimers();
  values = {
    GEMINI_API_KEYS: "video-key-a,video-key-b",
    GEMINI_VIDEO_MODEL: "google/gemini-3.5-flash",
  };
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

describe("Gemini Files video lifecycle", () => {
  it("distributes different Storage paths across the pool and keeps the choice stable", async () => {
    values.GEMINI_API_KEYS = "video-key-a,video-key-b,video-key-c,video-key-d";
    values.GEMINI_VIDEO_PREFERRED_KEY_INDEXES = "2,0";
    let uploadNumber = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/storage/v1/object/")) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-length": "1", "content-type": "video/mp4" },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        uploadNumber++;
        const key = new Headers(init?.headers).get("x-goog-api-key");
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": `https://upload.example/${key}/${uploadNumber}` },
        });
      }
      if (url.startsWith("https://upload.example/")) {
        return new Response(JSON.stringify({
          file: {
            name: `files/distribution-${uploadNumber}`,
            uri: `https://files.example/distribution-${uploadNumber}`,
            mimeType: "video/mp4",
            state: "ACTIVE",
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }));

    const paths = [1, 2, 3, 4].map((number) => `reference/owner/video-${number}.mp4`);
    const selected: string[] = [];
    for (const storagePath of paths) {
      const media = await prepareVideoMedia({
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "service-role-placeholder",
        storagePath,
      });
      selected.push(media.geminiApiKey);
      await releaseVideoMedia(media);
    }

    expect(new Set(selected).size).toBe(4);
    const preferredPool = ["video-key-c", "video-key-a", "video-key-b", "video-key-d"];
    expect(selected).toEqual(paths.map((storagePath) =>
      preferredPool[stableVideoKeyStartIndex(storagePath, preferredPool.length)]
    ));

    const repeated = await prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath: paths[0],
    });
    expect(repeated.geminiApiKey).toBe(selected[0]);
    await releaseVideoMedia(repeated);
  });

  it("uses the same deterministic circular upload retry order for the same video", async () => {
    values.GEMINI_API_KEYS = "video-key-a,video-key-b,video-key-c,video-key-d";
    values.GEMINI_VIDEO_MAX_KEY_ATTEMPTS = "3";
    const sequences: string[][] = [];
    let activeSequence: string[] = [];
    let uploadNumber = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/storage/v1/object/")) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-length": "1", "content-type": "video/mp4" },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
        activeSequence.push(key);
        if (activeSequence.length === 1) return new Response("retry", { status: 503 });
        uploadNumber++;
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": `https://upload.example/retry-${uploadNumber}` },
        });
      }
      if (url.startsWith("https://upload.example/retry-")) {
        return new Response(JSON.stringify({
          file: {
            name: `files/retry-${uploadNumber}`,
            uri: `https://files.example/retry-${uploadNumber}`,
            state: "ACTIVE",
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }));

    const storagePath = "reference/owner/stable-retry.mp4";
    for (let run = 0; run < 2; run++) {
      activeSequence = [];
      const pending = prepareVideoMedia({
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "service-role-placeholder",
        storagePath,
      });
      await vi.runAllTimersAsync();
      const media = await pending;
      sequences.push([...activeSequence]);
      await releaseVideoMedia(media);
    }

    const pool = ["video-key-a", "video-key-b", "video-key-c", "video-key-d"];
    const start = stableVideoKeyStartIndex(storagePath, pool.length);
    expect(sequences).toEqual([
      [pool[start], pool[(start + 1) % pool.length]],
      [pool[start], pool[(start + 1) % pool.length]],
    ]);
  });

  it("uses a circular generation order and honors the configured key-attempt maximum", async () => {
    values.GEMINI_API_KEYS = "video-key-a,video-key-b,video-key-c,video-key-d";
    values.GEMINI_VIDEO_PREFERRED_KEY_INDEXES = "2,0";
    values.GEMINI_VIDEO_MAX_KEY_ATTEMPTS = "3";
    const uploadKeys: string[] = [];
    const generationKeys: string[] = [];
    const generationUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/storage/v1/object/")) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-length": "1", "content-type": "video/mp4" },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        uploadKeys.push(key);
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": `https://upload.example/max-${uploadKeys.length}` },
        });
      }
      if (url.startsWith("https://upload.example/max-")) {
        const number = Number(url.split("-").pop());
        return new Response(JSON.stringify({
          file: {
            name: `files/max-${number}`,
            uri: `https://files.example/max-${number}`,
            mimeType: "video/mp4",
            state: "ACTIVE",
          },
        }), { status: 200 });
      }
      if (url.includes(":generateContent")) {
        generationKeys.push(key);
        generationUrls.push(url);
        return new Response("quota", { status: 429 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }));

    const storagePath = "reference/owner/bounded-generation.mp4";
    const media = await prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath,
    });
    const pending = generateVideoJson({
      media,
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { type: "object" },
      toolName: "save",
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: "GEMINI_ANALYSIS_FAILED" });
    await vi.runAllTimersAsync();
    await assertion;

    const pool = ["video-key-c", "video-key-a", "video-key-b", "video-key-d"];
    const start = stableVideoKeyStartIndex(storagePath, pool.length);
    const expected = [0, 1, 2].map((offset) => pool[(start + offset) % pool.length]);
    expect(uploadKeys).toEqual(expected);
    expect(generationKeys).toEqual([...expected, expected[2]]);
    expect(generationUrls.every((url) => url.includes("/models/gemini-3.5-flash:generateContent"))).toBe(true);
    expect(generationUrls.some((url) => url.includes("gemini-2.5-flash"))).toBe(false);
    expect(uploadKeys).not.toContain(pool[(start + 3) % pool.length]);
  });

  it("accepts the 300 MB boundary and re-uploads with one new key after a retryable generation failure", async () => {
    let uploadNumber = 0;
    const generateKeys: string[] = [];
    const deletedFiles: string[] = [];
    const deleteAttempts = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.includes("/storage/v1/object/")) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: {
            "content-length": String(MAX_REFERENCE_VIDEO_BYTES),
            "content-type": "video/mp4",
          },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        uploadNumber++;
        expect(headers.get("x-goog-api-key")).toMatch(/^video-key-/);
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": `https://upload.example/session-${uploadNumber}` },
        });
      }
      if (url.startsWith("https://upload.example/session-")) {
        return new Response(JSON.stringify({
          file: {
            name: `files/video-${uploadNumber}`,
            uri: `https://files.example/video-${uploadNumber}`,
            mimeType: "video/mp4",
            state: "ACTIVE",
          },
        }), { status: 200 });
      }
      if (url.includes(":generateContent")) {
        generateKeys.push(headers.get("x-goog-api-key") ?? "");
        const request = JSON.parse(String(init?.body));
        expect(request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
        expect(request.generationConfig).not.toHaveProperty("temperature");
        if (generateKeys.length === 1) return new Response("quota", { status: 429 });
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        }), { status: 200 });
      }
      if (init?.method === "DELETE") {
        deletedFiles.push(url);
        const attempt = (deleteAttempts.get(url) ?? 0) + 1;
        deleteAttempts.set(url, attempt);
        if (url.endsWith("/files/video-1") && attempt === 1) {
          return new Response("temporary", { status: 503 });
        }
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const media = await prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath: "reference/owner/video.mp4",
      maxBytes: MAX_REFERENCE_VIDEO_BYTES,
    });
    expect(media.sizeBytes).toBe(MAX_REFERENCE_VIDEO_BYTES);
    const firstKey = media.geminiApiKey;

    const generation = generateVideoJson<{ ok: boolean }>({
      media,
      systemPrompt: "Analyze only visible evidence.",
      userPrompt: "Return JSON.",
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      toolName: "save_video",
    });
    await vi.runAllTimersAsync();
    await expect(generation).resolves.toEqual({ ok: true });
    expect(generateKeys).toHaveLength(2);
    expect(generateKeys[0]).toBe(firstKey);
    expect(generateKeys[1]).not.toBe(firstKey);
    expect(media.geminiApiKey).toBe(generateKeys[1]);
    expect(uploadNumber).toBe(2);
    expect(deletedFiles.some((url) => url.endsWith("/files/video-1"))).toBe(true);
    expect(deletedFiles.filter((url) => url.endsWith("/files/video-1"))).toHaveLength(2);

    await releaseVideoMedia(media);
    expect(deletedFiles.some((url) => url.endsWith("/files/video-2"))).toBe(true);
  });

  it("falls back from a 503 to Gemini 2.5 on the same key and uploaded file", async () => {
    values.GEMINI_API_KEYS = "only-video-key";
    values.GEMINI_VIDEO_MODEL = "models/gemini-3.5-flash";
    let uploads = 0;
    const generationRequests: Array<{
      url: string;
      key: string | null;
      body: Record<string, any>;
    }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/storage/v1/object/")) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-length": "1", "content-type": "video/mp4" },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        uploads++;
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": "https://upload.example/fallback" },
        });
      }
      if (url === "https://upload.example/fallback") {
        return new Response(JSON.stringify({
          file: {
            name: "files/fallback",
            uri: "https://files.example/fallback",
            mimeType: "video/mp4",
            state: "ACTIVE",
          },
        }), { status: 200 });
      }
      if (url.includes(":generateContent")) {
        generationRequests.push({
          url,
          key: new Headers(init?.headers).get("x-goog-api-key"),
          body: JSON.parse(String(init?.body)),
        });
        if (generationRequests.length === 1) {
          return new Response("primary temporarily unavailable", { status: 503 });
        }
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        }), { status: 200 });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected test URL: ${url}`);
    }));

    const media = await prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath: "reference/owner/model-fallback.mp4",
    });
    const pending = generateVideoJson<{ ok: boolean }>({
      media,
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { type: "object" },
      toolName: "save",
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ ok: true });

    expect(uploads).toBe(1);
    expect(generationRequests).toHaveLength(2);
    expect(generationRequests.map(({ key }) => key)).toEqual([
      "only-video-key",
      "only-video-key",
    ]);
    expect(generationRequests[0].url).toContain("/models/gemini-3.5-flash:generateContent");
    expect(generationRequests[1].url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(generationRequests[0].body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "minimal",
    });
    expect(generationRequests[0].body.generationConfig).not.toHaveProperty("temperature");
    expect(generationRequests[1].body.generationConfig.temperature).toBe(0.1);
    expect(generationRequests[1].body.generationConfig).not.toHaveProperty("thinkingConfig");
    expect(generationRequests[0].body.contents[0].parts[0].fileData.fileUri).toBe(
      generationRequests[1].body.contents[0].parts[0].fileData.fileUri,
    );
    await releaseVideoMedia(media);
  });

  it("bounds a stalled primary generation and reaches the fallback before the Edge wall clock", async () => {
    values.GEMINI_API_KEYS = "only-video-key";
    values.GEMINI_VIDEO_GENERATION_ATTEMPT_TIMEOUT_MS = "60000";
    values.GEMINI_VIDEO_GENERATION_TOTAL_TIMEOUT_MS = "115000";
    let generations = 0;
    const generationUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/storage/v1/object/")) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-length": "1", "content-type": "video/mp4" },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": "https://upload.example/timeout-fallback" },
        });
      }
      if (url === "https://upload.example/timeout-fallback") {
        return new Response(JSON.stringify({
          file: {
            name: "files/timeout-fallback",
            uri: "https://files.example/timeout-fallback",
            mimeType: "video/mp4",
            state: "ACTIVE",
          },
        }), { status: 200 });
      }
      if (url.includes(":generateContent")) {
        generations++;
        generationUrls.push(url);
        if (generations === 1) {
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          });
        }
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        }), { status: 200 });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected test URL: ${url}`);
    }));

    const media = await prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath: "reference/owner/timeout-fallback.mp4",
    });
    const pending = generateVideoJson<{ ok: boolean }>({
      media,
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { type: "object" },
      toolName: "save",
    });

    await vi.advanceTimersByTimeAsync(60_100);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(generationUrls[0]).toContain("gemini-3.5-flash");
    expect(generationUrls[1]).toContain("gemini-2.5-flash");
    await releaseVideoMedia(media);
  });

  it.each(["invalid", "empty"] as const)(
    "falls back after a %s structured response on the same uploaded media",
    async (firstResponse) => {
      values.GEMINI_API_KEYS = "only-video-key";
      let uploads = 0;
      let generations = 0;
      const generationUrls: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/storage/v1/object/")) {
          return new Response(new Uint8Array([1]), {
            status: 200,
            headers: { "content-length": "1", "content-type": "video/mp4" },
          });
        }
        if (url.endsWith("/upload/v1beta/files")) {
          uploads++;
          return new Response(null, {
            status: 200,
            headers: { "x-goog-upload-url": "https://upload.example/only" },
          });
        }
        if (url === "https://upload.example/only") {
          return new Response(JSON.stringify({
            file: { name: "files/only", uri: "https://files.example/only", state: "ACTIVE" },
          }), { status: 200 });
        }
        if (url.includes(":generateContent")) {
          generations++;
          generationUrls.push(url);
          if (generations === 1) {
            return new Response(JSON.stringify(firstResponse === "invalid"
              ? { candidates: [{ content: { parts: [{ text: "not-json" }] } }] }
              : { candidates: [{ content: { parts: [] } }] }), { status: 200 });
          }
          return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          }), { status: 200 });
        }
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        throw new Error(`Unexpected test URL: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const media = await prepareVideoMedia({
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "service-role-placeholder",
        storagePath: "reference/owner/only.mp4",
      });
      const pending = generateVideoJson<{ ok: boolean }>({
        media,
        systemPrompt: "system",
        userPrompt: "user",
        jsonSchema: { type: "object" },
        toolName: "save",
      });
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toEqual({ ok: true });
      expect(generations).toBe(2);
      expect(uploads).toBe(1);
      expect(generationUrls[0]).toContain("/models/gemini-3.5-flash:generateContent");
      expect(generationUrls[1]).toContain("/models/gemini-2.5-flash:generateContent");
      await releaseVideoMedia(media);
    },
  );

  it("does not force repeated uploads when the pool has only one failing key", async () => {
    values.GEMINI_API_KEYS = "only-video-key";
    let storageFetches = 0;
    let uploadStarts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/storage/v1/object/")) {
        storageFetches++;
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-length": "1", "content-type": "video/mp4" },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        uploadStarts++;
        return new Response("provider unavailable", { status: 503 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }));

    await expect(prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath: "reference/owner/one-key.mp4",
    })).rejects.toMatchObject({ code: "GEMINI_UPLOAD_START_FAILED" });
    expect(storageFetches).toBe(1);
    expect(uploadStarts).toBe(1);
  });

  it("cleans an uploaded file when polling fails before rotating keys", async () => {
    let uploadNumber = 0;
    const deleted: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        deleted.push(url);
        return new Response(null, { status: 204 });
      }
      if (url.includes("/storage/v1/object/")) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-length": "1", "content-type": "video/mp4" },
        });
      }
      if (url.endsWith("/upload/v1beta/files")) {
        uploadNumber++;
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": `https://upload.example/poll-${uploadNumber}` },
        });
      }
      if (url.startsWith("https://upload.example/poll-")) {
        return new Response(JSON.stringify({
          file: {
            name: `files/poll-${uploadNumber}`,
            uri: `https://files.example/poll-${uploadNumber}`,
            state: uploadNumber === 1 ? "PROCESSING" : "ACTIVE",
          },
        }), { status: 200 });
      }
      if (url.endsWith("/files/poll-1")) return new Response("retry", { status: 503 });
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath: "reference/owner/poll.mp4",
    });
    await vi.runAllTimersAsync();
    const media = await pending;
    expect(uploadNumber).toBe(2);
    expect(deleted.some((url) => url.endsWith("/files/poll-1"))).toBe(true);
    await releaseVideoMedia(media);
  });

  it("aborts a stalled Storage request at its configured timeout", async () => {
    values.GEMINI_API_KEYS = "timeout-video-key";
    values.GEMINI_STORAGE_FETCH_TIMEOUT_MS = "1000";
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })));

    const pending = prepareVideoMedia({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-placeholder",
      storagePath: "reference/owner/timeout.mp4",
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: "STORAGE_FETCH_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
