import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS,
  DEFAULT_VIRAL_REVIEW_THRESHOLDS,
  evaluateViralQualityGates,
  extractJsonObject,
  normalizeViralEvaluation,
  reconcileBoundedComplementOnlyEvaluation,
  resolveViralPacingWordsPerSecond,
  resolveViralSlotWordRange,
  resolveViralWordCountContract,
  runViralWriterEvaluatorLoop,
  viralEvaluationEvidenceFingerprint,
  viralDraftFingerprint,
} from "../../../supabase/functions/_shared/viral-review-loop";
import {
  assessRequiredViralReview,
  resolveScriptInputMode,
} from "../../../supabase/functions/_shared/required-viral-review";

const passingRawEvaluation = {
  estimated_metrics: {
    continue_rate_percent: 90.1,
    skip_rate_percent: 9.9,
    avg_view_percentage: 90,
  },
  criterion_scores: {
    hook: 9,
    development: 9,
    payoff: 9,
    visual_fidelity: 9.5,
    dna_strategy_application: 9,
    originality: 9,
    pacing: 9,
  },
  overall_score: 9,
  feedback: { summary: "Pronto", revision_priorities: [], block_issues: [] },
  evidence_limits: ["Estimativa sem dados pós-publicação"],
};

const passingCompactMicroevent = {
  event_id: "slot:0:visual:0",
  script_slot_index: 0,
  start_seconds: 0,
  end_seconds: 2.5,
  event: "O personagem encontra o objeto visível.",
  evidence_kind: "visual",
  coverage: "covered",
  causal_relation: "preserved",
  reason: "A frase preserva a ação e sua ordem.",
};

function passingNarrativeGate(overrides: Record<string, unknown> = {}) {
  return {
    required: true,
    passed: true,
    source: "independent_narrative_auditor",
    contract_version: 2,
    plan_fingerprint: "fnv1a32:abc12345",
    audit_source: "independent_narrative_auditor",
    audit_contract_version: 2,
    reasons: [],
    audited_microevents: 1,
    required_audited_microevents: 1,
    audit_coverage_contract: [{ script_slot_index: 0, minimum_distinct_events: 1 }],
    microevent_audit: [{ ...passingCompactMicroevent }],
    full_microevent_audit: [{
      ...passingCompactMicroevent,
      coverage_status: "covered",
      causal_status: "preserved",
    }],
    visual_candidate_count: 1,
    required_visual_event_count: 1,
    visual_candidate_audit: [{
      event_id: passingCompactMicroevent.event_id,
      start_seconds: passingCompactMicroevent.start_seconds,
      event: passingCompactMicroevent.event,
      script_slot_index: passingCompactMicroevent.script_slot_index,
      materiality: "required",
      coverage: "covered",
      causal_relation: "preserved",
      reason: passingCompactMicroevent.reason,
    }],
    complete_narrative_gaps: [],
    causal_errors: [],
    affected_slot_indexes: [],
    ...overrides,
  };
}

function passingHookPayoffGate(overrides: Record<string, unknown> = {}) {
  return {
    required: true,
    passed: true,
    pair_fingerprint: "fnv1a32:feed1234",
    hook_index: 0,
    payoff_index: 6,
    semantic_resolution_confirmed: true,
    open_loop: "de quem era o teste positivo",
    semantic_answer: "o final mostra que o teste era da militar",
    reason: "o payoff responde a pergunta de posse aberta no hook",
    object_overlap_alone_is_insufficient: true,
    ...overrides,
  };
}

function signedPassingEvaluation(overrides: Record<string, unknown> = {}) {
  return normalizeViralEvaluation({
    ...passingRawEvaluation,
    narrative_fidelity_gate: passingNarrativeGate(),
    hook_payoff_resolution_gate: passingHookPayoffGate(),
    ...overrides,
  }, 1);
}

function signedEvaluationWithGate(overrides: Record<string, unknown>) {
  return signedPassingEvaluation({
    narrative_fidelity_gate: passingNarrativeGate(overrides),
  });
}

function passingPersistedReport(
  finalEvaluation: Record<string, unknown> = signedPassingEvaluation(),
) {
  return {
    enabled: true,
    writer_agent: "dna_writer",
    evaluator_agent: "viral_evaluator",
    passed: true,
    termination_reason: "quality_gate_passed",
    iterations_completed: 1,
    max_iterations: DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS,
    thresholds: DEFAULT_VIRAL_REVIEW_THRESHOLDS,
    metrics_kind: "pre_publication_ai_estimates",
    final_evaluation: finalEvaluation,
    audit_trail: [{
      iteration: 1,
      draft_fingerprint: "fnv1a32:1234abcd",
      evaluator: finalEvaluation,
      writer_revision: null,
    }],
  };
}

