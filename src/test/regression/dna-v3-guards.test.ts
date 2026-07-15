import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assessVisualEvidenceTimeline,
  assessLexicalCopyRisk,
  buildCanonicalEvidencePartition,
  detectForeignLanguageContamination,
  detectGuardLanguage,
  resolveVisualEvidenceForSlot,
  selectTranscriptSupportForRange,
  selectVisualEvidenceForSlot,
  textGuardFingerprint,
} from "../../../supabase/functions/_shared/dna-guards";

describe("DNA v3 - guardas puros", () => {
  it("bloqueia guarda sem referencias protegidas", () => {
    const risk = assessLexicalCopyRisk("Uma historia totalmente nova", []);
    expect(risk.blocked).toBe(true);
    expect(risk.reasons).toContain("protected_references_missing");
  });

  it("normaliza acentos no n-gram e detecta copia lexical", () => {
    const risk = assessLexicalCopyRisk(
      "Voce nao vai acreditar no resultado",
      ["Você não vai acreditar no que aconteceu"],
      { maxExactNgram: 3 },
    );
    expect(risk.blocked).toBe(true);
    expect(risk.longest_exact_ngram).toBeGreaterThanOrEqual(4);
  });

  it("marca comparacao cross-language para acionar o guarda semantico", () => {
    const risk = assessLexicalCopyRisk(
      "O homem mostrou que a casa nao era sua e depois desapareceu",
      ["The man transformed his own house during the night"],
    );
    expect(detectGuardLanguage("The man transformed his own house during the night")).toBe("en");
    expect(risk.cross_language).toBe(true);
  });

  it("não confunde clítico português com artigo espanhol", () => {
    expect(detectGuardLanguage(
      "Lobo faminto encontrou e farejou pele humana; intrigado, decidiu vesti-la, mas o mistério permaneceu.",
    )).toBe("pt");
    expect(detectGuardLanguage(
      "El lobo encontró la piel y decidió vestirla para engañar a la familia.",
    )).toBe("es");
  });

  it("rejeita perezosa e o uso espanhol contextual de vago em um roteiro PT-BR", () => {
    expect(detectForeignLanguageContamination(
      "Sua atitude perezosa chamou atenção.",
      "pt",
    )).toContain("perezosa");
    expect(detectForeignLanguageContamination(
      "Este homem era tão vago que evitava andar.",
      "pt",
    )).toContain("vago_contextual");
    expect(detectForeignLanguageContamination(
      "O narrador usou um termo vago.",
      "pt",
    )).not.toContain("vago_contextual");
  });

  it("invalida metadado de guarda quando o texto e editado", () => {
    const before = textGuardFingerprint("A estatua caiu no lago.");
    const after = textGuardFingerprint("A estatua explodiu no lago.");
    expect(before).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(after).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(before).not.toBe(after);
  });

  it("seleciona para o hook a evidencia mais intensa somente dentro da abertura", () => {
    const frames = [
      { timestamp_seconds: 0, description: "Pessoa entra na sala", scene_type: "setup", surprise_score: 10 },
      { timestamp_seconds: 9, description: "Uma explosao inesperada transforma o objeto", scene_type: "action" },
      { timestamp_seconds: 3, description: "Pessoa olha para a mesa", scene_type: "setup", surprise_score: 70 },
    ];
    const selected = selectVisualEvidenceForSlot(frames, "hook", 0, 4, 1);
    expect(selected[0].timestamp_seconds).toBe(3);
  });

  it("prioriza surprise_score na abertura sem vazar uma revelacao tardia", () => {
    const selection = resolveVisualEvidenceForSlot([
      { timestamp_seconds: 1, description: "Uma explosao aparece", scene_type: "action", surprise_score: 20 },
      { timestamp_seconds: 12, description: "A personagem abre a caixa", scene_type: "action", surprise_score: 97 },
      { timestamp_seconds: 20, description: "A cena termina", scene_type: "ending", surprise_score: 10 },
    ], { slot_type: "hook" }, 0, 3, { durationSeconds: 20, limit: 1 });
    expect(selection.method).toBe("opening_hook");
    expect(selection.time_range).toEqual({ start: 0, end: 5 });
    expect(selection.frames[0].timestamp_seconds).toBe(1);
  });

  it("falha fechado quando nao existe evidencia visual na janela de abertura", () => {
    const selection = resolveVisualEvidenceForSlot([
      { timestamp_seconds: 8, description: "A primeira descricao so aparece no meio" },
      { timestamp_seconds: 18, description: "A resolucao aparece no fim" },
    ], { slot_type: "hook" }, 0, 3, { durationSeconds: 20, limit: 1 });
    expect(selection.method).toBe("insufficient");
    expect(selection.frames).toEqual([]);
    expect(selection.reason).toBe("opening_window_has_no_frames");
  });

  it("nunca transforma timestamp ausente em frame de abertura", () => {
    const selection = resolveVisualEvidenceForSlot([
      { description: "Payoff sem timestamp", surprise_score: 99 },
      { timestamp_seconds: 1, description: "Acao real da abertura", surprise_score: 20 },
    ], { slot_type: "hook" }, 0, 3, { durationSeconds: 20, limit: 1 });
    expect(selection.method).toBe("opening_hook");
    expect(selection.frames).toHaveLength(1);
    expect(selection.frames[0].description).toBe("Acao real da abertura");
  });

  it("mantem a auditoria factual do hook na janela completa 0-5s", () => {
    const selection = resolveVisualEvidenceForSlot([
      { timestamp_seconds: 1, description: "Acao que abre o video", surprise_score: 30 },
      { timestamp_seconds: 10, description: "Virada tardia muito intensa", surprise_score: 99 },
    ], { slot_type: "Hook", start_seconds: 0, end_seconds: 3 }, 0, 7, {
      durationSeconds: 100,
      limit: 1,
    });
    expect(selection.method).toBe("opening_hook");
    expect(selection.time_range).toEqual({ start: 0, end: 5 });
    expect(selection.frames[0].timestamp_seconds).toBe(1);
  });

  it("limita a ancora visual do hook aos primeiros cinco segundos em video longo", () => {
    const selection = resolveVisualEvidenceForSlot([
      { timestamp_seconds: 4.8, description: "Acao concreta ainda dentro da abertura", surprise_score: 60 },
      { timestamp_seconds: 5.1, description: "Revelacao ja fora da abertura", surprise_score: 99 },
    ], { slot_type: "hook" }, 0, 7, { durationSeconds: 90, limit: 4 });
    expect(selection.method).toBe("opening_hook");
    expect(selection.time_range).toEqual({ start: 0, end: 5 });
    expect(selection.frames.map((frame) => frame.timestamp_seconds)).toEqual([4.8]);
  });

  it("recusa frames sem descricao como evidencia visual", () => {
    const selected = selectVisualEvidenceForSlot([{ timestamp_seconds: 1, description: "" }], "hook", 0, 1);
    expect(selected).toEqual([]);
  });

  it("prioriza timestamps reais do bloco antes de qualquer fallback", () => {
    const selection = resolveVisualEvidenceForSlot(
      [
        { timestamp_seconds: 2, description: "Pessoa abre a porta" },
        { timestamp_seconds: 12, description: "Objeto escondido aparece" },
        { timestamp_seconds: 22, description: "A sala fica vazia" },
      ],
      { slot_type: "revelacao", timestamp_start: 10, timestamp_end: 14 },
      2,
      4,
      { durationSeconds: 24, allowUniformFallback: true },
    );
    expect(selection.method).toBe("slot_timestamps");
    expect(selection.fallback_used).toBe(false);
    expect(selection.frames.map(frame => frame.timestamp_seconds)).toEqual([12]);
  });

  it("nao deixa fase narrativa aproximada encolher a faixa estrutural continua", () => {
    const selection = resolveVisualEvidenceForSlot(
      [
        { timestamp_seconds: 3, description: "Contexto inicial do personagem" },
        { timestamp_seconds: 14, description: "O perigo cresce rapidamente" },
        { timestamp_seconds: 27, description: "A verdade finalmente aparece" },
      ],
      { slot_type: "tensao" },
      1,
      3,
      {
        durationSeconds: 30,
        allowUniformFallback: true,
        topicAnalysis: {
          narrative_progression: [
            { phase: "setup", timestamp_start: 0, timestamp_end: 8 },
            { phase: "tension", timestamp_start: 10, timestamp_end: 20 },
            { phase: "payoff", timestamp_start: 24, timestamp_end: 30 },
          ],
        },
      },
    );
    expect(selection.method).toBe("structural_window");
    expect(selection.fallback_used).toBe(false);
    expect(selection.time_range).toEqual({ start: 5, end: 17.5 });
    expect(selection.frames.map(frame => frame.timestamp_seconds)).toEqual([14]);
  });

  it("usa uma janela estrutural cronologica quando ela tem cobertura segura", () => {
    const selection = resolveVisualEvidenceForSlot(
      [
        { timestamp_seconds: 1, description: "Primeira acao visivel" },
        { timestamp_seconds: 7, description: "Segunda acao visivel" },
        { timestamp_seconds: 13, description: "Terceira acao visivel" },
      ],
      { slot_type: "desenvolvimento" },
      1,
      3,
      { durationSeconds: 18, allowUniformFallback: true },
    );
    expect(selection.method).toBe("structural_window");
    expect(selection.fallback_used).toBe(false);
    expect(selection.reason).toBeNull();
    expect(selection.frames.map(frame => frame.timestamp_seconds)).toEqual([7]);
  });

  it("preserva o ultimo frame real quando a fase de payoff arredonda o fim para baixo", () => {
    const selection = resolveVisualEvidenceForSlot(
      [
        { timestamp_seconds: 0, description: "Abertura" },
        { timestamp_seconds: 10, description: "Contexto" },
        { timestamp_seconds: 20, description: "Desenvolvimento inicial" },
        { timestamp_seconds: 30, description: "Desenvolvimento final" },
        { timestamp_seconds: 51.5, description: "O personagem foge pela rua" },
        { timestamp_seconds: 54.5, description: "Os perseguidores correm atras dele" },
        { timestamp_seconds: 56.5, description: "O atropelamento encerra a historia" },
      ],
      { slot_type: "payoff" },
      6,
      7,
      {
        durationSeconds: 56.721,
        allowUniformFallback: true,
        topicAnalysis: {
          narrative_progression: [
            { phase: "resolution", timestamp_start: 49, timestamp_end: 56 },
          ],
        },
      },
    );
    expect(selection.method).toBe("structural_window");
    expect(selection.time_range?.end).toBeCloseTo(56.721, 3);
    expect(selection.frames.map(frame => frame.timestamp_seconds)).toEqual([51.5, 54.5, 56.5]);
  });

  it("segmenta os sete slots em ordem e nao reutiliza o inicio da fase development", () => {
    const durationSeconds = 82.94;
    const frames = [1, 12, 20, 31, 34, 37, 43, 49, 55, 61, 67, 70, 72, 75, 80]
      .map(timestamp_seconds => ({
        timestamp_seconds,
        description: `Acao observada em ${timestamp_seconds}s`,
        surprise_score: timestamp_seconds,
      }));
    const slots = [
      { index: 1, slot_type: "hook", start_seconds: 0, end_seconds: 4 },
      { index: 2, slot_type: "setup" },
      { index: 3, slot_type: "desenvolvimento" },
      { index: 4, slot_type: "tensao" },
      { index: 5, slot_type: "revelacao" },
      { index: 6, slot_type: "desenvolvimento" },
      { index: 7, slot_type: "payoff" },
    ];
    const topicAnalysis = {
      narrative_progression: [
        { phase: "opening", timestamp_start: 0, timestamp_end: 30.5 },
        { phase: "development", timestamp_start: 30.5, timestamp_end: 69.5 },
        { phase: "climax", timestamp_start: 69.5, timestamp_end: 73.5 },
        { phase: "resolution", timestamp_start: 73.5, timestamp_end: durationSeconds },
      ],
    };

    const selections = slots.map((slot, position) => ({
      ...resolveVisualEvidenceForSlot(frames, slot, position, slots.length, {
        topicAnalysis,
        durationSeconds,
        allowUniformFallback: true,
      }),
      slot_index: slot.index,
      slot_type: slot.slot_type,
    }));
    const firstDevelopment = selections[2];
    const secondDevelopment = selections[5];
    const timeline = assessVisualEvidenceTimeline(selections);

    expect(selections.every(selection => selection.frames.length > 0)).toBe(true);
    expect(firstDevelopment.method).toBe("structural_window");
    expect(secondDevelopment.method).toBe("structural_window");
    expect(firstDevelopment.time_range?.start).toBeCloseTo(5 + (1 / 6) * (durationSeconds - 5), 5);
    expect(firstDevelopment.time_range?.end).toBeCloseTo(5 + (2 / 6) * (durationSeconds - 5), 5);
    expect(secondDevelopment.time_range?.start).toBeCloseTo(5 + (4 / 6) * (durationSeconds - 5), 5);
    expect(secondDevelopment.time_range?.end).toBeCloseTo(5 + (5 / 6) * (durationSeconds - 5), 5);
    expect(secondDevelopment.time_range!.start).toBeGreaterThan(firstDevelopment.time_range!.end);
    expect(timeline).toEqual({ passed: true, checked_ranges: 7, violations: [] });
  });

  it("cobre continuamente o video do lobo de 0s ate a duracao real", () => {
    const durationSeconds = 56.721;
    const frames = [0, 1.5, 3.2, 5, 9, 12, 15.5, 18.5, 21.5, 24.5, 27.5, 30.5, 33.5, 36.5, 38.5, 40.5, 42.5, 45.5, 48.5, 51.5, 54.5, 56.5]
      .map((timestamp_seconds) => ({ timestamp_seconds, description: `Evento em ${timestamp_seconds}s` }));
    const slotTypes = ["hook", "setup", "desenvolvimento", "tensao", "revelacao", "desenvolvimento", "payoff"];
    const selections = slotTypes.map((slot_type, position) => ({
      ...resolveVisualEvidenceForSlot(frames, { slot_type }, position, slotTypes.length, {
        durationSeconds,
        allowUniformFallback: true,
      }),
      slot_index: position + 1,
      slot_type,
    }));

    expect(selections[0].time_range).toEqual({ start: 0, end: 5 });
    for (let position = 1; position < selections.length; position++) {
      expect(selections[position].time_range?.start).toBeCloseTo(selections[position - 1].time_range!.end, 6);
    }
    expect(selections.at(-1)?.time_range?.end).toBeCloseTo(durationSeconds, 6);
    expect(assessVisualEvidenceTimeline(selections).passed).toBe(true);
  });

  it("encaixa os sete slots do lobo nos limites reais dos 26 microeventos", () => {
    const durationSeconds = 56.721;
    const segments = [
      [0, 2], [2, 5], [5, 7], [7, 10], [10, 11], [11, 13], [13, 16],
      [16, 17], [17, 20], [20, 22], [22, 24], [24, 25], [25, 26], [26, 28],
      [28, 30], [30, 33], [33, 34], [34, 36], [36, 38], [38, 41], [41, 44],
      [44, 46], [46, 49], [49, 52], [52, 53], [53, 55],
    ].map(([start, end], index) => ({ start, end, text: `microevento ${index + 1}` }));
    const frames = [0, 1.5, 3.2, 5, 6.5, 9, 12, 15.5, 18.5, 21.5, 24.5, 27.5, 30.5, 33.5, 36.5, 38.5, 40.5, 42.5, 45.5, 48.5, 51.5, 54.5, 56.5]
      .map((timestamp_seconds) => ({ timestamp_seconds, description: `Evento em ${timestamp_seconds}s` }));
    const slotTypes = ["hook", "setup", "desenvolvimento", "tensao", "revelacao", "desenvolvimento", "payoff"];
    const partition = buildCanonicalEvidencePartition({
      totalSlots: slotTypes.length,
      durationSeconds,
      transcriptionSegments: segments,
      visualFrames: frames,
    });

    expect(partition?.mode).toBe("transcript_boundaries");
    expect(partition?.boundaries).toEqual([0, 5, 13, 22, 30, 38, 49, 56.721]);
    const selections = slotTypes.map((slot_type, position) => ({
      ...resolveVisualEvidenceForSlot(frames, { slot_type }, position, slotTypes.length, {
        durationSeconds,
        transcriptionSegments: segments,
        canonicalPartition: partition,
        allowUniformFallback: true,
      }),
      slot_index: position + 1,
      slot_type,
    }));
    expect(selections.map((selection) => selection.time_range)).toEqual(partition?.ranges);
    expect(new Set(selections.map((selection) => selection.partition_fingerprint))).toEqual(new Set([partition?.fingerprint]));
    expect(selections[5].frames.map((frame) => frame.timestamp_seconds)).toContain(48.5);
    expect(selections[6].frames.map((frame) => frame.timestamp_seconds)).not.toContain(48.5);
    expect(assessVisualEvidenceTimeline(selections, { durationSeconds })).toEqual({
      passed: true,
      checked_ranges: 7,
      violations: [],
    });

    const owned = selections.flatMap((selection, position) =>
      selectTranscriptSupportForRange(segments, selection.time_range, {
        openingHook: position === 0,
        finalSlot: position === selections.length - 1,
        limit: segments.length,
      }).map((segment) => segment.text)
    );
    expect(owned).toHaveLength(26);
    expect(new Set(owned).size).toBe(26);
  });

  it("usa fallback uniforme deterministico quando o video nao tem fala", () => {
    const partition = buildCanonicalEvidencePartition({
      totalSlots: 4,
      durationSeconds: 20,
      transcriptionSegments: [],
      visualFrames: [
        { timestamp_seconds: 1, description: "abertura" },
        { timestamp_seconds: 8, description: "acao" },
        { timestamp_seconds: 14, description: "virada" },
        { timestamp_seconds: 19, description: "fim" },
      ],
    });
    expect(partition?.mode).toBe("uniform_no_transcript");
    expect(partition?.boundaries).toEqual([0, 5, 10, 15, 20]);
    expect(partition?.ranges.every((range, index, ranges) =>
      range.end > range.start && (index === 0 || range.start === ranges[index - 1].end)
    )).toBe(true);
  });

  it("atribui transcricao de fronteira a um unico slot e nunca vaza fala pos-5s no hook", () => {
    const segments = [
      { start: 3, end: 4.5, text: "fato integral da abertura" },
      { start: 4.8, end: 6, text: "revelacao que cruza cinco segundos" },
      { start: 6, end: 7, text: "primeiro fato do setup" },
    ];
    const hook = selectTranscriptSupportForRange(segments, { start: 0, end: 5 }, { openingHook: true });
    const setup = selectTranscriptSupportForRange(segments, { start: 5, end: 13.62 });

    expect(hook.map((segment) => segment.text)).toEqual(["fato integral da abertura"]);
    expect(setup.map((segment) => segment.text)).toEqual([
      "revelacao que cruza cinco segundos",
      "primeiro fato do setup",
    ]);
    expect(hook.filter((segment) => setup.includes(segment))).toHaveLength(0);
  });

  it("reprova ranges visuais que voltam para uma fase anterior", () => {
    const assessment = assessVisualEvidenceTimeline([
      { frames: [{}], method: "opening_hook", time_range: { start: 0, end: 4 }, fallback_used: false, reason: null, slot_type: "hook" },
      { frames: [{}], method: "structural_window", time_range: { start: 12, end: 24 }, fallback_used: false, reason: null, slot_type: "setup" },
      { frames: [{}], method: "narrative_phase", time_range: { start: 30.5, end: 69.5 }, fallback_used: false, reason: null, slot_type: "desenvolvimento" },
      { frames: [{}], method: "narrative_phase", time_range: { start: 69.5, end: 73.5 }, fallback_used: false, reason: null, slot_type: "tensao" },
      { frames: [{}], method: "narrative_phase", time_range: { start: 30.5, end: 69.5 }, fallback_used: false, reason: null, slot_type: "desenvolvimento" },
    ]);

    expect(assessment.passed).toBe(false);
    const reasons = assessment.violations.map(violation => violation.reason);
    expect(reasons).toContain("time_range_gap");
    expect(reasons).toContain("time_range_start_regressed");
    expect(reasons).toContain("time_range_end_regressed");
    expect(assessment.violations
      .filter(violation => violation.reason.includes("regressed"))
      .every(violation => violation.selection_index === 4)).toBe(true);
  });

  it("reprova qualquer gap ou sobreposicao real entre slots adjacentes", () => {
    const gap = assessVisualEvidenceTimeline([
      { frames: [{}], method: "opening_hook", time_range: { start: 0, end: 5 }, fallback_used: false, reason: null, slot_type: "hook" },
      { frames: [{}], method: "structural_window", time_range: { start: 5.01, end: 10 }, fallback_used: false, reason: null, slot_type: "setup" },
    ], { durationSeconds: 10 });
    const overlap = assessVisualEvidenceTimeline([
      { frames: [{}], method: "opening_hook", time_range: { start: 0, end: 5 }, fallback_used: false, reason: null, slot_type: "hook" },
      { frames: [{}], method: "structural_window", time_range: { start: 4.99, end: 10 }, fallback_used: false, reason: null, slot_type: "setup" },
    ], { durationSeconds: 10 });
    expect(gap.violations.map((item) => item.reason)).toContain("time_range_gap");
    expect(overlap.violations.map((item) => item.reason)).toContain("time_range_overlap");
  });

  it("reprova selecao visual sem intervalo temporal auditavel", () => {
    const assessment = assessVisualEvidenceTimeline([
      { frames: [{}], method: "visual_anchor", time_range: null, fallback_used: false, reason: null },
    ]);
    expect(assessment.passed).toBe(false);
    expect(assessment.violations[0].reason).toBe("time_range_missing");
  });

  it("falha fechado sem contexto suficiente para segmentar cada bloco", () => {
    const selection = resolveVisualEvidenceForSlot(
      [{ timestamp_seconds: 5, description: "Uma unica cena analisada" }],
      { slot_type: "desenvolvimento" },
      1,
      4,
      { durationSeconds: 20, allowUniformFallback: true },
    );
    expect(selection.method).toBe("insufficient");
    expect(selection.frames).toEqual([]);
    expect(selection.reason).toBe("structural_frame_coverage_insufficient");
  });
});

