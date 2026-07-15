import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const processor = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/process-reference-video/index.ts"),
  "utf8",
);

describe("process-reference-video resumable two-phase analysis", () => {
  it("separates transcription and pixel analysis into independent Gemini generations", () => {
    expect(processor.match(/await generateVideoJson</g) ?? []).toHaveLength(2);

    const audioStart = processor.indexOf("await generateVideoJson<TranscriptionResult>");
    const visualStart = processor.indexOf("await generateVideoJson<VisualResult>");
    expect(audioStart).toBeGreaterThanOrEqual(0);
    expect(visualStart).toBeGreaterThan(audioStart);

    const audioGeneration = processor.slice(audioStart, visualStart);
    const visualGeneration = processor.slice(visualStart);

    expect(audioGeneration).toContain("jsonSchema: transcriptionSchema");
    expect(audioGeneration).toContain('toolName: "save_reference_transcription"');
    expect(audioGeneration).toContain("return only audio evidence");
    expect(audioGeneration).toContain("Song lyrics, singing and vocalized music are not spoken narration");
    expect(audioGeneration).toContain("return an empty segments array");
    expect(audioGeneration).not.toContain("jsonSchema: visualSchema");

    expect(visualGeneration).toContain("jsonSchema: visualSchema");
    expect(visualGeneration).toContain('toolName: "save_reference_visual_analysis"');
    expect(visualGeneration).toContain("ACTUAL PIXELS");
    expect(visualGeneration).toContain("Ignore narration as proof");

    expect(processor).not.toContain("ReferenceAnalysisResult");
    expect(processor).not.toContain("referenceAnalysisSchema");
    expect(processor).not.toContain('toolName: "save_reference_analysis"');
  });

  it("persists an audio checkpoint and returns 202 before starting visual analysis", () => {
    expect(processor).toContain('const AUDIO_PROCESSING_STATUS = "processing_audio"');
    expect(processor).toContain('const AUDIO_READY_STATUS = "awaiting_visual"');
    expect(processor).toContain('const VISUAL_PROCESSING_STATUS = "processing_visual"');
    expect(processor).toContain('const VISUAL_READY_STATUS = "ready"');
    expect(processor).toContain("status: AUDIO_PROCESSING_STATUS");
    expect(processor).toContain("status: AUDIO_READY_STATUS");
    expect(processor).toContain('next_phase: "visual"');
    expect(processor).toMatch(/status:\s*AUDIO_READY_STATUS,[\s\S]{0,500}?\},\s*202,\s*corsHeaders\)/);
  });

  it("resumes the visual phase from the durable transcript and only then marks ready", () => {
    expect(processor).toContain("transcription_segments, frames, duration_seconds, updated_at");
    expect(processor).toContain('.eq("status", VISUAL_PROCESSING_STATUS)');
    expect(processor).toContain("status: VISUAL_READY_STATUS");
    expect(processor).toContain("status, transcription, transcription_segments, frames");
    expect(processor).toContain("sanitizeFrames(visualResult.frames, sourceDuration)");
    expect(processor).toContain("frames,");
    expect(processor).toContain('.from("reference_video_frames").insert');
  });

  it("requires structured metadata from new model output while keeping the sanitizer legacy-compatible", () => {
    const visualSchemaStart = processor.indexOf("const visualSchema =");
    const sanitizerStart = processor.indexOf("function sanitizeSegments", visualSchemaStart);
    const visualSchemaSource = processor.slice(visualSchemaStart, sanitizerStart);
    const frameRequired = visualSchemaSource.match(/required:\s*\[([\s\S]*?)\]/)?.[1] || "";

    expect(visualSchemaSource).toContain('enum: ["reactor", "embedded", "unknown"]');
    expect(visualSchemaSource).toContain("subject_role:");
    expect(visualSchemaSource).toContain("layer:");
    expect(visualSchemaSource).toContain("region:");
    expect(visualSchemaSource).toContain("subject_id:");
    expect(frameRequired).toContain("subject_role");
    expect(frameRequired).toContain("layer");
    expect(frameRequired).toContain("region");
    expect(frameRequired).toContain("subject_id");
    expect(processor).toContain("sanitizeVisualSubjectRole(value?.subject_role)");
    expect(processor).toContain("sanitizeVisualSubjectRole(value?.layer)");
    expect(processor).toContain("uniqueReferenceVisualTimestamps(reusableFrames)");
    expect(processor).toContain("const coverageFrames = uniqueReferenceVisualTimestamps(frames)");
    expect(processor).toContain("assessVisualTimelineCoverage(coverageFrames, duration");
    expect(processor).toContain("sanitizeOpaqueFrameToken(value?.region, 80)");
    expect(processor).toContain("neutralSubjectId(value?.subject_id, effectiveRole)");
    expect(processor).toContain("UNSUPPORTED_VISUAL_JUDGMENT_MODIFIER");
    expect(processor).toContain("lazy|laziness|loafing|shameless");
    expect(processor).toContain("pregui[cç]a");
    expect(processor).toContain("cara\\s+de\\s+pau");
    expect(processor).toContain("offers?\\s+help");
    expect(processor).toContain("defiant(?:ly)?");
    expect(processor).toContain("removeUnsupportedInferenceClauses(String(value ?? \"\"))");
    expect(processor).toContain("neutralizeUnsupportedRelationshipLabels");
    expect(processor).toContain("their baby|their child|bebe deles|filh[oa] deles");
    expect(processor).toContain("raising\\s+(?:the\\s+)?(?:baby|child)");
    expect(processor).toContain("sanitizeLayerScopedDescription(value?.description, region, 1200)");
    expect(processor).toContain('effectiveRole === "reactor" ? ""');
    expect(processor).toContain('const prefix = role === "embedded" ? "embedded_subject"');
    expect(processor).toContain("subject_role and layer must match");
    expect(processor).toContain("Use unknown instead of guessing");
    expect(processor).toContain("help intent");
    expect(processor).toContain("offering help from an extended hand");
    expect(processor).toContain("defiant/challenging");
  });

  it("leases active phase claims and allows awaiting_visual to advance immediately", () => {
    expect(processor).toContain("ACTIVE_PHASE_LEASE_MS");
    expect(processor).toContain("ACTIVE_PROCESSING_STATUSES");
    expect(processor).toContain("AUDIO_READY_STATUS");
    expect(processor).toContain('let activePhase: "audio" | "visual" | null');
    expect(processor).toContain("activePhase = !force");
    expect(processor).toContain('activePhase === "audio"');
    expect(processor).toContain('? "visual"');
  });

  it("fails closed unless the visual timeline is dense and covers opening through payoff", () => {
    const coverageCheck = processor.indexOf("if (!visualCoverage.passed)");
    const readyUpdate = processor.indexOf("status: VISUAL_READY_STATUS", coverageCheck);

    expect(coverageCheck).toBeGreaterThanOrEqual(0);
    expect(readyUpdate).toBeGreaterThan(coverageCheck);
    expect(processor).toContain("assessVisualTimelineCoverage(coverageFrames, duration");
    expect(processor).toContain("REFERENCE_VISUAL_MAX_MOMENTS = 30");
    expect(processor).toContain("secondsPerMoment: 3");
    expect(processor).toContain("at or after 90% of the real duration");
    expect(processor).toContain("at least two distinct visual moments inside the first 5 seconds");
    expect(processor).toContain("emit at most two separate rows at that same timestamp");
    expect(processor).toContain("ALWAYS emit a separate reactor baseline row inside 0-5 seconds");
    expect(processor).toContain("description and main_action may state only a visibly observable actor");
    expect(processor).toContain("Never infer relationships, parenthood, help intent, motive, morality, judgment, symbolism");
    expect(processor).toContain("limitReferenceVisualTimelineByTimestamp");
    expect(processor).toContain("assessReferenceVisualEvidenceContract");
    expect(processor).toContain("Never stop early");
  });

  it("keeps transcript/frame persistence and invalidates topics only after final success", () => {
    expect(processor).toContain("sanitizeSegments(transcriptionResult.segments)");
    expect(processor).toContain("reconcileTranscriptLanguage(");
    expect(processor).toContain("transcriptionResult.language");
    expect(processor).toContain("const language = languageDecision.language");
    expect(processor).toContain("transcription_segments: segments");
    expect(processor).toContain("detected_language: language");
    expect(processor).toContain('.from("reference_video_transcripts").upsert');
    expect(processor).toMatch(/\.from\("reference_video_frames"\)\s*\.delete\(\)/);
    expect(processor).toContain('.from("reference_video_frames").insert');

    const visualGeneration = processor.indexOf("await generateVideoJson<VisualResult>");
    const readyUpdate = processor.indexOf("status: VISUAL_READY_STATUS", visualGeneration);
    const staleTopics = processor.indexOf('.from("reference_video_topics")', readyUpdate);
    expect(readyUpdate).toBeGreaterThanOrEqual(0);
    expect(staleTopics).toBeGreaterThan(readyUpdate);
  });

  it("revalidates a persisted ready reference before reusing it", () => {
    expect(processor).toContain("frames, duration_seconds, updated_at");
    expect(processor).toContain("const reusableCoverageFrames = uniqueReferenceVisualTimestamps(reusableFrames)");
    expect(processor).toContain("enforceObservableLanguage: true");
    expect(processor).toContain("const reusableCoverage = assessVisualTimelineCoverage(");
    expect(processor).toContain("const reusableLayerContract = assessReferenceVisualEvidenceContract");
    expect(processor).toContain("if (reusableCoverage.passed && reusableLayerContract.passed)");
    expect(processor).not.toContain("reusableSegments.length > 0 && reusableCoverage.passed");
    expect(processor).toContain("legacy `ready` flag is not evidence");
  });
});
