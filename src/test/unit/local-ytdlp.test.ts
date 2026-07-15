import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_YTDLP_MAX_VIDEO_BYTES,
  LOCAL_YTDLP_IMPORT_LEASE_MS,
  LOCAL_YTDLP_STORAGE_BUCKET,
  canReclaimLocalReference,
  contentTypeFor,
  createReferenceVideoRecord,
  findDownloadedVideo,
  runYtDlp,
  safeRemoveDirectory,
  streamLocalReferenceBodyToFile,
  uploadDownloadedReference,
  validateLocalReferenceUploadHeaders,
  validateLocalYtDlpSourceUrl,
} from "../../../scripts/vite-local-ytdlp";
import { LOCAL_VIDEO_MAX_INPUT_BYTES } from "../../../scripts/local-video-normalizer";

function createFakeChild(): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    pid: 4242,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local yt-dlp source validation", () => {
  it("accepts only concrete HTTPS videos supported by the bulk parser contract", () => {
    expect(validateLocalYtDlpSourceUrl("https://www.youtube.com/shorts/vjqsNKq05iE#x"))
      .toBe("https://www.youtube.com/shorts/vjqsNKq05iE");
    expect(validateLocalYtDlpSourceUrl("https://www.youtube-nocookie.com/embed/vjqsNKq05iE"))
      .toContain("youtube-nocookie.com/embed/vjqsNKq05iE");
    expect(validateLocalYtDlpSourceUrl("https://www.tiktok.com/@creator/video/123456789"))
      .toContain("tiktok.com/@creator/video/");
    expect(validateLocalYtDlpSourceUrl("https://drive.google.com/file/d/abc/view"))
      .toContain("drive.google.com/file/d/abc/view");
  });

  it("rejects channels, playlists, malformed YouTube URLs, credentials, HTTP and unknown hosts", () => {
    expect(() => validateLocalYtDlpSourceUrl("https://www.youtube.com/@Benji_Curioso")).toThrow(/canal ou playlist/);
    expect(() => validateLocalYtDlpSourceUrl("https://www.youtube.com/playlist?list=PL123")).toThrow(/canal ou playlist/);
    expect(() => validateLocalYtDlpSourceUrl("https://www.youtube.com/not-a-video")).toThrow(/vídeo identificável/);
    expect(() => validateLocalYtDlpSourceUrl("https://user:pass@youtube.com/shorts/vjqsNKq05iE")).toThrow(/credenciais/);
    expect(() => validateLocalYtDlpSourceUrl("http://youtube.com/shorts/vjqsNKq05iE")).toThrow(/somente links HTTPS/);
    expect(() => validateLocalYtDlpSourceUrl("https://127.0.0.1/video.mp4")).toThrow(/plataformas de vídeo conhecidas/);
  });
});

