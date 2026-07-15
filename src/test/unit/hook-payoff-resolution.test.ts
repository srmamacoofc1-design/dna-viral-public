import { describe, expect, it } from "vitest";
import {
  assessLiteralOwnershipResolution,
  assessPersistedHookPayoffResolution,
  resolveHookPayoffPair,
} from "../../../supabase/functions/_shared/hook-payoff-resolution.ts";
import { normalizeViralEvaluation } from "../../../supabase/functions/_shared/viral-review-loop.ts";

const blocks = [
  { index: 0, slot_type: "hook", generated_text: "O soldado ergue um teste positivo, mas de quem era?" },
  { index: 1, slot_type: "desenvolvimento", generated_text: "A militar guarda o teste no bolso." },
  { index: 2, slot_type: "payoff", generated_text: "No fim, a militar aparece gravida e confirma que o teste era dela." },
];

describe("hook/payoff semantic resolution contract", () => {
  it("ties a semantic pass to the exact current hook and payoff", () => {
    const pair = resolveHookPayoffPair(blocks)!;
    const assessment = assessPersistedHookPayoffResolution(blocks, {
      required: true,
      passed: true,
      pair_fingerprint: pair.fingerprint,
      semantic_resolution_confirmed: true,
      open_loop: "de quem era o teste positivo",
      semantic_answer: "o final mostra que o teste era da militar",
      reason: "o payoff responde a pergunta de posse aberta no hook",
    });

    expect(assessment.passed).toBe(true);
    expect(assessment.persisted_current).toBe(true);
  });

  it("uses the evidence fingerprint contract accepted by the normalized evaluator", () => {
    const pair = resolveHookPayoffPair(blocks)!;
    expect(pair.fingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);

    const normalized = normalizeViralEvaluation({
      estimated_metrics: {
        continue_rate_percent: 90,
        skip_rate_percent: 9,
        avg_view_percentage: 92,
      },
      criterion_scores: {
        hook: 9.2,
        development: 9.1,
        payoff: 9.3,
        visual_fidelity: 9.5,
        dna_strategy_application: 9.2,
        originality: 9,
        pacing: 9.1,
      },
      overall_score: 9.2,
      feedback: { summary: "Pronto", revision_priorities: [], block_issues: [] },
      hook_payoff_resolution_gate: {
        required: true,
        passed: true,
        pair_fingerprint: pair.fingerprint,
        hook_index: pair.hook_index,
        payoff_index: pair.payoff_index,
        semantic_resolution_confirmed: true,
        open_loop: "de quem era o teste positivo",
        semantic_answer: "o teste era da militar",
        reason: "o payoff responde a posse aberta no hook",
        object_overlap_alone_is_insufficient: true,
      },
    }, 1);

    expect(normalized.hook_payoff_resolution_gate?.passed).toBe(true);
    expect(normalized.failed_gates).not.toContain("hook_payoff_resolution_gate_failed");
  });

  it("fails closed for a stale verdict or an object-only echo without semantic confirmation", () => {
    const pair = resolveHookPayoffPair(blocks)!;
    expect(assessPersistedHookPayoffResolution(blocks, {
      required: true,
      passed: true,
      pair_fingerprint: pair.fingerprint,
      semantic_resolution_confirmed: false,
      open_loop: "teste positivo",
      semantic_answer: "teste positivo",
      reason: "repete o objeto",
    }).passed).toBe(false);

    const changed = blocks.map((block) => block.index === 2
      ? { ...block, generated_text: "Eles apenas olham o teste." }
      : block);
    expect(assessPersistedHookPayoffResolution(changed, {
      required: true,
      passed: true,
      pair_fingerprint: pair.fingerprint,
      semantic_resolution_confirmed: true,
      open_loop: "de quem era o teste",
      semantic_answer: "era da militar",
      reason: "responde a posse",
    }).reason).toBe("hook_payoff_resolution_fingerprint_stale");
  });

  it("rejects the exact v16 ownership false positive even when the evaluator claims resolution", () => {
    const v16Blocks = [
      {
        index: 1,
        slot_type: "hook",
        generated_text: "O soldado grisalho exibe um teste de gravidez positivo para as mulheres; de quem seria esse teste?",
      },
      {
        index: 7,
        slot_type: "payoff",
        generated_text: "A mulher loira e o mecânico seguram um bebê. O mecânico aponta para um avião no céu.",
      },
    ];
    const pair = resolveHookPayoffPair(v16Blocks)!;
    const result = assessPersistedHookPayoffResolution(v16Blocks, {
      required: true,
      passed: true,
      pair_fingerprint: pair.fingerprint,
      semantic_resolution_confirmed: true,
      open_loop: "de quem seria esse teste",
      semantic_answer: "o bebê mostraria que o teste era da mulher",
      reason: "a família responderia a pergunta",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("hook_payoff_ownership_answer_not_explicit");
    expect(result.literal_ownership_resolution).toMatchObject({
      required: true,
      passed: false,
      object_head: "teste",
    });
  });

  it("requires a literal same-object ownership answer, not holding or family inference", () => {
    const hook = "O oficial mostrou um teste positivo; de quem era aquele teste?";

    expect(assessLiteralOwnershipResolution(hook, "A mulher segura o teste e sorri.").passed).toBe(false);
    expect(assessLiteralOwnershipResolution(hook, "A mulher aparece com um homem e um bebê.").passed).toBe(false);
    expect(assessLiteralOwnershipResolution(hook, "A militar confirma que o teste era dela.")).toMatchObject({
      required: true,
      passed: true,
      object_head: "teste",
    });
  });
});