describe("DNA v3 - contratos Edge fail-closed", () => {
  const source = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

  it("valida o texto contra frames reais e torna a falha visual critica", () => {
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    expect(validator).toContain("EVIDÊNCIA VISUAL REAL DO VÍDEO OPERACIONAL");
    expect(validator).toContain('inputMode === "video" && criteria.visual_sync_alignment?.value !== true');
    expect(validator).toContain("protected_references_checked");
    expect(validator).toContain("semantic_checked");
  });

  it("falha fechado em lacuna completa e alteracao causal no roteiro operacional", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    const reviewLoop = source("../../../supabase/functions/_shared/viral-review-loop.ts");

    expect(assembler).toContain("transcript_support: transcriptSupport");
    expect(assembler).toContain("enforceNarrativeFidelityGate");
    expect(assembler).toContain("complete_narrative_gaps");
    expect(assembler).toContain("causal_relation_altered_or_unsupported");
    expect(assembler).toContain("microevent_slot_not_audited");
    expect(assembler).toContain("microevent_slot_audit_incomplete");
    expect(assembler).toContain("narrativeAuditCoverageContract");
    expect(assembler).toContain("pelo menos uma entrada para CADA bloco do roteiro");
    expect(assembler).toContain("const EDGE_REQUEST_SOFT_DEADLINE_MS = 135_000;");
    expect(validator).toContain('name: "narrative_microevent_coverage"');
    expect(validator).toContain("authoritative_transcript_segment_count");
    expect(validator).toContain("cross_boundary_facts_forbidden");
    expect(validator).toContain("narrative_fidelity_gate_failed");
    expect(validator).toContain('criteria.narrative_microevent_coverage?.value !== true');
    expect(reviewLoop).toContain("narrative_fidelity_gate_failed");
  });

  it("nao renderiza main_action/dominant_visual_actions no prompt do gerador", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    expect(assembler).not.toContain("strategy.dominant_visual_actions");
    expect(assembler).toContain("strategy.dominant_visual_dynamics");
    expect(assembler).toContain("assessProtectedCopyGuard");
    expect(assembler).toContain("slot?.dna_strategy_ref?.avg_words_per_second");
    expect(assembler).toContain("rules?.input_resolution?.language || stylePack.target_lang");
  });

  it("transporta a evidencia visual multimodal completa para o contexto operacional", () => {
    const builder = source("../../../supabase/functions/build-complete-generation-context/index.ts");
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    expect(builder).toContain("main_action: f.main_action");
    expect(builder).toContain("surprise_score: f.surprise_score");
    expect(builder).toContain("text_on_screen: f.text_on_screen");
    expect(assembler).toContain("frame?.surprise_score");
    expect(assembler).toContain("DADOS NÃO CONFIÁVEIS");
  });

  it("nao permite que titulo ou metadado legado virem evidencia de CTA", () => {
    const ctaExtractor = source("../../../supabase/functions/extract-cta-deep-v2/index.ts");
    expect(ctaExtractor).not.toContain("video.titulo");
    expect(ctaExtractor).not.toContain("video.hook_text");
    expect(ctaExtractor).not.toContain("video.payoff_text");
    expect(ctaExtractor).not.toContain("video.cta_text");
    expect(ctaExtractor).toContain("groundCtaText");
    expect(ctaExtractor).toContain("CTA_JSON_INVALID");
    expect(ctaExtractor).toContain('const allowedCtaTypes = new Set(["explicit", "implicit", "emotional", "narrative"])');
    expect(ctaExtractor).toContain("if (!allowedCtaTypes.has(c?.cta_type)) return []");
  });

  it("isola nome de arquivo e titulo da analise do video operacional", () => {
    const topicAnalyzer = source("../../../supabase/functions/analyze-reference-topics/index.ts");
    const videoProcessor = source("../../../supabase/functions/process-reference-video/index.ts");
    expect(topicAnalyzer).not.toContain('${refVid.file_name}');
    expect(videoProcessor).toContain('displayName: "reference-video"');
    expect(videoProcessor).not.toContain("displayName: fileName");
    expect(videoProcessor).not.toContain('if (segments.length === 0) throw new Error("A transcrição real voltou vazia.")');
    expect(videoProcessor).toContain("if (reusableCoverage.passed && reusableLayerContract.passed)");
    expect(topicAnalyzer).toContain("segments.length === 0 && frames.length === 0");
  });

  it("exige cobertura semantica anti-copia de todas as referencias protegidas", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    expect(assembler).not.toContain("protectedReferences.slice(0, 8)");
    expect(assembler).toContain("semantic_references_checked: protectedSemanticReferences.length");
    expect(validator).toContain("semantic_references_checked");
    expect(validator).toContain(">= protectedReferences.length");
  });

  it("faz o idioma resolvido participar do retry e da validacao", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    expect(assembler).toContain("!strategyPassed || copyBlocked || !languagePassed");
    expect(validator).toContain("criteria.output_language?.value === false");
  });

  it("so declara revisao concluida apos assemble e validacao aprovados", () => {
    const reviser = source("../../../supabase/functions/revise-script-assembly/index.ts");
    const assembleGate = reviser.indexOf("const assemblePassed");
    const validationGate = reviser.indexOf('validation?.validation_status !== "approved"');
    const revisedReturn = reviser.indexOf('status: "revised"');
    expect(assembleGate).toBeGreaterThan(-1);
    expect(validationGate).toBeGreaterThan(assembleGate);
    expect(revisedReturn).toBeGreaterThan(validationGate);
  });

  it("exige autenticacao e ownership nas quatro funcoes de roteiro", () => {
    for (const file of [
      "../../../supabase/functions/assemble-script/index.ts",
      "../../../supabase/functions/validate-script-against-dna/index.ts",
      "../../../supabase/functions/revise-script-assembly/index.ts",
      "../../../supabase/functions/promote-script-final/index.ts",
    ]) {
      const edgeFunction = source(file);
      expect(edgeFunction).toContain("requireUserOrService");
      expect(edgeFunction).toContain("assertResourceOwner");
    }
    const reviser = source("../../../supabase/functions/revise-script-assembly/index.ts");
    const edgeAuth = source("../../../supabase/functions/_shared/edge-auth.ts");
    expect(reviser).toContain("internalFunctionHeaders,");
    expect(reviser).toContain("...internalFunctionHeaders(serviceKey)");
    expect(edgeAuth).toContain("Authorization: `Bearer ${internalToken}`");
    expect(edgeAuth).toContain("apikey: serviceRoleKey.trim()");
    expect(edgeAuth).toContain("token === serviceRoleKey");
    expect(edgeAuth).toContain("token === internalToken");
  });

  it("remove definitivamente os prompts literais legados da revisao", () => {
    const reviser = source("../../../supabase/functions/revise-script-assembly/index.ts");
    expect(reviser).not.toContain("EXEMPLOS CANONICOS");
    expect(reviser).not.toContain("EXEMPLOS CANÔNICOS");
    expect(reviser).not.toContain("FRASES FORTES OBSERVADAS");
    expect(reviser).not.toContain("vocab_ref");
  });

  it("falha fechado na montagem quando algum bloco nao tem evidencia visual", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    expect(assembler).toContain("visual_evidence_selection");
    expect(assembler).toContain("visual_evidence_trace");
    expect(assembler).toContain("visual_segmentation");
    expect(assembler).toContain('method === "insufficient"');
    expect(assembler).toContain("assessVisualEvidenceTimeline");
    expect(assembler).toContain('status: "visual_timeline_invalid"');
    expect(assembler).toContain("FALLBACK UNIFORME EXPLÍCITO");
    expect(validator).toContain("resolveVisualEvidenceForSlot");
    expect(validator).toContain("fallback_used");
  });
});
