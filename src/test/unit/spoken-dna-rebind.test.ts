import { describe, expect, it } from "vitest";
import {
  buildSpokenDnaRebindPayload,
  EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS,
  normalizeSpokenText,
  type BuildSpokenDnaRebindInput,
} from "../../../scripts/lib/spoken-dna-rebind.ts";

function transcript() {
  return [
    { id: "10000000-0000-4000-8000-000000000001", tempo_inicio: 0, tempo_fim: 2, texto: "A porta desapareceu." },
    { id: "10000000-0000-4000-8000-000000000002", tempo_inicio: 2, tempo_fim: 4, texto: "Ninguém entendeu o motivo." },
    { id: "10000000-0000-4000-8000-000000000003", tempo_inicio: 4, tempo_fim: 6, texto: "Então o chão começou a tremer." },
    { id: "10000000-0000-4000-8000-000000000004", tempo_inicio: 6, tempo_fim: 8, texto: "Uma luz surgiu no corredor." },
    { id: "10000000-0000-4000-8000-000000000005", tempo_inicio: 8, tempo_fim: 10, texto: "Mas aquilo era uma armadilha." },
    { id: "10000000-0000-4000-8000-000000000006", tempo_inicio: 10, tempo_fim: 12, texto: "Finalmente todos escaparam." },
  ];
}

function visual(blockId: string, index: number) {
  return {
    id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    block_id: blockId,
    data_source_type: "gemini_video_understanding",
    representative_timestamp: index * 2 - 1,
    representative_frame_path: `https://example.invalid/${index}.jpg`,
    scene_description: `Cena ${index}`,
    main_action: `Ação ${index}`,
  };
}

function baseInput(): BuildSpokenDnaRebindInput {
  const blocks = [
    { id: "30000000-0000-4000-8000-000000000001", bloco_id: 1, tipo_bloco: "hook", tempo_inicio: 0, tempo_fim: 2, texto: "Título inventado", emocao: "curiosidade" },
    { id: "30000000-0000-4000-8000-000000000002", bloco_id: 2, tipo_bloco: "setup", tempo_inicio: 2, tempo_fim: 4, texto: "Ninguém entendeu o motivo.", emocao: "expectativa" },
    // Deliberate 4s hole: transcript segment 3 has no positive old-block overlap.
    { id: "30000000-0000-4000-8000-000000000003", bloco_id: 3, tipo_bloco: "desenvolvimento", tempo_inicio: 6, tempo_fim: 8, texto: "Uma luz surgiu no corredor.", emocao: "expectativa" },
    { id: "30000000-0000-4000-8000-000000000004", bloco_id: 4, tipo_bloco: "tensao", tempo_inicio: 8, tempo_fim: 10, texto: "Mas aquilo era uma armadilha.", emocao: "tensao" },
    { id: "30000000-0000-4000-8000-000000000005", bloco_id: 5, tipo_bloco: "payoff", tempo_inicio: 10, tempo_fim: 12, texto: "Finalmente todos escaparam.", emocao: "impacto" },
  ];
  return {
    youtubeId: EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS[0],
    videoId: "40000000-0000-4000-8000-000000000001",
    durationSeconds: 12,
    transcripts: transcript(),
    blocks,
    // One timestamped Gemini observation for every spoken two-second unit.
    // The rebinder must never use a visually distant row merely because its
    // legacy source block id happens to match.
    visualAnalyses: transcript().map((_segment, index) =>
      visual(blocks[Math.min(index, blocks.length - 1)].id, index + 1)
    ),
  };
}

describe("spoken DNA rebinder", () => {
  it("resegments exclusively from contiguous transcript groups when old blocks have a hole", () => {
    const payload = buildSpokenDnaRebindPayload(baseInput());
    expect(payload.mode).toBe("full_rebind");
    expect(payload.blocks.length).toBeGreaterThanOrEqual(3);
    expect(payload.blocks.length).toBeLessThanOrEqual(18);
    expect(payload.blocks[0].type).toBe("hook");
    expect(payload.blocks.some((block) => block.type === "desenvolvimento")).toBe(true);
    expect(payload.blocks.at(-1)?.type).toBe("payoff");
    const used = payload.blocks.flatMap((block) => block.transcript_segment_ids);
    expect(used).toHaveLength(transcript().length);
    expect(new Set(used).size).toBe(transcript().length);
    expect(payload.blocks.map((block) => block.text).join(" ")).toBe(
      transcript().map((segment) => segment.texto).join(" "),
    );
    expect(new Set(payload.blocks.map((block) => block.source_visual_analysis_id)).size)
      .toBe(payload.blocks.length);
  });

  it("uses layers_only and preserves exact block ids, boundaries and speech", () => {
    const input = baseInput();
    input.youtubeId = EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS[2];
    input.blocks = [
      { id: "30000000-0000-4000-8000-000000000001", bloco_id: 1, tipo_bloco: "hook", tempo_inicio: 0, tempo_fim: 4, texto: `${transcript()[0].texto} ${transcript()[1].texto}`, emocao: "curiosidade" },
      { id: "30000000-0000-4000-8000-000000000002", bloco_id: 2, tipo_bloco: "desenvolvimento", tempo_inicio: 4, tempo_fim: 8, texto: `${transcript()[2].texto} ${transcript()[3].texto}`, emocao: "expectativa" },
      { id: "30000000-0000-4000-8000-000000000003", bloco_id: 3, tipo_bloco: "payoff", tempo_inicio: 8, tempo_fim: 12, texto: `${transcript()[4].texto} ${transcript()[5].texto}`, emocao: "impacto" },
    ];
    input.visualAnalyses = input.blocks.map((block, index) => visual(block.id, index * 2 + 1));
    const payload = buildSpokenDnaRebindPayload(input);
    expect(payload.mode).toBe("layers_only");
    expect(payload.blocks.map((block) => ({
      id: block.source_block_id,
      start: block.start,
      end: block.end,
      text: block.text,
    }))).toEqual(input.blocks.map((block) => ({
      id: block.id,
      start: block.tempo_inicio,
      end: block.tempo_fim,
      text: block.texto,
    })));
  });

  it("derives every keyword and phrase as a normalized contiguous speech substring", () => {
    const payload = buildSpokenDnaRebindPayload(baseInput());
    for (const block of payload.blocks) {
      const speech = ` ${normalizeSpokenText(block.text)} `;
      for (const keyword of block.semantic.keywords) {
        expect(speech).toContain(` ${normalizeSpokenText(keyword)} `);
      }
      for (const phrase of block.semantic.strong_phrases) {
        expect(speech).toContain(` ${normalizeSpokenText(phrase)} `);
      }
    }
  });

  it("refuses every YouTube id outside the exact audited repair allowlist", () => {
    const input = baseInput();
    input.youtubeId = "OlYMSfYlBFo";
    expect(() => buildSpokenDnaRebindPayload(input)).toThrow("exact non-manual repair allowlist");
  });

  it("refuses a visual row that belongs to the video but is temporally distant", () => {
    const input = baseInput();
    input.visualAnalyses = input.visualAnalyses.map((row) => ({
      ...row,
      representative_timestamp: 1_000,
    }));
    expect(() => buildSpokenDnaRebindPayload(input)).toThrow("no trusted Gemini visual timestamp overlaps");
  });
});
