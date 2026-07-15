import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/transcribe-video/index.ts"),
  "utf8",
);

describe("transcribe-video complete visual coverage", () => {
  it("uses the shared fail-closed coverage contract before commit", () => {
    const assessment = source.indexOf("assessVisualTimelineCoverage(visualMoments, duration");
    const rejection = source.indexOf("if (!visualCoverage.passed)");
    const commit = source.indexOf('supabase.rpc("commit_video_multimodal_analysis"');
    expect(assessment).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(assessment);
    expect(commit).toBeGreaterThan(rejection);
    expect(source).toContain("LIBRARY_VISUAL_MAX_MOMENTS = 40");
    expect(source).toContain("secondsPerMoment: 3");
  });

  it("does not reuse an old timeline unless its opening, density and ending pass", () => {
    expect(source).toContain("const existingCoverage");
    expect(source).toContain("if (existingCoverage?.passed)");
    expect(source).not.toContain("Array.isArray(existing) && existing.length >= 3");
  });

  it("explicitly tells the multimodal model to reach the real end", () => {
    expect(source).toContain("at or after 90% of the real duration");
    expect(source).toContain("never stop early");
    expect(source).toContain("maximum 40");
    expect(source).toContain("at least two distinct visual moments inside the first 5 seconds");
  });
});
