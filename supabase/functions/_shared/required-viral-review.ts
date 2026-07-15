import {
  DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS,
  DEFAULT_VIRAL_REVIEW_THRESHOLDS,
  narrativeFidelityAuditFingerprint,
  normalizeViralEvaluation,
  viralEvaluationEvidenceFingerprint,
} from "./viral-review-loop.ts";

export interface ViralReviewReportLike {
  enabled?: boolean;
  passed?: boolean;
  writer_agent?: unknown;
  evaluator_agent?: unknown;
  termination_reason?: string | null;
  iterations_completed?: number;
  max_iterations?: number;
  thresholds?: unknown;
  metrics_kind?: string;
  final_evaluation?: unknown;
  audit_trail?: unknown;
}

export interface RequiredViralReviewAssessment {
  required: boolean;
  passed: boolean;
  reason: string | null;
}

function normalizedInputMode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function finiteInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function validIndexList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(finiteInteger);
  if (parsed.some((item) => item === null || item! < 0)) return null;
  const indexes = parsed as number[];
  return new Set(indexes).size === indexes.length ? indexes : null;
}

function thresholdsAreExact(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return Object.entries(DEFAULT_VIRAL_REVIEW_THRESHOLDS)
    .every(([key, expected]) => Number(source[key]) === expected);
}

function evaluationEvidenceSignature(value: ReturnType<typeof normalizeViralEvaluation>): string {
  return JSON.stringify({
    iteration: value.iteration,
    estimated_metrics: value.estimated_metrics,
    criterion_scores: value.criterion_scores,
    overall_score: value.overall_score,
    failed_gates: value.failed_gates,
    narrative_fidelity_gate: value.narrative_fidelity_gate,
    hook_payoff_resolution_gate: value.hook_payoff_resolution_gate,
    feedback: value.feedback,
    evidence_limits: value.evidence_limits,
    evaluation_fingerprint: value.evaluation_fingerprint,
  });
}

function hookPayoffResolutionClosureFailure(
  rawEvaluation: Record<string, unknown>,
  normalizedEvaluation: ReturnType<typeof normalizeViralEvaluation>,
): string | null {
  const rawGate = rawEvaluation.hook_payoff_resolution_gate;
  if (!rawGate || typeof rawGate !== "object" || Array.isArray(rawGate)) {
    return "final evaluator evidence is missing the required hook_payoff_resolution_gate";
  }
  const gate = rawGate as Record<string, unknown>;
  const normalized = normalizedEvaluation.hook_payoff_resolution_gate;
  if (!normalized || gate.required !== true || normalized.required !== true) {
    return "hook_payoff_resolution_gate.required must be true for video input";
  }
  if (gate.passed !== true || normalized.passed !== true) {
    return "hook_payoff_resolution_gate must confirm semantic closure before video promotion";
  }
  if (typeof gate.pair_fingerprint !== "string"
    || !EVIDENCE_FINGERPRINT_PATTERN.test(gate.pair_fingerprint)
    || gate.pair_fingerprint !== normalized.pair_fingerprint) {
    return "hook_payoff_resolution_gate pair_fingerprint is missing or invalid";
  }
  if (finiteInteger(gate.hook_index) === null || finiteInteger(gate.payoff_index) === null) {
    return "hook_payoff_resolution_gate hook/payoff indexes are invalid";
  }
  if (gate.semantic_resolution_confirmed !== true
    || typeof gate.open_loop !== "string" || gate.open_loop.trim().length < 4
    || typeof gate.semantic_answer !== "string" || gate.semantic_answer.trim().length < 4
    || typeof gate.reason !== "string" || gate.reason.trim().length < 4
    || gate.object_overlap_alone_is_insufficient !== true) {
    return "hook_payoff_resolution_gate lacks a complete semantic promise/answer verdict";
  }
  return null;
}

const EVIDENCE_FINGERPRINT_PATTERN = /^fnv1a32:[0-9a-f]{8}$/;

function signedEvaluationEvidenceFailure(
  raw: Record<string, unknown>,
  normalized: ReturnType<typeof normalizeViralEvaluation>,
): string | null {
  const fingerprint = raw.evaluation_fingerprint;
  if (typeof fingerprint !== "string" || !EVIDENCE_FINGERPRINT_PATTERN.test(fingerprint)) {
    return "evaluator evidence fingerprint is missing or invalid";
  }
  if (
    fingerprint !== viralEvaluationEvidenceFingerprint(raw)
    || fingerprint !== normalized.evaluation_fingerprint
  ) {
    return "evaluator evidence fingerprint is inconsistent with the persisted evaluation";
  }
  return null;
}

