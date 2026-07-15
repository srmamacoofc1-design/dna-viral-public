import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ExactBlockCoverageError,
  normalizeExactBlockCoverage,
} from "../../../supabase/functions/_shared/exact-block-coverage";

const canonicalBlocks = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    tipo_bloco: "gancho",
    texto: "Texto canônico do gancho",
    tempo_inicio: 0,
    tempo_fim: 2,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    tipo_bloco: "desenvolvimento",
    texto: "Texto canônico do desenvolvimento",
    tempo_inicio: 2,
    tempo_fim: 7,
  },
];

describe("exact semantic block coverage", () => {
  it("aceita todos os IDs uma única vez e restaura dados canônicos na ordem do banco", () => {
    const normalized = normalizeExactBlockCoverage(canonicalBlocks, [
      {
        block_id: canonicalBlocks[1].id,
        block_type: "inventado",
        block_text: "texto inventado",
        timestamp_start: 999,
        timestamp_end: 1000,
        block_keywords: ["segundo"],
      },
      {
        block_id: canonicalBlocks[0].id,
        block_type: "inventado",
        block_text: "texto inventado",
        timestamp_start: 999,
        timestamp_end: 1000,
        block_keywords: ["primeiro"],
      },
    ]);

    expect(normalized.map((block) => block.block_id)).toEqual(canonicalBlocks.map((block) => block.id));
    expect(normalized[0]).toMatchObject({
      block_type: "gancho",
      block_text: "Texto canônico do gancho",
      timestamp_start: 0,
      timestamp_end: 2,
      block_keywords: ["primeiro"],
    });
  });

  it("rejeita cobertura parcial em vez de devolver subconjunto persistível", () => {
    expect(() => normalizeExactBlockCoverage(canonicalBlocks, [
      { block_id: canonicalBlocks[0].id },
    ])).toThrowError(ExactBlockCoverageError);

    try {
      normalizeExactBlockCoverage(canonicalBlocks, [{ block_id: canonicalBlocks[0].id }]);
    } catch (error) {
      expect(error).toBeInstanceOf(ExactBlockCoverageError);
      expect((error as ExactBlockCoverageError).missingIds).toEqual([canonicalBlocks[1].id]);
    }
  });

  it("rejeita IDs duplicados ou fora do conjunto canônico", () => {
    expect(() => normalizeExactBlockCoverage(canonicalBlocks, [
      { block_id: canonicalBlocks[0].id },
      { block_id: canonicalBlocks[0].id },
    ])).toThrowError(/duplicates=/);

    expect(() => normalizeExactBlockCoverage(canonicalBlocks, [
      { block_id: canonicalBlocks[0].id },
      { block_id: "33333333-3333-4333-8333-333333333333" },
    ])).toThrowError(/unknown=/);
  });

  it("rejeita IDs duplicados na própria fonte canônica", () => {
    expect(() => normalizeExactBlockCoverage(
      [canonicalBlocks[0], { ...canonicalBlocks[1], id: canonicalBlocks[0].id }],
      [],
    )).toThrowError(/Canonical block ID is duplicated/);
  });
});

describe("extract-block-semantics fail-closed contract", () => {
  it("tenta no máximo duas vezes por Edge, valida antes de apagar e responde com erro HTTP", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/functions/extract-block-semantics/index.ts"),
      "utf8",
    );
    const validateAt = source.indexOf("normalizeExactBlockCoverage(chunk, candidate.blocks)");
    const deleteAt = source.indexOf('supabase.from("block_semantic_patterns").delete()');

    expect(source).toContain("const maxAiAttempts = 2");
    expect(source).toContain("SEMANTIC_CHUNK_SIZE = 6");
    expect(source).toContain("SEMANTIC_CHUNK_CONCURRENCY = 2");
    expect(source).toContain("AI failed exact block coverage after");
    expect(validateAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(validateAt);
    expect(source).toContain("e instanceof ExactBlockCoverageError");
    expect(source).toContain("? 422");
    expect(source).not.toContain('{ status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },\n    );');
  });
});
