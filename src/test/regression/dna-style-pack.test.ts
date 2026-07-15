/**
 * REGRESSION SUITE — DNA Style Pack
 *
 * Garante que o pacote envia apenas estratégias abstratas ao gerador,
 * preserva as referências literais para o guarda anti-cópia e suporta
 * presets cross-language (PT/EN/ES).
 */
import { describe, it, expect } from "vitest";
import {
  detectTextLanguage,
  formatStylePackLines,
  buildStylePackNotes,
  deriveTextStrategy,
  assessCopyRisk,
  evaluateStrategyCompliance,
  classifyVisualDynamic,
  MAX_PROTECTED_EXAMPLES_PER_BLOCK,
  validateDnaStylePack,
  type DnaStylePack,
} from "@/lib/dna-style-pack";

const fakePack: DnaStylePack = {
  target_lang: "pt",
  scope: "global",
  total_videos: 46,
  dominant_sequence: "hook → setup → desenvolvimento → tensao → payoff",
  dominant_sequence_count: 2,
  structural_contract: {
    contract_type: "abstract_narrative_order",
    normalized_stage_order: ["hook", "development", "payoff"],
    dominant_sequence_usage: "statistical_reference_only",
    literal_source_sequence_required: false,
    visual_chronology_priority: true,
    fail_closed_for_video_slot_order: true,
  },
  built_at: new Date().toISOString(),
  block_styles: [
    {
      block_type: "hook",
      examples: [
        { text: "Você não vai acreditar no que ele fez.", emotion: "curiosidade", words: 8, engagement_rate: 0.12 },
        { text: "Ninguém sabia o que estava por vir.", emotion: "tensao", words: 7, engagement_rate: 0.1 },
      ],
      protected_examples: [
        { text: "Este hombre encogió a su esposa y se la tragó de un solo bocado.", emotion: "choque", words: 13, engagement_rate: 0.2, video_id: "es-1" },
        { text: "La mujer descubrió la trampa y cambió el final de la historia.", emotion: "surpresa", words: 12, engagement_rate: 0.18, video_id: "es-2" },
        { text: "Nadie esperaba que el objeto atravesara la pared en ese momento.", emotion: "curiosidade", words: 11, engagement_rate: 0.16, video_id: "es-3" },
      ],
      weighted_words: ["medo", "segredo", "ninguém"],
      impact_phrases: ["medo de perder o filho"],
      dominant_emotion: "curiosidade",
      avg_intensity: 3.3,
      median_words: 9,
      avg_words_per_second: 2.8,
      strategy: {
        source_video_count: 3,
        dominant_opening_patterns: ["negation", "shock_statement"],
        word_range: { min: 6, target: 8, max: 10 },
        sentence_range: { min: 1, target: 1, max: 2 },
        avg_sentence_words: 8,
        question_rate: 0,
        exclamation_rate: 0,
        direct_address_rate: 0.5,
        withheld_payoff_rate: 0.7,
        micro_reveals_per_sentence: 0.8,
        escalation_markers_per_sentence: 0.5,
        dominant_visual_actions: ["transformação", "queda"],
        dominant_visual_dynamics: ["transformacao", "impacto"],
        dominant_visual_emotions: ["surpresa"],
        strategy_instruction: "Use abertura negation/shock_statement; mire 8 palavras em 1 frase.",
      },
    },
  ],
  strategy_contract: {
    required_block_types: ["hook"],
    min_source_videos: 3,
    min_strategy_score: 0.82,
    max_exact_ngram: 3,
    max_content_similarity: 0.62,
    max_semantic_similarity: 0.78,
    protected_reference_required: true,
    semantic_copy_guard_required: true,
    fail_closed: true,
    visual_first_required: true,
  },
  extraction_quality: {
    video_coverage: 1,
    text_strategy_coverage: 1,
    visual_strategy_coverage: 0.9,
    overall: 0.97,
    warnings: [],
  },
};

