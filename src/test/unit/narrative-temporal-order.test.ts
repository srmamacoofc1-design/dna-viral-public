import { describe, expect, it } from "vitest";
import { hasNarrativeMicroeventOrderRegression } from "../../../supabase/functions/_shared/narrative-temporal-order";

describe("ordem temporal do narrative fidelity gate", () => {
  it("aceita a sobreposicao real v9 entre o frame final do hook e a fala inicial do setup", () => {
    expect(hasNarrativeMicroeventOrderRegression(
      {
        start_seconds: 5,
        end_seconds: 5,
        script_slot_index: 1,
      },
      {
        start_seconds: 4.67,
        end_seconds: 9.37,
        script_slot_index: 2,
      },
    )).toBe(false);
  });

  it("continua reprovando uma regressao real sem sobreposicao entre slots", () => {
    expect(hasNarrativeMicroeventOrderRegression(
      {
        start_seconds: 5,
        end_seconds: 5,
        script_slot_index: 1,
      },
      {
        start_seconds: 1.2,
        end_seconds: 4.66,
        script_slot_index: 2,
      },
    )).toBe(true);
  });

  it("continua reprovando inversao intrasslot mesmo quando as janelas se sobrepoem", () => {
    expect(hasNarrativeMicroeventOrderRegression(
      {
        start_seconds: 5,
        end_seconds: 8,
        script_slot_index: 2,
      },
      {
        start_seconds: 4.67,
        end_seconds: 9.37,
        script_slot_index: 2,
      },
    )).toBe(true);
  });
});
