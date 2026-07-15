import { describe, expect, it } from "vitest";
import {
  assessVideoNarrativeSequence,
  normalizeNarrativeStage,
} from "../../../supabase/functions/_shared/narrative-sequence-contract";

const contract = {
  contract_type: "abstract_narrative_order",
  normalized_stage_order: ["hook", "development", "payoff"],
  dominant_sequence_usage: "statistical_reference_only",
  literal_source_sequence_required: false,
  visual_chronology_priority: true,
  fail_closed_for_video_slot_order: true,
};

describe("abstract narrative sequence contract", () => {
  it("normalizes aliases without requiring a literal source sequence", () => {
    expect(normalizeNarrativeStage("tensão")).toBe("development");
    expect(normalizeNarrativeStage("desfecho")).toBe("payoff");
    const result = assessVideoNarrativeSequence([
      { index: 0, slot_type: "gancho" },
      { index: 1, slot_type: "setup" },
      { index: 2, slot_type: "tensão" },
      { index: 3, slot_type: "revelação" },
      { index: 4, slot_type: "desfecho" },
    ], contract);
    expect(result.passed).toBe(true);
    expect(result.normalized_sequence).toEqual(["hook", "development", "development", "development", "payoff"]);
  });

  it("fails closed when payoff precedes development or a new hook appears late", () => {
    const result = assessVideoNarrativeSequence([
      { index: 0, slot_type: "hook" },
      { index: 1, slot_type: "payoff" },
      { index: 2, slot_type: "desenvolvimento" },
      { index: 3, slot_type: "hook" },
    ], contract);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("narrative_order_regression_at_2");
  });

  it("rejects a contract that asks to copy a source sequence literally", () => {
    const result = assessVideoNarrativeSequence([
      { slot_type: "hook" },
      { slot_type: "desenvolvimento" },
      { slot_type: "payoff" },
    ], { ...contract, literal_source_sequence_required: true });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("literal_source_sequence_must_not_be_required");
  });
});