function packWithProtectedSourceCoverage(sourceCount: number, protectedCount: number): DnaStylePack {
  const block = fakePack.block_styles[0];
  return {
    ...fakePack,
    total_videos: sourceCount,
    block_styles: [{
      ...block,
      strategy: { ...block.strategy!, source_video_count: sourceCount },
      protected_examples: Array.from({ length: protectedCount }, (_, index) => ({
        text: `Referência protegida exclusiva da fonte número ${index + 1}.`,
        emotion: "curiosidade",
        words: 7,
        engagement_rate: 1 - index / Math.max(1, protectedCount),
        video_id: `video-${index + 1}`,
      })),
    }],
  };
}

describe("DNA Style Pack — formatação", () => {
  it("inclui contrato abstrato e nunca expõe texto ou vocabulário da base", () => {
    const lines = formatStylePackLines(fakePack);
    const text = lines.join("\n");
    expect(text).not.toContain("Você não vai acreditar no que ele fez.");
    expect(text).not.toContain("medo de perder o filho");
    expect(text).not.toContain("segredo, ninguém");
    expect(text).not.toContain("encogió a su esposa");
    expect(text).not.toContain("transformação/queda");
    expect(text).toContain("dinâmica=transformacao/impacto");
    expect(text).toContain("hook → setup → desenvolvimento → tensao → payoff");
    expect(text).toContain("referência estatística abstrata");
    expect(text).toContain("hook → desenvolvimento/escalada → payoff/desfecho");
    expect(text).toContain("cronologia VISUAL");
    expect(text).toContain("ANTI-CÓPIA");
    expect(text).toContain("ESTRATÉGIA MEDIDA");
    expect(text).toContain("CONTRATO:");
    expect(text).toContain("46 vídeos");
    expect(text).toContain("[HOOK]");
    expect(text).toContain("emoção dominante: curiosidade");
    expect(text).toContain("ritmo 2.8 palavras/s");
  });

  it("buildStylePackNotes gera texto único não vazio", () => {
    const notes = buildStylePackNotes(fakePack);
    expect(notes.length).toBeGreaterThan(200);
    expect(notes).toContain("PACOTE DE ESTILO DNA");
  });

  it("gancho apelão é o padrão e pode ser desligado", () => {
    const comApelao = formatStylePackLines(fakePack).join("\n");
    expect(comApelao).toContain("GANCHO APELÃO");
    expect(comApelao).toContain("DESENVOLVIMENTO DE RETENÇÃO");
    expect(comApelao).toContain("primeiros 0-5 segundos");
    expect(comApelao).toContain("consequência desconhecida");
    expect(comApelao).toContain("Nunca revele família");

    const semApelao = formatStylePackLines(fakePack, { hookApelao: false }).join("\n");
    expect(semApelao).not.toContain("GANCHO APELÃO");
  });

  it("modo vídeo adiciona prioridade visual", () => {
    const lines = formatStylePackLines(fakePack, { visualFirst: true }).join("\n");
    expect(lines).toContain("PRIORIDADE VISUAL");
    expect(lines).toContain("frame/ação visível");
  });

  it("preset ativo aparece na origem do pacote", () => {
    const lines = formatStylePackLines(fakePack, { presetName: "Preset Filmes" }).join("\n");
    expect(lines).toContain('preset "Preset Filmes"');
  });
});

describe("DNA Style Pack — detecção de idioma", () => {
  it("classifica português", () => {
    expect(detectTextLanguage("O homem mostrou que as crianças não sabem de nada sobre isso")).toBe("pt");
  });
  it("classifica inglês", () => {
    expect(detectTextLanguage("The man showed that the kids just don't know about this")).toBe("en");
  });
  it("classifica espanhol sem contaminar preset português", () => {
    expect(detectTextLanguage("Esta mujer arrojó a su amante por el inodoro y después descubrió la verdad")).toBe("es");
  });
  it("texto curto é unknown", () => {
    expect(detectTextLanguage("wow")).toBe("unknown");
  });
});