describe("local reference upload contract", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const referenceVideoId = "22222222-2222-4222-8222-222222222222";
  const storagePath = `reference/${userId}/upload-${"a".repeat(40)}.mp4`;

  it("accepts only a bounded raw video body tied to the authenticated user path", () => {
    expect(validateLocalReferenceUploadHeaders({
      "content-length": String(60 * 1024 * 1024),
      "content-type": "video/quicktime",
      "x-reference-video-id": referenceVideoId,
      "x-storage-path": storagePath,
      "x-file-name": encodeURIComponent("meu vídeo.mov"),
    }, userId)).toEqual({
      contentLength: 60 * 1024 * 1024,
      contentType: "video/quicktime",
      referenceVideoId,
      storagePath,
      fileName: "meu vídeo.mov",
    });
  });

  it("rejects a missing length, >300 MiB, foreign path and non-video body", () => {
    const base = {
      "content-length": "10240",
      "content-type": "video/mp4",
      "x-reference-video-id": referenceVideoId,
      "x-storage-path": storagePath,
    };
    expect(() => validateLocalReferenceUploadHeaders({ ...base, "content-length": undefined }, userId))
      .toThrow(/Content-Length/);
    expect(() => validateLocalReferenceUploadHeaders({
      ...base,
      "content-length": String(LOCAL_VIDEO_MAX_INPUT_BYTES + 1),
    }, userId)).toThrow(/300 MB/);
    expect(() => validateLocalReferenceUploadHeaders({
      ...base,
      "x-storage-path": `reference/foreign/upload-${"a".repeat(40)}.mp4`,
    }, userId)).toThrow(/usuário autenticado/);
    expect(() => validateLocalReferenceUploadHeaders({ ...base, "content-type": "application/json" }, userId))
      .toThrow(/arquivo de vídeo/);
  });

  it("streams exactly the declared bytes to disk and rejects a truncated body", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dna-reference-stream-"));
    try {
      const complete = new PassThrough();
      complete.end(Buffer.alloc(12 * 1024, 7));
      await expect(streamLocalReferenceBodyToFile({
        request: complete as unknown as IncomingMessage,
        destinationPath: path.join(directory, "complete.bin"),
        expectedBytes: 12 * 1024,
      })).resolves.toBe(12 * 1024);

      const truncated = new PassThrough();
      truncated.end(Buffer.alloc(10 * 1024));
      await expect(streamLocalReferenceBodyToFile({
        request: truncated as unknown as IncomingMessage,
        destinationPath: path.join(directory, "truncated.bin"),
        expectedBytes: 12 * 1024,
      })).rejects.toThrow(/antes de receber todos os bytes/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("yt-dlp process lifecycle", () => {
  it("terminates the whole process through the injected tree killer on timeout and settles once", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    let capturedArgs: readonly string[] = [];
    const spawnProcess = vi.fn((_executable: string, args: readonly string[]) => {
      capturedArgs = args;
      return child;
    });
    const terminateProcess = vi.fn(async (target: ChildProcessWithoutNullStreams) => {
      target.emit("close", null, "SIGKILL");
    });
    const operation = runYtDlp("https://youtu.be/vjqsNKq05iE", "video.%(ext)s", {
      timeoutMs: 25,
      spawnProcess,
      terminateProcess,
    });
    const rejection = expect(operation).rejects.toThrow(/excedeu 10 minutos/);

    await vi.advanceTimersByTimeAsync(30);
    await rejection;
    child.emit("close", 0, null);

    expect(terminateProcess).toHaveBeenCalledTimes(1);
    expect(capturedArgs).toContain(String(LOCAL_YTDLP_MAX_VIDEO_BYTES));
    expect(capturedArgs).toContain("--remux-video");
  });

  it("kills yt-dlp when the HTTP request signal is aborted", async () => {
    const child = createFakeChild();
    const controller = new AbortController();
    const terminateProcess = vi.fn(async (target: ChildProcessWithoutNullStreams) => {
      target.emit("close", null, "SIGKILL");
    });
    const operation = runYtDlp("https://youtu.be/vjqsNKq05iE", "video.%(ext)s", {
      signal: controller.signal,
      spawnProcess: () => child,
      terminateProcess,
    });

    controller.abort(new Error("cliente desconectou"));
    await expect(operation).rejects.toThrow("cliente desconectou");
    expect(terminateProcess).toHaveBeenCalledTimes(1);
  });
});

describe("download format, size and cleanup", () => {
  it("selects a supported video and reports a normalized MIME type", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dna-ytdlp-test-"));
    try {
      await writeFile(path.join(directory, "audio.m4a"), Buffer.alloc(30 * 1024));
      await writeFile(path.join(directory, "video.WEBM"), Buffer.alloc(12 * 1024));
      const downloaded = await findDownloadedVideo(directory);
      expect(path.basename(downloaded.filePath)).toBe("video.WEBM");
      expect(downloaded.format).toEqual({ extension: "webm", contentType: "video/webm" });
      expect(contentTypeFor(downloaded.filePath)).toBe("video/webm");
      expect(() => contentTypeFor("arquivo.bin")).toThrow(/não suportado/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces the exact 300 MB upload ceiling before opening a stream", async () => {
    const fetchSpy = vi.fn();
    await expect(uploadDownloadedReference({
      filePath: "nao-deve-ser-aberto.mp4",
      fileSize: LOCAL_YTDLP_MAX_VIDEO_BYTES + 1,
      userId: "user-1",
      authorization: "Bearer token",
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "key",
    }, { fetchImpl: fetchSpy as unknown as typeof fetch })).rejects.toThrow(/300 MB/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never rejects when temporary-directory cleanup itself fails", async () => {
    const warning = vi.fn();
    const failingRemove = vi.fn(async () => {
      throw new Error("arquivo ainda bloqueado");
    });
    await expect(safeRemoveDirectory(
      "C:\\temp\\job",
      warning,
      failingRemove as unknown as typeof rm,
    )).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("arquivo ainda bloqueado"));
  });
});

describe("private Storage upload and reference row", () => {
  it("keeps a recent reservation leased and reclaims stale/error rows without a file", () => {
    const now = Date.now();
    const base = {
      id: "reference-lease",
      file_name: "video.mp4",
      storage_path: null,
      storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
      status: "uploading",
      user_id: "user-1",
      updated_at: new Date(now - LOCAL_YTDLP_IMPORT_LEASE_MS + 1_000).toISOString(),
    };
    expect(canReclaimLocalReference(base, now)).toBe(false);
    expect(canReclaimLocalReference({
      ...base,
      updated_at: new Date(now - LOCAL_YTDLP_IMPORT_LEASE_MS).toISOString(),
    }, now)).toBe(true);
    expect(canReclaimLocalReference({ ...base, status: "error" }, now)).toBe(true);
    expect(canReclaimLocalReference({ ...base, storage_path: "reference/user-1/file.mp4", status: "error" }, now)).toBe(false);
  });

  it("streams to the private bucket and applies an upload timeout", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(path.join(tmpdir(), "dna-ytdlp-upload-"));
    const filePath = path.join(directory, "video.mp4");
    await writeFile(filePath, Buffer.alloc(12 * 1024));
    const fetchSpy = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });

    try {
      const operation = uploadDownloadedReference({
        filePath,
        fileSize: 12 * 1024,
        userId: "user-1",
        authorization: "Bearer token",
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "key",
      }, {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        timeoutMs: 25,
        randomId: () => "fixed-id",
      });
      const rejection = expect(operation).rejects.toThrow(/Storage excedeu o tempo limite/);
      await vi.advanceTimersByTimeAsync(30);
      await rejection;

      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(`/object/${LOCAL_YTDLP_STORAGE_BUCKET}/reference/user-1/fixed-id.mp4`);
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toMatchObject({
        "Content-Type": "video/mp4",
        "Content-Length": String(12 * 1024),
      });
      expect(fetchSpy.mock.calls.some(([, request]) => request?.method === "DELETE")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uploads a normalized artifact only to an explicit user-scoped path with upsert", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dna-reference-upload-"));
    const filePath = path.join(directory, "normalized.mp4");
    await writeFile(filePath, Buffer.alloc(12 * 1024));
    const explicitPath = `reference/user-1/upload-${"b".repeat(40)}.mp4`;
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    try {
      await expect(uploadDownloadedReference({
        filePath,
        fileSize: 12 * 1024,
        userId: "user-1",
        authorization: "Bearer user-token",
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "anon-key",
        storagePath: explicitPath,
        upsert: true,
      }, { fetchImpl: fetchSpy as unknown as typeof fetch })).resolves.toBe(explicitPath);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(explicitPath);
      expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
        Authorization: "Bearer user-token",
        "Content-Length": String(12 * 1024),
        "x-upsert": "true",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates a pending reference row with the user bearer and private bucket", async () => {
    const row = {
      id: "reference-1",
      file_name: "video.mp4",
      storage_path: "reference/user-1/file.mp4",
      storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
      status: "pending",
      user_id: "user-1",
    };
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify([row]), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await createReferenceVideoRecord({
      referenceVideoId: row.id,
      fileName: row.file_name,
      storagePath: row.storage_path,
      sourceUrl: "https://www.youtube.com/shorts/vjqsNKq05iE",
      sourceKey: "youtube:vjqsNKq05iE",
      userId: row.user_id,
      authorization: "Bearer user-token",
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "anon-key",
    });

    expect(result).toEqual({ row, inserted: true });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer user-token", Prefer: "return=representation" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      status: "pending",
      storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
      source_idempotency_key: "youtube:vjqsNKq05iE",
      user_id: "user-1",
    });
  });

  it("reuses the existing row on a unique-key conflict", async () => {
    const existing = {
      id: "reference-existing",
      file_name: "old.mp4",
      storage_path: "reference/user-1/old.mp4",
      storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
      status: "pending",
      user_id: "user-1",
    };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response("duplicate", { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([existing]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createReferenceVideoRecord({
      referenceVideoId: "new-id",
      fileName: "new.mp4",
      storagePath: "reference/user-1/new.mp4",
      sourceUrl: "https://www.youtube.com/shorts/vjqsNKq05iE",
      sourceKey: "youtube:vjqsNKq05iE",
      userId: "user-1",
      authorization: "Bearer user-token",
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "anon-key",
    })).resolves.toEqual({ row: existing, inserted: false });

    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain("source_idempotency_key=eq.youtube%3AvjqsNKq05iE");
  });

  it("recognizes an existing reservation that is still waiting for its file", async () => {
    const reserved = {
      id: "reference-uploading",
      file_name: "reserved.mp4",
      storage_path: null,
      storage_bucket: LOCAL_YTDLP_STORAGE_BUCKET,
      status: "pending",
      user_id: "user-1",
    };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response("duplicate", { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([reserved]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createReferenceVideoRecord({
      referenceVideoId: "new-id",
      fileName: "new.mp4",
      storagePath: "reference/user-1/new.mp4",
      sourceUrl: "https://www.youtube.com/shorts/vjqsNKq05iE",
      sourceKey: "youtube:vjqsNKq05iE",
      userId: "user-1",
      authorization: "Bearer user-token",
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "anon-key",
    })).resolves.toEqual({ row: reserved, inserted: false });
  });
});
