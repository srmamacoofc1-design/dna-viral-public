import { describe, expect, it } from "vitest";
import {
  assertVideoSize,
  extractYouTubeVideoId,
  extensionForMimeType,
  IngestionError,
  MAX_REFERENCE_VIDEO_BYTES,
  normalizeStoragePath,
  parseVideoSource,
  sourceIdempotencyKey,
} from "../../../supabase/functions/_shared/ingestion";

describe("video ingestion URL parsing", () => {
  it.each([
    ["https://www.youtube.com/shorts/vjqsNKq05iE", "vjqsNKq05iE"],
    ["https://youtu.be/adcOHqnTEZY?t=3", "adcOHqnTEZY"],
    ["https://www.youtube.com/watch?v=FaZGE4SyeUc&list=abc", "FaZGE4SyeUc"],
    ["https://www.youtube.com/live/vjqsNKq05iE", "vjqsNKq05iE"],
  ])("accepts a concrete YouTube video: %s", (url, id) => {
    const parsed = parseVideoSource(url);
    expect(parsed.kind).toBe("youtube_video");
    expect(parsed.videoId).toBe(id);
    expect(extractYouTubeVideoId(new URL(url))).toBe(id);
  });

  it.each([
    "https://www.youtube.com/@Benji_Curioso",
    "https://youtube.com/channel/UC123/shorts",
    "https://youtube.com/playlist?list=PL123",
  ])("classifies channels/playlists separately: %s", (url) => {
    expect(parseVideoSource(url).kind).toBe("youtube_collection");
  });

  it.each([
    "http://localhost/video.mp4",
    "http://127.0.0.1/video.mp4",
    "http://192.168.1.10/video.mp4",
    "http://[fc00::1]/video.mp4",
    "http://[fe80::1]/video.mp4",
    "http://[::ffff:127.0.0.1]/video.mp4",
    "file:///tmp/video.mp4",
    "https://user:pass@example.com/video.mp4",
  ])("blocks unsafe URLs: %s", (url) => {
    expect(() => parseVideoSource(url)).toThrow(IngestionError);
  });

  it("uses the YouTube ID as a stable retry key", () => {
    const watch = sourceIdempotencyKey(parseVideoSource("https://youtube.com/watch?v=vjqsNKq05iE&t=8"));
    const short = sourceIdempotencyKey(parseVideoSource("https://youtube.com/shorts/vjqsNKq05iE"));
    expect(watch).toBe("youtube:vjqsNKq05iE");
    expect(short).toBe(watch);
  });

  it("normalizes query order for direct-link retry keys", () => {
    const first = sourceIdempotencyKey(parseVideoSource("https://cdn.example/video.mp4?b=2&a=1"));
    const second = sourceIdempotencyKey(parseVideoSource("https://CDN.example/video.mp4?a=1&b=2"));
    expect(first).toBe(second);
  });
});

describe("video ingestion path and MIME helpers", () => {
  it("normalizes valid storage paths", () => {
    expect(normalizeStoragePath("/reference/user/video.mp4")).toBe("reference/user/video.mp4");
  });

  it.each(["", "../video.mp4", "reference//video.mp4", "reference\\video.mp4"])(
    "rejects unsafe storage path: %s",
    (path) => expect(() => normalizeStoragePath(path)).toThrow(IngestionError),
  );

  it("derives a stable extension", () => {
    expect(extensionForMimeType("video/quicktime")).toBe("mov");
    expect(extensionForMimeType("application/octet-stream", "https://cdn.example/video.webm?x=1")).toBe("webm");
    expect(extensionForMimeType(null)).toBe("mp4");
  });

  it("enforces the advertised 300 MB boundary", () => {
    expect(() => assertVideoSize(MAX_REFERENCE_VIDEO_BYTES)).not.toThrow();
    expect(() => assertVideoSize(MAX_REFERENCE_VIDEO_BYTES + 1)).toThrowError(/300 MB/);
    expect(() => assertVideoSize(0)).toThrow(IngestionError);
  });
});
