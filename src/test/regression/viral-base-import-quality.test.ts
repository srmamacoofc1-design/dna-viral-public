import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const importer = fs.readFileSync(
  path.resolve(__dirname, "../../../scripts/import-viral-base-live.ts"),
  "utf8",
);
const narrativeAnalyzer = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/analyze-narrative/index.ts"),
  "utf8",
);
const semanticExtractor = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/extract-block-semantics/index.ts"),
  "utf8",
);
const atomicNarrativeMigration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20260714144000_atomic_narrative_replace.sql"),
  "utf8",
);

describe("curated viral-base importer quality gate", () => {
  it("requires visual evidence for every narrative block", () => {
    expect(importer).toContain("if (visualBlockEvidence.count < blocks)");
    expect(importer).not.toContain("Math.ceil(blocks * 0.6)");
    expect(importer).toContain("TRUSTED_VISUAL_SOURCE_TYPES");
    expect(importer).toContain('"gemini_video_understanding"');
    expect(importer).toContain('"codex_manual_visual_audit"');
    expect(importer).toContain("narrativeBlockContractViolations(persistedBlocks, expectedDuration)");
  });

  it("rejects legacy over-segmented narratives", () => {
    expect(importer).toContain("if (blocks > 18)");
    expect(importer).toContain("narrative_blocks_${blocks}_above_18");
    expect(semanticExtractor).toContain("if (blocksWithText.length > 18)");
    expect(semanticExtractor).toContain("NARRATIVE_BLOCK_LIMIT_EXCEEDED");
  });

  it("gives Gemini two full narrative attempts without weakening the schema", () => {
    expect(narrativeAnalyzer).toContain("totalTimeoutMs: 140_000");
    expect(narrativeAnalyzer).toContain("attemptTimeoutMs: 65_000");
    expect(narrativeAnalyzer).not.toContain("attemptTimeoutMs: 105_000");
    expect(narrativeAnalyzer).toContain('reasoning_effort: "medium"');
    expect(narrativeAnalyzer).toContain("tool_choice:");
  });

  it("validates source duration and persists the complete narrative atomically", () => {
    const contractGate = narrativeAnalyzer.indexOf(
      "assertNarrativeBlockContract(validatedBlocks, totalDuration)",
    );
    expect(contractGate).toBeGreaterThan(-1);
    expect(narrativeAnalyzer).toContain(
      "assertTranscriptTimelineMatchesSource(transcripts, video.duracao)",
    );
    expect(narrativeAnalyzer).toContain('"replace_video_narrative_atomic"');
    expect(narrativeAnalyzer).not.toContain('.from("video_blocks").delete()');
    expect(narrativeAnalyzer).not.toContain("duracao: totalDuration");

    for (const fatalWrite of [
      'throwIfDatabaseError("replace narrative atomically", atomicNarrativeError)',
      'throwIfDatabaseError("update processing_queue", queueUpdateError)',
      'throwIfDatabaseError("delete extraction_logs", extractionDeleteError)',
      'throwIfDatabaseError("insert extraction_logs", extractionInsertError)',
      'throwIfDatabaseError("insert narrative completion log", completionLogError)',
    ]) {
      expect(narrativeAnalyzer).toContain(fatalWrite);
    }

    expect(atomicNarrativeMigration).toContain("SECURITY DEFINER");
    expect(atomicNarrativeMigration).toContain("SET search_path = pg_catalog, public");
    expect(atomicNarrativeMigration).toContain("DELETE FROM public.video_blocks");
    expect(atomicNarrativeMigration.indexOf("NARRATIVE_TIMELINE_CONTRACT_INVALID")).toBeLessThan(
      atomicNarrativeMigration.indexOf("DELETE FROM public.video_blocks"),
    );
    expect(atomicNarrativeMigration).toContain("GRANT EXECUTE ON FUNCTION public.replace_video_narrative_atomic(uuid, jsonb, jsonb) TO service_role");
  });

  it("regenerates narrative blocks when the persisted timeline is invalid", () => {
    expect(importer).toContain('reason.startsWith("narrative_timeline_")');
    expect(importer).toContain('reason.startsWith("transcript_block_")');
    expect(importer).toContain("assignExactTranscriptTextToBlocks(persistedBlocks, transcriptRows)");
    expect(importer).toContain('reasons.push("transcript_block_text_mismatch")');
    expect(importer).toContain('reasons.push("transcript_block_assignment_error")');
  });

  it("keeps every derived block layer exact", () => {
    expect(importer).toContain("if (semanticBlocks < blocks)");
    expect(importer).toContain("if (wordPatternBlocks < blocks)");
    expect(importer).toContain("if (phrasePatternBlocks < blocks)");
    expect(importer).toContain("if (verbalBlocks < blocks)");
    expect(importer).toContain("if (alignments < blocks)");
    expect(importer).toContain("if (imageCompatibility < blocks)");
  });

  it("repairs a visual-only legacy gap before spending quota on the full pipeline", () => {
    expect(importer).toContain("function isVisualOnlyAuditGap");
    expect(importer).toContain('audit.reasons.every((reason) => reason.startsWith("visual_coverage_"))');
    expect(importer).toContain("remediacao visual isolada");
    expect(importer).toContain("}, 8 * 60_000, 1)");
    expect(importer).toContain('audit.visual_source_type !== "codex_manual_visual_audit"');
    expect(importer.indexOf("remediacao visual isolada")).toBeLessThan(
      importer.indexOf("const storagePath = await uploadSource"),
    );
  });
});
