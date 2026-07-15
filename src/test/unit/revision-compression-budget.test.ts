import { describe, expect, it } from "vitest";
import { resolveRevisionCompressionBudget } from "../../../supabase/functions/_shared/revision-compression-budget";

describe("orçamento de compressão da revisão", () => {
  it("não cria necessidade de donor quando o headroom global comporta todo o crescimento", () => {
    expect(resolveRevisionCompressionBudget({
      requestedGrowth: 8,
      currentTotal: 182,
      acceptableMax: 194,
    })).toEqual({
      requested_growth: 8,
      current_total: 182,
      acceptable_max: 194,
      global_headroom: 12,
      compression_required: 0,
    });
  });

  it("comprime somente o excedente que não cabe no headroom real", () => {
    expect(resolveRevisionCompressionBudget({
      requestedGrowth: 9,
      currentTotal: 188,
      acceptableMax: 194,
    }).compression_required).toBe(3);
  });

  it("inclui um excesso anterior no cálculo em vez de fingir headroom", () => {
    expect(resolveRevisionCompressionBudget({
      requestedGrowth: 4,
      currentTotal: 197,
      acceptableMax: 194,
    }).compression_required).toBe(7);
  });
});
