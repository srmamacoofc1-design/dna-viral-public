import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

describe("process-reference-video authorization boundary", () => {
  const processor = source("../../../supabase/functions/process-reference-video/index.ts");
  const edgeAuth = source("../../../supabase/functions/_shared/edge-auth.ts");

  it("authenticates every POST and supports only owner, admin, or service access", () => {
    expect(processor).toContain("requireUserOrService({ req, supabaseUrl, serviceRoleKey })");
    expect(processor).toContain("requireResourceOwnerAdminOrService({");
    expect(edgeAuth).toContain('if (options.actor.kind === "service") return');
    expect(edgeAuth).toContain("options.ownerId === options.actor.userId");
    expect(edgeAuth).toContain('admin.rpc("has_role"');
    expect(edgeAuth).toContain('_role: "admin"');
    expect(edgeAuth).toContain('throw new EdgeAuthError("RESOURCE_FORBIDDEN"');
  });

  it("does not promote a caller-supplied ID to mutable state before authorization", () => {
    const load = processor.indexOf('.eq("id", requestedReferenceVideoId)');
    const authorize = processor.indexOf("await requireResourceOwnerAdminOrService({", load);
    const mutableId = processor.indexOf("referenceVideoId = existing.id", load);
    const mutableOwner = processor.indexOf("authorizedReference = { id: existing.id, ownerId }", load);

    expect(load).toBeGreaterThanOrEqual(0);
    expect(authorize).toBeGreaterThan(load);
    expect(mutableId).toBeGreaterThan(authorize);
    expect(mutableOwner).toBeGreaterThan(authorize);
    expect(processor).not.toContain("referenceVideoId = typeof body?.reference_video_id");
  });

  it("never mutates a foreign row from the catch path", () => {
    const catchBlock = processor.slice(processor.indexOf("} catch (error) {"), processor.indexOf("} finally {"));

    expect(catchBlock).toContain("if (authorizedReference)");
    expect(catchBlock).toContain('.eq("id", authorizedReference.id)');
    expect(catchBlock).toContain('.eq("user_id", authorizedReference.ownerId)');
    expect(catchBlock).not.toContain('.eq("id", referenceVideoId)');
    expect(catchBlock).not.toContain("requestedReferenceVideoId");
  });

  it("also scopes the processing claim and final success update by immutable ownership", () => {
    const claim = processor.slice(
      processor.indexOf('let claimQuery = supabase.from("reference_videos").update'),
      processor.indexOf("// Compare-and-set prevents"),
    );
    const audioCheckpoint = processor.slice(
      processor.indexOf("const { data: audioCompletedReference"),
      processor.indexOf("if (audioUpdateError"),
    );
    const visualCompleted = processor.slice(
      processor.indexOf("const { data: completedReference"),
      processor.indexOf("if (updateError"),
    );

    for (const mutation of [claim, audioCheckpoint, visualCompleted]) {
      expect(mutation).toContain('.eq("id", authorizedReference.id)');
      expect(mutation).toContain('.eq("user_id", authorizedReference.ownerId)');
    }
    expect(audioCheckpoint).toContain('.eq("status", AUDIO_PROCESSING_STATUS)');
    expect(visualCompleted).toContain('.eq("status", VISUAL_PROCESSING_STATUS)');
  });

  it("requires service calls that create work to reference an existing durable row", () => {
    expect(processor).toContain('actor.kind !== "user" || !actor.userId');
    expect(processor).toContain('"REFERENCE_VIDEO_ID_REQUIRED"');
  });
});
