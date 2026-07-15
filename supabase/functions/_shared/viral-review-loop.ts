export type ViralReviewThresholds = {
  continue_rate_percent_min: number;
  skip_rate_percent_max_exclusive: number;
  avg_view_percentage_min: number;
  overall_score_min: number;
  critical_criterion_score_min: number;
  engagement_complement_tolerance_points: number;
};

export const DEFAULT_VIRAL_REVIEW_THRESHOLDS: ViralReviewThresholds = {
  continue_rate_percent_min: 86,
  skip_rate_percent_max_exclusive: 10,
  avg_view_percentage_min: 90,
  overall_score_min: 9,
  critical_criterion_score_min: 8.5,
  engagement_complement_tolerance_points: 1,
} as const;

// A fourth evaluator pass lets the Writer verify the fully repaired checklist
// after three bounded revisions. The absolute request deadline and per-stage
// budget checks below still stop fail-closed before work that cannot fit.
export const DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS = 4;

export const VIRAL_HOOK_DURATION_MIN_SECONDS = 3;
export const VIRAL_HOOK_DURATION_MAX_SECONDS = 5;
const VIRAL_HOOK_FALLBACK_WORDS_PER_SECOND = 3.5;

export type ViralWordRange = { index: number; min: number; max: number };

/**
 * Resolves the only word range a generated slot may use. Both the narrative
 * block distribution and the consolidated DNA distribution are observed
 * constraints, so their intersection is authoritative everywhere that builds,
 * validates or promotes a script.
 */
export function resolveViralSlotWordRange(slot: any): ViralWordRange {
  const strategy = slot?.dna_strategy_ref || {};
  const finiteRounded = (values: unknown[]) => values
    .map(Number)
    .filter(Number.isFinite)
    .map((value) => Math.round(value));
  const minimums = finiteRounded([slot?.word_count_rule?.p10, strategy?.word_range?.min]);
  const maximums = finiteRounded([slot?.word_count_rule?.p90, strategy?.word_range?.max]);
  let min = Math.max(1, minimums.length ? Math.max(...minimums) : 1);
  let max = Math.max(min, maximums.length ? Math.min(...maximums) : min);

  // The opening narration has a stricter delivery contract than the generic
  // observed word distribution: it must fit the first 3-5 seconds. Preserve
  // the overlap whenever one exists; when a legacy preset's word range cannot
  // fit that window, the explicit temporal contract wins while the remaining
  // hook strategy (opening pattern, curiosity gap and cadence) stays intact.
  if (String(slot?.slot_type || "").trim().toLowerCase() === "hook") {
    const measuredRate = Number(strategy?.avg_words_per_second);
    const wordsPerSecond = Number.isFinite(measuredRate) && measuredRate >= 0.5 && measuredRate <= 6
      ? measuredRate
      : VIRAL_HOOK_FALLBACK_WORDS_PER_SECOND;
    const durationMin = Math.max(1, Math.ceil(wordsPerSecond * VIRAL_HOOK_DURATION_MIN_SECONDS));
    const durationMax = Math.max(durationMin, Math.floor(wordsPerSecond * VIRAL_HOOK_DURATION_MAX_SECONDS));
    const intersectedMin = Math.max(min, durationMin);
    const intersectedMax = Math.min(max, durationMax);
    if (intersectedMin <= intersectedMax) {
      min = intersectedMin;
      max = intersectedMax;
    } else {
      min = durationMin;
      max = durationMax;
    }
  }
  return { index: Number(slot?.index), min, max };
}

export type ViralWordCountContract = {
  requested_target: number;
  target: number;
  acceptable_min: number;
  acceptable_max: number;
  total_p10: number;
  total_p90: number;
  allocations: Array<{ index: number; target_words: number; min: number; max: number }>;
};

/** Median measured DNA cadence, excluding corrupt or physically implausible values. */
export function resolveViralPacingWordsPerSecond(slots: any[]): number | null {
  const rates = (Array.isArray(slots) ? slots : [])
    .filter((slot) => slot?.generation_ready !== false)
    .map((slot) => Number(slot?.dna_strategy_ref?.avg_words_per_second))
    .filter((rate) => Number.isFinite(rate) && rate >= 0.5 && rate <= 6)
    .sort((left, right) => left - right);
  if (rates.length === 0) return null;
  const middle = Math.floor(rates.length / 2);
  const median = rates.length % 2 === 1
    ? rates[middle]
    : (rates[middle - 1] + rates[middle]) / 2;
  return +median.toFixed(2);
}

