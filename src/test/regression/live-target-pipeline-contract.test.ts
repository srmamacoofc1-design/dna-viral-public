import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = fs.readFileSync(
  path.resolve(__dirname, "../../../scripts/test-viral-preset-on-video-live.ts"),
  "utf8",
);

describe("teste ao vivo do preset no vídeo operacional", () => {
  it("seleciona unicamente o preset compartilhado esperado e exige os 50 vídeos", () => {
    expect(script).toContain('const DEFAULT_PRESET_NAME = "Base Viral — 50 Shorts Fornecidos (Jul 2026)"');
    expect(script).toContain(".is(\"created_by\", null)");
    expect(script).toContain("EXPECTED_DEFAULT_PRESET_VIDEO_COUNT = 50");
    expect(script).toContain("assertPresetConsistency(preset, stylePack, config)");
    expect(script).toContain("video_strategies");
  });

  it("usa TUS resumível de 6 MiB e confirma o objeto antes de processar", () => {
    expect(script).toContain("TUS_CHUNK_SIZE = 6 * 1024 * 1024");
    expect(script).toContain("FileUrlStorage");
    expect(script).toContain("findPreviousUploads()");
    expect(script).toContain("resumeFromPreviousUpload");
    expect(script).toContain("dna-reference-");
    expect(script).toContain("waitForStorageObjectSize(client, storagePath, stat.size)");
  });

  it("retoma processamento abandonado e repara uma linha ready parcial uma só vez", () => {
    expect(script).toContain("staleProcessing");
    expect(script).toContain("processingAge >= 10 * 60_000");
    expect(script).toContain("dispatchReferenceProcessing(true)");
    expect(script).toContain("Referência continuou incompleta após reconstrução forçada");
    expect(script).toContain("visual_timestamps: [...new Set((frames.data || [])");
  });

  it("invalida checkpoints quando o DNA muda e recusa contexto operacional incorreto", () => {
    expect(script).toContain("stylePackFingerprint(stylePack)");
    expect(script).toContain("sourceFingerprint, fileSha256");
    expect(script).toContain("sameSource");
    expect(script).toContain("contextMatchesReference");
    expect(script).toContain("discard_stale_generation_context");
  });

  it("recalcula localmente os gates exatos e sempre repete a validação formal", () => {
    expect(script).toContain("normalizeViralEvaluation(rawFinal, iterations || 1)");
    expect(script).toContain("DEFAULT_VIRAL_REVIEW_THRESHOLDS");
    expect(script).toContain('agent.termination_reason === "quality_gate_passed"');
    expect(script).toContain('stage("validate_script_against_dna", "running")');
    expect(script.match(/if \(validationStatus !== "approved"\)/g) ?? []).toHaveLength(1);
  });

  it("promove somente depois da aprovação local e somente então conclui a execução", () => {
    const localApproval = script.indexOf('currentAgent = requireAgentApproval(agentFromAssembly(assembly), "assembly final")');
    const promotionCall = script.indexOf('invokeFunction(config, "promote-script-final"', localApproval);
    const promotionCheckpoint = script.indexOf("promotion_status: promotionStatus", promotionCall);
    const completedReport = script.indexOf('report.status = "completed"', promotionCheckpoint);
    const artifactWrite = script.indexOf("await writeArtifacts()", completedReport);
    const completedCheckpoint = script.indexOf("completed: true", artifactWrite);

    expect(localApproval).toBeGreaterThan(-1);
    expect(promotionCall).toBeGreaterThan(localApproval);
    expect(script).toContain('["promoted", "already_promoted"].includes(promotionStatus)');
    expect(script).toContain("promotion.promoted_script_id || promotion.video_script_id");
    expect(script).toContain("await saveCheckpoint({ completed: false })");
    expect(promotionCheckpoint).toBeGreaterThan(promotionCall);
    expect(completedReport).toBeGreaterThan(promotionCheckpoint);
    expect(artifactWrite).toBeGreaterThan(completedReport);
    expect(completedCheckpoint).toBeGreaterThan(artifactWrite);
    expect(script).toContain("Promoted script ID:");
    expect(script).toContain("current.pipeline.promoted_script_id");
    expect(script).toContain('assembly.status !== "final"');
    expect(script).toContain("sanitizeValidationSummary(assembly.validation_result)");
    expect(script).toContain("sanitizeBlocks(assembly.script_blocks, assembly.assembly_rules)");
  });

  it("exclui evidência-fonte literal dos relatórios e grava artefatos atomicamente", () => {
    for (const field of [
      "transcription_full",
      "visual_frames",
      "protected_examples",
      "dominant_visual_actions",
      "text_on_screen",
    ]) {
      expect(script).toContain(`\"${field}\"`);
    }
    expect(script).toContain("sanitizedStrategy(block.strategy)");
    expect(script).toContain("writeTextAtomic(artifactPaths.markdown, markdown)");
  });
});
