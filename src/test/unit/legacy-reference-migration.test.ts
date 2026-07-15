import { describe, expect, it } from "vitest";
import {
  clampLegacyMigrationBatchLimit,
  isExclusiveLegacyReferencePath,
  legacyReferenceDestinationPath,
  legacySourceRemovalDecision,
  normalizeLegacyReferencePath,
  verifyLegacyReferenceCopy,
} from "../../../supabase/functions/_shared/legacy-reference-migration";

const referenceVideoId = "11111111-1111-4111-8111-111111111111";
const ownerUserId = "22222222-2222-4222-8222-222222222222";

describe("legacy reference storage migration helpers", () => {
  it("builds a deterministic private destination scoped to the owner", () => {
    expect(legacyReferenceDestinationPath({
      referenceVideoId,
      ownerUserId,
      sourcePath: `reference/${ownerUserId}/old-video.webm`,
    })).toBe(`reference/${ownerUserId}/legacy/${referenceVideoId}.webm`);
  });

  it("quarantines ownerless rows instead of exposing them to another user", () => {
    expect(legacyReferenceDestinationPath({
      referenceVideoId,
      ownerUserId: null,
      sourcePath: "reference/old-owner/video.mp4",
    })).toBe(`reference/unowned/legacy/${referenceVideoId}.mp4`);
  });

  it("rejects traversal and malformed storage paths", () => {
    expect(() => normalizeLegacyReferencePath("reference/user/../secret.mp4")).toThrow(/inválido/i);
    expect(() => normalizeLegacyReferencePath("https://example.com/video.mp4")).toThrow(/inválido/i);
  });

  it("verifies a copy by exact non-zero byte size", () => {
    expect(verifyLegacyReferenceCopy({
      sourceInfo: { size: 123_456 },
      destinationInfo: { metadata: { size: 123_456 } },
    })).toEqual({ sourceSize: 123_456, destinationSize: 123_456, verifiedBy: "exact_size" });
    expect(() => verifyLegacyReferenceCopy({
      sourceInfo: { size: 123_456 },
      destinationInfo: { size: 123_455 },
    })).toThrow(/tamanho exato/i);
  });

  it("uses a previously verified source size when a retry happens after deletion", () => {
    expect(verifyLegacyReferenceCopy({
      sourceInfo: null,
      destinationInfo: { size: 777 },
      previouslyVerifiedSourceSize: 777,
    }).destinationSize).toBe(777);
  });

  it("only auto-removes an exclusive reference namespace with no remaining consumers", () => {
    const sourcePath = `reference/${ownerUserId}/legacy-upload.mp4`;
    expect(isExclusiveLegacyReferencePath(sourcePath, ownerUserId)).toBe(true);
    expect(legacySourceRemovalDecision({
      sourcePath,
      ownerUserId,
      remainingLegacyReferences: 0,
      libraryReferences: 0,
    })).toMatchObject({ remove: true, reason: "exclusive_legacy_reference_namespace" });

    expect(legacySourceRemovalDecision({
      sourcePath,
      ownerUserId,
      remainingLegacyReferences: 1,
      libraryReferences: 0,
    })).toMatchObject({ remove: false, reason: "shared_by_other_legacy_reference_rows" });

    expect(legacySourceRemovalDecision({
      sourcePath,
      ownerUserId,
      remainingLegacyReferences: 0,
      libraryReferences: 1,
    })).toMatchObject({ remove: false, reason: "referenced_by_viral_library" });
  });

  it("requires explicit admin review before deleting an unscoped source", () => {
    expect(legacySourceRemovalDecision({
      sourcePath: "old-uploads/reference-video.mp4",
      ownerUserId,
      remainingLegacyReferences: 0,
      libraryReferences: 0,
    })).toMatchObject({ remove: false, reason: "unscoped_source_requires_explicit_admin_review" });
    expect(legacySourceRemovalDecision({
      sourcePath: "old-uploads/reference-video.mp4",
      ownerUserId,
      remainingLegacyReferences: 0,
      libraryReferences: 0,
      forceUnscopedDelete: true,
    })).toMatchObject({ remove: true, reason: "explicit_admin_cleanup_after_reference_checks" });
  });

  it("caps each invocation while allowing the queue itself to remain unlimited", () => {
    expect(clampLegacyMigrationBatchLimit(undefined)).toBe(10);
    expect(clampLegacyMigrationBatchLimit(0)).toBe(1);
    expect(clampLegacyMigrationBatchLimit(500)).toBe(50);
  });
});
