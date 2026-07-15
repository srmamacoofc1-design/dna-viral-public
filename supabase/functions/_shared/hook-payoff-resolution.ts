import { textGuardFingerprint } from "./dna-guards.ts";

export interface HookPayoffPair {
  hook_index: number;
  payoff_index: number;
  hook_text: string;
  payoff_text: string;
  fingerprint: string;
}

export interface PersistedHookPayoffResolutionAssessment {
  required: true;
  passed: boolean;
  reason: string | null;
  pair: HookPayoffPair | null;
  persisted_current: boolean;
  semantic_resolution_confirmed: boolean;
  literal_ownership_resolution: LiteralOwnershipResolutionAssessment;
}

export interface LiteralOwnershipResolutionAssessment {
  required: boolean;
  passed: boolean;
  reason: string | null;
  object_head: string | null;
}

function normalizedResolutionText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ownershipObjectHead(hookText: unknown): { required: boolean; head: string | null } {
  const hook = normalizedResolutionText(hookText);
  const ptEsQuestion = hook.match(
    /\bde (?:quem|quien) (?:e|es|era|seria|seria|foi|fue)\s+(?:(?:o|a|os|as|esse|essa|este|esta|aquele|aquela|el|la|los|las|ese|esa|aquel|aquella)\s+)?([a-z][a-z0-9-]*)/u,
  );
  if (ptEsQuestion) return { required: true, head: ptEsQuestion[1] };

  const englishQuestion = hook.match(
    /\bwho (?:does|did|would)\s+(?:the|this|that|a|an)\s+([a-z][a-z0-9-]*)\s+belong to\b/u,
  ) || hook.match(/\bwhose\s+([a-z][a-z0-9-]*)\b/u);
  if (englishQuestion) return { required: true, head: englishQuestion[1] };

  const bareOwnership = /\b(?:de (?:quem|quien) (?:e|es|era|seria|foi|fue)|who (?:does|did|would) (?:it|this|that) belong to)\b/u.test(hook);
  if (!bareOwnership) return { required: false, head: null };

  const prefix = hook.split(/\b(?:de (?:quem|quien)|who (?:does|did|would))\b/u)[0];
  const directObjects = [...prefix.matchAll(
    /\b(?:carrega|carregou|ergue|ergueu|exibe|exibiu|mostra|mostrou|pega|pegou|segura|segurou|carries|carried|displays|displayed|holds|held|raises|raised|shows|showed|muestra|mostro|sostiene|sostuvo)\s+(?:um|uma|o|a|esse|essa|este|esta|aquele|aquela|a|an|the|this|that|un|una|el|la|ese|esa|aquel|aquella)\s+([a-z][a-z0-9-]*)\b/gu,
  )];
  return { required: true, head: directObjects.at(-1)?.[1] || null };
}

/**
 * Ownership is a special fail-closed open loop: seeing the same object, a
 * baby, a couple, or somebody merely holding the object never answers whose
 * it was. The payoff must name the same object and state ownership literally.
 */
export function assessLiteralOwnershipResolution(
  hookText: unknown,
  payoffText: unknown,
): LiteralOwnershipResolutionAssessment {
  const ownership = ownershipObjectHead(hookText);
  if (!ownership.required) return { required: false, passed: true, reason: null, object_head: null };
  if (!ownership.head) {
    return {
      required: true,
      passed: false,
      reason: "hook_ownership_object_not_identified",
      object_head: null,
    };
  }

  const payoff = normalizedResolutionText(payoffText);
  const object = escapeRegExp(ownership.head);
  const explicitOwnership = [
    new RegExp(`\\b${object}\\s+(?:(?:e|era|foi)\\s+(?:d(?:e|o|a|os|as)\\b|dele\\b|dela\\b|deles\\b|delas\\b|meu\\b|minha\\b|seu\\b|sua\\b)|pertenc(?:e|eu|ia)\\s+a\\b)`, "u"),
    new RegExp(`\\b${object}\\s+(?:dele|dela|deles|delas)\\b`, "u"),
    new RegExp(`\\b${object}\\s+(?:(?:is|was)\\s+(?:his|hers|theirs|mine|yours)\\b|belong(?:s|ed)?\\s+to\\b)`, "u"),
    new RegExp(`\\b(?:his|her|their|my|your)\\s+${object}\\b`, "u"),
    new RegExp(`\\b${object}\\s+(?:(?:es|era|fue)\\s+de\\b|pertenec(?:e|io|ia)\\s+a\\b)`, "u"),
  ].some((pattern) => pattern.test(payoff));
  return {
    required: true,
    passed: explicitOwnership,
    reason: explicitOwnership ? null : "hook_payoff_ownership_answer_not_explicit",
    object_head: ownership.head,
  };
}

