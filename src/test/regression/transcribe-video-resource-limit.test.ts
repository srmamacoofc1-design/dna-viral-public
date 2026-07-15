import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const edgeFunction = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/transcribe-video/index.ts"),
  "utf8",
);
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20260713230000_atomic_multimodal_analysis.sql"),
  "utf8",
);

describe("transcribe-video resource-limit hardening", () => {
  it("extracts audio and visual evidence in exactly one Gemini generation", () => {
    expect(edgeFunction.match(/await generateVideoJson</g) ?? []).toHaveLength(1);
    expect(edgeFunction).toContain("generateVideoJson<MultimodalAnalysisResult>");
    expect(edgeFunction).toContain("jsonSchema: multimodalAnalysisSchema");
    expect(edgeFunction).toContain('toolName: "save_multimodal_analysis"');
    expect(edgeFunction).toContain('required: ["language", "duration_seconds", "segments", "moments"]');
    expect(edgeFunction).toContain("ai_calls: 1");
    expect(edgeFunction).not.toContain("CHUNK_DURATION_SECONDS");
    expect(edgeFunction).not.toContain("CHUNK_OVERLAP_SECONDS");
    expect(edgeFunction).not.toContain("transcribeMedia");
    expect(edgeFunction).not.toContain('toolName: "save_transcription"');
    expect(edgeFunction).not.toContain('toolName: "save_visual_analysis"');
  });

  it("rejects unreasonable durations before uploading and claims before preparing media", () => {
    expect(edgeFunction).toContain("MAX_MULTIMODAL_DURATION_SECONDS = 60 * 60");
    expect(edgeFunction).toContain("parseExpectedDuration(body?.video_duration)");
    expect(edgeFunction).toContain('"INVALID_VIDEO_DURATION"');
    expect(edgeFunction).toContain('"MULTIMODAL_ALREADY_PROCESSING"');

    const durationValidation = edgeFunction.indexOf("parseExpectedDuration(body?.video_duration)");
    const claim = edgeFunction.indexOf('supabase.rpc("claim_video_multimodal_analysis"');
    const mediaPreparation = edgeFunction.indexOf("await prepareVideoMedia({");
    expect(durationValidation).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(durationValidation);
    expect(mediaPreparation).toBeGreaterThan(claim);
  });

  it("prepares all replacement rows before one atomic commit RPC", () => {
    const transcripts = edgeFunction.indexOf("const transcriptRows = segments.map");
    const frames = edgeFunction.indexOf("const frameRows = await Promise.all");
    const commit = edgeFunction.indexOf('supabase.rpc("commit_video_multimodal_analysis"');
    expect(transcripts).toBeGreaterThan(-1);
    expect(frames).toBeGreaterThan(transcripts);
    expect(commit).toBeGreaterThan(frames);
    expect(edgeFunction).not.toMatch(/\.from\("video_transcripts"\)\s*\.delete\(/);
    expect(edgeFunction).not.toMatch(/\.from\("video_frames"\)\s*\.delete\(/);
  });

  it("uses a leased database claim and transaction-scoped replacement", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.claim_video_multimodal_analysis");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.release_video_multimodal_analysis_claim");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.commit_video_multimodal_analysis");
    expect(migration).toContain("ON CONFLICT (video_id, chave) DO UPDATE");
    expect(migration).toContain("clock_timestamp() - make_interval(secs => _bounded_lease)");
    expect(migration).toContain("AND valor = _claim_token::text");
    expect(migration).toContain("jsonb_typeof(_transcripts) <> 'array'");
    expect(migration).toContain("jsonb_typeof(_frames) <> 'array'");

    const validation = migration.indexOf("MULTIMODAL_FRAME_RECORD_INVALID");
    const transcriptDelete = migration.indexOf("DELETE FROM public.video_transcripts");
    const frameDelete = migration.indexOf("DELETE FROM public.video_frames");
    expect(transcriptDelete).toBeGreaterThan(validation);
    expect(frameDelete).toBeGreaterThan(transcriptDelete);
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration.match(/ TO service_role;/g) ?? []).toHaveLength(3);
  });
});
