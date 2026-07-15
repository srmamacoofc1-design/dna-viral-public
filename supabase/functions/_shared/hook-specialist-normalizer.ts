import { assessHookOpenLoopStructure } from "./dna-guards.ts";
import { assessLiteralOwnershipResolution } from "./hook-payoff-resolution.ts";

export interface HookSpecialistEvidenceEvent {
  evidence_text?: string;
  evidence_kind?: string;
  required_deterministic_qualifiers?: readonly string[];
}

export interface HookSpecialistNormalizerOptions {
  targetLanguage: string;
  maxWords: number;
  declarativePreferred: boolean;
  events?: ReadonlyArray<HookSpecialistEvidenceEvent>;
  payoffEvents?: ReadonlyArray<HookSpecialistEvidenceEvent>;
}

const UNSUPPORTED_UNKNOWN_GAP = /\b(?:mist[eé]rio|misterio|mystery|segredo|secret|secreto|desconhecid\p{L}*|unknown|incert\p{L}*|sem\s+explica[cç][aã]o|sin\s+explicaci[oó]n|without\s+explanation|ningu[eé]m\s+sabia|nadie\s+sab[ií]a|nobody\s+knew|mal\s+sabia|little\s+did|sem\s+imaginar|sin\s+imaginar|without\s+knowing)\b/iu;

const WHY_QUESTION = /(?:^|[.!?;:—-]\s*)(?:por\s+que|por\s+qu[eé]|why|qual\s+(?:era\s+)?(?:o\s+)?motivo|cu[aá]l\s+(?:era\s+)?(?:el\s+)?motivo|what\s+(?:was\s+)?the\s+reason)\b[^?]*\?/iu;

const EXPLICIT_CAUSE_OR_PURPOSE = /\b(?:porque|because|por\s+causa\s+de|due\s+to|devido\s+a|debido\s+a|j[aá]\s+que|ya\s+que|uma\s+vez\s+que|since|a\s+fim\s+de|in\s+order\s+to|com\s+o\s+objetivo\s+de|con\s+el\s+objetivo\s+de|queria|quer[ií]a|wanted\s+to|n[aã]o\s+tinha\s+(?:vontade|inten[cç][aã]o)|no\s+ten[ií]a\s+ganas|t[aã]o\b[^.!?]{0,100}\bque|tan\b[^.!?]{0,100}\bque|so\b[^.!?]{0,100}\bthat)\b/iu;

const GENERIC_FORWARD_QUESTION = /(?:^|[,.!?;:\-]\s*)(?:(?:mas|so\s+que|pero|but)\s+)?(?:o\s+que\s+(?:vai|ira|pode)\s+acontecer(?:\s+(?:agora|depois))?|o\s+que\s+(?:[\p{L}\p{N}_-]+\s+){0,4}(?:(?:vai|ira)\s+fazer|fara|planeja(?:\s+fazer)?|pretende(?:\s+fazer)?)(?:\s+(?:agora|depois))?|qual\s+(?:sera\s+)?(?:o\s+)?destino(?:\s+(?:dele|dela|deles|delas))?|e\s+agora|what\s+(?:will\s+)?happen(?:\s+next)?|what\s+comes\s+next|what\s+(?:will|would|could)\s+(?:[\p{L}\p{N}_-]+\s+){0,4}(?:do|plan|intend)(?:\s+(?:now|next))?|cual\s+(?:sera\s+)?(?:el\s+)?destino|que\s+(?:[\p{L}\p{N}_-]+\s+){0,4}(?:hara|planea(?:\s+hacer)?|pretende(?:\s+hacer)?)(?:\s+ahora)?|y\s+ahora)\s*\?$/iu;

const GENERIC_BARE_IDENTITY_QUESTION = /(?:^|[,.!?;:\-]\s*)(?:(?:mas|so\s+que)\s+)?quem\s+(?:e|era|foi)(?:\s+(?:(?:essa|esta|aquela)\s+pessoa|ele|ela|isso|isto))?(?:\s+afinal)?\s*\?$|(?:^|[,.!?;:\-]\s*)but\s+who\s+(?:is|was)(?:\s+(?:it|he|she|they|this\s+person))?(?:\s+after\s+all)?\s*\?$|(?:^|[,.!?;:\-]\s*)pero\s+quien\s+(?:es|era|fue)(?:\s+(?:(?:esa|esta|aquella)\s+persona|el|ella|eso))?(?:\s+al\s+final)?\s*\?$/iu;

