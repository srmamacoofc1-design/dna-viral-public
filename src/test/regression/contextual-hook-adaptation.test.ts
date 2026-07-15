import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHookStrategyAnalogs,
  deriveTextStrategy,
  type DnaStylePack,
} from "../../lib/dna-style-pack";

const root = path.resolve(__dirname, "../../..");
const assemble = fs.readFileSync(path.join(root, "supabase/functions/assemble-script/index.ts"), "utf8");
const validator = fs.readFileSync(path.join(root, "supabase/functions/validate-script-against-dna/index.ts"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts/test-viral-preset-on-video-live.ts"), "utf8");

function pack(): DnaStylePack {
  const spokenHook = "Cuidado para não sair uma barata viva do seu ouvido durante a noite.";
  return {
    version: 3,
    target_lang: "pt",
    scope: "preset",
    total_videos: 1,
    dominant_sequence: "hook → desenvolvimento → payoff",
    dominant_sequence_count: 1,
    block_styles: [{
      block_type: "hook",
      examples: [],
      protected_examples: [{ video_id: "video-spoken-1", text: spokenHook }],
      weighted_words: [],
      impact_phrases: [],
      dominant_emotion: "curiosidade",
      avg_intensity: 8,
      median_words: 13,
      avg_words_per_second: 3.7,
    }],
    video_strategies: [{
      video_id: "video-spoken-1",
      engagement_rate: 0.12,
      block_sequence: "hook → desenvolvimento → payoff",
      hook_strategy: deriveTextStrategy(spokenHook),
      narrative_progression: "escalada",
      micro_turn_count: 3,
      micro_turn_types: ["risco", "descoberta", "reversão"],
      visual_hook: {
        action: "barata entrando no ouvido",
        emotion: "choque",
        intensity: 9,
        alignment_score: 0.95,
      },
      evidence_coverage: 1,
    }],
    strategy_contract: {
      required_block_types: ["hook"],
      min_source_videos: 1,
      min_strategy_score: 0.82,
      max_exact_ngram: 3,
      max_content_similarity: 0.62,
      fail_closed: true,
      visual_first_required: true,
    },
    extraction_quality: {
      video_coverage: 1,
      text_strategy_coverage: 1,
      visual_strategy_coverage: 1,
      overall: 1,
      warnings: [],
    },
    built_at: new Date(0).toISOString(),
  };
}

describe("adaptação contextual de ganchos falados", () => {
  it("deriva candidatos por vídeo sem carregar frase-fonte nem título", () => {
    const source = pack();
    const analogs = buildHookStrategyAnalogs(source);
    expect(analogs).toHaveLength(1);
    expect(analogs[0].source_video_id).toBe("video-spoken-1");
    expect(analogs[0].context_tokens).toEqual(expect.arrayContaining(["barata", "ouvido"]));
    expect(analogs[0].spoken_hook_strategy.opening_pattern).toBe("warning");
    expect(analogs[0].source_text_included).toBe(false);
    expect(analogs[0].title_included).toBe(false);
    expect(JSON.stringify(analogs)).not.toContain(source.block_styles[0].protected_examples![0].text);
  });

  it("obriga o Escritor a escolher analogia funcional ou fallback agregado", () => {
    expect(assemble).toContain("matched_analog|aggregate_fallback");
    expect(assemble).toContain("Do not mechanically replace one noun in a source sentence");
    expect(assemble).toContain("hook_strategy_analogy_trace_invalid");
    expect(assemble).toContain("source_video_id_not_in_candidates");
    expect(assemble).toContain("the first dominant_opening_pattern of the hook profile is authoritative");
    expect(assemble).toContain("checks.concrete_curiosity");
    expect(assemble).toContain("vai te chocar");
    expect(assemble).toContain("inimaginavel");
    expect(assemble).toContain("(?:algo|resultado|objeto|coisa)");
    expect(assemble).toContain("const possessiveDirect = [\"seu\", \"sua\", \"seus\", \"suas\"].includes(words[0]");
    expect(assemble).toContain("ambiguousPortuguesePossessiveOpening");
    expect(assemble).toContain("firstNormalizedToken");
    expect(assemble).toContain("ambiguousPossessiveFallbackOpening");
    expect(assemble).toContain("sig.word_count <= 9");
    expect(assemble).toContain("Never replace a proven concrete object with a generic placeholder such as 'something'");
    expect(assemble).toContain("Never turn a one-time effect into 'constant'");
    expect(assemble).toContain("Do not upgrade 'whenever she slept' into 'every night'");
    expect(assemble).toContain("when sentence_range.target is 2, use two punctuated sentences");
    expect(assemble).toContain("pre_evaluator_strategy_repair");
    expect(assemble).toContain("preEvaluatorRepairRound <= 3");
    expect(assemble).toContain("const preEvaluatorRepairScope = resolvePreEvaluatorRepairScope");
    expect(assemble).toContain("const strategyFailedBeforeEvaluation = preEvaluatorRepairScope.requested_blocks");
    expect(assemble).toContain("const currentHookText = rawCurrentHookText && hookAllocation");
    expect(assemble).toContain("const hookNeedsSpecialist = !currentHookText");
    expect(assemble).not.toContain("buildGroundedOpeningHookFallback({");
    expect(assemble).not.toContain('"deterministic-hook-fallback"');
    expect(assemble).toContain("spoken_clauses: frozenHookSpokenClauses");
    expect(assemble).toContain("visual_action_clause: frozenHookVisualActionClause");
    expect(assemble).toContain("Nunca retorne generated_text");
    expect(assemble).toContain("hookSpokenPremiseCarrierPromise");
    expect(assemble).toContain("hookVisualActionCarrierPromise");
    expect(assemble).toContain("hookSpokenPremiseEquivalenceResult");
    expect(assemble).toContain("hookNeedsSpecialist && !hookSpecialistAccepted");
    expect(assemble).toContain("deterministic_strategy_contract_failed");
    expect(assemble).toContain("fit 3-5 spoken seconds");
    expect(assemble).toContain("timestamps from 0s through 5s");
    expect(assemble).toContain("Later video evidence is forbidden as hook fact support");
    expect(assemble).toContain("hook_apelao: options.stylePack?.hook_apelao !== false");
    expect(assemble).toContain("HOOK APEAL MODE IS ON");
    expect(assemble).toContain("GANCHO APELÃO LIGADO");
  });

  it("leva a trilha ao Avaliador e bloqueia hook sem contrato de adaptação", () => {
    expect(assemble).toContain('hook_strategy_trace: block.slot_type === "hook"');
    expect(assemble).toContain('hookTrace?.contract_version !== 1');
    expect(assemble).toContain("reconcileEvaluatorBlockIssues");
    expect(assemble).toContain("repairedEstimateIsUnstable");
    expect(assemble).toContain("unsupportedRateFailure");
    expect(assemble).toContain("repairedFailureIsSubstantive");
    expect(assemble).toContain("Reassess ALL THREE estimates independently");
    expect(assemble).toContain("do not replace a high-scoring evaluation with an unrelated 50/50 estimate");
    expect(assemble).toContain("Um ajuste apenas low de polimento ou contagem não justifica sozinho reprovar retenção");
    expect(assemble).toContain("troca mecânica de substantivo");
  });

  it("permite fatos coincidentes somente quando o vídeo novo os comprova", () => {
    expect(assemble).toContain("operational_evidence: pending.candidate.operationalEvidence || null");
    expect(assemble).toContain("independently explicit in operational_evidence from the NEW video");
    expect(assemble).toContain("operationalEvidenceForCopyGuard(options.payload");
  });

  it("injeta a mesma lista completa no fluxo ao vivo retomável", () => {
    expect(runner).toContain("buildHookStrategyAnalogs");
    expect(runner).toContain("hook_strategy_analogs: expectedHookStrategyAnalogs");
    expect(runner).toContain("DNA contextual incompleto");
  });

  it("reprova emoção ou intenção inventada fora do intervalo visual/falado", () => {
    expect(validator).toContain("transcript_support: transcriptSupport");
    expect(validator).not.toContain("later_confirmation_support: hookLaterConfirmationSupport");
    expect(validator).toContain("TODAS as afirmacoes factuais devem nascer exclusivamente dos frames e transcricao da abertura entre 0s e 5s");
    expect(validator).toContain("O hook deve caber em 3-5 segundos falados");
    expect(validator).toContain("nao infira odio, amor, desejo ou motivacao");
    expect(validator).toContain("um efeito observado uma vez nao pode ser descrito como constante");
    expect(assemble).toContain("Não infira ódio, amor ou desejo apenas por uma ação posterior");
  });
});