function normalizedSlotType(block: any): string {
  return String(block?.slot_type || block?.type || block?.narrative_function || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function resolveHookPayoffPair(blocks: any[]): HookPayoffPair | null {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const hook = safeBlocks.find((block) => normalizedSlotType(block) === "hook");
  const payoffCandidates = safeBlocks.filter((block) =>
    ["payoff", "revelacao", "resolution", "resolucao", "desfecho"].includes(normalizedSlotType(block))
  );
  const payoff = payoffCandidates[payoffCandidates.length - 1];
  const hookText = String(hook?.generated_text || "").trim();
  const payoffText = String(payoff?.generated_text || "").trim();
  const hookIndex = Number(hook?.index);
  const payoffIndex = Number(payoff?.index);
  if (!hookText || !payoffText || !Number.isInteger(hookIndex) || !Number.isInteger(payoffIndex)) return null;
  return {
    hook_index: hookIndex,
    payoff_index: payoffIndex,
    hook_text: hookText,
    payoff_text: payoffText,
    fingerprint: textGuardFingerprint(`${hookIndex}:${hookText}\n${payoffIndex}:${payoffText}`),
  };
}

/**
 * The semantic verdict comes from the independent Evaluator; this helper ties
 * that verdict to the exact current hook/payoff text so a stale pass cannot be
 * reused after either block changes.
 */
export function assessPersistedHookPayoffResolution(
  blocks: any[],
  persistedGate: any,
): PersistedHookPayoffResolutionAssessment {
  const pair = resolveHookPayoffPair(blocks);
  if (!pair) {
    return {
      required: true,
      passed: false,
      reason: "hook_or_payoff_missing",
      pair: null,
      persisted_current: false,
      semantic_resolution_confirmed: false,
      literal_ownership_resolution: {
        required: false,
        passed: true,
        reason: null,
        object_head: null,
      },
    };
  }
  const persistedCurrent = String(persistedGate?.pair_fingerprint || "") === pair.fingerprint;
  const semanticResolutionConfirmed = persistedGate?.semantic_resolution_confirmed === true
    && String(persistedGate?.open_loop || "").trim().length >= 4
    && String(persistedGate?.semantic_answer || "").trim().length >= 4
    && String(persistedGate?.reason || "").trim().length >= 4;
  const literalOwnershipResolution = assessLiteralOwnershipResolution(pair.hook_text, pair.payoff_text);
  const passed = persistedGate?.required === true
    && persistedGate?.passed === true
    && persistedCurrent
    && semanticResolutionConfirmed
    && literalOwnershipResolution.passed;
  return {
    required: true,
    passed,
    reason: passed
      ? null
      : !persistedCurrent
      ? "hook_payoff_resolution_fingerprint_stale"
      : !literalOwnershipResolution.passed
      ? literalOwnershipResolution.reason
      : !semanticResolutionConfirmed
      ? "hook_payoff_semantic_resolution_not_confirmed"
      : "hook_payoff_resolution_gate_failed",
    pair,
    persisted_current: persistedCurrent,
    semantic_resolution_confirmed: semanticResolutionConfirmed,
    literal_ownership_resolution: literalOwnershipResolution,
  };
}
