import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

describe("build-complete-generation-context authorization boundary", () => {
  const handler = source("../../../supabase/functions/build-complete-generation-context/index.ts");
  const userPage = source("../../pages/app/UserGeneratePage.tsx");
  const inputBuilder = source("../../services/generation-input.ts");

  it("requires an authenticated user or an explicit internal service caller before database reads", () => {
    const authentication = handler.indexOf("const actor = await requireUserOrService({");
    const firstDatabaseRead = handler.indexOf('.from("blueprint_contexts")');

    expect(authentication).toBeGreaterThan(-1);
    expect(firstDatabaseRead).toBeGreaterThan(authentication);
    expect(handler).toContain("serviceRoleKey: serviceKey");
    expect(handler).not.toContain("SUPABASE_ANON_KEY");
    expect(handler).not.toContain("jwtUserId");
  });

  it("derives browser ownership only from the authenticated actor and ignores public user_id", () => {
    expect(handler).toContain('if (actor.kind === "user")');
    expect(handler).toContain("requestUserId = actor.userId!");
    expect(handler).toContain("persistPayload.user_id = requestUserId");
    expect(handler).not.toContain("body?.user_id");
    expect(handler).not.toContain("body.user_id");
    expect(handler).not.toContain("jwtUserId ??");
  });

  it("makes service-role attribution explicit and rejects an absent or invalid internal owner", () => {
    const serviceBranch = handler.indexOf('if (actor.kind === "user")');
    const internalField = handler.indexOf("body?.internal_user_id", serviceBranch);
    const validation = handler.indexOf("INTERNAL_USER_ID_REQUIRED", internalField);
    const assignment = handler.indexOf("requestUserId = internalUserId", validation);

    expect(serviceBranch).toBeGreaterThan(-1);
    expect(internalField).toBeGreaterThan(serviceBranch);
    expect(validation).toBeGreaterThan(internalField);
    expect(assignment).toBeGreaterThan(validation);
  });

  it("resolves admin/service scope and applies the owner filter before loading private reference content", () => {
    const videoSection = handler.slice(
      handler.indexOf("// 3. MODE-SPECIFIC: LOAD VIDEO REFERENCE"),
      handler.indexOf("// 3b. MODE-SPECIFIC: ANALYZE ORIGINAL SCRIPT"),
    );
    const elevatedScope = videoSection.indexOf('let canReadAnyReference = actor.kind === "service"');
    const adminCheck = videoSection.indexOf('await sb.rpc("has_role"');
    const referenceQuery = videoSection.indexOf('.from("reference_videos")');
    const ownerConstraint = videoSection.indexOf('referenceQuery.eq("user_id", requestUserId)');
    const queryExecution = videoSection.indexOf("await referenceQuery.maybeSingle()");
    const ownerAssertion = videoSection.indexOf("assertResourceOwner(actor, refVid.user_id)");

    expect(elevatedScope).toBeGreaterThan(-1);
    expect(adminCheck).toBeGreaterThan(elevatedScope);
    expect(referenceQuery).toBeGreaterThan(adminCheck);
    expect(ownerConstraint).toBeGreaterThan(referenceQuery);
    expect(queryExecution).toBeGreaterThan(ownerConstraint);
    expect(ownerAssertion).toBeGreaterThan(queryExecution);
    expect(videoSection).toContain("transcription, transcription_segments, frames");
    expect(videoSection).not.toContain('.select("*")');
  });

  it("returns the same not-found response for a missing or foreign UUID before using its assets", () => {
    const ownerScopedExecution = handler.indexOf("await referenceQuery.maybeSingle()");
    const missingReference = handler.indexOf("if (!refVid)", ownerScopedExecution);
    const genericNotFound = handler.indexOf('status_reason: "Vídeo de referência não encontrado"', missingReference);
    const assetUse = handler.indexOf("referenceVideoData = refVid", missingReference);

    expect(ownerScopedExecution).toBeGreaterThan(-1);
    expect(missingReference).toBeGreaterThan(ownerScopedExecution);
    expect(genericNotFound).toBeGreaterThan(missingReference);
    expect(assetUse).toBeGreaterThan(genericNotFound);
    expect(handler.slice(missingReference, assetUse)).not.toContain("referenceVideoId");
  });

  it("does not let an internal service attribution copy another owner's private reference", () => {
    const referenceRead = handler.indexOf("await referenceQuery.maybeSingle()");
    const serviceOwnerGate = handler.indexOf('actor.kind === "service" && refVid.user_id !== requestUserId', referenceRead);
    const assetUse = handler.indexOf("referenceVideoData = refVid", serviceOwnerGate);
    expect(serviceOwnerGate).toBeGreaterThan(referenceRead);
    expect(assetUse).toBeGreaterThan(serviceOwnerGate);
  });

  it("keeps single and batch generation behind the authenticated pipeline", () => {
    const pipelineStart = userPage.indexOf("const executePipeline = async (");
    const pipelineEnd = userPage.indexOf("const handleAutoRun =", pipelineStart);
    const pipeline = userPage.slice(pipelineStart, pipelineEnd);
    const loginGate = pipeline.indexOf("if (!user) {");
    const invocation = pipeline.indexOf('supabase.functions.invoke("build-complete-generation-context"');
    const autoRun = userPage.slice(
      pipelineEnd,
      userPage.indexOf("const patchBatchItem =", pipelineEnd),
    );
    const batchStart = userPage.indexOf("const handleBatchGenerate = async () =>");
    const batchEnd = userPage.indexOf("const handleCancel =", batchStart);
    const batch = userPage.slice(batchStart, batchEnd);

    expect(pipelineStart).toBeGreaterThan(-1);
    expect(pipelineEnd).toBeGreaterThan(pipelineStart);
    expect(loginGate).toBeGreaterThan(-1);
    expect(invocation).toBeGreaterThan(loginGate);
    expect(autoRun).toContain("executePipeline(mode, inputData)");
    expect(batch).toContain("if (!user) {");
    expect(batch).toContain('executePipeline("video", candidateInput');
    expect(inputBuilder).toContain("if (userId) payload.user_id = userId");
    expect(handler).not.toContain("body?.user_id");
  });

  it("preserves authentication and authorization HTTP status codes", () => {
    expect(handler).toContain("err instanceof EdgeAuthError");
    expect(handler).toContain("error_code: err.code");
    expect(handler).toContain("err.status");
  });
});
