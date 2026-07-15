export const MAX_SAFE_REVISION_WORD_FLOOR_DEFICIT = 9;

export type RevisionWordFloorBlock = {
  index: number;
  slot_type?: string | null;
  generated_text?: string | null;
};

export type RevisionWordFloorAllocation = {
  index: number;
  min: number;
  max: number;
  target_words?: number;
};

export type RevisionWordFloorRepairTarget = {
  index: number;
  current_words: number;
  prior_words: number;
  add_words: number;
  target_words: number;
  max_words: number;
};

export type RevisionWordFloorRepairPlan = {
  status: "not_needed" | "eligible" | "ineligible";
  reason: string;
  current_total: number;
  acceptable_min: number;
  acceptable_max: number;
  deficit: number;
  total_headroom: number;
  max_safe_deficit: number;
  targets: RevisionWordFloorRepairTarget[];
};

function wordCount(value: unknown): number {
  return String(value || "").trim().split(/\s+/u).filter(Boolean).length;
}

export type PreEvaluatorRepairScope<T> = {
  requested_blocks: T[];
  current_total: number;
  pacing_underflow_requires_joint_repair: boolean;
  pacing_overflow_requires_joint_repair: boolean;
};

/**
 * A hook-only repair cannot fix a whole-script duration deficit. When the
 * draft is below the unchanged global floor, include every non-empty block
 * whose copy guard is currently safe (plus the hook) so the Writer can expand
 * distinct local microevents and repair the opening in one combined proposal.
 * Inside the range, the existing hook-first behavior remains unchanged.
 */
export function resolvePreEvaluatorRepairScope<T extends {
  generated_text?: string | null;
  slot_type?: string | null;
  dna_copy_guard?: { passed?: boolean } | null;
}>(options: {
  blocks: T[];
  strategyFailedBlocks: T[];
  acceptableMin: number;
  acceptableMax: number;
}): PreEvaluatorRepairScope<T> {
  const currentTotal = options.blocks.reduce(
    (sum, block) => sum + wordCount(block?.generated_text),
    0,
  );
  const acceptableMin = Number(options.acceptableMin);
  const acceptableMax = Number(options.acceptableMax);
  const underflow = currentTotal < acceptableMin;
  const overflow = currentTotal > acceptableMax;
  const hookFailures = options.strategyFailedBlocks.filter((block) =>
    String(block?.slot_type || "") === "hook"
  );
  const jointUnderflowBlocks = options.blocks.filter((block) =>
    String(block?.generated_text || "").trim()
      && (block?.dna_copy_guard?.passed === true || String(block?.slot_type || "") === "hook")
  );
  const requestedBlocks = underflow
    ? jointUnderflowBlocks
    : hookFailures.length > 0 && !overflow
    ? hookFailures
    : options.strategyFailedBlocks;
  return {
    requested_blocks: requestedBlocks,
    current_total: currentTotal,
    pacing_underflow_requires_joint_repair: underflow,
    pacing_overflow_requires_joint_repair: overflow,
  };
}

/**
 * Plans a narrowly bounded repair when an otherwise useful Writer revision
 * lands just below the unchanged whole-script duration floor.
 *
 * The planner never lowers a gate, never touches the 3-5s hook and never
 * manufactures padding. It only identifies exact word targets inside the
 * existing per-slot ceilings. The caller must ask the Writer to fill those
 * targets from local evidence and must run every narrative/copy/register gate
 * again before accepting the result.
 */
