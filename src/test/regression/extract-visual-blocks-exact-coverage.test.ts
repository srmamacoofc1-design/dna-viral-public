import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/extract-visual-blocks/index.ts"),
  "utf8",
);

describe("extract-visual-blocks exact Gemini coverage contract", () => {
  it("assesses persisted Gemini evidence before replacing derived rows", () => {
    const assessment = source.indexOf("assessAndAssignPersistedGeminiMoments(");
    const rejection = source.indexOf("if (!assessment.passed)");
    const persistence = source.indexOf('.from("visual_block_analysis")\n        .insert(visualRecords)');
    expect(assessment).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(assessment);
    expect(persistence).toBeGreaterThan(rejection);
    expect(source).toContain("EXACT_GEMINI_VISUAL_BLOCK_COVERAGE_REQUIRED");
  });

  it("persists one raw Gemini-derived record for every block and verifies exact IDs", () => {
    expect(source).toContain('data_source_type: "gemini_video_understanding"');
    expect(source).toContain('origin_level: "raw"');
    expect(source).toContain("insertedRows?.length !== blocks.length");
    expect(source).toContain("exact_block_coverage: true");
    expect(source).toContain("observed_blocks: visualRecords.length");
  });

  it("does not fall back to frame detectors, block prose, or calculated observations", () => {
    expect(source).not.toContain("blockFrames");
    expect(source).not.toContain("visual_detection");
    expect(source).not.toContain("block.descricao_visual");
    expect(source).not.toContain('data_source_type: "calculated"');
    expect(source).toContain("representative_timestamp: representative.timestamp_seconds");
  });
});
