import { describe, expect, it } from "vitest";
import { resolveValidatedEffectiveWordContract } from "../../../supabase/functions/_shared/effective-word-contract";

const base = { index: 2, min: 9, max: 30, target_words: 30 };

describe("contrato efetivo persistido por bloco", () => {
  it("aceita expansão visual não-hook de até dez palavras", () => {
    expect(resolveValidatedEffectiveWordContract(base, {
      slot_type: "setup",
      effective_word_contract: { index: 2, min: 9, max: 40, target_words: 38 },
    }, true)).toMatchObject({ min: 9, max: 40, target_words: 38, source: "persisted_block_effective_contract" });
  });

  it("aceita compressão doadora sem alterar o mínimo", () => {
    expect(resolveValidatedEffectiveWordContract(base, {
      slot_type: "setup",
      effective_word_contract: { index: 2, min: 9, max: 24, target_words: 24 },
    }, true)).toMatchObject({ min: 9, max: 24, source: "persisted_block_effective_contract" });
  });

  it("rejeita expansão do hook e contratos acima de dez palavras", () => {
    expect(resolveValidatedEffectiveWordContract(base, {
      slot_type: "hook",
      effective_word_contract: { index: 2, min: 9, max: 31, target_words: 31 },
    }, true).source).toBe("base_allocation");
    expect(resolveValidatedEffectiveWordContract(base, {
      slot_type: "setup",
      effective_word_contract: { index: 2, min: 9, max: 41, target_words: 40 },
    }, true).source).toBe("base_allocation");
  });

  it("ignora override quando o loop viral não o autorizou", () => {
    expect(resolveValidatedEffectiveWordContract(base, {
      slot_type: "setup",
      effective_word_contract: { index: 2, min: 9, max: 40, target_words: 38 },
    }, false).source).toBe("base_allocation");
  });
});
