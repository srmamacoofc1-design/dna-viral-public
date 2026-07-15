import { describe, expect, it } from "vitest";
import {
  assignExactTranscriptTextToBlocks,
  assertNarrativeBlockContract,
  assertTranscriptTimelineMatchesSource,
  enforceNarrativeBlockLimit,
} from "../../../supabase/functions/_shared/narrative-blocks";

function blocks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    bloco_id: index + 1,
    tipo_bloco: index === 0 ? "hook" : index === count - 1 ? "payoff" : "desenvolvimento",
    tempo_inicio: index,
    tempo_fim: index + 1,
    texto: `trecho-${index}`,
    emocao: index === 0 ? "impacto" : "curiosidade",
    funcao_narrativa: `função-${index}`,
    semantic_shift_score: index % 3 === 0 ? 5 : 80,
    visual_shift_score: index,
  }));
}

describe("narrative block limit", () => {
  it("persists exact spoken captions instead of an AI title/paraphrase", () => {
    const provider = [
      { ...blocks(3)[0], tempo_inicio: 0, tempo_fim: 3, texto: "TÍTULO APELATIVO INVENTADO" },
      { ...blocks(3)[1], tempo_inicio: 3, tempo_fim: 6, texto: "paráfrase da IA" },
      { ...blocks(3)[2], tempo_inicio: 6, tempo_fim: 9, texto: "outro texto inventado" },
    ];
    const transcript = [
      { tempo_inicio: 0, tempo_fim: 3, texto: "Frase falada real, com pontuação!" },
      { tempo_inicio: 3, tempo_fim: 6, texto: "Depois, a fala continua." },
      { tempo_inicio: 6, tempo_fim: 9, texto: "E termina exatamente assim." },
    ];
    const assigned = assignExactTranscriptTextToBlocks(provider, transcript);
    expect(assigned.map((block) => block.texto)).toEqual(transcript.map((segment) => segment.texto));
    expect(assigned.map((block) => block.texto).join(" ")).not.toContain("TÍTULO APELATIVO");
    expect(provider[0].texto).toBe("TÍTULO APELATIVO INVENTADO");
  });

  it("assigns a crossing caption exactly once to the block with greatest overlap", () => {
    const provider = [
      { ...blocks(3)[0], tempo_inicio: 0, tempo_fim: 3 },
      { ...blocks(3)[1], tempo_inicio: 3, tempo_fim: 6 },
      { ...blocks(3)[2], tempo_inicio: 6, tempo_fim: 9 },
    ];
    const assigned = assignExactTranscriptTextToBlocks(provider, [
      { tempo_inicio: 0, tempo_fim: 2.8, texto: "primeira" },
      { tempo_inicio: 2.8, tempo_fim: 5.8, texto: "cruza mas pertence ao segundo" },
      { tempo_inicio: 6, tempo_fim: 9, texto: "terceira" },
    ]);
    expect(assigned[0].texto).toBe("primeira");
    expect(assigned[1].texto).toBe("cruza mas pertence ao segundo");
    expect(assigned[2].texto).toBe("terceira");
  });

  it("uses the MP4 duration and rejects a 149s transcript attached to a 115s source", () => {
    const foreignTranscript = Array.from({ length: 149 }, (_, index) => ({
      tempo_inicio: index,
      tempo_fim: index + 1,
    }));
    expect(() => assertTranscriptTimelineMatchesSource(foreignTranscript, 115)).toThrow(
      /TRANSCRIPT_TIMELINE_EXCEEDS_SOURCE_DURATION/,
    );

    const matchingTranscript = Array.from({ length: 115 }, (_, index) => ({
      tempo_inicio: index,
      tempo_fim: index + 1,
    }));
    expect(assertTranscriptTimelineMatchesSource(matchingTranscript, 115)).toBe(115);
  });

  it("rejects a transcript that covers too little of the authoritative media", () => {
    expect(() => assertTranscriptTimelineMatchesSource([
      { tempo_inicio: 0, tempo_fim: 40 },
    ], 115)).toThrow(/TRANSCRIPT_TIMELINE_INCOMPLETE.*coverage/i);
  });

  it("coalesces excess blocks without dropping text, time range, hook or payoff", () => {
    const source = blocks(26);
    const result = enforceNarrativeBlockLimit(source, 18);

    expect(result).toHaveLength(18);
    expect(result[0].tempo_inicio).toBe(0);
    expect(result.at(-1)?.tempo_fim).toBe(26);
    expect(result.some((block) => block.tipo_bloco === "hook")).toBe(true);
    expect(result.some((block) => block.tipo_bloco === "payoff")).toBe(true);
    expect(result.map((block) => block.bloco_id)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
    const allText = result.map((block) => block.texto).join(" ");
    for (let index = 0; index < 26; index++) expect(allText).toContain(`trecho-${index}`);
  });

  it("does not mutate or expand a provider result already inside the limit", () => {
    const source = blocks(12);
    const snapshot = structuredClone(source);
    const result = enforceNarrativeBlockLimit(source, 18);

    expect(source).toEqual(snapshot);
    expect(result).toHaveLength(12);
    expect(result).not.toBe(source);
  });

  it("accepts only the 3-18 block contract with hook, development and payoff", () => {
    expect(() => assertNarrativeBlockContract(blocks(3), 3)).not.toThrow();
    expect(() => assertNarrativeBlockContract(blocks(18), 18)).not.toThrow();

    expect(() => assertNarrativeBlockContract(blocks(2), 2)).toThrow(/expected_3_18_blocks/i);
    expect(() => assertNarrativeBlockContract(blocks(19), 19)).toThrow(/expected_3_18_blocks/i);

    for (const missing of ["hook", "desenvolvimento", "payoff"]) {
      const invalid = blocks(6).map((block) => ({
        ...block,
        tipo_bloco: block.tipo_bloco === missing ? "transicao" : block.tipo_bloco,
      }));
      expect(() => assertNarrativeBlockContract(invalid, 6)).toThrow(
        new RegExp(`missing_required_block_types_.*${missing}`, "i"),
      );
    }
  });

  it("rejects a foreign, incomplete or malformed narrative timeline before persistence", () => {
    const source = blocks(12).map((block) => ({
      ...block,
      tempo_inicio: Number(block.tempo_inicio) * 10,
      tempo_fim: Number(block.tempo_fim) * 10,
      texto: String(block.texto),
    }));
    source.at(-1)!.tempo_fim = 149;
    expect(() => assertNarrativeBlockContract(source, 114.544)).toThrow(
      /end_after_source_duration/i,
    );

    const valid = blocks(12).map((block) => ({
      ...block,
      tempo_inicio: Number(block.tempo_inicio) * 10,
      tempo_fim: (Number(block.tempo_inicio) + 1) * 10,
    }));
    valid.at(-1)!.tempo_fim = 114.544;
    expect(() => assertNarrativeBlockContract(valid, 114.544)).not.toThrow();

    expect(() => assertNarrativeBlockContract(
      valid.map((block, index) => index === 4 ? { ...block, texto: "" } : block),
      114.544,
    )).toThrow(/block_5_text_empty/i);
    expect(() => assertNarrativeBlockContract(
      valid.map((block, index) => index === 4 ? { ...block, tempo_inicio: 60 } : block),
      114.544,
    )).toThrow(/gap_too_large|overlap_too_large/i);
  });

  it("rejects accumulated small overlaps even when each boundary is within tolerance", () => {
    const overlapping = blocks(12).map((block, index) => ({
      ...block,
      tempo_inicio: index * 0.8,
      tempo_fim: index * 0.8 + 1,
    }));
    expect(() => assertNarrativeBlockContract(overlapping, 9.8)).toThrow(
      /total_timeline_overlap_too_large/i,
    );
  });
});
