import { describe, expect, it } from "vitest";
import {
  MAX_SAFE_REVISION_WORD_FLOOR_DEFICIT,
  resolvePreEvaluatorRepairScope,
  resolveRevisionWordFloorRepairPlan,
} from "../../../supabase/functions/_shared/revision-word-floor";

const words = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" ");

describe("reparo seguro do piso global apos revisao", () => {
  it("expands the exact v17 165-word underflow jointly instead of isolating the hook", () => {
    const counts = [17, 30, 22, 33, 23, 20, 20];
    const blocks = counts.map((count, offset) => ({
      index: offset + 1,
      slot_type: offset === 0 ? "hook" : offset === 6 ? "payoff" : "desenvolvimento",
      generated_text: words(count, `s${offset + 1}-`),
      dna_copy_guard: { passed: offset !== 0 },
    }));
    const scope = resolvePreEvaluatorRepairScope({
      blocks,
      strategyFailedBlocks: [blocks[0]],
      acceptableMin: 191,
      acceptableMax: 217,
    });

    expect(scope).toMatchObject({
      current_total: 165,
      pacing_underflow_requires_joint_repair: true,
      pacing_overflow_requires_joint_repair: false,
    });
    expect(scope.requested_blocks.map((block) => block.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("preserves hook-only repair when the complete draft already fits the global range", () => {
    const counts = [17, 29, 31, 31, 30, 30, 30];
    const blocks = counts.map((count, offset) => ({
      index: offset + 1,
      slot_type: offset === 0 ? "hook" : offset === 6 ? "payoff" : "desenvolvimento",
      generated_text: words(count, `ok${offset + 1}-`),
      dna_copy_guard: { passed: offset !== 0 },
    }));
    const scope = resolvePreEvaluatorRepairScope({
      blocks,
      strategyFailedBlocks: [blocks[0]],
      acceptableMin: 191,
      acceptableMax: 217,
    });

    expect(scope.current_total).toBe(198);
    expect(scope.pacing_underflow_requires_joint_repair).toBe(false);
    expect(scope.requested_blocks.map((block) => block.index)).toEqual([1]);
  });

  it("considera somente slots nao-hook cujo texto foi realmente revisado", () => {
    const plan = resolveRevisionWordFloorRepairPlan({
      baseBlocks: [
        { index: 0, slot_type: "hook", generated_text: words(15, "h") },
        { index: 1, slot_type: "desenvolvimento", generated_text: words(90, "a") },
        { index: 2, slot_type: "payoff", generated_text: words(91, "b") },
      ],
      proposedBlocks: [
        { index: 0, slot_type: "hook", generated_text: words(15, "novo-hook") },
        { index: 1, slot_type: "desenvolvimento", generated_text: words(84, "simples-a") },
        { index: 2, slot_type: "payoff", generated_text: words(91, "b") },
      ],
      allocations: [
        { index: 0, min: 12, max: 19 },
        { index: 1, min: 70, max: 94 },
        { index: 2, min: 70, max: 94 },
      ],
      eligibleIndexes: [0, 1, 2],
      acceptableMin: 191,
      acceptableMax: 220,
    });

    expect(plan).toMatchObject({
      status: "eligible",
      current_total: 190,
      acceptable_min: 191,
      deficit: 1,
    });
    expect(plan.targets).toEqual([expect.objectContaining({ index: 1, add_words: 1, target_words: 85 })]);
  });

  it("preenche exatamente um deficit curto sem tocar o hook nem ultrapassar tetos locais", () => {
    const plan = resolveRevisionWordFloorRepairPlan({
      baseBlocks: [
        { index: 0, slot_type: "hook", generated_text: words(15, "h") },
        { index: 1, slot_type: "desenvolvimento", generated_text: words(90, "a") },
        { index: 2, slot_type: "payoff", generated_text: words(91, "b") },
      ],
      proposedBlocks: [
        { index: 0, slot_type: "hook", generated_text: words(15, "novo-hook") },
        { index: 1, slot_type: "desenvolvimento", generated_text: words(86, "simples-a") },
        { index: 2, slot_type: "payoff", generated_text: words(83, "simples-b") },
      ],
      allocations: [
        { index: 0, min: 12, max: 19 },
        { index: 1, min: 70, max: 94 },
        { index: 2, min: 70, max: 94 },
      ],
      eligibleIndexes: [0, 1, 2],
      acceptableMin: 191,
      acceptableMax: 220,
    });

    expect(plan.status).toBe("eligible");
    expect(plan.current_total).toBe(184);
    expect(plan.deficit).toBe(7);
    expect(plan.targets.map((target) => target.index)).toEqual([2, 1]);
    expect(plan.targets.reduce((sum, target) => sum + target.add_words, 0)).toBe(7);
    expect(plan.targets.every((target) => target.target_words <= target.max_words)).toBe(true);
    expect(plan.targets.some((target) => target.index === 0)).toBe(false);
  });

  it("continua fail-closed quando o deficit passa do limite curto", () => {
    const plan = resolveRevisionWordFloorRepairPlan({
      baseBlocks: [{ index: 1, slot_type: "desenvolvimento", generated_text: words(200, "a") }],
      proposedBlocks: [{ index: 1, slot_type: "desenvolvimento", generated_text: words(180, "b") }],
      allocations: [{ index: 1, min: 100, max: 220 }],
      eligibleIndexes: [1],
      acceptableMin: 191,
      acceptableMax: 210,
    });

    expect(MAX_SAFE_REVISION_WORD_FLOOR_DEFICIT).toBe(9);
    expect(plan).toMatchObject({
      status: "ineligible",
      reason: "deficit_above_safe_bound",
      deficit: 11,
      targets: [],
    });
  });

  it("continua fail-closed sem espaco provado nos slots revisados", () => {
    const plan = resolveRevisionWordFloorRepairPlan({
      baseBlocks: [
        { index: 0, slot_type: "hook", generated_text: words(15, "h") },
        { index: 1, slot_type: "desenvolvimento", generated_text: words(180, "a") },
      ],
      proposedBlocks: [
        { index: 0, slot_type: "hook", generated_text: words(19, "hook-maior") },
        { index: 1, slot_type: "desenvolvimento", generated_text: words(171, "simples") },
      ],
      allocations: [
        { index: 0, min: 12, max: 19 },
        { index: 1, min: 150, max: 171 },
      ],
      eligibleIndexes: [0, 1],
      acceptableMin: 191,
      acceptableMax: 210,
    });

    expect(plan).toMatchObject({
      status: "ineligible",
      reason: "insufficient_changed_non_hook_headroom",
      deficit: 1,
      total_headroom: 0,
      targets: [],
    });
  });

  it("nao cria reparo quando o piso global ja esta satisfeito", () => {
    const plan = resolveRevisionWordFloorRepairPlan({
      baseBlocks: [{ index: 1, slot_type: "payoff", generated_text: words(192, "a") }],
      proposedBlocks: [{ index: 1, slot_type: "payoff", generated_text: words(191, "b") }],
      allocations: [{ index: 1, min: 150, max: 200 }],
      eligibleIndexes: [1],
      acceptableMin: 191,
      acceptableMax: 210,
    });

    expect(plan).toMatchObject({
      status: "not_needed",
      reason: "whole_script_floor_satisfied",
      current_total: 191,
      deficit: 0,
      targets: [],
    });
  });
});