/**
 * Promotion is allowed only from a complete, internally consistent audit of
 * every required narrative microevent. Keep this stricter than normalization:
 * normalization makes model output safe to inspect, while this function
 * decides whether persisted evidence is eligible for a state transition.
 */
function narrativeFidelityClosureFailure(
  rawEvaluation: Record<string, unknown>,
  normalizedEvaluation: ReturnType<typeof normalizeViralEvaluation>,
): string | null {
  const rawGate = rawEvaluation.narrative_fidelity_gate;
  if (!rawGate || typeof rawGate !== "object" || Array.isArray(rawGate)) {
    return "final evaluator evidence is missing the required narrative_fidelity_gate";
  }
  const gate = rawGate as Record<string, unknown>;
  const normalizedGate = normalizedEvaluation.narrative_fidelity_gate;
  if (!normalizedGate) {
    return "final evaluator evidence has an invalid narrative_fidelity_gate";
  }
  if (gate.required !== true || normalizedGate.required !== true) {
    return "narrative_fidelity_gate.required must be true for video input";
  }
  if (gate.passed !== true || normalizedGate.passed !== true) {
    return "narrative_fidelity_gate.passed must be true before video promotion";
  }
  if (gate.source !== "independent_narrative_auditor"
    || normalizedGate.source !== "independent_narrative_auditor") {
    return "narrative_fidelity_gate must identify the independent_narrative_auditor source";
  }
  if (finiteInteger(gate.contract_version) !== 2
    || normalizedGate.contract_version !== 2) {
    return "narrative_fidelity_gate requires independent narrative audit contract version 2";
  }
  if (gate.audit_source !== gate.source || normalizedGate.audit_source !== normalizedGate.source) {
    return "narrative_fidelity_gate canonical source and audit_source alias are inconsistent";
  }
  if (finiteInteger(gate.audit_contract_version) !== finiteInteger(gate.contract_version)
    || normalizedGate.audit_contract_version !== normalizedGate.contract_version) {
    return "narrative_fidelity_gate canonical contract_version and alias are inconsistent";
  }
  if (typeof gate.plan_fingerprint !== "string"
    || !EVIDENCE_FINGERPRINT_PATTERN.test(gate.plan_fingerprint)
    || gate.plan_fingerprint !== normalizedGate.plan_fingerprint) {
    return "narrative_fidelity_gate plan_fingerprint is missing or invalid";
  }
  const visualCandidates = finiteInteger(gate.visual_candidate_count);
  const requiredVisualEvents = finiteInteger(gate.required_visual_event_count);
  if (visualCandidates === null || requiredVisualEvents === null
    || visualCandidates < 0 || requiredVisualEvents < 0
    || requiredVisualEvents > visualCandidates) {
    return "narrative_fidelity_gate visual event counts are invalid";
  }
  const visualCandidateAudit = gate.visual_candidate_audit;
  if (!Array.isArray(visualCandidateAudit) || visualCandidateAudit.length !== visualCandidates) {
    return "narrative_fidelity_gate visual_candidate_audit must dispose every visual candidate";
  }
  const visualCandidateIds = new Set<string>();
  const requiredVisualCandidateIds = new Set<string>();
  for (const rawCandidate of visualCandidateAudit) {
    if (!rawCandidate || typeof rawCandidate !== "object" || Array.isArray(rawCandidate)) {
      return "narrative_fidelity_gate visual_candidate_audit contains an invalid candidate";
    }
    const candidate = rawCandidate as Record<string, unknown>;
    const eventId = typeof candidate.event_id === "string" ? candidate.event_id.trim() : "";
    if (!eventId || visualCandidateIds.has(eventId)) {
      return "narrative_fidelity_gate visual candidate IDs must be non-empty and unique";
    }
    visualCandidateIds.add(eventId);
    if (finiteInteger(candidate.script_slot_index) === null) {
      return "narrative_fidelity_gate visual candidate script_slot_index is invalid";
    }
    if (candidate.materiality !== "required" && candidate.materiality !== "redundant") {
      return "narrative_fidelity_gate visual candidate materiality is invalid";
    }
    if (candidate.materiality === "required") {
      requiredVisualCandidateIds.add(eventId);
      if (candidate.coverage !== "covered"
        || (candidate.causal_relation !== "preserved" && candidate.causal_relation !== "not_applicable")) {
        return "narrative_fidelity_gate required visual candidate is uncovered or causally invalid";
      }
    }
  }
  if (requiredVisualCandidateIds.size !== requiredVisualEvents) {
    return "narrative_fidelity_gate required visual candidate count is inconsistent";
  }

  const auditFingerprint = gate.audit_fingerprint;
  if (typeof auditFingerprint !== "string" || !EVIDENCE_FINGERPRINT_PATTERN.test(auditFingerprint)) {
    return "narrative_fidelity_gate audit fingerprint is missing or invalid";
  }
  if (
    auditFingerprint !== narrativeFidelityAuditFingerprint(gate)
    || auditFingerprint !== normalizedGate.audit_fingerprint
  ) {
    return "narrative_fidelity_gate audit fingerprint is inconsistent with its evidence";
  }

  const audited = finiteInteger(gate.audited_microevents);
  const required = finiteInteger(gate.required_audited_microevents);
  if (audited === null || required === null || audited <= 0 || required <= 0 || audited !== required) {
    return "narrative_fidelity_gate audited_microevents must equal required_audited_microevents and be greater than zero";
  }

  const fullAudit = gate.full_microevent_audit;
  if (!Array.isArray(fullAudit) || fullAudit.length !== required) {
    return "narrative_fidelity_gate full_microevent_audit length does not match required_audited_microevents";
  }
  const compactAudit = gate.microevent_audit;
  if (!Array.isArray(compactAudit) || compactAudit.length !== required) {
    return "narrative_fidelity_gate microevent_audit length does not match required_audited_microevents";
  }

  const compactById = new Map<string, Record<string, unknown>>();
  for (const rawEvent of compactAudit) {
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      return "narrative_fidelity_gate microevent_audit contains an invalid event";
    }
    const event = rawEvent as Record<string, unknown>;
    const eventId = typeof event.event_id === "string" ? event.event_id.trim() : "";
    if (!eventId || compactById.has(eventId)) {
      return "narrative_fidelity_gate microevent_audit event_id values must be non-empty and unique";
    }
    compactById.set(eventId, event);
  }

  const fullIds = new Set<string>();
  for (const rawEvent of fullAudit) {
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      return "narrative_fidelity_gate full_microevent_audit contains an invalid event";
    }
    const event = rawEvent as Record<string, unknown>;
    const eventId = typeof event.event_id === "string" ? event.event_id.trim() : "";
    if (!eventId || fullIds.has(eventId)) {
      return "narrative_fidelity_gate full_microevent_audit event_id values must be non-empty and unique";
    }
    fullIds.add(eventId);
    if (event.coverage_status !== "covered") {
      return "narrative_fidelity_gate full_microevent_audit contains an uncovered or distorted event";
    }
    if (event.causal_status !== "preserved" && event.causal_status !== "not_applicable") {
      return "narrative_fidelity_gate full_microevent_audit contains an invalid causal_status";
    }
    if (event.coverage !== event.coverage_status || event.causal_relation !== event.causal_status) {
      return "narrative_fidelity_gate full_microevent_audit contains inconsistent status aliases";
    }
    const compact = compactById.get(eventId);
    if (!compact) {
      return "narrative_fidelity_gate full and compact audits do not describe the same event IDs";
    }
    if (compact.coverage !== event.coverage_status || compact.causal_relation !== event.causal_status) {
      return "narrative_fidelity_gate full and compact audit statuses are inconsistent";
    }
  }
  for (const eventId of requiredVisualCandidateIds) {
    if (!fullIds.has(eventId)) {
      return "narrative_fidelity_gate required visual candidate is missing from the full audit";
    }
  }

  for (const [field, reason] of [
    ["reasons", "narrative_fidelity_gate must not retain failure reasons"],
    ["complete_narrative_gaps", "narrative_fidelity_gate contains complete narrative gaps"],
    ["causal_errors", "narrative_fidelity_gate contains causal errors"],
    ["affected_slot_indexes", "narrative_fidelity_gate contains affected slot indexes"],
  ] as const) {
    const value = gate[field];
    if (!Array.isArray(value) || value.length !== 0) return reason;
  }
  return null;
}

