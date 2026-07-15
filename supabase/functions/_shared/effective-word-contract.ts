export interface EffectiveWordContract {
  index: number;
  min: number;
  max: number;
  target_words: number;
  source: "base_allocation" | "persisted_block_effective_contract";
}

function finiteInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Accepts the assembler's persisted local density/donor contract only inside
 * the same bounded envelope used by the Writer: hook never expands; every
 * later slot may add at most ten words. Malformed or over-wide contracts fall
 * back to the recomputed base allocation.
 */
export function resolveValidatedEffectiveWordContract(
  allocation: any,
  block: any,
  allowPersistedOverride: boolean,
): EffectiveWordContract {
  const index = finiteInteger(allocation?.index) ?? -1;
  const baseMin = Math.max(0, finiteInteger(allocation?.min) ?? 0);
  const baseMax = Math.max(baseMin, finiteInteger(allocation?.max) ?? baseMin);
  const baseTarget = Math.min(
    baseMax,
    Math.max(baseMin, finiteInteger(allocation?.target_words) ?? baseMax),
  );
  const base: EffectiveWordContract = {
    index,
    min: baseMin,
    max: baseMax,
    target_words: baseTarget,
    source: "base_allocation",
  };
  if (!allowPersistedOverride) return base;

  const persisted = block?.effective_word_contract;
  const persistedIndex = finiteInteger(persisted?.index);
  const persistedMin = finiteInteger(persisted?.min);
  const persistedMax = finiteInteger(persisted?.max);
  const persistedTarget = finiteInteger(persisted?.target_words);
  const expansionAllowance = String(block?.slot_type || "") === "hook" ? 0 : 10;
  const valid = persistedIndex === index
    && persistedMin === baseMin
    && persistedMax !== null
    && persistedMax >= baseMin
    && persistedMax <= baseMax + expansionAllowance
    && persistedTarget !== null
    && persistedTarget >= baseMin
    && persistedTarget <= persistedMax;
  return valid ? {
    index,
    min: persistedMin!,
    max: persistedMax!,
    target_words: persistedTarget!,
    source: "persisted_block_effective_contract",
  } : base;
}
