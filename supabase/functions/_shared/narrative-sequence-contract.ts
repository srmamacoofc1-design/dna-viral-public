export const NORMALIZED_VIDEO_NARRATIVE_ORDER = ["hook", "development", "payoff"] as const;

export type NormalizedNarrativeStage = typeof NORMALIZED_VIDEO_NARRATIVE_ORDER[number];

export interface AbstractStructuralContractLike {
  contract_type?: unknown;
  normalized_stage_order?: unknown;
  dominant_sequence_usage?: unknown;
  literal_source_sequence_required?: unknown;
  visual_chronology_priority?: unknown;
  fail_closed_for_video_slot_order?: unknown;
}

export interface NarrativeSlotLike {
  index?: unknown;
  slot_type?: unknown;
  narrative_function?: unknown;
}

export interface NarrativeSequenceAssessment {
  passed: boolean;
  normalized_sequence: NormalizedNarrativeStage[];
  slot_stages: Array<{
    slot_index: number;
    slot_type: string;
    stage: NormalizedNarrativeStage | null;
  }>;
  milestone_slot_indexes: {
    hook: number | null;
    development: number | null;
    payoff: number | null;
  };
  reasons: string[];
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeNarrativeStage(value: unknown): NormalizedNarrativeStage | null {
  const normalized = normalizedText(value);
  if (!normalized) return null;
  const tokens = new Set(normalized.split("_").filter(Boolean));
  const includes = (...values: string[]) => values.some((candidate) =>
    tokens.has(candidate) || normalized === candidate || normalized.startsWith(`${candidate}_`)
  );

  if (includes("hook", "gancho", "opening", "abertura")) return "hook";
  if (includes(
    "payoff", "desfecho", "conclusao", "resolution", "resolucao", "ending",
    "closing", "cta", "loop", "finalizacao",
  )) return "payoff";
  if (includes(
    "development", "desenvolvimento", "setup", "contexto", "build", "escalada",
    "escalation", "tensao", "tension", "revelacao", "reveal", "transicao", "transition",
  )) return "development";
  return null;
}

function contractReasons(contract: AbstractStructuralContractLike | null | undefined): string[] {
  if (!contract || typeof contract !== "object") return ["abstract_structural_contract_missing"];
  const actualOrder = Array.isArray(contract.normalized_stage_order)
    ? contract.normalized_stage_order.map(normalizedText)
    : [];
  const expectedOrder = [...NORMALIZED_VIDEO_NARRATIVE_ORDER];
  const reasons: string[] = [];
  if (contract.contract_type !== "abstract_narrative_order") reasons.push("abstract_contract_type_invalid");
  if (actualOrder.length !== expectedOrder.length || actualOrder.some((stage, index) => stage !== expectedOrder[index])) {
    reasons.push("abstract_stage_order_invalid");
  }
  if (contract.dominant_sequence_usage !== "statistical_reference_only") {
    reasons.push("dominant_sequence_usage_must_be_statistical_only");
  }
  if (contract.literal_source_sequence_required !== false) {
    reasons.push("literal_source_sequence_must_not_be_required");
  }
  if (contract.visual_chronology_priority !== true) reasons.push("visual_chronology_priority_missing");
  if (contract.fail_closed_for_video_slot_order !== true) reasons.push("video_sequence_fail_closed_missing");
  return reasons;
}

/**
 * Validates only the abstract narrative roles. It deliberately never compares
 * the new slot list with a source video's literal dominant sequence. In video
 * mode, chronology comes from the new video's visual evidence.
 */
export function assessVideoNarrativeSequence(
  slots: NarrativeSlotLike[],
  contract: AbstractStructuralContractLike | null | undefined,
): NarrativeSequenceAssessment {
  const reasons = contractReasons(contract);
  if (!Array.isArray(slots) || slots.length === 0) reasons.push("slot_sequence_missing");

  const slotStages = (Array.isArray(slots) ? slots : []).map((slot, position) => {
    const slotType = normalizedText(slot?.slot_type);
    const stage = normalizeNarrativeStage(slot?.slot_type) ?? normalizeNarrativeStage(slot?.narrative_function);
    return {
      slot_index: Number.isInteger(Number(slot?.index)) ? Number(slot.index) : position,
      slot_type: slotType,
      stage,
    };
  });
  const unclassified = slotStages.filter((slot) => slot.stage === null);
  if (unclassified.length) {
    reasons.push(`unclassified_slots_${unclassified.map((slot) => slot.slot_index).join("_")}`);
  }

  const normalizedSequence = slotStages
    .map((slot) => slot.stage)
    .filter((stage): stage is NormalizedNarrativeStage => stage !== null);
  const ranks: Record<NormalizedNarrativeStage, number> = { hook: 0, development: 1, payoff: 2 };
  for (let index = 1; index < normalizedSequence.length; index++) {
    if (ranks[normalizedSequence[index]] < ranks[normalizedSequence[index - 1]]) {
      reasons.push(`narrative_order_regression_at_${index}`);
      break;
    }
  }

  for (const requiredStage of NORMALIZED_VIDEO_NARRATIVE_ORDER) {
    if (!normalizedSequence.includes(requiredStage)) reasons.push(`required_stage_missing_${requiredStage}`);
  }
  if (normalizedSequence.length && normalizedSequence[0] !== "hook") reasons.push("normalized_sequence_must_start_with_hook");
  if (normalizedSequence.length && normalizedSequence[normalizedSequence.length - 1] !== "payoff") {
    reasons.push("normalized_sequence_must_end_with_payoff");
  }

  const milestone = (stage: NormalizedNarrativeStage): number | null =>
    slotStages.find((slot) => slot.stage === stage)?.slot_index ?? null;
  return {
    passed: reasons.length === 0,
    normalized_sequence: normalizedSequence,
    slot_stages: slotStages,
    milestone_slot_indexes: {
      hook: milestone("hook"),
      development: milestone("development"),
      payoff: milestone("payoff"),
    },
    reasons: [...new Set(reasons)],
  };
}