describe("loop Escritor DNA + Avaliador Viral", () => {
  it.each([
    ["ausente", undefined],
    ["desabilitado", { enabled: false, passed: true }],
    ["sem aprovacao", { enabled: true, passed: false }],
  ])("fecha o gate de video quando o relatorio esta %s", (_case, report) => {
    const gate = assessRequiredViralReview("video", report);
    expect(gate.required).toBe(true);
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("writer_evaluator_loop");
  });

  it("aceita video somente com loop habilitado e aprovado", () => {
    expect(assessRequiredViralReview("video", passingPersistedReport()))
      .toEqual({ required: true, passed: true, reason: null });
  });

  it("nao confia em booleano persistido sem evidencia que passe os gates exatos", () => {
    const gate = assessRequiredViralReview("video", passingPersistedReport(signedPassingEvaluation({
      estimated_metrics: { continue_rate_percent: 50, skip_rate_percent: 50, avg_view_percentage: 40 },
    })));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("local gate verification");
  });

  it("rejeita avaliação quantitativa assinada sem o gate narrativo obrigatório", () => {
    const evaluation = normalizeViralEvaluation(passingRawEvaluation, 1);
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("missing the required narrative_fidelity_gate");
  });

  it("preserva o gate hook-payoff e falha fechado quando a resolucao e apenas declarada", () => {
    const passed = normalizeViralEvaluation({
      ...passingRawEvaluation,
      hook_payoff_resolution_gate: passingHookPayoffGate(),
    }, 1);
    expect(passed.hook_payoff_resolution_gate?.passed).toBe(true);

    const failed = normalizeViralEvaluation({
      ...passingRawEvaluation,
      hook_payoff_resolution_gate: passingHookPayoffGate({
        semantic_resolution_confirmed: false,
        semantic_answer: "teste positivo",
      }),
    }, 1);
    expect(failed.passed).toBe(false);
    expect(failed.failed_gates).toContain("hook_payoff_resolution_gate_failed");
  });

  it("rejeita promocao de video sem evidencia hook-payoff persistida", () => {
    const evaluation = normalizeViralEvaluation({
      ...passingRawEvaluation,
      narrative_fidelity_gate: passingNarrativeGate(),
    }, 1);
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("hook_payoff_resolution_gate");
  });

  it("rejeita contagens narrativas inconsistentes mesmo quando a avaliação foi selada", () => {
    const evaluation = signedEvaluationWithGate({ audited_microevents: 2 });
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("audited_microevents must equal required_audited_microevents");
  });

  it("rejeita auditoria integral omitida mesmo quando o resumo compacto existe", () => {
    const evaluation = signedEvaluationWithGate({ full_microevent_audit: [] });
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("full_microevent_audit length");
  });

  it("rejeita microevento distorcido na auditoria integral", () => {
    const distorted = { ...passingCompactMicroevent, coverage: "distorted" };
    const evaluation = signedEvaluationWithGate({
      microevent_audit: [distorted],
      full_microevent_audit: [{
        ...distorted,
        coverage_status: "distorted",
        causal_status: "preserved",
      }],
    });
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("uncovered or distorted event");
  });

  it("rejeita IDs duplicados em vez de contar o mesmo microevento duas vezes", () => {
    const first = { ...passingCompactMicroevent };
    const second = { ...passingCompactMicroevent, event_id: "slot:0:visual:1" };
    const fullDuplicate = {
      ...first,
      coverage_status: "covered",
      causal_status: "preserved",
    };
    const evaluation = signedEvaluationWithGate({
      audited_microevents: 2,
      required_audited_microevents: 2,
      microevent_audit: [first, second],
      full_microevent_audit: [fullDuplicate, { ...fullDuplicate }],
    });
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("event_id values must be non-empty and unique");
  });

  it.each([
    ["fonte ausente", { source: "", audit_source: "" }, "independent_narrative_auditor source"],
    ["contrato legado", { contract_version: 1, audit_contract_version: 1 }, "contract version 2"],
    ["lacuna completa", { complete_narrative_gaps: [{ event_id: "gap:0" }] }, "complete narrative gaps"],
    ["erro causal", { causal_errors: [{ event_id: "causal:0" }] }, "causal errors"],
    ["slot afetado", { affected_slot_indexes: [0] }, "affected slot indexes"],
  ])("rejeita fechamento narrativo inválido: %s", (_case, overrides, expectedReason) => {
    const evaluation = signedEvaluationWithGate(overrides);
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain(expectedReason);
  });

  it("rejeita assinatura externa adulterada", () => {
    const evaluation = {
      ...signedPassingEvaluation(),
      evaluation_fingerprint: "fnv1a32:00000000",
    };
    const gate = assessRequiredViralReview("video", passingPersistedReport(evaluation));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("evaluator evidence fingerprint is inconsistent");
  });

  it("rejeita assinatura interna adulterada ainda que a assinatura externa seja recalculada", () => {
    const valid = signedPassingEvaluation();
    const tampered = {
      ...valid,
      narrative_fidelity_gate: {
        ...valid.narrative_fidelity_gate!,
        audit_fingerprint: "fnv1a32:00000000",
      },
    };
    tampered.evaluation_fingerprint = viralEvaluationEvidenceFingerprint(tampered);
    const gate = assessRequiredViralReview("video", passingPersistedReport(tampered));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("fingerprint is inconsistent");
  });

  it("vincula a assinatura ao plano canônico da auditoria independente", () => {
    const valid = signedPassingEvaluation();
    const tampered = {
      ...valid,
      narrative_fidelity_gate: {
        ...valid.narrative_fidelity_gate!,
        plan_fingerprint: "fnv1a32:99999999",
      },
    };
    // Simula uma edição que recalculou apenas o selo externo, mas não consegue
    // manter coerente o selo interno da auditoria autoritativa.
    tampered.evaluation_fingerprint = viralEvaluationEvidenceFingerprint(tampered);
    const gate = assessRequiredViralReview("video", passingPersistedReport(tampered));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("fingerprint is inconsistent");
  });

  it("exige papéis separados, teto de iterações, thresholds exatos e auditoria coerente", () => {
    expect(assessRequiredViralReview("video", {
      ...passingPersistedReport(),
      writer_agent: "viral_evaluator",
    }).reason).toContain("separate dna_writer");

    expect(assessRequiredViralReview("video", {
      ...passingPersistedReport(),
      max_iterations: DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS + 1,
    }).reason).toContain("max_iterations");

    expect(assessRequiredViralReview("video", {
      ...passingPersistedReport(),
      thresholds: { ...DEFAULT_VIRAL_REVIEW_THRESHOLDS, overall_score_min: 1 },
    }).reason).toContain("thresholds");

    expect(assessRequiredViralReview("video", {
      ...passingPersistedReport(),
      audit_trail: [],
    }).reason).toContain("audit_trail length");
  });

  it("não confia nos booleanos quando a trilha de papéis está adulterada", () => {
    const report = passingPersistedReport();
    const gate = assessRequiredViralReview("video", {
      ...report,
      audit_trail: [{
        ...report.audit_trail[0],
        evaluator: { ...report.audit_trail[0].evaluator, agent_role: "dna_writer" },
      }],
    });
    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("invalid evaluator role");
  });

  it("resolve conflito de modo como video e preserva tema explicito", () => {
    expect(resolveScriptInputMode({ input_mode: "theme" }, { input_mode: "video" })).toBe("video");
    expect(resolveScriptInputMode(null, { input_mode: "theme" })).toBe("theme");
    expect(resolveScriptInputMode(null, null)).toBe("video");
    expect(assessRequiredViralReview("theme", null).passed).toBe(true);
  });

  it("aplica os limites exatos e exige skip estritamente menor que 10", () => {
    const normalized = normalizeViralEvaluation({
      ...passingRawEvaluation,
      passed: true,
      estimated_metrics: { ...passingRawEvaluation.estimated_metrics, skip_rate_percent: 10 },
    }, 1);

    expect(normalized.passed).toBe(false);
    expect(normalized.failed_gates).toContain("estimated_skip_rate_not_below_10");
    expect(normalized.metrics_kind).toBe("pre_publication_ai_estimates");
    expect(normalized.metrics_disclaimer).toContain("não são métricas reais");
  });

  it("ignora a aprovação declarada pelo modelo e recalcula o gate localmente", () => {
    const normalized = normalizeViralEvaluation({
      ...passingRawEvaluation,
      passed: true,
      estimated_metrics: {
        continue_rate_percent: 40,
        skip_rate_percent: 60,
        avg_view_percentage: 30,
      },
      overall_score: 10,
    }, 1);

    expect(normalized.passed).toBe(false);
    expect(normalized.failed_gates).toEqual(expect.arrayContaining([
      "estimated_continue_rate_below_86",
      "estimated_skip_rate_not_below_10",
      "estimated_avg_view_percentage_below_90",
    ]));
  });

  it("preserva o gate narrativo quando uma avaliação normalizada é verificada novamente", () => {
    const covered = {
      event_id: "slot:6:transcript:20",
      script_slot_index: 6,
      event: "A familia reagiu assustada.",
      coverage: "covered",
      causal_relation: "preserved",
    };
    const omitted = {
      event_id: "slot:6:transcript:21",
      script_slot_index: 6,
      event: "Os funcionarios correram atras dele para dete-lo.",
      coverage: "omitted",
      causal_relation: "preserved",
    };
    const first = normalizeViralEvaluation({
      ...passingRawEvaluation,
      __narrative_fidelity_gate: passingNarrativeGate({
        audited_microevents: 2,
        required_audited_microevents: 2,
        microevent_audit: [covered, omitted],
        full_microevent_audit: [
          { ...covered, coverage_status: "covered", causal_status: "preserved" },
          { ...omitted, coverage_status: "omitted", causal_status: "preserved" },
        ],
      }),
    }, 1);
    const second = normalizeViralEvaluation(first, 1);

    expect(second.narrative_fidelity_gate).toMatchObject({
      required: true,
      passed: true,
      source: "independent_narrative_auditor",
      contract_version: 2,
      plan_fingerprint: "fnv1a32:abc12345",
      audit_source: "independent_narrative_auditor",
      audit_contract_version: 2,
      audited_microevents: 2,
      required_audited_microevents: 2,
    });
    expect(second.narrative_fidelity_gate?.microevent_audit).toEqual([
      expect.objectContaining({
        event_id: "slot:6:transcript:20",
        coverage: "covered",
      }),
      expect.objectContaining({
        event_id: "slot:6:transcript:21",
        coverage: "omitted",
      }),
    ]);
    expect(second.passed).toBe(true);
    expect(second.evaluation_fingerprint).toBe(first.evaluation_fingerprint);
  });

  it("reprova estimativas incoerentes quando continuaram e pularam não somam aproximadamente 100", () => {
    const normalized = normalizeViralEvaluation({
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 95, skip_rate_percent: 1, avg_view_percentage: 95 },
    }, 1);
    expect(normalized.passed).toBe(false);
    expect(normalized.failed_gates).toContain("estimated_engagement_rates_not_complementary");
  });

  it("reconcilia proporcionalmente apenas uma pequena inconsistência complementar isolada", () => {
    const reconciled = reconcileBoundedComplementOnlyEvaluation({
      ...passingRawEvaluation,
      estimated_metrics: {
        continue_rate_percent: 89.5,
        skip_rate_percent: 8.2,
        avg_view_percentage: 93,
      },
    }, 1);

    expect(reconciled?.passed).toBe(true);
    expect(reconciled?.failed_gates).toEqual([]);
    expect(reconciled?.estimated_metrics).toEqual({
      continue_rate_percent: 91.6,
      skip_rate_percent: 8.4,
      avg_view_percentage: 93,
    });
    expect(reconciled?.evidence_limits[0]).toContain("bounded_proportional_rescale");
  });

  it("não reconcilia discrepância grande nem qualquer segunda falha de qualidade", () => {
    expect(reconcileBoundedComplementOnlyEvaluation({
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 95, skip_rate_percent: 1, avg_view_percentage: 95 },
    }, 1)).toBeNull();

    expect(reconcileBoundedComplementOnlyEvaluation({
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 85, skip_rate_percent: 13, avg_view_percentage: 95 },
    }, 1)).toBeNull();
  });

  it("executa avaliação, feedback e revisão até a aprovação", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        ...passingRawEvaluation,
        estimated_metrics: { continue_rate_percent: 80, skip_rate_percent: 15, avg_view_percentage: 82 },
        overall_score: 8,
        feedback: {
          summary: "Hook lento",
          revision_priorities: ["Antecipar a ação visível"],
          block_issues: [{ slot_index: 0, slot_type: "hook", severity: "high", problem: "Demora", required_change: "Abrir com ação" }],
        },
      })
      .mockResolvedValueOnce(passingRawEvaluation);
    const revise = vi.fn(async (blocks) => ({
      blocks: [{ ...blocks[0], generated_text: "A ação mais forte aparece primeiro." }],
      changed_slot_indexes: [0],
      rejected_slot_indexes: [],
      latency_ms: 21,
      model: "test-model",
    }));

    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{ index: 0, slot_type: "hook", generated_text: "Introdução lenta." }],
      maxIterations: 3,
      evaluate,
      revise,
    });

    expect(result.passed).toBe(true);
    expect(result.termination_reason).toBe("quality_gate_passed");
    expect(result.iterations_completed).toBe(2);
    expect(result.audit_trail[0].writer_revision?.agent_role).toBe("dna_writer");
    expect(result.audit_trail[0].draft_fingerprint).toMatch(/^fnv1a32:/);
    expect(result.blocks[0].generated_text).toContain("ação mais forte");
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });

  it("interrompe de forma segura no máximo de quatro avaliações", async () => {
    const failing = {
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 70, skip_rate_percent: 20, avg_view_percentage: 65 },
      overall_score: 6,
      criterion_scores: { ...passingRawEvaluation.criterion_scores, hook: 5, development: 6, payoff: 6, visual_fidelity: 6 },
    };
    const evaluate = vi.fn().mockResolvedValue(failing);
    let revisionNumber = 0;
    const revise = vi.fn(async (blocks) => {
      revisionNumber++;
      return {
        blocks: [{ ...blocks[0], generated_text: `Texto revisado ${revisionNumber}` }],
        changed_slot_indexes: [0],
      };
    });

    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{ index: 0, slot_type: "hook", generated_text: "Texto" }],
      maxIterations: 99,
      evaluate,
      revise,
    });

    expect(result.passed).toBe(false);
    expect(result.termination_reason).toBe("max_iterations_reached");
    expect(result.max_iterations).toBe(DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS);
    expect(evaluate).toHaveBeenCalledTimes(DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS);
    expect(revise).toHaveBeenCalledTimes(DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS - 1);
  });

  it("nao inicia a quarta avaliacao quando ela nao cabe no deadline absoluto", async () => {
    const failing = {
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 70, skip_rate_percent: 30, avg_view_percentage: 70 },
      overall_score: 6,
    };
    const evaluate = vi.fn().mockResolvedValue(failing);
    let revision = 0;
    const revise = vi.fn(async (blocks) => ({
      blocks: [{ ...blocks[0], generated_text: `Revisao ${++revision}` }],
      changed_slot_indexes: [0],
    }));
    const clock = [0, 0, 20, 20, 40, 40, 90];
    let tick = 0;

    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{ index: 0, slot_type: "hook", generated_text: "Texto" }],
      deadlineAtMs: 100,
      minimumEvaluationBudgetMs: 15,
      minimumRevisionBudgetMs: 25,
      now: () => clock[Math.min(tick++, clock.length - 1)],
      evaluate,
      revise,
    });

    expect(result.termination_reason).toBe("time_budget_exhausted");
    expect(result.error).toContain("before_evaluation");
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(revise).toHaveBeenCalledTimes(3);
  });

  it("tenta novamente sem gastar uma avaliação quando o escritor devolve uma revisão sem efeito", async () => {
    const failing = {
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 70, skip_rate_percent: 30, avg_view_percentage: 70 },
      overall_score: 7,
    };
    const evaluate = vi.fn().mockResolvedValue(failing);
    const revise = vi.fn(async (blocks) => ({ blocks, changed_slot_indexes: [] }));

    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{ index: 0, slot_type: "hook", generated_text: "Texto" }],
      maxIterations: 3,
      evaluate,
      revise,
    });

    expect(result.passed).toBe(false);
    expect(result.termination_reason).toBe("writer_error");
    expect(result.error).toBe("writer_revision_no_required_progress_after_2_attempts");
    expect(result.iterations_completed).toBe(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(revise).toHaveBeenCalledTimes(2);
    expect(result.audit_trail[0].writer_revision).toEqual(expect.objectContaining({
      rejected_slot_indexes: [0],
      rejection_reasons_by_slot: { "0": ["writer_revision_no_effect"] },
    }));
  });

  it("não aceita compressão apenas no donor quando o alvo high foi explicitamente rejeitado", async () => {
    const failing = {
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 70, skip_rate_percent: 30, avg_view_percentage: 70 },
      overall_score: 7,
      feedback: {
        summary: "Alvo principal ainda falha",
        revision_priorities: ["Corrigir o hook"],
        block_issues: [{
          slot_index: 0,
          slot_type: "hook",
          severity: "high",
          problem: "Hook sem ação",
          required_change: "Abrir com a ação",
        }],
      },
    };
    let donorAttempt = 0;
    const evaluate = vi.fn().mockResolvedValue(failing);
    const revise = vi.fn(async (blocks) => ({
      blocks: blocks.map((block) => block.index === 1
        ? { ...block, generated_text: `Donor comprimido ${++donorAttempt}` }
        : block),
      changed_slot_indexes: [1],
      rejected_slot_indexes: [0],
      rejection_reasons_by_slot: { "0": ["hook_guard_failed"] },
    }));

    const initialBlocks = [
      { index: 0, slot_type: "hook", generated_text: "Hook original" },
      { index: 1, slot_type: "desenvolvimento", generated_text: "Donor original" },
    ];
    const result = await runViralWriterEvaluatorLoop({ initialBlocks, evaluate, revise });

    expect(result.termination_reason).toBe("writer_error");
    expect(result.iterations_completed).toBe(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(revise).toHaveBeenCalledTimes(2);
    expect(result.blocks).toEqual(initialBlocks);
    expect(result.audit_trail[0].writer_revision).toEqual(expect.objectContaining({
      changed_slot_indexes: [],
      rejected_slot_indexes: [0, 1],
      rejection_reasons_by_slot: expect.objectContaining({
        "0": ["hook_guard_failed"],
        "1": ["writer_revision_non_target_change_without_required_progress"],
      }),
    }));
  });

  it("descarta a revisão inteira quando um segundo alvo affected fica silencioso", async () => {
    const failing = {
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 70, skip_rate_percent: 30, avg_view_percentage: 70 },
      overall_score: 7,
      __narrative_fidelity_gate: passingNarrativeGate({
        passed: false,
        reasons: ["slot_1_event_missing"],
        affected_slot_indexes: [1],
      }),
      feedback: {
        summary: "Dois alvos materiais",
        revision_priorities: ["Corrigir os dois blocos"],
        block_issues: [0].map((slot_index) => ({
          slot_index,
          slot_type: slot_index === 0 ? "hook" : "desenvolvimento",
          severity: "high",
          problem: "Fato material ausente",
          required_change: "Restaurar o fato local",
        })),
      },
    };
    let attempt = 0;
    const evaluate = vi.fn().mockResolvedValue(failing);
    const revise = vi.fn(async (blocks) => ({
      blocks: blocks.map((block) => block.index === 0
        ? { ...block, generated_text: `Hook corrigido ${++attempt}` }
        : block),
      changed_slot_indexes: [0],
      rejected_slot_indexes: [],
      rejection_reasons_by_slot: {},
    }));
    const initialBlocks = [
      { index: 0, slot_type: "hook", generated_text: "Hook original" },
      { index: 1, slot_type: "desenvolvimento", generated_text: "Desenvolvimento original" },
    ];

    const result = await runViralWriterEvaluatorLoop({ initialBlocks, evaluate, revise });

    expect(result.termination_reason).toBe("writer_error");
    expect(result.iterations_completed).toBe(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(revise).toHaveBeenCalledTimes(2);
    expect(result.blocks).toEqual(initialBlocks);
    expect(result.audit_trail[0].writer_revision).toEqual(expect.objectContaining({
      changed_slot_indexes: [],
      rejection_reasons_by_slot: expect.objectContaining({
        "1": ["writer_revision_required_target_silent"],
      }),
    }));
  });

  it("tenta novamente quando todos os blocos foram explicitamente rejeitados pelos guardas", async () => {
    const failing = {
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 70, skip_rate_percent: 30, avg_view_percentage: 70 },
      overall_score: 7,
    };
    const evaluate = vi.fn()
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(passingRawEvaluation);
    const revise = vi.fn()
      .mockImplementationOnce(async (blocks) => ({
        blocks,
        changed_slot_indexes: [],
        rejected_slot_indexes: [0],
        rejection_reasons_by_slot: { "0": ["word_count:37:above_p90"] },
      }))
      .mockImplementationOnce(async (blocks) => ({
        blocks: [{ ...blocks[0], generated_text: "Texto finalmente corrigido." }],
        changed_slot_indexes: [0],
        rejected_slot_indexes: [],
      }));

    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{ index: 0, slot_type: "hook", generated_text: "Texto" }],
      evaluate,
      revise,
    });

    expect(result.passed).toBe(true);
    expect(result.iterations_completed).toBe(2);
    expect(result.audit_trail[0].writer_revision).toEqual(expect.objectContaining({
      changed_slot_indexes: [0],
      rejected_slot_indexes: [],
      rejection_reasons_by_slot: {},
    }));
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(2);
  });

  it("reavalia quando o escritor corrige somente a trilha factual do mesmo texto", async () => {
    const failing = {
      ...passingRawEvaluation,
      estimated_metrics: { continue_rate_percent: 70, skip_rate_percent: 30, avg_view_percentage: 70 },
      overall_score: 7,
    };
    const evaluate = vi.fn()
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(passingRawEvaluation);
    const revise = vi.fn(async (blocks) => ({
      blocks: blocks.map((block) => ({
        ...block,
        narrative_event_checklist: {
          acknowledged_event_ids: ["slot:0:transcript:0"],
          event_text_evidence: [{
            event_id: "slot:0:transcript:0",
            text_excerpt: "Texto",
          }],
        },
      })),
      changed_slot_indexes: [0],
    }));

    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{
        index: 0,
        slot_type: "hook",
        generated_text: "Texto",
        narrative_event_checklist: {
          acknowledged_event_ids: ["slot:0:transcript:0"],
          event_text_evidence: [{
            event_id: "slot:0:transcript:0",
            text_excerpt: "Tex",
          }],
        },
      }],
      evaluate,
      revise,
    });

    expect(result.passed).toBe(true);
    expect(result.iterations_completed).toBe(2);
    expect(result.audit_trail[0].writer_revision?.changed_slot_indexes).toEqual([0]);
    expect(result.blocks[0].generated_text).toBe("Texto");
  });

  it("atribui ao escritor a falha do contrato deterministico anterior ao avaliador", async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error("draft_contract_incomplete:3"));
    const revise = vi.fn();

    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{ index: 3, slot_type: "desenvolvimento", generated_text: "Frase longa." }],
      evaluate,
      revise,
    });

    expect(result.passed).toBe(false);
    expect(result.termination_reason).toBe("writer_error");
    expect(result.error).toBe("draft_contract_incomplete:3");
    expect(revise).not.toHaveBeenCalled();
  });

  it("reserva a janela Edge e não inicia avaliação que não cabe no orçamento", async () => {
    const evaluate = vi.fn().mockResolvedValue(passingRawEvaluation);
    const revise = vi.fn();
    const result = await runViralWriterEvaluatorLoop({
      initialBlocks: [{ index: 0, slot_type: "hook", generated_text: "Texto" }],
      deadlineAtMs: 10_000,
      minimumEvaluationBudgetMs: 2_000,
      now: () => 8_500,
      evaluate,
      revise,
    });

    expect(result.passed).toBe(false);
    expect(result.termination_reason).toBe("time_budget_exhausted");
    expect(result.error).toContain("before_evaluation");
    expect(evaluate).not.toHaveBeenCalled();
    expect(revise).not.toHaveBeenCalled();
  });

  it("extrai JSON mesmo quando o provedor envolve a resposta em markdown", () => {
    expect(extractJsonObject("```json\n{\"overall_score\":9}\n```"))
      .toEqual({ overall_score: 9 });
  });

  it("preserva modelo e latência como trilha técnica, sem confiar no modelo para aprovação", () => {
    const normalized = normalizeViralEvaluation({
      ...passingRawEvaluation,
      __agent_meta: { model: "gemini-test", latency_ms: 123.8 },
    }, 2);
    expect(normalized.model).toBe("gemini-test");
    expect(normalized.latency_ms).toBe(123);
    expect(normalized.iteration).toBe(2);
  });

  it("vincula o parecer do avaliador ao conteudo e ordem exatos dos blocos", () => {
    const blocks = [
      { index: 0, slot_type: "hook", generated_text: "A porta se abre." },
      { index: 1, slot_type: "payoff", generated_text: "O segredo aparece." },
    ];
    const original = viralDraftFingerprint(blocks);

    expect(original).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(viralDraftFingerprint([{ ...blocks[0], generated_text: "A porta desaparece." }, blocks[1]]))
      .not.toBe(original);
    expect(viralDraftFingerprint([...blocks].reverse())).not.toBe(original);
    expect(viralDraftFingerprint([{
      ...blocks[0],
      narrative_event_checklist: {
        acknowledged_event_ids: ["event:1"],
        event_text_evidence: [{ event_id: "event:1", text_excerpt: "A porta se abre" }],
      },
    }, blocks[1]])).not.toBe(original);
  });

  it("reprova se qualquer critério crítico ficar abaixo de 8,5", () => {
    const gate = evaluateViralQualityGates(
      passingRawEvaluation.estimated_metrics,
      { ...passingRawEvaluation.criterion_scores, payoff: 8.4 },
      9,
    );
    expect(gate.passed).toBe(false);
    expect(gate.failed_gates).toContain("payoff_score_below_8_5");
  });

  it("aloca o alvo total do vídeo sem sair de nenhum intervalo p10/p90", () => {
    const ranges = [
      { index: 0, min: 8, max: 25 },
      { index: 1, min: 10, max: 42 },
      { index: 2, min: 10, max: 48 },
      { index: 3, min: 10, max: 48 },
      { index: 4, min: 10, max: 48 },
      { index: 5, min: 10, max: 48 },
      { index: 6, min: 10, max: 50 },
    ];
    const contract = resolveViralWordCountContract(ranges, 207, 82.94);

    expect(contract.requested_target).toBe(207);
    expect(contract.target).toBe(207);
    expect(contract.acceptable_min).toBeGreaterThanOrEqual(contract.total_p10);
    expect(contract.acceptable_max).toBeLessThanOrEqual(contract.total_p90);
    expect(contract.allocations.reduce((sum, item) => sum + item.target_words, 0)).toBe(207);
    expect(contract.allocations.every((item) => item.target_words >= item.min && item.target_words <= item.max)).toBe(true);
  });

  it("uses real duration times measured DNA pacing instead of a short topic estimate", () => {
    const ranges = [
      { index: 1, min: 12, max: 19 },
      { index: 2, min: 9, max: 30 },
      { index: 3, min: 10, max: 34 },
      { index: 4, min: 9, max: 33 },
      { index: 5, min: 10, max: 34 },
      { index: 6, min: 10, max: 34 },
      { index: 7, min: 10, max: 33 },
    ];
    const contract = resolveViralWordCountContract(ranges, 145, 58, 0.12, 3.8);
    expect(contract.requested_target).toBe(220);
    expect(contract.target).toBe(contract.total_p90);
    expect(contract.acceptable_min).toBeGreaterThanOrEqual(191);
  });

  it("computes median DNA pacing from valid ready slots", () => {
    expect(resolveViralPacingWordsPerSecond([
      { dna_strategy_ref: { avg_words_per_second: 3.7 } },
      { dna_strategy_ref: { avg_words_per_second: 3.9 } },
      { dna_strategy_ref: { avg_words_per_second: 99 } },
      { generation_ready: false, dna_strategy_ref: { avg_words_per_second: 1 } },
    ])).toBe(3.8);
  });

  it("uses the intersection of narrative and DNA word ranges everywhere", () => {
    expect(resolveViralSlotWordRange({
      index: 7,
      word_count_rule: { p10: 9, p90: 60 },
      dna_strategy_ref: { word_range: { min: 12, max: 30 } },
    })).toEqual({ index: 7, min: 12, max: 30 });
  });

  it("limits the hook narration to the measured 3-5 second delivery window", () => {
    expect(resolveViralSlotWordRange({
      index: 0,
      slot_type: "hook",
      word_count_rule: { p10: 8, p90: 46 },
      dna_strategy_ref: {
        word_range: { min: 10, max: 36 },
        avg_words_per_second: 3.89,
      },
    })).toEqual({ index: 0, min: 12, max: 19 });
  });

  it("makes the explicit 3-5 second hook contract override an incompatible legacy range", () => {
    expect(resolveViralSlotWordRange({
      index: 0,
      slot_type: "hook",
      word_count_rule: { p10: 25, p90: 60 },
      dna_strategy_ref: {
        word_range: { min: 28, max: 45 },
        avg_words_per_second: 4,
      },
    })).toEqual({ index: 0, min: 12, max: 20 });
  });

  it.each([undefined, 0, 100, "invalid"])("uses a bounded fallback for invalid hook WPS (%s)", (rate) => {
    expect(resolveViralSlotWordRange({
      index: 0,
      slot_type: "hook",
      word_count_rule: { p10: 1, p90: 100 },
      dna_strategy_ref: { word_range: { min: 1, max: 100 }, avg_words_per_second: rate },
    })).toEqual({ index: 0, min: 11, max: 17 });
  });
});

