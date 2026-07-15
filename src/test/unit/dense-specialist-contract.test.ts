import { describe, expect, it, vi } from "vitest";
import {
  resolveDenseSpecialistBudget,
  resolveEvidenceAwareMicroRevealRate,
  resolveEvidenceDensitySentenceMax,
  runOptionalDenseSpecialist,
  selectLocalQualifierGuidance,
} from "../../../supabase/functions/_shared/dense-specialist-contract.ts";

describe("dense specialist contract", () => {
  it("uses the real remaining deadline without manufacturing a 2500ms floor", () => {
    expect(resolveDenseSpecialistBudget(12_499, 10_000)).toEqual({
      eligible: false,
      remaining_ms: 2_499,
      minimum_budget_ms: 2_500,
    });
    expect(resolveDenseSpecialistBudget(12_500, 10_000)).toEqual({
      eligible: true,
      remaining_ms: 2_500,
      minimum_budget_ms: 2_500,
    });
    expect(resolveDenseSpecialistBudget(9_000, 10_000).remaining_ms).toBe(0);
  });

  it("skips an optional slot before transport when its budget is insufficient", async () => {
    const execute = vi.fn(async () => "never");
    const result = await runOptionalDenseSpecialist({
      deadlineAtMs: 12_499,
      now: () => 10_000,
      execute,
    });
    expect(result).toMatchObject({
      status: "skipped",
      remaining_ms: 2_499,
      value: null,
      failure_reason: "time_budget_insufficient",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("contains a rejected provider call instead of throwing a writer error", async () => {
    const result = await runOptionalDenseSpecialist({
      deadlineAtMs: 20_000,
      now: () => 10_000,
      execute: async () => {
        throw new Error("provider unavailable");
      },
    });
    expect(result).toMatchObject({
      status: "failed",
      value: null,
      failure_reason: "provider_error",
    });
  });

  it("classifies a structured-agent deadline failure without propagating it", async () => {
    const result = await runOptionalDenseSpecialist({
      deadlineAtMs: 20_000,
      now: () => 10_000,
      execute: async () => {
        throw new Error("structured_agent_time_budget_exhausted");
      },
    });
    expect(result.status).toBe("failed");
    expect(result.failure_reason).toBe("time_budget_exhausted");
  });

  it("allows three sentences for five or six non-hook events but preserves hook DNA", () => {
    expect(resolveEvidenceDensitySentenceMax({
      slotType: "desenvolvimento",
      observedMin: 1,
      observedMax: 2,
      requiredEventCount: 5,
    })).toBe(3);
    expect(resolveEvidenceDensitySentenceMax({
      slotType: "tensao",
      observedMin: 1,
      observedMax: 2,
      requiredEventCount: 6,
    })).toBe(3);
    expect(resolveEvidenceDensitySentenceMax({
      slotType: "hook",
      observedMin: 1,
      observedMax: 1,
      requiredEventCount: 6,
    })).toBe(1);
  });

  it("does not force an invented second reveal into a one-event local window", () => {
    expect(resolveEvidenceAwareMicroRevealRate({
      slotType: "tensao",
      observedRate: 0.8,
      requiredEventCount: 1,
    })).toBe(0.34);
    expect(resolveEvidenceAwareMicroRevealRate({
      slotType: "desenvolvimento",
      observedRate: 0.8,
      requiredEventCount: 2,
    })).toBe(0.8);
    expect(resolveEvidenceAwareMicroRevealRate({
      slotType: "hook",
      observedRate: 0.8,
      requiredEventCount: 1,
    })).toBe(0.8);
  });

  it("sends only qualifier guidance required by the local events", () => {
    const guidance = {
      purpose: "purpose rule",
      fear: "fear rule",
      mansion_specificity: "mansion rule",
    };
    expect(selectLocalQualifierGuidance(guidance, ["purpose", "mansion_specificity"]))
      .toEqual({
        purpose: "purpose rule",
        mansion_specificity: "mansion rule",
      });
  });
});