export function resolveRevisionWordFloorRepairPlan(options: {
  baseBlocks: RevisionWordFloorBlock[];
  proposedBlocks: RevisionWordFloorBlock[];
  allocations: RevisionWordFloorAllocation[];
  eligibleIndexes: Iterable<number>;
  acceptableMin: number;
  acceptableMax: number;
  maxSafeDeficit?: number;
}): RevisionWordFloorRepairPlan {
  const acceptableMin = Math.max(0, Math.trunc(Number(options.acceptableMin) || 0));
  const acceptableMax = Math.max(acceptableMin, Math.trunc(Number(options.acceptableMax) || acceptableMin));
  const maxSafeDeficit = Math.max(
    0,
    Math.trunc(Number(options.maxSafeDeficit) || MAX_SAFE_REVISION_WORD_FLOOR_DEFICIT),
  );
  const eligibleIndexes = new Set([...options.eligibleIndexes].map(Number).filter(Number.isInteger));
  const proposedByIndex = new Map(
    options.proposedBlocks
      .map((block) => [Number(block?.index), block] as const)
      .filter(([index]) => Number.isInteger(index)),
  );
  const allocationByIndex = new Map(
    options.allocations
      .map((allocation) => [Number(allocation?.index), allocation] as const)
      .filter(([index]) => Number.isInteger(index)),
  );
  const combinedBlocks = options.baseBlocks.map((block) =>
    proposedByIndex.get(Number(block?.index)) || block
  );
  const currentTotal = combinedBlocks.reduce(
    (sum, block) => sum + wordCount(block?.generated_text),
    0,
  );
  const deficit = Math.max(0, acceptableMin - currentTotal);
  const baseResult = {
    current_total: currentTotal,
    acceptable_min: acceptableMin,
    acceptable_max: acceptableMax,
    deficit,
    max_safe_deficit: maxSafeDeficit,
  };
  if (deficit === 0) {
    return {
      ...baseResult,
      status: "not_needed",
      reason: currentTotal > acceptableMax ? "above_acceptable_max" : "whole_script_floor_satisfied",
      total_headroom: 0,
      targets: [],
    };
  }
  if (deficit > maxSafeDeficit) {
    return {
      ...baseResult,
      status: "ineligible",
      reason: "deficit_above_safe_bound",
      total_headroom: 0,
      targets: [],
    };
  }

  const baseByIndex = new Map(options.baseBlocks.map((block) => [Number(block?.index), block]));
  const candidates = options.proposedBlocks.flatMap((proposed) => {
    const index = Number(proposed?.index);
    const base = baseByIndex.get(index);
    const allocation = allocationByIndex.get(index);
    const proposedText = String(proposed?.generated_text || "").trim();
    const baseText = String(base?.generated_text || "").trim();
    if (!Number.isInteger(index)
      || !eligibleIndexes.has(index)
      || !base
      || !allocation
      || !proposedText
      || proposedText === baseText
      || String(proposed?.slot_type || base?.slot_type || "").trim().toLowerCase() === "hook") {
      return [];
    }
    const currentWords = wordCount(proposedText);
    const priorWords = wordCount(baseText);
    const maxWords = Math.max(currentWords, Math.trunc(Number(allocation.max) || currentWords));
    const headroom = Math.max(0, maxWords - currentWords);
    return headroom > 0
      ? [{ index, currentWords, priorWords, maxWords, headroom }]
      : [];
  }).sort((left, right) => {
    const leftRemovedWords = Math.max(0, left.priorWords - left.currentWords);
    const rightRemovedWords = Math.max(0, right.priorWords - right.currentWords);
    return rightRemovedWords - leftRemovedWords
      || right.headroom - left.headroom
      || left.index - right.index;
  });
  const totalHeadroom = candidates.reduce((sum, candidate) => sum + candidate.headroom, 0);
  if (totalHeadroom < deficit) {
    return {
      ...baseResult,
      status: "ineligible",
      reason: "insufficient_changed_non_hook_headroom",
      total_headroom: totalHeadroom,
      targets: [],
    };
  }

  const additions = new Map<number, number>();
  let remaining = deficit;
  // Spread a short repair across changed evidence-rich slots first. This keeps
  // one block from receiving nine words of filler merely because it has the
  // largest ceiling. A second pass uses any remaining capacity when only one
  // slot can safely fund the whole deficit.
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const addition = Math.min(5, candidate.headroom, remaining);
    if (addition > 0) additions.set(candidate.index, addition);
    remaining -= addition;
  }
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const alreadyAdded = additions.get(candidate.index) || 0;
    const extraCapacity = candidate.headroom - alreadyAdded;
    const addition = Math.min(extraCapacity, remaining);
    if (addition > 0) additions.set(candidate.index, alreadyAdded + addition);
    remaining -= addition;
  }
  if (remaining > 0) {
    return {
      ...baseResult,
      status: "ineligible",
      reason: "repair_distribution_failed",
      total_headroom: totalHeadroom,
      targets: [],
    };
  }
  const targets = candidates.flatMap((candidate) => {
    const addWords = additions.get(candidate.index) || 0;
    return addWords > 0
      ? [{
        index: candidate.index,
        current_words: candidate.currentWords,
        prior_words: candidate.priorWords,
        add_words: addWords,
        target_words: candidate.currentWords + addWords,
        max_words: candidate.maxWords,
      }]
      : [];
  });
  return {
    ...baseResult,
    status: "eligible",
    reason: "short_deficit_can_be_repaired_from_changed_slot_evidence",
    total_headroom: totalHeadroom,
    targets,
  };
}
