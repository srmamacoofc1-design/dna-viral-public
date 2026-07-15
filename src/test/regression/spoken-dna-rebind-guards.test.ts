import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/20260714153000_spoken_dna_rebind_atomic.sql"),
  "utf8",
);
const runner = readFileSync(path.join(root, "scripts/rebind-viral-spoken-dna-live.ts"), "utf8");
const importer = readFileSync(path.join(root, "scripts/import-viral-base-live.ts"), "utf8");

describe("spoken DNA live repair guards", () => {
  it("keeps the batch service-role-only, exact-16, two-phase and all-or-nothing", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.rebind_viral_spoken_dna_atomic");
    expect(migration).toContain("jsonb_array_length(_payloads) <> 16");
    expect(migration).toContain("SPOKEN_DNA_BATCH_INVENTORY_MISMATCH");
    expect(migration).toContain("SPOKEN_DNA_ALREADY_VALID");
    expect(migration).toContain("SPOKEN_DNA_REBIND_MANUAL_EVIDENCE_FORBIDDEN");
    expect(migration).toContain("Phase 1 locks and validates the complete batch");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.rebind_viral_spoken_dna_atomic");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.rebind_viral_spoken_dna_atomic(jsonb, text, text) TO service_role");
  });

  it("copies visual evidence from current Gemini rows and never accepts visual prose in the payload", () => {
    expect(migration).toContain("FROM public.visual_block_analysis AS visual");
    expect(migration).toContain("visual.data_source_type = 'gemini_video_understanding'");
    expect(migration).toContain("_visual ->> 'representative_frame_path'");
    expect(migration).toContain("_visual ->> 'scene_description'");
    expect(migration).not.toContain("_block #>> '{visual,");
  });

  it("requires an atomic, hashed, complete pre-state snapshot before apply", () => {
    expect(runner).toContain("pre-spoken-rebind-snapshot.json");
    expect(runner).toContain("assertSnapshotComplete(stored)");
    expect(runner).toContain("current.state_sha256 !== stored.state_sha256");
    expect(runner).toContain("database_writes: 0");
    for (const table of [
      "video_transcripts", "video_blocks", "visual_block_analysis", "block_semantic_patterns",
      "block_word_patterns", "block_phrase_patterns", "block_verbal_analysis",
      "text_visual_alignment", "text_image_compatibility", "video_frames",
    ]) expect(runner).toContain(`\"${table}\"`);
  });

  it("blocks preset publication on content-invalid spoken patterns and the nominal 50/50 audit", () => {
    expect(importer).toContain("word_pattern_not_contiguous_spoken_block_text");
    expect(importer).toContain("phrase_pattern_not_contiguous_spoken_block_text");
    const nominal = importer.indexOf("await requireNominalSpokenDnaAudit(urlFile, reportDir)");
    const preset = importer.indexOf("await createSharedPreset(client, videoIds");
    expect(nominal).toBeGreaterThan(0);
    expect(preset).toBeGreaterThan(nominal);
  });
});
