import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const assembleSource = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/assemble-script/index.ts"),
  "utf8",
);
const validatorSource = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/validate-script-against-dna/index.ts"),
  "utf8",
);
const reviewLoopSource = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/_shared/viral-review-loop.ts"),
  "utf8",
);

describe("structured-agent quota budget", () => {
  it("fits the exact event-evidence checklist while keeping every output ceiling bounded", () => {
    // The seven-block writer returns 26+ event IDs and literal evidence
    // excerpts in addition to the short narration; 1,800 truncated valid JSON.
    expect(assembleSource).toContain("const BATCH_WRITER_MAX_OUTPUT_TOKENS = 4_800;");
    // The evaluator now returns an ordered micro-event/causality audit in
    // addition to scores, so its bounded ceiling must fit that JSON trace.
    expect(assembleSource).toContain("const VIRAL_EVALUATOR_MAX_OUTPUT_TOKENS = 4_200;");
    expect(assembleSource).toContain("const VIRAL_REVISION_MAX_OUTPUT_TOKENS = 4_800;");
    expect(assembleSource).not.toContain("maxTokens: 6_500");
  });

  it("gives a full-checklist revision enough bounded transport time to return valid JSON", () => {
    expect(assembleSource).toContain("const VIRAL_REVISION_TOTAL_TIMEOUT_MS = 28_000;");
    expect(assembleSource).toContain("const VIRAL_REVISION_ATTEMPT_TIMEOUT_MS = 18_000;");
    expect(assembleSource).toContain("maxTokens: VIRAL_REVISION_MAX_OUTPUT_TOKENS");
    expect(assembleSource).toContain("revisionStartedAt + VIRAL_REVISION_TOTAL_TIMEOUT_MS");
    expect(assembleSource).toContain("Math.min(VIRAL_REVISION_TOTAL_TIMEOUT_MS, remainingMs)");
    expect(assembleSource).toContain("Math.min(VIRAL_REVISION_ATTEMPT_TIMEOUT_MS, remainingMs)");
    expect(assembleSource).toContain("const VIRAL_REVISION_MINIMUM_BUDGET_MS = 52_000;");
    expect(assembleSource).toContain("minimumRevisionBudgetMs: VIRAL_REVISION_MINIMUM_BUDGET_MS");
    expect(assembleSource).toContain("REPARO DETERMINÍSTICO OBRIGATÓRIO DA REVISÃO");
    expect(assembleSource).toContain("collectRevisionWordIssues");
    expect(assembleSource).toContain("revisionDeadlineAtMs - Date.now()");
    expect(assembleSource).toContain("deterministicRepairRound <= 2");
    expect(assembleSource).toContain("remainingRevisionTransportMs < 2_500");
    expect(assembleSource).toContain("DISCARD every prior event_text_evidence row");
  });

  it("revisa no máximo dois slots por chamada e repara somente os índices que falharam", () => {
    const start = assembleSource.indexOf("async function reviseDraftAsDnaWriter");
    const end = assembleSource.indexOf("async function", start + 1);
    const body = assembleSource.slice(start, end > start ? end : undefined);

    expect(assembleSource).toContain("const VIRAL_REVISION_SLOT_CHUNK_SIZE = 2;");
    expect(assembleSource).toContain("const VIRAL_REVISION_MAX_CONCURRENCY = 2;");
    expect(body).toContain("offset += VIRAL_REVISION_SLOT_CHUNK_SIZE");
    expect(body).toContain("mapInOrderedChunks(");
    expect(body).toContain("buildRevisionUserPrompt(new Set(chunk))");
    expect(body).toContain("const repairIndexList = issueIndexes;");
    expect(body).toContain("PROPOSTA ANTERIOR SOMENTE DESTES ÍNDICES");
    expect(body).toContain("!repairIndexSet.has(Number(candidate?.index))");
  });

  it("gives the mandatory viral evaluator enough time to rotate keys without becoming evaluator_error", () => {
    expect(assembleSource).toContain("const VIRAL_EVALUATOR_TOTAL_TIMEOUT_MS = 28_000;");
    expect(assembleSource).toContain("const VIRAL_EVALUATOR_ATTEMPT_TIMEOUT_MS = 18_000;");
    expect(assembleSource).toContain("totalTimeoutMs: VIRAL_EVALUATOR_TOTAL_TIMEOUT_MS");
    expect(assembleSource).toContain("attemptTimeoutMs: VIRAL_EVALUATOR_ATTEMPT_TIMEOUT_MS");
    expect(assembleSource).toContain("const VIRAL_EVALUATOR_MAX_ATTEMPTS = 21;");
    expect(assembleSource).toContain("maxAttempts: VIRAL_EVALUATOR_MAX_ATTEMPTS");
    expect(assembleSource).toContain("Math.min(21, Math.trunc(Number(options.maxAttempts) || 21))");
  });

  it("intersects pacing and DNA word ranges before asking the writer to self-count", () => {
    expect(reviewLoopSource).toContain("Math.max(...minimums)");
    expect(reviewLoopSource).toContain("Math.min(...maximums)");
    expect(assembleSource).toContain("ready.map(resolveViralSlotWordRange)");
    expect(assembleSource).toContain("effective_word_contract:");
    expect(assembleSource).toContain("const effectiveWordContract = allocationByIndex.get(Number(candidate.index))");
    expect(assembleSource).toContain("count whitespace-delimited words");
    expect(assembleSource).not.toContain('"no", "nadie"');
  });

  it("permite densidade visual local sem inflar o teto global nem o hook", () => {
    expect(assembleSource).toContain("if (String(checklist.slot_type) === \"hook\") continue");
    expect(assembleSource).toContain("Math.min(10, requiredVisualEvents * 4)");
    expect(assembleSource).toContain("evidence_density_override");
    expect(assembleSource).toContain("const strategyForEvidenceDensity");
    expect(assembleSource).toContain("const resolveInitialStrategyForEvidenceDensity");
    expect(assembleSource).toContain("effectiveInitialWordContract");
    expect(assembleSource).toContain("whole-script cap unchanged");
  });

  it("gives the writer bounded deterministic repairs before evaluator scoring", () => {
    expect(assembleSource).toContain("auditWriterValue");
    expect(assembleSource).toContain("THE PREVIOUS DRAFT FAILED DETERMINISTIC CONTRACTS");
    expect(assembleSource).toContain("deterministic_repair_attempted");
    expect(assembleSource).toContain("options.deadlineAtMs - Date.now() >= 12_000");
    expect(assembleSource).toContain("repairPass <= 2");
    expect(assembleSource).toContain("repairedAudit.penalty >= selectedAudit.penalty");
    expect(assembleSource).toContain("deterministic_repair_attempts");
    expect(assembleSource).toContain("pre_evaluator_copy_repair");
    expect(assembleSource).toContain("deterministic_copy_guard_failed");
    expect(assembleSource.indexOf("pre_evaluator_copy_repair")).toBeLessThan(
      assembleSource.indexOf("const loopResult = await runViralWriterEvaluatorLoop"),
    );
  });

  it("retries only unresolved anti-copy slots and keeps independently valid partial revisions", () => {
    const start = assembleSource.indexOf("const collectCopyFailedBeforeEvaluation");
    const end = assembleSource.indexOf("const readyBlocks", start);
    const body = assembleSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("preEvaluatorCopyRepairRound <= 2");
    expect(body).toContain("const copyFailedBeforeEvaluation = collectCopyFailedBeforeEvaluation()");
    expect(body).toContain("if (copyRepair.changed_slot_indexes.length > 0) blocks = copyRepair.blocks");
    expect(body).toContain("remaining_copy_failed_slot_indexes");
    expect(body).toContain("rejection_reasons_by_slot: copyRepair.rejection_reasons_by_slot");
    expect(body).toContain("rejection_reasons_by_slot: rejectionReasonsBySlot");
    expect(body).toContain("Break ALL literal runs of 4+ words");
    expect(body).not.toContain("if ([...failedIndexes].every((index) => repairedIndexes.has(index))) blocks = copyRepair.blocks");
    expect(assembleSource).toContain("quebre TODAS as sequências literais de 4 ou mais palavras");
  });

  it("uses the configured provider model in structured-agent audit metadata", () => {
    expect(assembleSource).toContain("const model = normalizeGeminiModel(undefined);");
    expect(assembleSource).toContain("model_used: normalizeGeminiModel(undefined)");
  });

  it("keeps the formal semantic judge output bounded without changing its deterministic gates", () => {
    expect(validatorSource).toContain("max_tokens: 1_600");
    expect(validatorSource).toContain("exactSlotCoverage.passed");
    expect(validatorSource).toContain("globalWordCountContract.passed");
    expect(validatorSource).toContain("currentViralFingerprint.passed");
  });
});
