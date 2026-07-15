import { describe, expect, it } from "vitest";
import {
  mapWithConcurrency,
  referenceLinkFileName,
  referenceLinkQueueStorageKey,
  referenceQueueEntriesToResume,
  referenceQueueReadyForGeneration,
  referenceStoragePath,
  restoreReferenceLinkQueue,
  serializeReferenceLinkQueue,
  storageExtension,
  updateReferenceQueueEntry,
  withReferenceRetry,
  type ReferenceLinkQueueEntry,
} from "@/lib/reference-link-queue";

describe("reference link queue", () => {
  it("builds a private generation-reference path from a YouTube URL", () => {
    expect(referenceStoragePath(
      "user-123",
      "https://www.youtube.com/watch?v=vjqsNKq05iE",
      "temporary-video.webm",
      "job-456",
    )).toBe("reference/user-123/vjqsNKq05iE-job-456.webm");
  });

  it("creates safe file names and falls back to supported video extensions", () => {
    expect(referenceLinkFileName("https://cdn.example.com/Vídeo incrível.mov", "mov"))
      .toBe("Video-incrivel.mov");
    expect(storageExtension("download/file.unknown?token=1")).toBe("mp4");
  });

  it("updates only the selected queue item", () => {
    const entries: ReferenceLinkQueueEntry[] = [
      {
        clientId: "one",
        rawUrl: "https://example.com/one.mp4",
        sourceUrl: "https://example.com/one.mp4",
        canonicalUrl: "https://example.com/one.mp4",
        idempotencyKey: "direct:one",
        status: "queued",
      },
      {
        clientId: "two",
        rawUrl: "https://example.com/two.mp4",
        sourceUrl: "https://example.com/two.mp4",
        canonicalUrl: "https://example.com/two.mp4",
        idempotencyKey: "direct:two",
        status: "queued",
      },
    ];

    const updated = updateReferenceQueueEntry(entries, "two", { status: "ready" });
    expect(updated.map((entry) => entry.status)).toEqual(["queued", "ready"]);
    expect(entries.map((entry) => entry.status)).toEqual(["queued", "queued"]);
  });

  it("processes every item while respecting internal concurrency", async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      completed.push(item);
      active -= 1;
    });

    expect(peak).toBe(2);
    expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("persists a per-user resumable queue without session tokens or database payloads", () => {
    const entry = {
      clientId: "client-1",
      rawUrl: "https://youtu.be/vjqsNKq05iE",
      sourceUrl: "https://youtu.be/vjqsNKq05iE",
      canonicalUrl: "https://www.youtube.com/watch?v=vjqsNKq05iE",
      idempotencyKey: "youtube:vjqsNKq05iE",
      status: "processing" as const,
      referenceVideoId: "reference-1",
      referenceVideo: { id: "reference-1", transcription: "private row" } as any,
      accessToken: "must-never-be-persisted",
    } as ReferenceLinkQueueEntry & { accessToken: string };

    const serialized = serializeReferenceLinkQueue([entry]);
    expect(referenceLinkQueueStorageKey("user-1")).toBe("dna-viral:reference-link-queue:v1:user-1");
    expect(serialized).not.toContain("must-never-be-persisted");
    expect(serialized).not.toContain("private row");
    expect(restoreReferenceLinkQueue(serialized)).toEqual([{
      clientId: "client-1",
      rawUrl: "https://youtu.be/vjqsNKq05iE",
      sourceUrl: "https://youtu.be/vjqsNKq05iE",
      canonicalUrl: "https://www.youtube.com/watch?v=vjqsNKq05iE",
      idempotencyKey: "youtube:vjqsNKq05iE",
      status: "processing",
      referenceVideoId: "reference-1",
    }]);
  });

  it("turns interrupted browser-only work back into resumable jobs", () => {
    const base = {
      rawUrl: "https://example.com/video.mp4",
      sourceUrl: "https://example.com/video.mp4",
      canonicalUrl: "https://example.com/video.mp4",
    };
    const serialized = JSON.stringify({ version: 1, entries: [
      { ...base, clientId: "download", idempotencyKey: "direct:download", status: "downloading" },
      { ...base, clientId: "process-no-id", idempotencyKey: "direct:no-id", status: "processing" },
      { ...base, clientId: "server", idempotencyKey: "direct:server", status: "processing", referenceVideoId: "row-1" },
      { ...base, clientId: "failed", idempotencyKey: "direct:failed", status: "error", error: "network" },
      { ...base, clientId: "done", idempotencyKey: "direct:done", status: "ready", referenceVideoId: "row-2" },
    ] });
    const restored = restoreReferenceLinkQueue(serialized);
    expect(restored.map((entry) => entry.status)).toEqual(["queued", "queued", "processing", "error", "ready"]);
    expect(referenceQueueEntriesToResume(restored).map((entry) => entry.clientId)).toEqual([
      "download", "process-no-id", "server", "failed",
    ]);
  });

  it("selects every ready reference once for sequential batch generation", () => {
    const base = {
      rawUrl: "https://example.com/video.mp4",
      sourceUrl: "https://example.com/video.mp4",
      canonicalUrl: "https://example.com/video.mp4",
    };
    const entries: ReferenceLinkQueueEntry[] = [
      { ...base, clientId: "one", idempotencyKey: "one", status: "ready", referenceVideoId: "ref-1" },
      { ...base, clientId: "duplicate", idempotencyKey: "duplicate", status: "ready", referenceVideoId: "ref-1" },
      { ...base, clientId: "two", idempotencyKey: "two", status: "ready", referenceVideoId: "ref-2" },
      { ...base, clientId: "pending", idempotencyKey: "pending", status: "processing", referenceVideoId: "ref-3" },
      { ...base, clientId: "missing", idempotencyKey: "missing", status: "ready" },
    ];

    expect(referenceQueueReadyForGeneration(entries).map((entry) => entry.referenceVideoId))
      .toEqual(["ref-1", "ref-2"]);
  });

  it("retries 429/5xx with bounded backoff and stops after success", async () => {
    const attempts: number[] = [];
    const waits: number[] = [];
    const result = await withReferenceRetry(async (attempt) => {
      attempts.push(attempt);
      if (attempt < 3) {
        const error = new Error("busy") as Error & { status: number };
        error.status = attempt === 1 ? 429 : 503;
        throw error;
      }
      return "ok";
    }, { wait: async (milliseconds) => { waits.push(milliseconds); } });
    expect(result).toBe("ok");
    expect(attempts).toEqual([1, 2, 3]);
    expect(waits).toEqual([600, 1800]);
  });

  it("does not retry a permanent validation failure", async () => {
    let attempts = 0;
    await expect(withReferenceRetry(async () => {
      attempts += 1;
      const error = new Error("invalid") as Error & { status: number };
      error.status = 422;
      throw error;
    }, { wait: async () => undefined })).rejects.toThrow("invalid");
    expect(attempts).toBe(1);
  });
});