describe("integração fail-closed do gate viral", () => {
  const source = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

  it("mantém os dois papéis separados e persiste a trilha no assemble-script", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    expect(assembler).toContain("AGENTE ESCRITOR DNA");
    expect(assembler).toContain("AGENTE AVALIADOR VIRAL");
    expect(assembler).toContain("runViralWriterEvaluatorLoop");
    expect(assembler).toContain("writer_evaluator_loop: writerEvaluatorLoop");
    expect(assembler).toContain('metrics_kind: "pre_publication_ai_estimates"');
    expect(assembler).toContain("Visual pixels remain the");
    expect(assembler).toContain("generateWholeVideoDraft");
    expect(assembler).toContain("assessProtectedCopyGuardsBatch");
    expect(assembler).toContain('stage: "batch_dna_writer"');
    expect(assembler).toContain('stage: "total_word_count_contract"');
    expect(assembler).toContain("minimumEvaluationBudgetMs");
  });

  it("repara deficit global curto com evidencia sem afrouxar o rollback fail-closed", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    const plannerImport = assembler.indexOf("resolveRevisionWordFloorRepairPlan");
    const floorIssue = assembler.indexOf("writer_revision_whole_script_word_count_below_contract");
    const floorSpecialist = assembler.indexOf("ESCRITOR ESPECIALISTA DE PISO DE DURACAO");
    const semanticCopyGuard = assembler.indexOf("assessProtectedCopyGuardsBatch(revisionGuardCandidates");
    const belowFloorRollback = assembler.indexOf("revisedTotalWordCount < totalWordCountContract.acceptable_min");

    expect(plannerImport).toBeGreaterThan(-1);
    expect(floorIssue).toBeGreaterThan(plannerImport);
    expect(floorSpecialist).toBeGreaterThan(floorIssue);
    expect(semanticCopyGuard).toBeGreaterThan(floorSpecialist);
    expect(belowFloorRollback).toBeGreaterThan(semanticCopyGuard);
    expect(assembler).toContain("add exactly add_words until that block reaches target_words");
    expect(assembler).toContain("Expanda um detalhe ja presente na evidencia do proprio slot");
    expect(assembler).toContain("words !== target.target_words");
    expect(assembler).toContain("const conversationalRegister = assessPtBrConversationalRegister(");
    expect(assembler).toContain("localClaimEvidenceForSelection(options.payload, candidate.slot.visual_evidence_selection)");
    expect(assembler).toContain("assessGroundedControversyClaims({");
    expect(assembler).toContain("assessLocalClaimGrounding({");
    expect(assembler).toContain("changedIndexes.length = 0");
  });

  it("bloqueia revisão quando o Avaliador Viral habilitado não aprovou", () => {
    const reviser = source("../../../supabase/functions/revise-script-assembly/index.ts");
    const viralGate = reviser.indexOf("const viralReviewGate = assessRequiredViralReview(");
    const validator = reviser.indexOf('invokeInternal(supabaseUrl, serviceKey, "validate-script-against-dna"');
    const revised = reviser.indexOf('status: "revised"');
    expect(viralGate).toBeGreaterThan(-1);
    expect(validator).toBeGreaterThan(viralGate);
    expect(revised).toBeGreaterThan(validator);
  });

  it("propaga a auditoria no validador e impede aprovação direta do gate reprovado", () => {
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    expect(validator).toContain("assessRequiredViralReview(inputMode, writerEvaluatorLoop)");
    expect(validator).toContain("viralReviewGateFailed");
    expect(validator).toContain("writer_evaluator_loop: writerEvaluatorLoop");
    expect(validator).toContain("containsExplicitNightlyFrequency");
    expect(validator).toContain("explicit_nightly_frequency_in_generated_and_local_transcript");
    expect(validator).toContain("explicit_pursuit_in_generated_text_and_local_frames");
    expect(validator).toContain('materialVisualActionRuleIds(localFrameText).includes("pursuit")');
    expect(validator).toContain("resolveValidatedEffectiveWordContract(");
    const viralBranch = validator.indexOf("else if (viralReviewGateFailed)");
    const approvedBranch = validator.indexOf('validationStatus = "approved"');
    expect(viralBranch).toBeGreaterThan(-1);
    expect(approvedBranch).toBeGreaterThan(viralBranch);
  });

  it("impede promocao de video sem loop habilitado e aprovado", () => {
    const promoter = source("../../../supabase/functions/promote-script-final/index.ts");
    expect(promoter).toContain("resolveScriptInputMode(assembly?.assembly_rules, genCtx.generation_rules)");
    expect(promoter).toContain("assessRequiredViralReview(inputMode, writerEvaluatorLoop)");
    expect(promoter).toContain("viralReviewGate.passed !== true");
  });

  it("faz promoção e revisão herdarem o fechamento narrativo v2 fail-closed", () => {
    const guard = source("../../../supabase/functions/_shared/required-viral-review.ts");
    const promoter = source("../../../supabase/functions/promote-script-final/index.ts");
    const reviser = source("../../../supabase/functions/revise-script-assembly/index.ts");
    expect(guard).toContain("narrativeFidelityClosureFailure(finalEvaluation, locallyVerified)");
    expect(guard).toContain("full_microevent_audit length does not match");
    expect(guard).toContain("independent narrative audit contract version 2");
    for (const consumer of [promoter, reviser]) {
      expect(consumer).toContain("assessRequiredViralReview(");
      expect(consumer).toContain("viralReviewGate.passed !== true");
    }
    expect(promoter.indexOf("viralReviewGate.passed !== true"))
      .toBeLessThan(promoter.indexOf('.from("promoted_scripts")'));
  });

  it("recalcula cobertura, total de palavras e fingerprint antes de validar e promover", () => {
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    const promoter = source("../../../supabase/functions/promote-script-final/index.ts");

    for (const implementation of [validator, promoter]) {
      expect(implementation).toContain("assessExactSlotCoverage");
      expect(implementation).toContain("assessGlobalWordCountContract");
      expect(implementation).toContain("resolveViralWordCountContract");
      expect(implementation).toContain("persisted_total_word_count_contract_mismatch");
      expect(implementation).toContain("persisted_slot_word_allocations_mismatch");
      expect(implementation).toContain("effective_slot_word_range_violations");
      expect(implementation).toContain("resolveValidatedEffectiveWordContract");
      expect(implementation).toContain('termination_reason === "quality_gate_passed"');
      expect(implementation).toContain("assessCurrentViralFingerprint");
      expect(implementation).toContain("viralDraftFingerprint");
      expect(implementation).toContain("audit[audit.length - 1]");
      expect(implementation).toContain("current_script_blocks_do_not_match_last_evaluated_draft");
    }

    expect(validator).toContain("!exactSlotCoverage.passed");
    expect(validator).toContain("!globalWordCountContract.passed");
    expect(validator).toContain("!currentViralFingerprint.passed");
    expect(promoter).toContain("finalAcceptanceFailures.length > 0");
    expect(promoter.indexOf("finalAcceptanceFailures.length > 0"))
      .toBeLessThan(promoter.indexOf('.from("promoted_scripts")'));
  });

  it("autentica a promocao e verifica ownership antes de avaliar elegibilidade", () => {
    const promoter = source("../../../supabase/functions/promote-script-final/index.ts");
    const authenticate = promoter.indexOf("await requireUserOrService(");
    const ownership = promoter.indexOf("assertResourceOwner(actor, assembly.user_id)");
    const eligibility = promoter.indexOf("const blocks: string[] = []");
    expect(authenticate).toBeGreaterThan(-1);
    expect(ownership).toBeGreaterThan(authenticate);
    expect(eligibility).toBeGreaterThan(ownership);
    expect(promoter).toContain("err instanceof EdgeAuthError");
    expect(promoter).toContain('error_code: err.code');
    expect(promoter).not.toContain("SUPABASE_ANON_KEY");
    expect(promoter).not.toContain("jwtUserId");
  });
});