describe("DNA Style Pack — contrato determinístico", () => {
  it("deriva assinatura sem depender do idioma do assunto", () => {
    const es = deriveTextStrategy("Este hombre encogió a su esposa y se la tragó de un solo bocado.");
    expect(es.opening_pattern).toBe("statement");
    expect(es.word_count).toBeGreaterThan(8);
  });

  it("nao confunde possessivo interno de terceira pessoa com fala direta", () => {
    expect(deriveTextStrategy("Ela perdeu sua face enquanto a sala desaparecia.").opening_pattern).not.toBe("direct_address");
    expect(deriveTextStrategy("Ela perdeu sua verdadeira face enquanto a sala inteira desaparecia lentamente diante de todos.").opening_pattern).toBe("statement");
    expect(deriveTextStrategy("Voce perdeu sua face enquanto a sala desaparecia.").opening_pattern).toBe("direct_address");
    expect(deriveTextStrategy("Sua face comecou a rachar diante do espelho.").opening_pattern).toBe("direct_address");
  });

  it("bloqueia cópia literal de quatro palavras e permite estratégia original", () => {
    const refs = ["Você não vai acreditar no que ele fez naquela noite"];
    expect(assessCopyRisk("Você não vai acreditar no resultado", refs).blocked).toBe(true);
    expect(assessCopyRisk("A estátua explodiu antes do amanhecer", refs).blocked).toBe(false);
  });

  it("avalia faixa, abertura e progressão do bloco", () => {
    const profile = fakePack.block_styles[0].strategy!;
    const result = evaluateStrategyCompliance("Ninguém esperava aquela transformação final.", "hook", profile);
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it("falha fechado quando a amostra não atinge o contrato", () => {
    const invalid = { ...fakePack, total_videos: 1 };
    const result = validateDnaStylePack(invalid);
    expect(result.ready).toBe(false);
    expect(result.reasons.some(reason => reason.startsWith("insufficient_source_videos"))).toBe(true);
  });

  it("falha fechado sem contrato estrutural abstrato e sem exigir cópia da fonte", () => {
    const missing = validateDnaStylePack({ ...fakePack, structural_contract: undefined });
    expect(missing.ready).toBe(false);
    expect(missing.reasons).toContain("abstract_structural_contract_missing");

    const literalCopy = validateDnaStylePack({
      ...fakePack,
      structural_contract: { ...fakePack.structural_contract!, literal_source_sequence_required: true as false },
    });
    expect(literalCopy.ready).toBe(false);
    expect(literalCopy.reasons).toContain("literal_source_sequence_copy_forbidden");
  });

  it("falha fechado quando o guarda protegido é vácuo", () => {
    const invalid = {
      ...fakePack,
      block_styles: fakePack.block_styles.map(block => ({ ...block, protected_examples: [], examples: [] })),
    };
    const result = validateDnaStylePack(invalid);
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("protected_reference_missing_hook");
  });

  it("exige cobertura protegida de todas as fontes em presets de até 128 vídeos", () => {
    expect(MAX_PROTECTED_EXAMPLES_PER_BLOCK).toBe(128);
    expect(validateDnaStylePack(packWithProtectedSourceCoverage(50, 50)).ready).toBe(true);

    const incomplete = validateDnaStylePack(packWithProtectedSourceCoverage(50, 49));
    expect(incomplete.ready).toBe(false);
    expect(incomplete.reasons).toContain("incomplete_protected_coverage_hook_49_of_50");
  });

  it("aplica o teto de 128 fontes distintas sem contar duplicatas como cobertura", () => {
    expect(validateDnaStylePack(packWithProtectedSourceCoverage(200, 128)).ready).toBe(true);

    const duplicatePack = packWithProtectedSourceCoverage(50, 50);
    duplicatePack.block_styles[0].protected_examples![49].video_id = "video-49";
    const duplicateResult = validateDnaStylePack(duplicatePack);
    expect(duplicateResult.ready).toBe(false);
    expect(duplicateResult.reasons).toContain("incomplete_protected_coverage_hook_49_of_50");
  });

  it("nunca renderiza no prompt nem a primeira nem a última das 128 referências protegidas", () => {
    const protectedPack = packWithProtectedSourceCoverage(128, 128);
    const promptText = formatStylePackLines(protectedPack).join("\n");
    const references = protectedPack.block_styles[0].protected_examples!;
    expect(promptText).not.toContain(references[0].text);
    expect(promptText).not.toContain(references[127].text);
  });

  it("reduz ação visual livre a uma dinâmica sem carregar o assunto", () => {
    expect(classifyVisualDynamic("Um homem engole a esposa miniaturizada")).toBe("impacto");
    expect(classifyVisualDynamic("A personagem cresce e muda de cor")).toBe("transformacao");
  });
});
