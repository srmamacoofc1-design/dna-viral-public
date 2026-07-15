import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

describe("Gemini video rotation contract", () => {
  it("streams storage media through Files API and never places a key in a URL", () => {
    const video = source("../../../supabase/functions/_shared/gemini-video.ts");
    expect(video).toContain("body: response.body");
    expect(video).toContain('headers.set("x-goog-api-key", apiKey)');
    expect(video).toContain("MAX_REFERENCE_VIDEO_BYTES");
    expect(video).not.toMatch(/\?key=\$\{/);
    expect(video).not.toContain("LOVABLE_API_KEY");
  });

  it("restarts upload/poll/generation on another key while preserving one key per lifecycle", () => {
    const video = source("../../../supabase/functions/_shared/gemini-video.ts");
    expect(video).toContain("rotateGeminiKeys(");
    expect(video).toContain("prepareWithKey(options.media.source, apiKey)");
    expect(video).toContain("geminiHeaders(media.geminiApiKey");
    expect(video).toContain("replacePreparedFile(options.media, attemptMedia, !originalReleased)");
  });

  it("routes every network call through an AbortController timeout", () => {
    const video = source("../../../supabase/functions/_shared/gemini-video.ts");
    expect(video.match(/\bfetch\(/g)).toHaveLength(1);
    expect((video.match(/fetchWithTimeout\(/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(video).toContain("GEMINI_FILE_POLL_TIMEOUT");
    expect(video).toContain("GEMINI_GENERATE_TIMEOUT");
  });
});