const DETACHED_NEUTRAL_RISK_QUESTION = /^(?:(?:mas|so\s+que|pero|but)\s+)?(?:qual(?:\s+e|\s+o)?\s+risco\s+(?:dess[ea]s?|d[oa]s?)|what\s+is\s+the\s+risk\s+of|cual(?:\s+es)?\s+el\s+riesgo\s+de)\b[^?]*\?$/iu;

const NON_NEUTRAL_OBJECT_HEADS = new Set([
  "adult", "adulta", "adulto", "animal", "baby", "bebe", "bird", "boy", "cachorro",
  "cao", "cat", "cavalo", "child", "crianca", "criatura", "dog", "garota", "garoto",
  "gato", "girl", "hombre", "homem", "horse", "lobo", "man", "mechanic", "mecanico",
  "menina", "menino", "militar", "mujer", "mulher", "officer", "passaro", "perro",
  "person", "pessoa", "soldado", "soldier", "wolf", "woman",
]);

function normalizedForRule(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function currentOpeningEvidence(options: HookSpecialistNormalizerOptions): string {
  return (options.events || [])
    .map((event) => String(event?.evidence_text || "").trim())
    .filter(Boolean)
    .join(" \n ");
}

function literalPayoffEvidence(options: Pick<HookSpecialistNormalizerOptions, "payoffEvents">): string {
  return (options.payoffEvents || [])
    .filter((event) => {
      const kind = normalizedForRule(String(event?.evidence_kind || ""));
      return !kind || !kind.includes("visual_frame") || /\b(?:ocr|text on screen|texto na tela)\b/iu.test(String(event?.evidence_text || ""));
    })
    .map((event) => String(event?.evidence_text || "").trim())
    .filter(Boolean)
    .join(" \n ");
}

function repairableFinalQuestion(value: string): { prefix: string; question: string } | null {
  const original = String(value || "").trim();
  // A comma commonly introduces the final open loop (", mas qual...").
  // Treat it as a boundary so a grounded setup cannot hide a detached-risk
  // question from the narrow deterministic repair.
  const match = original.match(/([^,.!?;:\n]*\?)\s*$/u);
  if (!match || match.index === undefined) return null;
  const normalizedWhole = normalizedForRule(original);
  const normalizedQuestion = normalizedForRule(match[1]);
  const repairable = GENERIC_FORWARD_QUESTION.test(normalizedWhole)
    || GENERIC_BARE_IDENTITY_QUESTION.test(normalizedWhole)
    || DETACHED_NEUTRAL_RISK_QUESTION.test(normalizedQuestion);
  if (!repairable) return null;
  const prefix = original.slice(0, match.index).trim().replace(/[,.!?;:\-\u2013\u2014]+$/u, "").trim();
  return prefix ? { prefix, question: match[1] } : null;
}

function neutralObjectHead(prefix: string): { head: string; article: string } | null {
  const normalized = normalizedForRule(prefix);
  const ptOrEsMatches = [...normalized.matchAll(
    /\b(?:abre|abriu|apresenta|apresentou|carrega|carregou|encontra|encontrou|ergue|ergueu|exibe|exibiu|levanta|levantou|mostra|mostrou|pega|pegou|segura|segurou|abre|abrio|carga|cargaba|encuentra|encontro|levanta|levanto|muestra|mostro|sostiene|sostuvo)\s+(um|uma|o|a|esse|essa|este|esta|aquele|aquela|un|una|el|la|ese|esa|este|esta|aquel|aquella)\s+([a-z][a-z0-9-]*)\b/gu,
  )];
  for (const match of ptOrEsMatches.reverse()) {
    const rawArticle = match[1];
    const head = match[2];
    if (NON_NEUTRAL_OBJECT_HEADS.has(head)) continue;
    const feminine = /^(?:uma|a|essa|esta|aquela|una|la|esa|aquella)$/u.test(rawArticle);
    return { head, article: feminine ? "a" : "o" };
  }

  const englishMatches = [...normalized.matchAll(
    /\b(?:carries|carried|displays|displayed|finds|found|holds|held|opens|opened|picks|picked|raises|raised|shows|showed)\s+(?:up\s+)?(?:a|an|the|this|that)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,4}?)(?=\s+(?:at|before|for|in\s+front|to|toward|towards|while|with)\b|[,.;]|$)/gu,
  )];
  for (const match of englishMatches.reverse()) {
    const head = match[1].trim().split(/\s+/u).at(-1) || "";
    if (!head || NON_NEUTRAL_OBJECT_HEADS.has(head)) continue;
    return { head, article: "the" };
  }
  return null;
}