/** Builds a duration/pacing target without ever allocating outside a slot's observed range. */
export function resolveViralWordCountContract(
  rawRanges: ViralWordRange[],
  requestedTarget: unknown,
  durationSeconds?: unknown,
  toleranceRatio = 0.12,
  measuredWordsPerSecond?: unknown,
): ViralWordCountContract {
  const ranges = rawRanges.map((range) => {
    const rawMin = Number(range.min);
    const min = Math.max(1, Number.isFinite(rawMin) ? Math.round(rawMin) : 1);
    const rawMax = Number(range.max);
    const max = Math.max(min, Number.isFinite(rawMax) ? Math.round(rawMax) : min);
    return { index: Number(range.index), min, max };
  });
  const totalP10 = ranges.reduce((sum, range) => sum + range.min, 0);
  const totalP90 = ranges.reduce((sum, range) => sum + range.max, 0);
  const requested = Number(requestedTarget);
  const duration = Number(durationSeconds);
  const measuredRate = Number(measuredWordsPerSecond);
  const durationPacingTarget = Number.isFinite(duration) && duration > 0
    && Number.isFinite(measuredRate) && measuredRate >= 0.5 && measuredRate <= 6
    ? Math.round(duration * measuredRate)
    : null;
  const durationFallback = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 2.5) : totalP10;
  // In video mode the measured DNA cadence and real media duration are more
  // reliable than an LLM-estimated topic word count. The topic estimate stays
  // as fallback for non-video/legacy contexts.
  const finiteRequested = Math.max(1, Math.round(durationPacingTarget
    ?? (Number.isFinite(requested) && requested > 0 ? requested : durationFallback)));
  const target = ranges.length > 0 ? Math.max(totalP10, Math.min(totalP90, finiteRequested)) : 0;
  const boundedToleranceRatio = Math.max(0, Math.min(0.5, finiteNumber(toleranceRatio, 0.12)));
  const tolerance = target > 0 ? Math.max(5, Math.round(target * boundedToleranceRatio)) : 0;
  const acceptableMin = Math.max(totalP10, target - tolerance);
  const acceptableMax = Math.min(totalP90, target + tolerance);
  const totalHeadroom = ranges.reduce((sum, range) => sum + (range.max - range.min), 0);
  let remaining = Math.max(0, target - totalP10);
  const allocations = ranges.map((range) => {
    const headroom = range.max - range.min;
    const extra = totalHeadroom > 0 ? Math.floor((target - totalP10) * headroom / totalHeadroom) : 0;
    const targetWords = Math.min(range.max, range.min + extra);
    remaining -= targetWords - range.min;
    return { index: range.index, target_words: targetWords, min: range.min, max: range.max };
  });
  while (remaining > 0) {
    let changed = false;
    for (const allocation of allocations) {
      if (remaining <= 0) break;
      if (allocation.target_words >= allocation.max) continue;
      allocation.target_words++;
      remaining--;
      changed = true;
    }
    if (!changed) break;
  }
  return {
    requested_target: finiteRequested,
    target,
    acceptable_min: acceptableMin,
    acceptable_max: acceptableMax,
    total_p10: totalP10,
    total_p90: totalP90,
    allocations,
  };
}

export type ViralCriterionScores = {
  hook: number;
  development: number;
  payoff: number;
  visual_fidelity: number;
  dna_strategy_application: number;
  originality: number;
  pacing: number;
};

export type ViralEstimatedMetrics = {
  continue_rate_percent: number;
  skip_rate_percent: number;
  avg_view_percentage: number;
};

export type ViralBlockIssue = {
  slot_index: number | null;
  slot_type: string | null;
  severity: "low" | "medium" | "high";
  problem: string;
  required_change: string;
  visual_evidence_timestamps: number[];
};

export type ViralEvaluation = {
  agent_role: "viral_evaluator";
  iteration: number;
  metrics_kind: "pre_publication_ai_estimates";
  metrics_disclaimer: string;
  estimated_metrics: ViralEstimatedMetrics;
  criterion_scores: ViralCriterionScores;
  overall_score: number;
  passed: boolean;
  failed_gates: string[];
  narrative_fidelity_gate: {
    required: boolean;
    passed: boolean;
    source: string;
    contract_version: number;
    plan_fingerprint: string;
    audit_source: string;
    audit_contract_version: number;
    reasons: string[];
    audited_microevents: number;
    required_audited_microevents: number;
    microevent_audit: unknown[];
    full_microevent_audit: unknown[];
    visual_candidate_count: number;
    required_visual_event_count: number;
    /** Signed disposition for every visual candidate, including redundant ones. */
    visual_candidate_audit: unknown[];
    audit_coverage_contract: unknown[];
    complete_narrative_gaps: unknown[];
    causal_errors: unknown[];
    affected_slot_indexes: number[];
    audit_fingerprint: string;
  } | null;
  hook_payoff_resolution_gate: {
    required: boolean;
    passed: boolean;
    pair_fingerprint: string;
    hook_index: number | null;
    payoff_index: number | null;
    semantic_resolution_confirmed: boolean;
    open_loop: string | null;
    semantic_answer: string | null;
    reason: string;
    object_overlap_alone_is_insufficient: boolean;
  } | null;
  feedback: {
    summary: string;
    revision_priorities: string[];
    block_issues: ViralBlockIssue[];
  };
  evidence_limits: string[];
  model: string | null;
  latency_ms: number;
  evaluation_fingerprint: string;
};

export type ViralReviewBlock = {
  index: number;
  slot_type: string;
  generated_text: string | null;
  [key: string]: unknown;
};

export type WriterRevisionResult<TBlock extends ViralReviewBlock> = {
  blocks: TBlock[];
  changed_slot_indexes: number[];
  rejected_slot_indexes?: number[];
  rejection_reasons_by_slot?: Record<string, string[]>;
  latency_ms?: number;
  model?: string | null;
};

