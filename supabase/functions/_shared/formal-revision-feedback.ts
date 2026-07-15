export interface SanitizedFormalRevisionFeedback {
  source_script_assembly_id: string;
  source_generation_context_id: string;
  source_validation_version: number | null;
  source_validation_status: string | null;
  overall_quality_score: number | null;
  summary: {
    missing_required_slots: number;
    critical_failures: number;
    slots_with_insufficient_data: number;
    viral_review_gate_failed: boolean;
  };
  slot_issues: Array<{
    slot_index: number;
    slot_type: string;
    slot_status: string;
    quality_score: number | null;
    failed_criteria: string[];
  }>;
  viral_failed_gates: string[];
  fingerprint: string;
}

function safeId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[0-9a-z-]{8,80}$/i.test(text) ? text : "";
}

function safeToken(value: unknown, max = 100): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Converts persisted validation output into a small, identifier-only repair
 * contract. Free-form evidence and generated/source text are intentionally
 * discarded so validation data cannot become a prompt-injection channel.
 */
export function sanitizeFormalRevisionFeedback(raw: unknown): SanitizedFormalRevisionFeedback | null {
  if (!raw || typeof raw !== "object") return null;
  const wrapper = raw as Record<string, any>;
  const validation = wrapper.validation_result && typeof wrapper.validation_result === "object"
    ? wrapper.validation_result as Record<string, any>
    : null;
  const sourceScriptAssemblyId = safeId(wrapper.source_script_assembly_id);
  const sourceGenerationContextId = safeId(wrapper.source_generation_context_id);
  if (!validation || !sourceScriptAssemblyId || !sourceGenerationContextId) return null;

  const summarySource = validation.summary && typeof validation.summary === "object" ? validation.summary : {};
  const validationSummary = validation.validation_summary && typeof validation.validation_summary === "object"
    ? validation.validation_summary
    : {};
  const rawSlots = Array.isArray(validation.slot_validations) ? validation.slot_validations : [];
  const slotIssues = rawSlots.slice(0, 60).flatMap((slot: any) => {
    const slotIndex = Number(slot?.slot_index);
    const slotType = safeToken(slot?.slot_type, 80);
    const slotStatus = safeToken(slot?.slot_status, 80);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || !slotType || !slotStatus || slotStatus === "approved") return [];
    const criteria = slot?.criteria && typeof slot.criteria === "object" ? slot.criteria : {};
    const failedCriteria = Object.entries(criteria)
      .filter(([, criterion]: [string, any]) => criterion?.value === false)
      .map(([name]) => safeToken(name, 100))
      .filter(Boolean)
      .slice(0, 30);
    return [{
      slot_index: slotIndex,
      slot_type: slotType,
      slot_status: slotStatus,
      quality_score: finite(slot?.quality_score),
      failed_criteria: failedCriteria,
    }];
  });
  const viralFailedGates = Array.isArray(validation?.writer_evaluator_loop?.final_evaluation?.failed_gates)
    ? validation.writer_evaluator_loop.final_evaluation.failed_gates
        .map((value: unknown) => safeToken(value, 120))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const sanitizedWithoutFingerprint = {
    source_script_assembly_id: sourceScriptAssemblyId,
    source_generation_context_id: sourceGenerationContextId,
    source_validation_version: Number.isInteger(Number(wrapper.source_validation_version))
      ? Number(wrapper.source_validation_version)
      : null,
    source_validation_status: safeToken(wrapper.source_validation_status || validationSummary.status, 80) || null,
    overall_quality_score: finite(validationSummary.overall_quality_score),
    summary: {
      missing_required_slots: integer(summarySource.missing_required_slots),
      critical_failures: integer(summarySource.critical_failures),
      slots_with_insufficient_data: integer(summarySource.slots_with_insufficient_data),
      viral_review_gate_failed: summarySource.viral_review_gate_failed === true,
    },
    slot_issues: slotIssues,
    viral_failed_gates: viralFailedGates,
  };
  return {
    ...sanitizedWithoutFingerprint,
    fingerprint: fingerprint(sanitizedWithoutFingerprint),
  };
}