/**
 * Repairs only a narrow class of hook-loop failures. The asserted setup is
 * preserved byte-for-byte; a generic future/bare-identity question or an
 * invented detached-risk question is replaced with ownership of a concrete
 * non-living direct object already named in that setup. All normal hook,
 * checklist and 0-5s evidence gates still revalidate the returned candidate.
 */
export function buildNeutralObjectOwnershipGapCandidate(
  candidateText: string,
  options: Pick<HookSpecialistNormalizerOptions, "targetLanguage" | "maxWords" | "payoffEvents">,
): string | null {
  const repairable = repairableFinalQuestion(candidateText);
  if (!repairable) return null;
  const object = neutralObjectHead(repairable.prefix);
  if (!object) return null;
  const language = normalizedForRule(options.targetLanguage).split(/[-_]/u)[0];
  const question = language === "en"
    ? `Who did the ${object.head} belong to?`
    : language === "es"
    ? `De quien era ${object.article === "a" ? "la" : "el"} ${object.head}?`
    : `De quem era ${object.article} ${object.head}?`;
  const repaired = `${repairable.prefix}. ${question}`.replace(/\s+/gu, " ").trim();
  const words = repaired.split(/\s+/u).filter(Boolean).length;
  if (words > Number(options.maxWords)) return null;
  return assessLiteralOwnershipResolution(repaired, literalPayoffEvidence(options)).passed
    ? repaired
    : null;
}

/**
 * Fail-closed normalization for a hook-specialist candidate.
 *
 * This function deliberately does not rewrite nouns, verbs, entities, objects
 * or qualifiers. Those details belong exclusively to the current opening
 * events and must be regenerated by the specialist if the candidate invents
 * an unknown motive/secret or re-hides a cause already stated in the opening.
 * Returning an empty string triggers that bounded regeneration path.
 */
export function normalizeHookSpecialistDeclarativeGap(
  candidateText: string,
  options: HookSpecialistNormalizerOptions,
): string {
  const original = String(candidateText || "").trim();
  if (!original) return original;

  // A factual statement can be a strong setup, but the assembly contract also
  // requires a real curiosity gap. Returning the declarative statement here
  // used to make the bounded specialist repeat the same no-loop v8 candidate
  // until the required hook became `strategy_failed`. Fail closed so the next
  // specialist attempt must preserve the opening events and add an anchored
  // unanswered clause; do not manufacture that clause deterministically.
  if (!assessHookOpenLoopStructure(original).has_open_loop_marker) return "";

  // A concrete setup does not rescue a vague final question. The question
  // itself must name a supported opening action/object and a genuinely open
  // dimension, instead of merely asking what happens next or someone's fate.
  if (GENERIC_FORWARD_QUESTION.test(normalizedForRule(original))) return "";
  if (GENERIC_BARE_IDENTITY_QUESTION.test(normalizedForRule(original))) return "";
  if (!assessLiteralOwnershipResolution(original, literalPayoffEvidence(options)).passed) return "";

  const evidence = currentOpeningEvidence(options);
  const candidateAssertsUnknownGap = UNSUPPORTED_UNKNOWN_GAP.test(original);
  const evidenceSupportsUnknownGap = UNSUPPORTED_UNKNOWN_GAP.test(evidence);
  if (candidateAssertsUnknownGap && !evidenceSupportsUnknownGap) return "";

  const asksWhy = WHY_QUESTION.test(original);
  const openingAlreadyStatesCause = EXPLICIT_CAUSE_OR_PURPOSE.test(evidence);
  if (asksWhy && openingAlreadyStatesCause) return "";

  // Word-count repair and style conversion happen in the Writer. Mutating a
  // candidate here could silently delete a current event or qualifier.
  return original;
}