/**
 * Slots whose repair cannot be silently skipped by the Writer. Narrative
 * fidelity affected slots are deterministic repair targets; high-severity
 * evaluator issues are the other targets that must either change or carry an
 * explicit fail-closed rejection reason.
 */
export function requiredWriterRevisionTargetIndexes(evaluation: ViralEvaluation): number[] {
  const affectedIndexes = Array.isArray(evaluation.narrative_fidelity_gate?.affected_slot_indexes)
    ? evaluation.narrative_fidelity_gate.affected_slot_indexes
    : [];
  const highIssueIndexes = Array.isArray(evaluation.feedback?.block_issues)
    ? evaluation.feedback.block_issues
      .filter((issue) => issue.severity === "high")
      .map((issue) => issue.slot_index)
    : [];
  return [...new Set([...affectedIndexes, ...highIssueIndexes]
    .map(Number)
    .filter(Number.isInteger))]
    .sort((left, right) => left - right);
}

const WRITER_REVISION_ATTEMPTS_PER_EVALUATION = 2;

export type ViralReviewAuditEntry = {
  iteration: number;
  draft_fingerprint: string;
  evaluator: ViralEvaluation;
  writer_revision: null | {
    agent_role: "dna_writer";
    changed_slot_indexes: number[];
    rejected_slot_indexes: number[];
    rejection_reasons_by_slot: Record<string, string[]>;
    latency_ms: number;
    model: string | null;
  };
};

export type ViralReviewLoopResult<TBlock extends ViralReviewBlock> = {
  blocks: TBlock[];
  passed: boolean;
  termination_reason: "quality_gate_passed" | "max_iterations_reached" | "time_budget_exhausted" | "evaluator_error" | "writer_error";
  iterations_completed: number;
  max_iterations: number;
  thresholds: ViralReviewThresholds;
  metrics_kind: "pre_publication_ai_estimates";
  final_evaluation: ViralEvaluation | null;
  audit_trail: ViralReviewAuditEntry[];
  error: string | null;
};

const METRICS_DISCLAIMER = "Estimativas de IA antes da publicação; não são métricas reais nem garantia de desempenho.";

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: unknown, min: number, max: number): number {
  return Math.max(min, Math.min(max, finiteNumber(value, min)));
}

function cleanText(value: unknown, maxLength = 1200): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function stringList(value: unknown, limit: number, maxLength = 400): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, limit);
}

export function viralDraftFingerprint(blocks: ViralReviewBlock[]): string {
  const value = blocks
    .map((block) => {
      const checklist = block?.narrative_event_checklist && typeof block.narrative_event_checklist === "object"
        ? block.narrative_event_checklist as Record<string, unknown>
        : {};
      const acknowledgedEventIds = Array.isArray(checklist.acknowledged_event_ids)
        ? checklist.acknowledged_event_ids.map(String)
        : [];
      const eventTextEvidence = Array.isArray(checklist.event_text_evidence)
        ? checklist.event_text_evidence
        : [];
      return `${block.index}:${block.slot_type}:${String(block.generated_text || "").trim()}:${JSON.stringify({
        acknowledged_event_ids: acknowledgedEventIds,
        event_text_evidence: eventTextEvidence,
      })}`;
    })
    .join("\u241e");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalEvidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalEvidenceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalEvidenceValue(item)]),
    );
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
  return value === undefined ? null : String(value);
}

