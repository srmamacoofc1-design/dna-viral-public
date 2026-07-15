import { describe, expect, it } from "vitest";
import { mapInOrderedChunks } from "../../../supabase/functions/_shared/bounded-concurrency.ts";

describe("mapInOrderedChunks", () => {
  it("preserva a ordem e nunca supera a concorrência configurada", async () => {
    let active = 0;
    let maximumActive = 0;
    const result = await mapInOrderedChunks([0, 1, 2, 3, 4, 5, 6], 2, async (value) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 === 0 ? 4 : 1));
      active--;
      return `slot-${value}`;
    });

    expect(maximumActive).toBe(2);
    expect(result).toEqual(["slot-0", "slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"]);
  });

  it("falha fechado e não agenda lotes posteriores depois de um erro", async () => {
    const started: number[] = [];
    await expect(mapInOrderedChunks([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      if (value === 1) throw new Error("provider_429");
      return value;
    })).rejects.toThrow("provider_429");

    expect(started).toEqual([0, 1]);
  });

  it("rejeita limite inválido antes de executar o worker", async () => {
    let calls = 0;
    await expect(mapInOrderedChunks([1], 0, async (value) => {
      calls++;
      return value;
    })).rejects.toThrow("bounded_concurrency_invalid");
    expect(calls).toBe(0);
  });
});
