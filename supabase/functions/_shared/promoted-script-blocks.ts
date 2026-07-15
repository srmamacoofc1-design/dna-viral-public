export type PromotableScriptBlock = Record<string, unknown>;

function finiteBlockIndex(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Assemblies historically used either `index` or `slot_index`. Prefer the
 * canonical assembly `index`, but fall back to `slot_index` when it is absent
 * or invalid so older assemblies remain promotable.
 */
export function resolvePromotedBlockIndex(block: PromotableScriptBlock): number | null {
  return finiteBlockIndex(block.index) ?? finiteBlockIndex(block.slot_index);
}

/** Stable numeric ordering; blocks without a usable index stay last and keep
 * their source order. */
export function sortPromotableScriptBlocks(
  blocks: PromotableScriptBlock[],
): PromotableScriptBlock[] {
  return blocks
    .map((block, sourceOrder) => ({ block, sourceOrder, index: resolvePromotedBlockIndex(block) }))
    .sort((left, right) => {
      if (left.index === null && right.index === null) return left.sourceOrder - right.sourceOrder;
      if (left.index === null) return 1;
      if (right.index === null) return -1;
      return (left.index - right.index) || (left.sourceOrder - right.sourceOrder);
    })
    .map(({ block }) => block);
}