function evidenceFingerprint(value: unknown): string {
  const serialized = JSON.stringify(canonicalEvidenceValue(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function narrativeFidelityAuditFingerprint(value: unknown): string {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return evidenceFingerprint({
    required: source.required,
    passed: source.passed,
    source: source.source,
    contract_version: source.contract_version,
    plan_fingerprint: source.plan_fingerprint,
    audit_source: source.audit_source,
    audit_contract_version: source.audit_contract_version,
    reasons: source.reasons,
    audited_microevents: source.audited_microevents,
    required_audited_microevents: source.required_audited_microevents,
    microevent_audit: source.microevent_audit,
    full_microevent_audit: source.full_microevent_audit,
    visual_candidate_count: source.visual_candidate_count,
    required_visual_event_count: source.required_visual_event_count,
    visual_candidate_audit: source.visual_candidate_audit,
    audit_coverage_contract: source.audit_coverage_contract,
    complete_narrative_gaps: source.complete_narrative_gaps,
    causal_errors: source.causal_errors,
    affected_slot_indexes: source.affected_slot_indexes,
  });
}

/** Fingerprint of every persisted evaluator field that can affect eligibility. */
export function viralEvaluationEvidenceFingerprint(value: unknown): string {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return evidenceFingerprint({
    agent_role: source.agent_role,
    iteration: source.iteration,
    metrics_kind: source.metrics_kind,
    metrics_disclaimer: source.metrics_disclaimer,
    estimated_metrics: source.estimated_metrics,
    criterion_scores: source.criterion_scores,
    overall_score: source.overall_score,
    passed: source.passed,
    failed_gates: source.failed_gates,
    narrative_fidelity_gate: source.narrative_fidelity_gate,
    hook_payoff_resolution_gate: source.hook_payoff_resolution_gate,
    feedback: source.feedback,
    evidence_limits: source.evidence_limits,
    model: source.model,
    latency_ms: source.latency_ms,
  });
}

function severity(value: unknown): ViralBlockIssue["severity"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

export function evaluateViralQualityGates(
  estimated: ViralEstimatedMetrics,
  scores: ViralCriterionScores,
  overallScore: number,
  thresholds: ViralReviewThresholds = DEFAULT_VIRAL_REVIEW_THRESHOLDS,
): { passed: boolean; failed_gates: string[] } {
  const failed: string[] = [];
  if (estimated.continue_rate_percent < thresholds.continue_rate_percent_min) {
    failed.push("estimated_continue_rate_below_86");
  }
  if (estimated.skip_rate_percent >= thresholds.skip_rate_percent_max_exclusive) {
    failed.push("estimated_skip_rate_not_below_10");
  }
  if (Math.abs(estimated.continue_rate_percent + estimated.skip_rate_percent - 100)
    > thresholds.engagement_complement_tolerance_points) {
    failed.push("estimated_engagement_rates_not_complementary");
  }
  if (estimated.avg_view_percentage < thresholds.avg_view_percentage_min) {
    failed.push("estimated_avg_view_percentage_below_90");
  }
  if (overallScore < thresholds.overall_score_min) {
    failed.push("overall_score_below_9");
  }

  for (const criterion of ["hook", "development", "payoff", "visual_fidelity"] as const) {
    if (scores[criterion] < thresholds.critical_criterion_score_min) {
      failed.push(`${criterion}_score_below_8_5`);
    }
  }
  return { passed: failed.length === 0, failed_gates: failed };
}

/**
 * Treats model output as untrusted data. The `passed` value is always computed
 * locally from the configured gates, never accepted from the model response.
 */
export function normalizeViralEvaluation(
  raw: unknown,
  iteration: number,
  thresholds: ViralReviewThresholds = DEFAULT_VIRAL_REVIEW_THRESHOLDS,
): ViralEvaluation {
  const source = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const metricsSource = source.estimated_metrics && typeof source.estimated_metrics === "object"
    ? source.estimated_metrics
    : {};
  const scoreSource = source.criterion_scores && typeof source.criterion_scores === "object"
    ? source.criterion_scores
    : {};

  const estimated_metrics: ViralEstimatedMetrics = {
    continue_rate_percent: +clamp(metricsSource.continue_rate_percent, 0, 100).toFixed(1),
    skip_rate_percent: +clamp(metricsSource.skip_rate_percent, 0, 100).toFixed(1),
    avg_view_percentage: +clamp(metricsSource.avg_view_percentage, 0, 200).toFixed(1),
  };
  const criterion_scores: ViralCriterionScores = {
    hook: +clamp(scoreSource.hook, 0, 10).toFixed(1),
    development: +clamp(scoreSource.development, 0, 10).toFixed(1),
    payoff: +clamp(scoreSource.payoff, 0, 10).toFixed(1),
    visual_fidelity: +clamp(scoreSource.visual_fidelity, 0, 10).toFixed(1),
    dna_strategy_application: +clamp(scoreSource.dna_strategy_application, 0, 10).toFixed(1),
    originality: +clamp(scoreSource.originality, 0, 10).toFixed(1),
    pacing: +clamp(scoreSource.pacing, 0, 10).toFixed(1),
  };
  const overall_score = +clamp(source.overall_score, 0, 10).toFixed(1);
  const gate = evaluateViralQualityGates(estimated_metrics, criterion_scores, overall_score, thresholds);
  const narrativeSource = source.__narrative_fidelity_gate && typeof source.__narrative_fidelity_gate === "object"
    ? source.__narrative_fidelity_gate
    : source.narrative_fidelity_gate && typeof source.narrative_fidelity_gate === "object"
    ? source.narrative_fidelity_gate
    : null;
  const narrativeFidelityBase = narrativeSource ? {
    required: narrativeSource.required === true,
    passed: narrativeSource.passed === true,
    source: cleanText(narrativeSource.source, 120),
    contract_version: Math.max(
      0,
      Math.trunc(finiteNumber(narrativeSource.contract_version, 0)),
    ),
    plan_fingerprint: cleanText(narrativeSource.plan_fingerprint, 120),
    audit_source: cleanText(narrativeSource.audit_source, 120),
    audit_contract_version: Math.max(
      0,
      Math.trunc(finiteNumber(narrativeSource.audit_contract_version, 0)),
    ),
    reasons: stringList(narrativeSource.reasons, 20, 160),
    audited_microevents: Math.max(0, Math.trunc(finiteNumber(narrativeSource.audited_microevents, 0))),
    required_audited_microevents: Math.max(
      0,
      Math.trunc(finiteNumber(narrativeSource.required_audited_microevents, 0)),
    ),
    microevent_audit: Array.isArray(narrativeSource.microevent_audit)
      ? narrativeSource.microevent_audit.slice(0, 240)
      : [],
    full_microevent_audit: Array.isArray(narrativeSource.full_microevent_audit)
      ? narrativeSource.full_microevent_audit.slice(0, 240)
      : [],
    visual_candidate_count: Math.max(
      0,
      Math.trunc(finiteNumber(narrativeSource.visual_candidate_count, 0)),
    ),
    required_visual_event_count: Math.max(
      0,
      Math.trunc(finiteNumber(narrativeSource.required_visual_event_count, 0)),
    ),
    visual_candidate_audit: Array.isArray(narrativeSource.visual_candidate_audit)
      ? narrativeSource.visual_candidate_audit.slice(0, 240)
      : [],
    audit_coverage_contract: Array.isArray(narrativeSource.audit_coverage_contract)
      ? narrativeSource.audit_coverage_contract.slice(0, 240)
      : [],
    complete_narrative_gaps: Array.isArray(narrativeSource.complete_narrative_gaps)
      ? narrativeSource.complete_narrative_gaps.slice(0, 20)
      : [],
    causal_errors: Array.isArray(narrativeSource.causal_errors)
      ? narrativeSource.causal_errors.slice(0, 20)
      : [],
    affected_slot_indexes: Array.isArray(narrativeSource.affected_slot_indexes)
      ? narrativeSource.affected_slot_indexes.map(Number).filter(Number.isInteger).slice(0, 20)
      : [],
  } : null;
  const narrativeFidelityGate = narrativeFidelityBase ? {
    ...narrativeFidelityBase,
    audit_fingerprint: narrativeFidelityAuditFingerprint(narrativeFidelityBase),
  } : null;
  const narrativeFidelityFailed = narrativeFidelityGate?.required === true
    && narrativeFidelityGate.passed !== true;
  const hookPayoffSource = source.hook_payoff_resolution_gate
    && typeof source.hook_payoff_resolution_gate === "object"
    ? source.hook_payoff_resolution_gate
    : null;
  const hookPayoffResolutionBase = hookPayoffSource ? {
    required: hookPayoffSource.required === true,
    claimed_passed: hookPayoffSource.passed === true,
    pair_fingerprint: cleanText(hookPayoffSource.pair_fingerprint, 120),
    hook_index: Number.isInteger(Number(hookPayoffSource.hook_index))
      ? Number(hookPayoffSource.hook_index)
      : null,
    payoff_index: Number.isInteger(Number(hookPayoffSource.payoff_index))
      ? Number(hookPayoffSource.payoff_index)
      : null,
    semantic_resolution_confirmed: hookPayoffSource.semantic_resolution_confirmed === true,
    open_loop: cleanText(hookPayoffSource.open_loop, 500) || null,
    semantic_answer: cleanText(hookPayoffSource.semantic_answer, 500) || null,
    reason: cleanText(hookPayoffSource.reason, 700),
    object_overlap_alone_is_insufficient: hookPayoffSource.object_overlap_alone_is_insufficient === true,
  } : null;
  const hookPayoffResolutionGate = hookPayoffResolutionBase ? {
    required: hookPayoffResolutionBase.required,
    passed: hookPayoffResolutionBase.required
      && hookPayoffResolutionBase.claimed_passed
      && /^fnv1a32:[0-9a-f]{8}$/u.test(hookPayoffResolutionBase.pair_fingerprint)
      && hookPayoffResolutionBase.hook_index !== null
      && hookPayoffResolutionBase.payoff_index !== null
      && hookPayoffResolutionBase.semantic_resolution_confirmed
      && String(hookPayoffResolutionBase.open_loop || "").length >= 4
      && String(hookPayoffResolutionBase.semantic_answer || "").length >= 4
      && hookPayoffResolutionBase.reason.length >= 4
      && hookPayoffResolutionBase.object_overlap_alone_is_insufficient,
    pair_fingerprint: hookPayoffResolutionBase.pair_fingerprint,
    hook_index: hookPayoffResolutionBase.hook_index,
    payoff_index: hookPayoffResolutionBase.payoff_index,
    semantic_resolution_confirmed: hookPayoffResolutionBase.semantic_resolution_confirmed,
    open_loop: hookPayoffResolutionBase.open_loop,
    semantic_answer: hookPayoffResolutionBase.semantic_answer,
    reason: hookPayoffResolutionBase.reason,
    object_overlap_alone_is_insufficient: hookPayoffResolutionBase.object_overlap_alone_is_insufficient,
  } : null;
  const hookPayoffResolutionFailed = hookPayoffResolutionGate?.required === true
    && hookPayoffResolutionGate.passed !== true;
  const failedGates = [
    ...gate.failed_gates,
    ...(narrativeFidelityFailed ? ["narrative_fidelity_gate_failed"] : []),
    ...(hookPayoffResolutionFailed ? ["hook_payoff_resolution_gate_failed"] : []),
  ];
  const feedbackSource = source.feedback && typeof source.feedback === "object" ? source.feedback : {};
  const rawIssues = Array.isArray(feedbackSource.block_issues) ? feedbackSource.block_issues : [];

  const block_issues: ViralBlockIssue[] = rawIssues.slice(0, 30).map((issue: any) => ({
    slot_index: Number.isInteger(Number(issue?.slot_index)) ? Number(issue.slot_index) : null,
    slot_type: cleanText(issue?.slot_type, 80) || null,
    severity: severity(issue?.severity),
    problem: cleanText(issue?.problem, 700),
    required_change: cleanText(issue?.required_change, 700),
    visual_evidence_timestamps: Array.isArray(issue?.visual_evidence_timestamps)
      ? issue.visual_evidence_timestamps.map((value: unknown) => finiteNumber(value, -1)).filter((value: number) => value >= 0).slice(0, 12)
      : [],
  })).filter((issue: ViralBlockIssue) => issue.problem || issue.required_change);

  const normalizedEvaluationBase = {
    agent_role: "viral_evaluator",
    iteration: Math.max(1, Math.trunc(finiteNumber(iteration, 1))),
    metrics_kind: "pre_publication_ai_estimates",
    metrics_disclaimer: METRICS_DISCLAIMER,
    estimated_metrics,
    criterion_scores,
    overall_score,
    passed: gate.passed && !narrativeFidelityFailed && !hookPayoffResolutionFailed,
    failed_gates: failedGates,
    narrative_fidelity_gate: narrativeFidelityGate,
    hook_payoff_resolution_gate: hookPayoffResolutionGate,
    feedback: {
      summary: cleanText(feedbackSource.summary, 1600),
      revision_priorities: stringList(feedbackSource.revision_priorities, 15, 500),
      block_issues,
    },
    evidence_limits: stringList(source.evidence_limits, 12, 500),
    // Preserve transport evidence when an already-normalized evaluation is
    // verified again during validation/promotion.
    model: cleanText(source?.__agent_meta?.model ?? source?.model, 120) || null,
    latency_ms: Math.max(0, Math.trunc(finiteNumber(
      source?.__agent_meta?.latency_ms ?? source?.latency_ms,
      0,
    ))),
  } satisfies Omit<ViralEvaluation, "evaluation_fingerprint">;
  return {
    ...normalizedEvaluationBase,
    evaluation_fingerprint: viralEvaluationEvidenceFingerprint(normalizedEvaluationBase),
  };
}

/**
 * Repairs only a small arithmetic inconsistency between independently
 * estimated continue/skip rates. It never relaxes a quality threshold, never
 * changes scores or average view percentage, and is eligible only when the
 * complement mismatch is the sole failed gate. Proportional rescaling keeps
 * the evaluator's relative estimate instead of fabricating one rate as
 * `100 - other`.
 */
export function reconcileBoundedComplementOnlyEvaluation(
  raw: unknown,
  iteration: number,
  thresholds: ViralReviewThresholds = DEFAULT_VIRAL_REVIEW_THRESHOLDS,
  maxGapPoints = 3,
): ViralEvaluation | null {
  const normalized = normalizeViralEvaluation(raw, iteration, thresholds);
  if (normalized.failed_gates.length !== 1
    || normalized.failed_gates[0] !== "estimated_engagement_rates_not_complementary") {
    return null;
  }
  const originalContinue = normalized.estimated_metrics.continue_rate_percent;
  const originalSkip = normalized.estimated_metrics.skip_rate_percent;
  const sum = originalContinue + originalSkip;
  const gap = Math.abs(sum - 100);
  if (!Number.isFinite(sum)
    || sum <= 0
    || gap <= thresholds.engagement_complement_tolerance_points
    || gap > maxGapPoints) {
    return null;
  }
  const continueRate = +((originalContinue * 100) / sum).toFixed(1);
  const skipRate = +((originalSkip * 100) / sum).toFixed(1);
  const provenance = `metrics_reconciliation=${JSON.stringify({
    method: "bounded_proportional_rescale",
    original: { continue: originalContinue, skip: originalSkip, sum: +sum.toFixed(1) },
    result: { continue: continueRate, skip: skipRate, sum: +(continueRate + skipRate).toFixed(1) },
    max_gap: maxGapPoints,
  })}`;
  const reconciled = normalizeViralEvaluation({
    ...normalized,
    estimated_metrics: {
      ...normalized.estimated_metrics,
      continue_rate_percent: continueRate,
      skip_rate_percent: skipRate,
    },
    evidence_limits: [provenance, ...normalized.evidence_limits],
  }, iteration, thresholds);
  return reconciled.passed && reconciled.failed_gates.length === 0
    ? reconciled
    : null;
}

export function extractJsonObject(raw: string): unknown {
  const cleaned = String(raw || "").replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("structured_json_missing");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function clampReviewIterations(value: unknown): number {
  return Math.max(1, Math.min(DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS, Math.trunc(finiteNumber(value, DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS))));
}

export async function runViralWriterEvaluatorLoop<TBlock extends ViralReviewBlock>(options: {
  initialBlocks: TBlock[];
  maxIterations?: number;
  thresholds?: ViralReviewThresholds;
  /** Absolute wall-clock deadline. The loop stops fail-closed before starting work that cannot fit. */
  deadlineAtMs?: number;
  minimumEvaluationBudgetMs?: number;
  /** Must include the writer, anti-copy checks and the following evaluator call. */
  minimumRevisionBudgetMs?: number;
  now?: () => number;
  evaluate: (blocks: TBlock[], iteration: number) => Promise<unknown>;
  revise: (blocks: TBlock[], evaluation: ViralEvaluation, nextIteration: number) => Promise<WriterRevisionResult<TBlock>>;
}): Promise<ViralReviewLoopResult<TBlock>> {
  const thresholds = options.thresholds ?? DEFAULT_VIRAL_REVIEW_THRESHOLDS;
  const maxIterations = clampReviewIterations(options.maxIterations);
  const now = options.now ?? Date.now;
  const rawDeadline = finiteNumber(options.deadlineAtMs, 0);
  const deadlineAtMs = rawDeadline > 0 ? rawDeadline : null;
  const minimumEvaluationBudgetMs = Math.max(0, Math.trunc(finiteNumber(options.minimumEvaluationBudgetMs, 0)));
  const minimumRevisionBudgetMs = Math.max(0, Math.trunc(finiteNumber(options.minimumRevisionBudgetMs, 0)));
  let blocks = options.initialBlocks;
  const audit: ViralReviewAuditEntry[] = [];
  let finalEvaluation: ViralEvaluation | null = null;
  const evaluationByDraftFingerprint = new Map<string, ViralEvaluation>();

  const hasBudget = (minimumMs: number) => deadlineAtMs === null || deadlineAtMs - now() >= minimumMs;
  const timeBudgetResult = (stage: "evaluation" | "revision"): ViralReviewLoopResult<TBlock> => ({
    blocks,
    passed: false,
    termination_reason: "time_budget_exhausted",
    iterations_completed: audit.length,
    max_iterations: maxIterations,
    thresholds,
    metrics_kind: "pre_publication_ai_estimates",
    final_evaluation: finalEvaluation,
    audit_trail: audit,
    error: `viral_review_time_budget_exhausted_before_${stage}`,
  });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (!hasBudget(minimumEvaluationBudgetMs)) return timeBudgetResult("evaluation");
    const currentDraftFingerprint = viralDraftFingerprint(blocks);
    try {
      const cachedEvaluation = evaluationByDraftFingerprint.get(currentDraftFingerprint);
      finalEvaluation = cachedEvaluation
        ? normalizeViralEvaluation(cachedEvaluation, iteration, thresholds)
        : normalizeViralEvaluation(await options.evaluate(blocks, iteration), iteration, thresholds);
      if (!cachedEvaluation) evaluationByDraftFingerprint.set(currentDraftFingerprint, finalEvaluation);
    } catch (error: any) {
      const errorMessage = cleanText(error?.message || "evaluator_error", 800);
      // The evaluator callback also owns the last deterministic preflight. If
      // that preflight rejects the writer's draft, no evaluator call happened;
      // report the responsible agent accurately instead of blaming transport
      // or the independent evaluator.
      const writerContractFailure = errorMessage.startsWith("draft_contract_incomplete:");
      return {
        blocks,
        passed: false,
        termination_reason: writerContractFailure ? "writer_error" : "evaluator_error",
        iterations_completed: iteration - 1,
        max_iterations: maxIterations,
        thresholds,
        metrics_kind: "pre_publication_ai_estimates",
        final_evaluation: finalEvaluation,
        audit_trail: audit,
        error: errorMessage,
      };
    }

    const entry: ViralReviewAuditEntry = {
      iteration,
      draft_fingerprint: currentDraftFingerprint,
      evaluator: finalEvaluation,
      writer_revision: null,
    };
    audit.push(entry);
    if (finalEvaluation.passed) {
      return {
        blocks,
        passed: true,
        termination_reason: "quality_gate_passed",
        iterations_completed: iteration,
        max_iterations: maxIterations,
        thresholds,
        metrics_kind: "pre_publication_ai_estimates",
        final_evaluation: finalEvaluation,
        audit_trail: audit,
        error: null,
      };
    }
    if (iteration === maxIterations) break;
    if (!hasBudget(minimumRevisionBudgetMs)) return timeBudgetResult("revision");

    try {
      const priorBlocks = blocks;
      const priorFingerprintByIdentity = new Map(
        priorBlocks.map((block) => [
          `${block.index}\u241f${block.slot_type}`,
          viralDraftFingerprint([block]),
        ]),
      );
      const requiredTargetIndexes = requiredWriterRevisionTargetIndexes(finalEvaluation);
      const requiredTargetSet = new Set(requiredTargetIndexes);
      const accumulatedRejectedIndexes = new Set<number>();
      const accumulatedRejectionReasons: Record<string, string[]> = {};
      let accumulatedLatencyMs = 0;
      const accumulatedModels = new Set<string>();
      let revisionApplied = false;

      const recordRejection = (index: number, reason: string) => {
        accumulatedRejectedIndexes.add(index);
        const key = String(index);
        accumulatedRejectionReasons[key] = [...new Set([
          ...(accumulatedRejectionReasons[key] || []),
          cleanText(reason, 240),
        ].filter(Boolean))];
      };

      for (let revisionAttempt = 1;
        revisionAttempt <= WRITER_REVISION_ATTEMPTS_PER_EVALUATION;
        revisionAttempt++) {
        if (revisionAttempt > 1 && !hasBudget(minimumRevisionBudgetMs)) return timeBudgetResult("revision");
        const revision = await options.revise(priorBlocks, finalEvaluation, iteration + 1);
        if (!revision || !Array.isArray(revision.blocks) || revision.blocks.length !== priorBlocks.length) {
          throw new Error("writer_revision_invalid_block_shape");
        }

        const revisedIdentities = revision.blocks.map((block) => `${block.index}\u241f${block.slot_type}`);
        if (new Set(revisedIdentities).size !== revisedIdentities.length ||
          revisedIdentities.some((identity) => !priorFingerprintByIdentity.has(identity))) {
          throw new Error("writer_revision_changed_block_identity");
        }

        const actualChangedIndexes = revision.blocks
          .filter((block) => priorFingerprintByIdentity.get(`${block.index}\u241f${block.slot_type}`) !== viralDraftFingerprint([block]))
          .map((block) => block.index);
        const declaredChangedIndexes = [...new Set((revision.changed_slot_indexes || []).filter(Number.isInteger))];
        const actualChangedSet = new Set(actualChangedIndexes);
        if (declaredChangedIndexes.length !== actualChangedSet.size ||
          declaredChangedIndexes.some((index) => !actualChangedSet.has(index))) {
          throw new Error("writer_revision_changed_indexes_mismatch");
        }

        const rejectionReasonsBySlot = revision.rejection_reasons_by_slot
          && typeof revision.rejection_reasons_by_slot === "object"
          ? revision.rejection_reasons_by_slot
          : {};
        const explicitlyRejectedSet = new Set(
          (revision.rejected_slot_indexes || [])
            .map(Number)
            .filter((index) => Number.isInteger(index)
              && Array.isArray(rejectionReasonsBySlot[String(index)])
              && rejectionReasonsBySlot[String(index)].some((reason) => cleanText(reason, 240))),
        );
        for (const rejectedIndex of explicitlyRejectedSet) {
          for (const reason of rejectionReasonsBySlot[String(rejectedIndex)] || []) {
            recordRejection(rejectedIndex, reason);
          }
        }
        accumulatedLatencyMs += Math.max(0, Math.trunc(finiteNumber(revision.latency_ms, 0)));
        const revisionModel = cleanText(revision.model, 120);
        if (revisionModel) accumulatedModels.add(revisionModel);

        const silentRequiredIndexes = requiredTargetIndexes.filter((index) =>
          !actualChangedSet.has(index) && !explicitlyRejectedSet.has(index)
        );
        const changedRequiredIndexes = actualChangedIndexes.filter((index) => requiredTargetSet.has(index));
        const onlyDonorOrNeighborChanged = requiredTargetIndexes.length > 0
          && actualChangedIndexes.length > 0
          && changedRequiredIndexes.length === 0;

        if (silentRequiredIndexes.length > 0 || actualChangedIndexes.length === 0 || onlyDonorOrNeighborChanged) {
          for (const index of silentRequiredIndexes) {
            recordRejection(index, "writer_revision_required_target_silent");
          }
          if (actualChangedIndexes.length === 0 && silentRequiredIndexes.length === 0) {
            for (const index of requiredTargetIndexes.length > 0
              ? requiredTargetIndexes
              : priorBlocks.map((block) => block.index)) {
              recordRejection(index, "writer_revision_no_effect");
            }
          }
          if (onlyDonorOrNeighborChanged) {
            for (const index of actualChangedIndexes) {
              recordRejection(index, "writer_revision_non_target_change_without_required_progress");
            }
          }
          entry.writer_revision = {
            agent_role: "dna_writer",
            changed_slot_indexes: [],
            rejected_slot_indexes: [...accumulatedRejectedIndexes].sort((left, right) => left - right),
            rejection_reasons_by_slot: accumulatedRejectionReasons,
            latency_ms: accumulatedLatencyMs,
            model: [...accumulatedModels].join(",") || null,
          };
          // A donor-only, neighbor-only or silent-target attempt is not a new
          // draft and must not spend an evaluator iteration. Retry the same
          // verified feedback in this bounded inner loop instead.
          continue;
        }

        const finallyRejectedIndexes = [...accumulatedRejectedIndexes]
          .filter((index) => !actualChangedSet.has(index))
          .sort((left, right) => left - right);
        const finalRejectionReasons = Object.fromEntries(
          finallyRejectedIndexes.map((index) => [
            String(index),
            accumulatedRejectionReasons[String(index)] || [],
          ]),
        );
        entry.writer_revision = {
          agent_role: "dna_writer",
          changed_slot_indexes: actualChangedIndexes,
          rejected_slot_indexes: finallyRejectedIndexes,
          rejection_reasons_by_slot: finalRejectionReasons,
          latency_ms: accumulatedLatencyMs,
          model: [...accumulatedModels].join(",") || null,
        };
        blocks = revision.blocks;
        revisionApplied = true;
        break;
      }

      if (!revisionApplied) {
        throw new Error(`writer_revision_no_required_progress_after_${WRITER_REVISION_ATTEMPTS_PER_EVALUATION}_attempts`);
      }
    } catch (error: any) {
      return {
        blocks,
        passed: false,
        termination_reason: "writer_error",
        iterations_completed: iteration,
        max_iterations: maxIterations,
        thresholds,
        metrics_kind: "pre_publication_ai_estimates",
        final_evaluation: finalEvaluation,
        audit_trail: audit,
        error: cleanText(error?.message || "writer_error", 800),
      };
    }
  }

  return {
    blocks,
    passed: false,
    termination_reason: "max_iterations_reached",
    iterations_completed: maxIterations,
    max_iterations: maxIterations,
    thresholds,
    metrics_kind: "pre_publication_ai_estimates",
    final_evaluation: finalEvaluation,
    audit_trail: audit,
    error: null,
  };
}
