import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../../..", relative), "utf8");
}

const importer = read("scripts/import-codex-audited-sixteen-live.ts");
const canonicalizer = read("scripts/lib/codex-manual-audit.ts");
const merger = read("scripts/merge-codex-audit-manifest.ts");
const rpc = read("supabase/migrations/20260714150000_codex_manual_audit_transaction.sql");
const batchRpc = read("supabase/migrations/20260714154000_codex_manual_audit_batch_atomic.sql");
const curatedImporter = read("scripts/import-viral-base-live.ts");
const stylePack = read("src/lib/dna-style-pack.ts");
const narrative = read("supabase/functions/analyze-narrative/index.ts");

describe("Codex exact manual audit live importer", () => {
  it("uses only the two trusted visual sources with source-matched metadata", () => {
    expect(curatedImporter).toContain('"gemini_video_understanding"');
    expect(curatedImporter).toContain('"codex_manual_visual_audit"');
    expect(curatedImporter).toContain('"multimodal_visual_analysis", "codex_manual_visual_analysis"');
    expect(curatedImporter).toContain('audit.visual_source_type !== "codex_manual_visual_audit"');
    expect(importer).not.toMatch(/invokeFunction[\s\S]{0,200}extract-visual-blocks/);
    expect(importer).not.toMatch(/geminiOpenAIChat|GEMINI_API_KEYS|generateContent/);
    expect(rpc).toContain("'codex_manual_visual_analysis'");
    expect(rpc).toContain("chave IN ('multimodal_visual_analysis','codex_manual_visual_analysis')");
  });

  it("materializes every local frame as a verified public URL before any RPC", () => {
    expect(importer).toContain("allLocalFrames.length !== 496");
    expect(importer).toContain('client.storage.from("videos")');
    expect(importer).toContain("codex-manual");
    expect(importer).toContain("download(objectPath)");
    expect(importer).toContain("post-upload download failed");
    expect(importer).toContain("materializeCodexAuditVideoFrames");
    expect(importer.indexOf("materializeCodexAuditVideoFrames(")).toBeLessThan(
      importer.indexOf('client.rpc("commit_codex_manual_audited_batch"'),
    );
    expect(canonicalizer).toContain("source_local_path");
    expect(canonicalizer).toContain("representative_source_local_path");
    expect(canonicalizer).toContain("post-upload SHA-256 mismatch");
    expect(canonicalizer).toContain('parsed.hostname !== EXACT_PUBLIC_STORAGE_HOST');
    expect(canonicalizer).toContain('parsed.pathname !== expectedPath');
    expect(canonicalizer).toContain("canonicalCodexVideoPayloadHash(video)");
    expect(rpc).toContain("/storage/v1/object/public/videos/frames/codex-manual/");
  });

  it("binds hook strategy and granular words/phrases only to spoken block text", () => {
    const videoSelect = stylePack.match(/\.from\("videos"\)[\s\S]*?\.select\("([^"]+)"\)/)?.[1] || "";
    expect(videoSelect).not.toMatch(/\btitulo\b|\btitle\b/);
    expect(stylePack).toContain('const hookBlock = ordered.find(b => b.tipo_bloco === "hook");');
    expect(stylePack).not.toContain('ordered.find(b => b.tipo_bloco === "hook") || ordered[0]');
    expect(narrative).toContain("assignExactTranscriptTextToBlocks(providerBlocks, transcripts)");
    expect(narrative).toContain("NARRATIVE_HOOK_TRANSCRIPT_TEXT_MISSING");
    expect(narrative).not.toContain("let hookText = flat.hook_text");
    expect(rpc).toContain("INSERT INTO public.block_word_patterns");
    expect(rpc).toContain("INSERT INTO public.block_phrase_patterns");
    expect(rpc).toContain("CODEX_MANUAL_GRANULAR_SPEECH_PATTERN_COVERAGE_INVALID");
    expect(rpc).toContain("CODEX_MANUAL_BLOCK_TEXT_NOT_EXACT_TRANSCRIPT");
    expect(rpc).toContain("CODEX_MANUAL_KEYWORD_NOT_IN_SPOKEN_BLOCK");
    expect(rpc).toContain("CODEX_MANUAL_STRONG_PHRASE_NOT_IN_SPOKEN_BLOCK");
    expect(curatedImporter).toContain('.select("block_id,word")');
    expect(curatedImporter).toContain('.select("block_id,phrase")');
    expect(curatedImporter).toContain("isContiguousSpokenSubstring(row.word, exactText)");
    expect(curatedImporter).toContain("isContiguousSpokenSubstring(row.phrase, exactText)");
    expect(curatedImporter).toContain("word_pattern_not_contiguous_spoken_block_text");
    expect(curatedImporter).toContain("phrase_pattern_not_contiguous_spoken_block_text");
  });

  it("is service-role-only, atomic, replay-reconstructing and invalidates stale Gemini claims first", () => {
    expect(rpc).toContain("SECURITY DEFINER");
    expect(rpc).toContain("SET search_path = pg_catalog, public");
    expect(rpc).toContain("SERVICE_ROLE_REQUIRED");
    expect(rpc).toContain("REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) FROM PUBLIC");
    expect(rpc).toContain("REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) FROM anon");
    expect(rpc).toContain("REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) FROM authenticated");
    expect(rpc).toContain("GRANT EXECUTE ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) TO service_role");
    const claimDelete = rpc.indexOf("chave = 'multimodal_processing_claim'");
    const blockDelete = rpc.indexOf("DELETE FROM public.video_blocks");
    expect(claimDelete).toBeGreaterThan(-1);
    expect(blockDelete).toBeGreaterThan(claimDelete);
    expect(rpc).not.toContain("IF NOT _already_committed THEN");
    expect(rpc).toContain("Replay always reconstructs every row");
    expect(importer).toContain('client.rpc("commit_codex_manual_audited_batch"');
    expect(importer).toContain("cleanupCreatedObjects");
    expect(importer).toContain("createdObjectPath");
    expect(batchRpc).toContain("SECURITY DEFINER");
    expect(batchRpc).toContain("CODEX_MANUAL_BATCH_INVENTORY_MISMATCH");
    expect(batchRpc).toContain("public.commit_codex_manual_audited_video(");
    expect(batchRpc).toContain("GRANT EXECUTE ON FUNCTION public.commit_codex_manual_audited_batch(jsonb, text) TO service_role");
  });

  it("requires explicit evidence scope and never manufactures perfect compatibility", () => {
    expect(canonicalizer).toContain('"visual_confirmed", "mixed", "narration_only"');
    expect(canonicalizer).toContain("compatibility: 28");
    expect(canonicalizer).not.toContain("compatibility_score: 100");
    expect(canonicalizer).toContain("text_requires_visual_boost: needsVisualBoost");
    expect(rpc).toContain("value ->> 'evidence_scope' = 'narration_only'");
    expect(rpc).toContain("compatibility,compatibility_score");
  });

  it("merges exact disjoint source partitions using temp plus atomic rename", () => {
    expect(merger).toContain("expectedByInput");
    expect(merger).toContain("if (byId.has(video.youtube_id))");
    expect(merger).toContain("flag: \"wx\"");
    expect(merger).toContain("await rename(temporary, output)");
  });
});
