import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { missingExplicitMaterialVisualAction } from "../../../supabase/functions/_shared/visual-material-guards";

describe("wiring do auditor narrativo independente", () => {
  const assembler = fs.readFileSync(
    path.resolve(__dirname, "../../../supabase/functions/assemble-script/index.ts"),
    "utf8",
  );
  const auditor = fs.readFileSync(
    path.resolve(__dirname, "../../../supabase/functions/_shared/independent-narrative-auditor.ts"),
    "utf8",
  );

  it("executa auditor independente em duas passagens internas e sobrescreve o audit do Avaliador antes do gate", () => {
    const buildAt = assembler.indexOf("buildIndependentNarrativeAuditPlan({");
    const independentCallAt = assembler.indexOf("auditDraftNarrativeIndependently({");
    const parallelAt = assembler.indexOf("const [result, independentAudit] = await Promise.all([");
    const overwriteAt = assembler.indexOf("narrative_fidelity: independentNarrativeFidelity");
    const gateAt = assembler.indexOf("const reconciledValue = enforceNarrativeFidelityGate(");

    expect(buildAt).toBeGreaterThan(0);
    expect(independentCallAt).toBeGreaterThan(buildAt);
    expect(parallelAt).toBeGreaterThan(independentCallAt);
    expect(overwriteAt).toBeGreaterThan(parallelAt);
    expect(gateAt).toBeGreaterThan(overwriteAt);
    expect(assembler).toContain("Any narrative_fidelity emitted");
    expect(assembler).toContain("parseIndependentNarrativeAudit(twoPassResult.value, options.plan)");
    expect(assembler).toContain("applyDeterministicNarrativeQualifierGate(");
    expect(assembler).toContain("independentAuditToNarrativeFidelity(options.plan, qualifierGatedAudit)");
    expect(assembler).toContain("const twoPassResult = await callStructuredAgent({");
    expect(assembler).toContain("failClosedIndependentNarrativeFidelity(independentAuditPlan, independentAudit.error)");
    expect(assembler).toContain("const independentRequiredEventCount = Number(fidelity?.required_event_count)");
    expect(assembler).toContain("microevent_audit_event_count_mismatch");
  });

  it("faz auditoria completa e adversarial sem fan-out por slot", () => {
    const start = assembler.indexOf("async function auditDraftNarrativeIndependently");
    const end = assembler.indexOf("function enforceNarrativeFidelityGate", start);
    const body = assembler.slice(start, end);

    expect(assembler).toContain("MANDATORY INTERNAL TWO-PASS VERIFICATION");
    expect(assembler).toContain("PASS 1 — comprehensive timeline audit");
    expect(assembler).toContain("PASS 2 — adversarial component audit");
    expect(assembler).toContain("When the passes disagree, keep the stricter verdict");
    expect(assembler).toContain("Run both mandatory internal passes over the complete plan");
    expect(assembler).toContain("single-call-internal-two-pass:");
    expect(body.match(/\bcallStructuredAgent\s*\(\s*\{/g) ?? []).toHaveLength(2);
    expect(body).not.toContain("independentNarrativeAdversarialSubplans(");
    expect(body).not.toContain("mapInOrderedChunks(");
    expect(body).not.toContain("Promise.all(");
    expect(body).toContain("SECOND INDEPENDENT VISUAL PROPOSITION AUDITOR");
    expect(body).toContain("independent_visual_verifier_event_id_mismatch");
    expect(body).toContain("second-visual-auditor:");
    expect(body.indexOf("independentNarrativeInvalidClaimedExcerptEventIds"))
      .toBeLessThan(body.indexOf("await callStructuredAgent"));
    expect(body).toContain("writer-claimed-excerpt-invalid: exact source event");
    expect(body).toContain("invalidClaimedExcerptEventIds.has(verdict.event_id)");
    expect(body.indexOf("parseIndependentNarrativeAudit"))
      .toBeLessThan(body.indexOf("applyDeterministicNarrativeQualifierGate"));
  });

  it("faz retry de 429 em mais chaves com backoff curto sem ultrapassar o deadline", () => {
    expect(assembler).toContain("const INDEPENDENT_AUDITOR_MAX_ATTEMPTS = 21");
    expect(assembler).toContain("maxAttempts: INDEPENDENT_AUDITOR_MAX_ATTEMPTS");
    expect(assembler).toContain("INDEPENDENT_AUDITOR_RETRY_BASE_DELAY_MS = 250");
    expect(assembler).toContain("INDEPENDENT_AUDITOR_RETRY_MAX_DELAY_MS = 1_000");
    expect(assembler).toContain("retryBaseDelayMs: INDEPENDENT_AUDITOR_RETRY_BASE_DELAY_MS");
    expect(assembler).toContain("retryMaxDelayMs: INDEPENDENT_AUDITOR_RETRY_MAX_DELAY_MS");
    expect(assembler).toContain("deadlineAtMs: options.deadlineAtMs");
  });

  it("instrui a perda de finalidade e proposicao como distorcao causal", () => {
    expect(assembler).toContain("took a cat in order to devour it");
    expect(assembler).toContain("mark distorted + altered");
    expect(assembler).toContain("lied that it was a present");
    expect(assembler).toContain("the proposition/content of the lie disappeared");
    expect(assembler).toContain("explicit state/condition, singularity or count, time/frequency, manner");
    expect(assembler).toContain("accidentally ended up in an interview");
    expect(assembler).toContain("days later, could no longer contain himself");
    expect(assembler).toContain("ending a life as a human");
    expect(assembler).toContain("visual_context remains authoritative contradiction");
    expect(assembler).toContain("Start with claimed_text_excerpt");
    expect(assembler).toContain("Generic reasons such as 'the text confirms the event' are invalid");
    expect(assembler).toContain("'proof of his destiny'");
    expect(assembler).toContain('"prova do seu destino"');
    expect(auditor).toContain("block?.narrative_event_checklist?.event_text_evidence");
    expect(auditor).toContain("assertIndependentNarrativeClaimedExcerptContract");
    expect(auditor).toContain("visual_context: visualContext");
  });

  it("classifica candidatos visuais pelo contrato v2 e dimensiona a resposta completa", () => {
    expect(assembler).toContain("visual_event_results");
    expect(assembler).toContain("materiality=required only when pixels show a materially new action");
    expect(assembler).toContain("materiality=redundant for illustration/background/pose/camera/aesthetic detail");
    expect(assembler).not.toContain("became/looked human");
    expect(assembler).toContain("every materially new component in its own evidence_text");
    expect(assembler).toContain("never import an example from another slot or video");
    expect(assembler).not.toContain("does not cover raw meat or blood appearing on documents");
    expect(assembler).not.toContain("disguise visibly breaking and revealing the hidden face");
    expect(assembler).toContain("plan.total_events + plan.total_visual_event_candidates");
    expect(auditor).toContain("visual_event_candidates: IndependentNarrativeEvent[]");
    expect(auditor).toContain("independent_narrative_audit_visual_event_count_mismatch");
    expect(auditor).toContain('verdict.materiality === "required"');
  });

  it("falha fechado para farejar, corpo caido e rastejar quando a acao visual nao esta explicita", () => {
    expect(missingExplicitMaterialVisualAction(
      "The wolf sniffs the motionless man on the ground.",
      "Ele encontrou um homem caido e depois examinou as proprias maos.",
    )).toBe(true);
    expect(missingExplicitMaterialVisualAction(
      "The wolf sniffs the motionless man on the ground.",
      "Ele encontrou e farejou um homem caido.",
    )).toBe(false);
    expect(missingExplicitMaterialVisualAction(
      "The man crawls across the lawn on all fours.",
      "Seus instintos selvagens permaneciam.",
    )).toBe(true);
    expect(missingExplicitMaterialVisualAction(
      "A man lies flat, motionless on the forest floor.",
      "Um homem estava caido no chao.",
    )).toBe(false);
    expect(missingExplicitMaterialVisualAction(
      "The man leans toward a cat inside a pet carrier cage.",
      "Ele trouxe um gato para casa.",
    )).toBe(true);
    expect(missingExplicitMaterialVisualAction(
      "A wolf muzzle stretches out inside a human mouth.",
      "Ele revelou um focinho de lobo.",
    )).toBe(true);
    expect(missingExplicitMaterialVisualAction(
      "A wolf muzzle stretches out inside a human mouth.",
      "Um focinho de lobo surgiu da boca humana.",
    )).toBe(false);
    expect(assembler).toContain("deterministic-material-action: required physical action/object");
    expect(assembler).toContain('verdict.materiality = "required"');
    expect(assembler).toContain('verdict.coverage = "distorted"');
  });

  it("reconhece decompor afirmado, mas nao aceita negacao, hipotese ou futuro", () => {
    const evidence = "The dog's body is beside the visibly decomposed cat's body.";
    const literalV7 = "O corpo do gato começou a decompor e, como compartilhavam o organismo, o cachorro morreu.";

    expect(missingExplicitMaterialVisualAction(evidence, literalV7)).toBe(false);
    expect(missingExplicitMaterialVisualAction(
      evidence,
      "O corpo do gato se decompôs.",
    )).toBe(false);
    expect(missingExplicitMaterialVisualAction(
      evidence,
      "O corpo do gato estava em decomposição.",
    )).toBe(false);
    expect(missingExplicitMaterialVisualAction(
      evidence,
      "Os restos do corpo do gato se decompuseram.",
    )).toBe(false);
    expect(missingExplicitMaterialVisualAction(
      evidence,
      "O corpo do gato não começou a decompor.",
    )).toBe(true);
    expect(missingExplicitMaterialVisualAction(
      evidence,
      "O corpo do gato poderia começar a decompor.",
    )).toBe(true);
    expect(missingExplicitMaterialVisualAction(
      evidence,
      "Se o corpo do gato decompor, o cachorro também pode morrer.",
    )).toBe(true);
    expect(missingExplicitMaterialVisualAction(
      evidence,
      "O corpo do gato vai se decompor.",
    )).toBe(true);
  });

  it("leva a acao visual material para a revisao e assina o gate independente", () => {
    expect(assembler).toContain("priorMicroeventAudit: effectivePriorEventAudit");
    expect(assembler).toContain("const expectedNarrativeEventIds = revisionEventChecklist");
    expect(assembler).toContain('source: "independent_narrative_auditor"');
    expect(assembler).toContain("plan_fingerprint: independentNarrativePlanFingerprint(independentAuditPlan)");
    expect(assembler).toContain("audit_fingerprint: narrativeFidelityAuditFingerprint(gateEvidence)");
    expect(auditor).toContain("export function independentNarrativePlanFingerprint");
  });

  it("gera feedback high para cada slot afetado, nao apenas para o primeiro", () => {
    expect(assembler).toContain("const affectedIssues = gate.affected_slot_indexes.map");
    expect(assembler).toContain("...affectedIssues");
    expect(assembler).not.toContain("slot_index: gate.affected_slot_indexes[0]");
  });

  it("injeta o mesmo checklist no Writer inicial e na revisao sem permitir oscilacao", () => {
    expect(assembler).toContain("authoritative_narrative_events:");
    expect(assembler).toContain("IMMUTABLE NARRATIVE EVENT CHECKLIST:");
    expect(assembler).toContain("covered_event_ids");
    expect(assembler).toContain("assessWriterNarrativeChecklist({");
    expect(assembler).toContain("CHECKLIST NARRATIVO AUTORITATIVO E IMUTÁVEL:");
    expect(assembler).toContain("buildWriterRevisionNarrativeChecklist(");
    expect(auditor).toContain('revision_duty: protectedCoverage ? "MUST_PRESERVE" as const : "MUST_RESTORE_COMPLETELY" as const');
    expect(assembler).toContain("never trade one covered event for another");
    expect(assembler).toContain("checklistRejectedIndexes.has(index)");
    expect(assembler).toContain("validPlanIndexes.has(index)");
    expect(assembler).toContain("event_text_evidence");
  });

  it("mantem as acoes visuais deterministicas em toda revisao, mesmo antes do avaliador", () => {
    expect(assembler).toContain("const deterministicRevisionVisualSeed");
    expect(assembler).toContain("const effectivePriorEventAudit");
    expect(assembler).toContain("deterministic_high_signal_visual_event_revision_contract");
    expect(assembler).toContain("revisionNarrativePlan,\n    effectivePriorEventAudit,");
    expect(assembler.match(/priorMicroeventAudit: effectivePriorEventAudit/g)?.length || 0).toBeGreaterThanOrEqual(6);
  });

  it("aumenta tambem o alvo de palavras quando a fidelidade visual exige densidade", () => {
    expect(assembler.match(/const expandedMax = Number\(allocation\.max\) \+ evidenceDensityAllowance;/g))
      .toHaveLength(2);
    expect(assembler.match(/Math\.min\(expandedMax - 2, Number\(allocation\.target_words\) \+ evidenceDensityAllowance\)/g))
      .toHaveLength(2);
    expect(assembler).toContain("initialWriterChecklistByIndex.get(Number(slot.index))?.events");
  });

  it("isola o hook de 0-5s, salvo quando o roteiro inteiro exige reparo de duracao", () => {
    expect(assembler).toContain("const precisionIndexes = indexes.filter");
    expect(assembler).toContain("slotType === \"hook\"");
    expect(assembler).toContain("visualEventCount >= 2");
    expect(assembler).toContain("chunks.push(...precisionIndexes.map((index) => [index]))");
    expect(assembler).toContain("const compactIndexes = indexes.filter");
    expect(assembler).toContain("ESPECIALISTA REDUZIDO DA LACUNA DO GANCHO");
    expect(assembler).toContain("composeFrozenHookClauses");
    expect(assembler).toContain("const hookNeedsSpecialist");
    expect(assembler).toContain("existingHookBlock?.dna_copy_guard?.passed !== true");
    expect(assembler).toContain('type: "hook_semantic_guard"');
    expect(assembler).toContain('reason: "independent_hook_guard_failed"');
    expect(assembler).toContain("const specialistPassed = candidateHookTerminalChecklistIssues.length === 0");
    expect(assembler).toContain("expectedSlotIndexes: [hookIndex]");
    expect(assembler).toContain("const genericRevisionIndexes = requestedIndexList.filter((index) => index !== hookRevisionIndex)");
    expect(assembler).toContain("const preEvaluatorRepairScope = resolvePreEvaluatorRepairScope");
    expect(assembler).toContain("const pacingUnderflowRequiresJointRepair = preEvaluatorRepairScope");
    expect(assembler).toContain("const strategyFailedBeforeEvaluation = preEvaluatorRepairScope.requested_blocks");
    expect(assembler).toContain("writerRepairDeferredToHookSpecialist = true");
    expect(assembler).toContain("deterministic_repair_deferred_to_hook_specialist");
    expect(assembler).toContain('"writer_checklist_ids_missing"');
    expect(assembler).toContain("const hookRevisionSeed = existingHookBlock ?");
    expect(assembler).toContain("&& index !== hookRevisionIndex");
    expect(assembler).toContain("const hookSpokenPremiseCarrierPromise");
    expect(assembler).toContain("const hookVisualActionCarrierPromise");
    expect(assembler).toContain("hook_specialist_failed:");
    expect(assembler).toContain("candidateHookTerminalChecklistIssues");
    expect(assembler).toContain("anchor_excerpt deve ser trecho literal contíguo");
    expect(assembler).toContain('gap_kind é somente extension, risk, consequence ou reveal');
    expect(assembler).not.toContain("encontrar + farejar + vestir + lacuna");
    expect(assembler).not.toContain("O substantivo concreto disambiguado pela transcrição continua sendo o MESMO núcleo");
    expect(assembler).not.toContain("conter explicitamente \"ainda\" ou \"mistério\"");
    expect(assembler).toContain("const declarativeDnaPreferred");
    expect(assembler).toContain("const rawCandidateText = loopOnlyIssues.length === 0");
    expect(assembler).toContain("const authoritativeHookEventIds");
    expect(assembler).toContain("failure_types: specialistFailures.map");
    expect(assembler).toContain("const terminalRevisionChecklistIssues");
    expect(assembler).toContain("const orthographicWordCount");
    expect(assembler).toContain("const compressionDonorTargets");
    expect(assembler).toContain("resolveRevisionCompressionBudget({");
    expect(assembler).toContain("const compressionRequiredGrowth = compressionBudget.compression_required");
    expect(assembler).toContain("if (compressionRequiredGrowth > 0)");
    expect(assembler).toContain("compressionRequiredGrowth - fundedWords");
    expect(assembler).toContain("candidate.eventCount > 0");
    expect(assembler).not.toContain("candidate.eventCount >= 5");
    expect(assembler).toContain("COMPRESSION_DONOR_PRESERVE_ALL_EVENTS");
    expect(assembler).toContain("if (!specialist.result)");
    expect(assembler).toContain("const normalizeWriterProposalMetadata");
    expect(assembler).toContain("hallucinated/stale ID cannot discard otherwise repairable narration");
    expect(assembler).toContain("ESQUEMA DE COMPRESSÃO DE TRÊS FRASES");
    expect(assembler).toContain("const denseTargetWords");
    expect(assembler).toContain("const authoritativeEventIds = specialist.checklist.events.map");
    expect(assembler).toContain("hookQuestionRate <= 0.10");
    expect(assembler).toContain("Retorne apenas loop_clause, anchor_excerpt e gap_kind");
    expect(assembler).not.toContain("Até onde [objeto/ação concreta já provada] o levaria?");
    expect(assembler).not.toContain("Reserve as últimas 5–7 palavras");
    expect(assembler).toContain("ESCRITOR ESPECIALISTA DE FIDELIDADE LOCAL");
    expect(assembler).toContain("const denseSpecialistIndexes");
    expect(assembler).toContain("mansion_specificity significa escrever");
    expect(assembler).toContain("TETO RÍGIDO: nunca ultrapasse");
  });

  it("adia falhas do hook sem esconder reparos determinísticos de outros blocos", () => {
    const partitionStart = assembler.indexOf("const belongsToHookSpecialist");
    const repairCall = assembler.indexOf("const repaired = await callStructuredAgent", partitionStart);
    const repairFlow = assembler.slice(partitionStart, repairCall);

    expect(partitionStart).toBeGreaterThanOrEqual(0);
    expect(repairCall).toBeGreaterThan(partitionStart);
    expect(repairFlow).toContain('issue?.type !== "unsupported_local_relationship_intent_or_conclusion"');
    expect(repairFlow).toContain("writerRepairDeferredToHookSpecialist = true");
    expect(repairFlow).toContain("const batchRepairIssues = hookNeedsDedicatedRepair");
    expect(repairFlow).toContain("selectedAudit.issues.filter((issue: any) => !belongsToHookSpecialist(issue))");
    expect(repairFlow).toContain("if (batchRepairIssues.length === 0) break");
    expect(repairFlow.indexOf("writerRepairDeferredToHookSpecialist = true"))
      .toBeLessThan(repairFlow.indexOf("if (batchRepairIssues.length === 0) break"));
    expect(assembler).toContain("deterministic_issues: batchRepairIssues");
    expect(assembler).toContain("const repairedValue = hookNeedsDedicatedRepair");
    expect(assembler).toContain("Number(block?.index) !== hookContractIndex");
    expect(assembler).toContain("selectedAudit.proposedBlocks");
    expect(assembler).toContain("writer = { ...repaired, value: repairedValue }");
  });

  it("mantem o especialista denso opcional, local e alinhado ao validador final", () => {
    expect(assembler).toContain("denseSpecialistIndexes,\n      VIRAL_REVISION_MAX_CONCURRENCY");
    expect(assembler).toContain("runOptionalDenseSpecialist({");
    expect(assembler).toContain("DICIONÁRIO LOCAL DE QUALIFICADORES");
    expect(assembler).toContain("RASCUNHO/PROVAS ATUAIS NÃO AUTORITATIVOS");
    expect(assembler).toContain("Number(compliance.score) >= specialist.minimumStrategyScore");
    expect(assembler).toContain("dense_specialist:${specialist.failureReason");
    expect(assembler.match(/resolveRevisionStrategyForEvidenceDensity\(/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(assembler).toContain('event?.revision_duty === "MUST_RESTORE_COMPLETELY"');
    expect(assembler).toContain("Number(checklist?.events.length || 0) >= 4 && (unresolved || hasRestoreDuty)");
    const fallbackAt = assembler.indexOf("const deterministicFallbackText = buildThreeSentenceMaterialDenseFallback");
    const modelAt = assembler.indexOf("const optionalAttempt = await runOptionalDenseSpecialist", fallbackAt);
    expect(fallbackAt).toBeGreaterThan(-1);
    expect(modelAt).toBeGreaterThan(fallbackAt);
    expect(assembler.slice(fallbackAt, modelAt)).toContain("model: \"deterministic-dense-fallback\"");
  });

  it("calcula o checklist de cada bloco no mesmo escopo em que ele e persistido", () => {
    const logsAt = assembler.indexOf("const logs: any[] = [");
    const finalBlocksLoopAt = assembler.indexOf(
      "for (let position = 0; position < enrichedSlots.length; position++)",
      logsAt,
    );
    const checklistAt = assembler.indexOf("const slotNarrativeChecklist = assessWriterNarrativeChecklist({", finalBlocksLoopAt);
    const persistedAt = assembler.indexOf("passed: slotNarrativeChecklist.passed", finalBlocksLoopAt);
    const loopEndAt = assembler.indexOf("const minPreEvaluatorStrategyScore", finalBlocksLoopAt);

    expect(finalBlocksLoopAt).toBeGreaterThan(logsAt);
    expect(checklistAt).toBeGreaterThan(finalBlocksLoopAt);
    expect(persistedAt).toBeGreaterThan(checklistAt);
    expect(loopEndAt).toBeGreaterThan(persistedAt);
  });

  it("encaminha excerpt obsoleto ao auditor sem aceita-lo como prova", () => {
    const terminalFilterAt = assembler.indexOf("const terminalNarrativeChecklistIssues");
    const terminalFailureAt = assembler.indexOf(
      "batch_writer_narrative_checklist_incomplete",
      terminalFilterAt,
    );
    const terminalFilter = assembler.slice(terminalFilterAt, terminalFailureAt);

    expect(terminalFilterAt).toBeGreaterThan(-1);
    expect(terminalFailureAt).toBeGreaterThan(terminalFilterAt);
    expect(terminalFilter).toContain('"writer_checklist_text_evidence_invalid"');
    expect(terminalFilter).toContain('"writer_checklist_material_visual_action_missing"');
    expect(terminalFilter).toContain('"writer_checklist_qualifiers_missing"');
    expect(auditor).toContain("claimedExcerptByEventId.get(eventId) || null");
  });

  it("reserva saida suficiente para os sete blocos e o checklist integral", () => {
    const configured = assembler.match(/const BATCH_WRITER_MAX_OUTPUT_TOKENS = ([\d_]+);/);
    expect(configured).not.toBeNull();
    expect(Number(configured![1].replaceAll("_", ""))).toBeGreaterThanOrEqual(4_000);
    expect(assembler).toContain("const BATCH_WRITER_TOTAL_TIMEOUT_MS = 28_000");
    expect(assembler).toContain("const INDEPENDENT_AUDITOR_TOTAL_TIMEOUT_MS = 28_000");
    expect(assembler).toContain("totalTimeoutMs: INDEPENDENT_AUDITOR_TOTAL_TIMEOUT_MS");
  });
});