/**
 * Resolve o modo persistido sem permitir que uma linha legada incompleta
 * desative silenciosamente o contrato de video. Video era o modo padrao, logo
 * modo desconhecido ou ausente continua fechado como video.
 */
export function resolveScriptInputMode(
  assemblyRules: unknown,
  generationRules: unknown,
): string {
  const assemblyMode = normalizedInputMode(
    typeof assemblyRules === "object" && assemblyRules !== null
      ? (assemblyRules as Record<string, unknown>).input_mode
      : null,
  );
  const generationMode = normalizedInputMode(
    typeof generationRules === "object" && generationRules !== null
      ? (generationRules as Record<string, unknown>).input_mode
      : null,
  );
  if (assemblyMode === "video" || generationMode === "video") return "video";
  return assemblyMode || generationMode || "video";
}

/**
 * Video so e elegivel quando a revisao independente foi habilitada e aprovada.
 *
 * `passed` is persisted JSON and therefore untrusted. Recompute the exact
 * quality gates from the final evaluation so a stale, legacy, or manually
 * edited boolean can never make a video script eligible by itself.
 */
export function assessRequiredViralReview(
  inputMode: unknown,
  report: ViralReviewReportLike | null | undefined,
): RequiredViralReviewAssessment {
  if (normalizedInputMode(inputMode) !== "video") {
    return { required: false, passed: true, reason: null };
  }
  if (!report || report.enabled !== true) {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop is required and must be enabled for video input",
    };
  }
  if (report.writer_agent !== "dna_writer" || report.evaluator_agent !== "viral_evaluator") {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop must preserve separate dna_writer and viral_evaluator roles",
    };
  }
  if (report.termination_reason !== "quality_gate_passed") {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop did not terminate with quality_gate_passed",
    };
  }
  if (report.metrics_kind !== "pre_publication_ai_estimates") {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop has an invalid metrics_kind",
    };
  }
  const maxIterations = finiteInteger(report.max_iterations);
  const iterationsCompleted = finiteInteger(report.iterations_completed);
  if (maxIterations === null || maxIterations < 1 || maxIterations > DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS) {
    return {
      required: true,
      passed: false,
      reason: `writer_evaluator_loop max_iterations must be between 1 and ${DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS}`,
    };
  }
  if (iterationsCompleted === null || iterationsCompleted < 1 || iterationsCompleted > maxIterations) {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop iterations_completed is inconsistent with max_iterations",
    };
  }
  if (!thresholdsAreExact(report.thresholds)) {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop thresholds do not match the required local quality contract",
    };
  }
  if (!report.final_evaluation || typeof report.final_evaluation !== "object") {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop is missing its final evaluation evidence",
    };
  }

  const finalEvaluation = report.final_evaluation as Record<string, unknown>;
  if (finalEvaluation.agent_role !== "viral_evaluator") {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop final evidence was not produced under the viral_evaluator role",
    };
  }
  const locallyVerified = normalizeViralEvaluation(
    finalEvaluation,
    iterationsCompleted,
  );
  const signedEvidenceFailure = signedEvaluationEvidenceFailure(finalEvaluation, locallyVerified);
  if (signedEvidenceFailure) {
    return {
      required: true,
      passed: false,
      reason: `writer_evaluator_loop ${signedEvidenceFailure}`,
    };
  }
  const narrativeClosureFailure = narrativeFidelityClosureFailure(finalEvaluation, locallyVerified);
  if (narrativeClosureFailure) {
    return {
      required: true,
      passed: false,
      reason: `writer_evaluator_loop ${narrativeClosureFailure}`,
    };
  }
  const hookPayoffClosureFailure = hookPayoffResolutionClosureFailure(finalEvaluation, locallyVerified);
  if (hookPayoffClosureFailure) {
    return {
      required: true,
      passed: false,
      reason: `writer_evaluator_loop ${hookPayoffClosureFailure}`,
    };
  }
  if (locallyVerified.iteration !== iterationsCompleted || Number(finalEvaluation.iteration) !== iterationsCompleted) {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop final evaluator iteration is inconsistent",
    };
  }
  if (locallyVerified.passed !== true) {
    return {
      required: true,
      passed: false,
      reason: `writer_evaluator_loop failed local gate verification: ${locallyVerified.failed_gates.join(", ") || "final_evaluation_not_approved"}`,
    };
  }
  const audit = Array.isArray(report.audit_trail) ? report.audit_trail : [];
  if (audit.length !== iterationsCompleted) {
    return {
      required: true,
      passed: false,
      reason: "writer_evaluator_loop audit_trail length does not match iterations_completed",
    };
  }
  let previousFingerprint: string | null = null;
  for (let position = 0; position < audit.length; position++) {
    const entry = audit[position] && typeof audit[position] === "object"
      ? audit[position] as Record<string, any>
      : null;
    const expectedIteration = position + 1;
    if (!entry || finiteInteger(entry.iteration) !== expectedIteration) {
      return { required: true, passed: false, reason: "writer_evaluator_loop audit iterations are not contiguous" };
    }
    if (typeof entry.draft_fingerprint !== "string" || !/^fnv1a32:[0-9a-f]{8}$/.test(entry.draft_fingerprint)) {
      return { required: true, passed: false, reason: "writer_evaluator_loop audit contains an invalid draft fingerprint" };
    }
    if (previousFingerprint === entry.draft_fingerprint) {
      return { required: true, passed: false, reason: "writer_evaluator_loop writer did not change the draft between evaluations" };
    }
    previousFingerprint = entry.draft_fingerprint;
    if (!entry.evaluator || entry.evaluator.agent_role !== "viral_evaluator") {
      return { required: true, passed: false, reason: "writer_evaluator_loop audit contains an invalid evaluator role" };
    }
    const auditedEvaluation = normalizeViralEvaluation(entry.evaluator, expectedIteration);
    const auditedEvidenceFailure = signedEvaluationEvidenceFailure(entry.evaluator, auditedEvaluation);
    if (auditedEvidenceFailure) {
      return {
        required: true,
        passed: false,
        reason: `writer_evaluator_loop audit ${auditedEvidenceFailure}`,
      };
    }
    if (Number(entry.evaluator.iteration) !== expectedIteration) {
      return { required: true, passed: false, reason: "writer_evaluator_loop evaluator iteration is inconsistent" };
    }
    const isFinal = position === audit.length - 1;
    if (isFinal) {
      const auditedNarrativeFailure = narrativeFidelityClosureFailure(entry.evaluator, auditedEvaluation);
      if (auditedNarrativeFailure) {
        return {
          required: true,
          passed: false,
          reason: `writer_evaluator_loop final audit ${auditedNarrativeFailure}`,
        };
      }
      const auditedHookPayoffFailure = hookPayoffResolutionClosureFailure(entry.evaluator, auditedEvaluation);
      if (auditedHookPayoffFailure) {
        return {
          required: true,
          passed: false,
          reason: `writer_evaluator_loop final audit ${auditedHookPayoffFailure}`,
        };
      }
      if (entry.writer_revision !== null) {
        return { required: true, passed: false, reason: "writer_evaluator_loop final passing audit entry must not contain a writer revision" };
      }
      if (evaluationEvidenceSignature(auditedEvaluation) !== evaluationEvidenceSignature(locallyVerified)) {
        return { required: true, passed: false, reason: "writer_evaluator_loop final evaluation does not match its audit trail" };
      }
    } else {
      if (auditedEvaluation.passed) {
        return { required: true, passed: false, reason: "writer_evaluator_loop continued after an evaluator already passed the draft" };
      }
      const writer = entry.writer_revision;
      const changed = validIndexList(writer?.changed_slot_indexes);
      const rejected = validIndexList(writer?.rejected_slot_indexes);
      if (!writer || writer.agent_role !== "dna_writer" || !changed || changed.length === 0 || !rejected) {
        return { required: true, passed: false, reason: "writer_evaluator_loop audit contains an invalid dna_writer revision" };
      }
      if (changed.some((index) => rejected.includes(index))) {
        return { required: true, passed: false, reason: "writer_evaluator_loop writer audit has conflicting changed and rejected slots" };
      }
    }
  }
  // Persisted booleans are consistency hints only. Eligibility above was
  // recomputed from roles, exact thresholds, evaluator evidence and audit.
  if (report.passed !== locallyVerified.passed) {
    return { required: true, passed: false, reason: "writer_evaluator_loop persisted passed flag is inconsistent with local evidence" };
  }
  return { required: true, passed: true, reason: null };
}
