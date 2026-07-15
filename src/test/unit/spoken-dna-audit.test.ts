import { describe, expect, it } from "vitest";
import { validateSpokenTimeline, type DbBlock, type DbTranscript } from "../../../scripts/audit-viral-spoken-dna-live.ts";

function block(start: number, end: number, text: string, index = 1): DbBlock {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    bloco_id: index,
    tipo_bloco: index === 1 ? "hook" : index === 3 ? "payoff" : "desenvolvimento",
    texto: text,
    tempo_inicio: start,
    tempo_fim: end,
  };
}

describe("spoken DNA live audit timeline proof", () => {
  it("rejects a tautological assignment that covers only the first seconds of a long source", () => {
    const transcript: DbTranscript[] = [
      { id: "a", tempo_inicio: 0, tempo_fim: 1, texto: "Primeira fala." },
      { id: "b", tempo_inicio: 1, tempo_fim: 2, texto: "Segunda fala." },
      { id: "c", tempo_inicio: 2, tempo_fim: 3, texto: "Terceira fala." },
    ];
    const blocks = [
      block(0, 1, "Primeira fala.", 1),
      block(1, 2, "Segunda fala.", 2),
      block(2, 3, "Terceira fala.", 3),
    ];
    const proof = validateSpokenTimeline(60, blocks, transcript);
    expect(proof.every_segment_assigned_once).toBe(false);
    expect(proof.reasons.join(" ")).toContain("transcript_timeline_invalid");
  });
});
