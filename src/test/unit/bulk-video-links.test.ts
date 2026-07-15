import { describe, expect, it } from "vitest";
import {
  canonicalizeVideoSource,
  parseBulkVideoLinks,
  parseVideoSource,
} from "../../../supabase/functions/_shared/ingestion";

describe("bulk video link parsing", () => {
  it("parses one URL per non-empty line and returns canonical URLs", () => {
    const result = parseBulkVideoLinks(`
      https://youtu.be/vjqsNKq05iE?t=10

      https://www.youtube.com/shorts/adcOHqnTEZY
      https://cdn.example/video.mp4?b=2&a=1#frame
    `);

    expect(result.inputCount).toBe(3);
    expect(result.rejected).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.accepted.map((item) => item.line)).toEqual([2, 4, 5]);
    expect(result.accepted.map((item) => item.canonicalUrl)).toEqual([
      "https://www.youtube.com/watch?v=vjqsNKq05iE",
      "https://www.youtube.com/watch?v=adcOHqnTEZY",
      "https://cdn.example/video.mp4?a=1&b=2",
    ]);
    expect(result.accepted[2].source.url).toBe(
      "https://cdn.example/video.mp4?b=2&a=1",
    );
  });

  it("deduplicates YouTube watch, Shorts and share URLs by video ID", () => {
    const result = parseBulkVideoLinks([
      "https://youtu.be/vjqsNKq05iE?t=2",
      "https://youtube.com/watch?v=vjqsNKq05iE&list=PL123",
      "https://www.youtube.com/shorts/vjqsNKq05iE",
    ].join("\n"));

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].idempotencyKey).toBe("youtube:vjqsNKq05iE");
    expect(result.duplicates).toEqual([
      expect.objectContaining({ line: 2, code: "DUPLICATE_VIDEO_LINK", duplicateOfLine: 1 }),
      expect.objectContaining({ line: 3, code: "DUPLICATE_VIDEO_LINK", duplicateOfLine: 1 }),
    ]);
  });

  it("keeps valid videos when other lines are invalid or collections", () => {
    const result = parseBulkVideoLinks([
      "https://www.youtube.com/shorts/FaZGE4SyeUc",
      "isto não é uma URL",
      "https://www.youtube.com/@Benji_Curioso",
      "https://www.youtube.com/playlist?list=PL123",
      "http://127.0.0.1/video.mp4",
      "https://cdn.example/valid.mp4",
    ].join("\n"));

    expect(result.accepted).toHaveLength(2);
    expect(result.accepted.map((item) => item.line)).toEqual([1, 6]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ line: 2, code: "INVALID_URL" }),
      expect.objectContaining({ line: 3, code: "YOUTUBE_COLLECTION_NOT_A_VIDEO" }),
      expect.objectContaining({ line: 4, code: "YOUTUBE_COLLECTION_NOT_A_VIDEO" }),
      expect.objectContaining({ line: 5, code: "PRIVATE_URL_NOT_ALLOWED" }),
    ]);
  });

  it("accepts a large pasted list without an artificial user-facing limit", () => {
    const count = 80;
    const input = Array.from(
      { length: count },
      (_, index) => `https://cdn.example/video-${index + 1}.mp4`,
    ).join("\n");

    const result = parseBulkVideoLinks(input);

    expect(result.inputCount).toBe(count);
    expect(result.accepted).toHaveLength(count);
    expect(result.rejected).toEqual([]);
  });

  it("supports a smaller caller-defined batch limit", () => {
    const result = parseBulkVideoLinks([
      "https://cdn.example/one.mp4",
      "https://cdn.example/two.mp4",
      "https://cdn.example/three.mp4",
    ].join("\n"), 2);

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected[0]).toEqual(expect.objectContaining({
      line: 3,
      code: "BULK_LINK_LIMIT_EXCEEDED",
    }));
  });
});

describe("video source canonicalization", () => {
  it("creates a stable key URL without changing the separately preserved download URL", () => {
    const source = parseVideoSource("https://CDN.example:443/video.mp4?signature=z&expires=10#ignored");
    expect(canonicalizeVideoSource(source)).toBe(
      "https://cdn.example/video.mp4?expires=10&signature=z",
    );
  });
});
