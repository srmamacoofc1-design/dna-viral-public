export type DetectedLanguage = "pt" | "en" | "es" | "unknown";

const LANGUAGE_MARKERS: Record<Exclude<DetectedLanguage, "unknown">, Set<string>> = {
  pt: new Set(["de", "do", "da", "dos", "das", "que", "nao", "uma", "um", "com", "para", "por", "os", "as", "no", "na", "nos", "nas", "em", "se", "mais", "foi", "sao", "era", "ate", "isso", "essa", "esse", "ela", "ele", "voce", "muito", "como", "quando", "mas", "tem", "sua", "seu", "este", "esta", "ja", "pode", "sobre", "depois", "entao"]),
  en: new Set(["the", "and", "is", "was", "are", "were", "have", "has", "had", "will", "would", "can", "could", "should", "this", "that", "with", "from", "for", "but", "not", "they", "their", "them", "what", "when", "where", "which", "who", "how", "been", "being", "does", "did", "just", "than", "then", "also", "into", "about", "after", "before", "during", "without", "because", "more", "most", "only", "very", "you", "your"]),
  es: new Set(["de", "del", "la", "las", "el", "los", "que", "una", "uno", "con", "para", "por", "en", "se", "sin", "mas", "fue", "son", "era", "hasta", "eso", "esa", "ese", "ella", "usted", "muy", "como", "cuando", "pero", "tiene", "su", "sus", "este", "esta", "ya", "puede", "sobre", "despues", "entonces", "mientras", "aunque", "habia"]),
};

const CONTENT_STOPWORDS = new Set([
  ...LANGUAGE_MARKERS.pt,
  ...LANGUAGE_MARKERS.en,
  ...LANGUAGE_MARKERS.es,
  "dos", "das", "los", "las", "ele", "ela", "el", "ella", "they", "them", "their",
  "como", "como", "mais", "mas", "more", "very", "muy", "seu", "sua", "sus",
]);

const GENERIC_HOOK_META_PATTERN = /\b(?:voce nao vai acreditar|voce nem imagina|o que aconteceu vai te|o que fara|o que (?:ele|ela) fara|qual sera (?:o|seu|sua) (?:resultado|destino|consequencia|futuro)|e agora|assista ate o final|fique ate o final|you won t believe|what happened will|what will (?:he|she|it) do|watch until the end|no vas a creer|que hara|y ahora|mira hasta el final)\b/u;
const GENERIC_FORWARD_QUESTION_PATTERN = /\b(?:o que (?:vai )?acontec(?:e|er|era|erao|eria|eria acontecer)|what (?:will|would|could) happen|que (?:va a )?pasar(?:a|ia)?)\b/u;
const GENERIC_BARE_ACTION_QUESTION_PATTERN = /\b(?:o que (?:[a-z0-9]+ ){0,4}(?:(?:fara|vai fazer|ira fazer|planeja(?: fazer)?|pretende(?: fazer)?)(?: (?:agora|depois))?)|what (?:will|would|could) (?:[a-z0-9]+ ){0,4}(?:do|plan|intend)(?: now| next)?|que (?:[a-z0-9]+ ){0,4}(?:hara|planea(?: hacer)?|pretende(?: hacer)?)(?: ahora)?)\b/u;
const GENERIC_FUTURE_INTENT_QUESTION_PATTERN = /\b(?:(?:ate onde|aonde|onde)\s+(?:(?:ele|ela|eles|elas|o homem|a mulher|the man|the woman|he|she|they|el hombre|la mujer|el|ella)\s+)?(?:pretend\p{L}*|planej\p{L}*|tencion\p{L}*|intend\p{L}*|plan\p{L}*|planea\p{L}*)\s+(?:chegar|ir|levar|reach|go|take|llegar|ir|llevar)|(?:qual|what|cual)\s+(?:lugar|destino|place|destination)\s+(?:(?:ele|ela|he|she|el|ella)\s+)?(?:pretend\p{L}*|planej\p{L}*|intend\p{L}*|plan\p{L}*|planea\p{L}*))\b/u;
const GENERIC_BARE_IDENTITY_QUESTION_PATTERN = /(?:^(?:quem\s+(?:e|era|foi)(?:\s+(?:(?:essa|esta|aquela)\s+pessoa|ele|ela|isso|isto))?(?:\s+afinal)?|who\s+(?:is|was)(?:\s+(?:it|he|she|they|this\s+person))?(?:\s+after\s+all)?|quien\s+(?:es|era|fue)(?:\s+(?:(?:esa|esta|aquella)\s+persona|el|ella|eso))?(?:\s+al\s+final)?)|\b(?:(?:mas|so\s+que)\s+quem\s+(?:e|era|foi)(?:\s+(?:(?:essa|esta|aquela)\s+pessoa|ele|ela|isso|isto))?(?:\s+afinal)?|but\s+who\s+(?:is|was)(?:\s+(?:it|he|she|they|this\s+person))?(?:\s+after\s+all)?|pero\s+quien\s+(?:es|era|fue)(?:\s+(?:(?:esa|esta|aquella)\s+persona|el|ella|eso))?(?:\s+al\s+final)?))$/u;
export const HOOK_OPENING_END_SECONDS = 5;
const HOOK_OPENING_BOUNDARY_EPSILON_SECONDS = 0.001;
const HOOK_ABSTRACT_WRAPPER_WORDS = new Set([
  "acontecimento", "acontecimentos", "coisa", "coisas", "consequencia", "consequencias",
  "destino", "destinos", "destiny", "destinies", "efeito", "efeitos", "evento", "eventos", "forma", "formas", "form", "forms", "shape", "shapes", "gesto", "gestos", "mudanca", "mudancas",
  "processo", "processos", "resultado", "resultados", "situacao", "situacoes", "transformacao",
  "transformacoes", "acontecimiento", "acontecimientos", "cambio", "cambios", "cosa", "cosas",
  "consecuencia", "consecuencias", "evento", "eventos", "proceso", "procesos", "resultado",
  "resultados", "situacion", "situaciones", "transformacion", "transformaciones", "change",
  "changes", "consequence", "consequences", "event", "events", "happening", "happenings",
  "outcome", "outcomes", "process", "processes", "result", "results", "situation", "situations",
  "thing", "things", "transformation", "transformations",
  // These name an explanation/role, not the concrete visual action or object
  // that must anchor the curiosity gap.
  "disfarce", "disfraz", "disguise", "finalidade", "motivo", "purpose", "razao", "reason",
]);
const HOOK_LOOP_SCAFFOLDING_WORDS = new Set([
  "acontece", "acontecer", "acontecera", "aconteceria", "apos", "ate", "aquela", "aquelas",
  "aquele", "aqueles", "aquilo", "chegar", "chegaria", "como", "depois",
  "essa", "essas", "esse", "esses", "esta", "estas", "este", "estes", "faria", "isso", "isto",
  "ir", "iria", "levar", "levaria", "onde", "pode", "poderia", "qual", "quais",
  "quando", "quanto", "sera", "seria", "what", "would", "could", "will", "happen", "happens",
  "happened", "happening", "after", "this", "that", "these", "those", "where", "when", "which",
  "reach", "lead", "leading", "take", "pasar", "pasara", "pasaria",
  "despues", "esa", "ese", "esta", "este", "aquella", "aquel", "donde", "cuando", "cual",
  "podria", "llegar", "llevaria",
  // Curiosity markers are scaffolding, never concrete anchors by themselves.
  "ainda", "incerto", "misterio", "mystery", "permanecia", "restava", "secret", "segredo",
  "still", "unknown", "quem", "quien", "who",
  // Generic future/method wrappers are not concrete anchors. Without these,
  // questions such as "Como tudo terminara?" or "Qual sera o proximo passo?"
  // incorrectly pass merely because an inflected helper is treated as a fact.
  "acontecera", "aconteceria", "alcance", "alcances", "extent", "extents", "futuro", "ira", "metodo", "modo", "passo", "podera",
  "proxima", "proximas", "proximo", "proximos", "termina", "terminar", "terminara",
  "terminaria", "tudo", "vai", "way", "next", "step", "end", "ends", "ending",
  // Quantifiers and neutral question helpers do not assert a story outcome.
  "enquanto", "longe", "muito", "quanto", "tao", "tanto", "how", "far", "much",
  "porque", "why",
]);

// Only neutral open-loop helpers may be introduced without appearing in a
// frozen factual clause. Outcome verbs such as "atrair", "conquistar" or
// "assustar" are deliberately absent: mentioning one would presuppose a later
// result even when the question still ends with a question mark.
const HOOK_LOOP_SCAFFOLDING_PREFIXES = [
  "cheg", "lev", "pod", "termin",
] as const;

export interface HookOpenLoopStructureAssessment {
  passed: boolean;
  has_open_loop_marker: boolean;
  generic_open_loop: boolean;
  concrete_anchor_terms: string[];
  loop_clause: string;
  reasons: string[];
}

function hookLoopClause(text: string): string {
  const questions = String(text || "").match(/[^.!?;:\n]+\?/gu) || [];
  if (questions.length > 0) return questions.at(-1)!.trim();
  const clauses = String(text || "")
    .split(/[.!;:\n]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const marked = clauses.filter((clause) => /\b(?:ainda|ate onde|sem saber|restava|incerto|misterio|segredo|little did|still|unknown|hasta donde|sin saber)\b/iu.test(
    normalizeGuardWords(clause).join(" "),
  ));
  return (marked.at(-1) || "").trim();
}

/**
 * Checks the structure of the curiosity gap without deciding story truth.
 * Semantic grounding against the 0-5s evidence remains a separate mandatory
 * verdict. Demonstratives plus abstract wrappers ("essa transformaÃ§Ã£o") are
 * deliberately not treated as concrete anchors.
 */
export function assessHookOpenLoopStructure(text: string): HookOpenLoopStructureAssessment {
  const raw = String(text || "").trim();
  const normalized = normalizeGuardWords(raw).join(" ");
  const loopClause = hookLoopClause(raw);
  const normalizedLoop = normalizeGuardWords(loopClause).join(" ");
  const hasOpenLoopMarker = Boolean(loopClause)
    && (loopClause.includes("?")
      || /\b(?:ainda|ate onde|sem saber|restava|incerto|misterio|segredo|little did|still|unknown|hasta donde|sin saber)\b/u.test(normalizedLoop));
  const concreteAnchorTerms = [...new Set(normalizeGuardWords(loopClause).filter((word) =>
    word.length > 2
    && !CONTENT_STOPWORDS.has(word)
    && !HOOK_LOOP_SCAFFOLDING_WORDS.has(word)
    && !HOOK_ABSTRACT_WRAPPER_WORDS.has(word)
  ))];
  const loopOffset = loopClause ? raw.lastIndexOf(loopClause) : -1;
  const assertedPrefixWords = new Set(normalizeGuardWords(loopOffset > 0 ? raw.slice(0, loopOffset) : ""));
  const repeatedConcreteTerms = concreteAnchorTerms.filter((word) => assertedPrefixWords.has(word));
  const nominalizedInfinitive = normalizedLoop.match(
    /\b(?:esse|essa|este|esta|aquele|aquela)\s+([a-z]{3,}(?:ar|er|ir))\b/u,
  )?.[1] || "";
  const normalizedPrefix = loopOffset > 0
    ? normalizeGuardWords(raw.slice(0, loopOffset)).join(" ")
    : "";
  // Reject literal-calque anchors such as "esse vestir" only when the same
  // infinitive was already used as an action in the asserted setup. This
  // avoids false positives for legitimate nouns such as "aquele olhar".
  const unnaturalNominalizedAction = Boolean(nominalizedInfinitive)
    && new RegExp(
      `\\b(?:decidiu|decide|resolveu|resolve|tentou|tenta|quis|queria|quer|comecou|comeca|ousou|passou|vai|iria|foi)\\s+(?:a\\s+)?${nominalizedInfinitive}\\b`,
      "u",
    ).test(normalizedPrefix);
  // "Como o lobo vestira a pele?" only asks for the method of the action that
  // the preceding clause already states. It does not withhold a consequence,
  // risk, extent or reveal, so it is a retelling disguised as a question.
  const howQuestionRestatesAssertedSetup = /^(?:como|how)\b/u.test(normalizedLoop)
    && repeatedConcreteTerms.length >= 2;
  const genericOpenLoop = GENERIC_HOOK_META_PATTERN.test(normalized)
    || GENERIC_FORWARD_QUESTION_PATTERN.test(normalizedLoop)
    || GENERIC_BARE_ACTION_QUESTION_PATTERN.test(normalizedLoop)
    || GENERIC_FUTURE_INTENT_QUESTION_PATTERN.test(normalizedLoop)
    || GENERIC_BARE_IDENTITY_QUESTION_PATTERN.test(normalizedLoop)
    || howQuestionRestatesAssertedSetup;
  const reasons = [
    ...(!hasOpenLoopMarker ? ["hook_open_loop_missing"] : []),
    ...(genericOpenLoop ? ["generic_open_loop"] : []),
    ...(unnaturalNominalizedAction ? ["hook_unnatural_nominalization"] : []),
    ...(hasOpenLoopMarker && concreteAnchorTerms.length === 0
      ? ["hook_open_loop_concrete_anchor_missing"]
      : []),
  ];
  return {
    passed: reasons.length === 0,
    has_open_loop_marker: hasOpenLoopMarker,
    generic_open_loop: genericOpenLoop,
    concrete_anchor_terms: concreteAnchorTerms,
    loop_clause: loopClause,
    reasons,
  };
}

export interface ReconciledHookOpenLoopVerdict {
  concrete_open_loop: boolean;
  open_loop_anchor_grounded: boolean;
  generic_open_loop: boolean;
  deterministic_reasons: string[];
  deterministic_anchor_terms: string[];
}

export interface FrozenHookLoopGroundingAssessment {
  passed: boolean;
  unsupported_terms: string[];
  reasons: string[];
}

/**
 * Builds a grammar-stable PT-BR extent question from semantic excerpts that
 * were already frozen by the independent spoken-premise carrier. It adds no
 * story fact: only the neutral extent frame is new. Returning an empty string
 * keeps unsupported languages or oversized clauses fail-closed.
 */
export function buildFrozenSpokenPremiseExtensionLoop(options: {
  targetIntentExcerpt: string;
  targetSubjectExcerpt: string;
  targetLanguage?: string;
  minWords?: number;
  maxWords: number;
}): string {
  const language = String(options.targetLanguage || "pt").toLocaleLowerCase().split(/[-_]/u)[0];
  if (language !== "pt") return "";
  const intent = String(options.targetIntentExcerpt || "").trim().replace(/[.!?;:,]+$/u, "");
  const subject = String(options.targetSubjectExcerpt || "").trim().replace(/[.!?;:,]+$/u, "");
  if (!intent || !subject) return "";
  const normalizedIntent = intent
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase();
  const startsWithInfinitive = /^(?:(?:nao|nunca|so|apenas|sempre)\s+)?(?:se\s+)?(?:[a-z]+(?:ar|er|ir)|ir|por)(?:\s|$)/u
    .test(normalizedIntent);
  if (!startsWithInfinitive) return "";
  // This extent frame was explicitly accepted for the application's spoken
  // viral register and keeps every content-bearing term inside frozen facts.
  const loop = `até onde ${intent} levaria ${subject}?`;
  const words = loop.split(/\s+/u).filter(Boolean).length;
  const minWords = Math.max(1, Number(options.minWords) || 1);
  const maxWords = Math.max(0, Number(options.maxWords) || 0);
  return words >= minWords && words <= maxWords ? loop : "";
}

/**
 * Reconciles the model's semantic verdict with the deterministic hook grammar.
 *
 * The semantic judge may add a stricter failure, but it can never overrule a
 * deterministic generic/missing-anchor result. This keeps the persisted copy
 * guard coherent with the hook strategy/grounding guard and prevents a vague
 * "what happens now?" question from being reported as concrete merely because
 * a model inferred an anchor from the surrounding evidence.
 */
export function reconcileHookOpenLoopVerdict(
  text: string,
  semantic: {
    concrete_open_loop?: unknown;
    open_loop_anchor_grounded?: unknown;
    generic_open_loop?: unknown;
  },
): ReconciledHookOpenLoopVerdict {
  const deterministic = assessHookOpenLoopStructure(text);
  const deterministicAnchorGrounded = deterministic.has_open_loop_marker
    && deterministic.concrete_anchor_terms.length > 0
    && !deterministic.generic_open_loop
    && !deterministic.reasons.includes("hook_unnatural_nominalization");
  return {
    concrete_open_loop: semantic?.concrete_open_loop === true && deterministic.passed,
    open_loop_anchor_grounded: semantic?.open_loop_anchor_grounded === true
      && deterministicAnchorGrounded,
    generic_open_loop: semantic?.generic_open_loop === true || deterministic.generic_open_loop,
    deterministic_reasons: deterministic.reasons,
    deterministic_anchor_terms: deterministic.concrete_anchor_terms,
  };
}

export function normalizeGuardWords(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Pequena impressão estável para invalidar metadados de guarda após edições. */
export function textGuardFingerprint(text: string): string {
  const normalized = normalizeGuardWords(text).join(" ");
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function detectGuardLanguage(text: string): DetectedLanguage {
  const words = normalizeGuardWords(text);
  if (words.length < 3) return "unknown";
  const rawNormalized = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  // Portuguese joins unstressed object pronouns with a hyphen ("vesti-la",
  // "seguiu-o"). The generic tokenizer used to split that into `vesti la`,
  // awarding a false Spanish point for `la` and rejecting valid PT-BR hooks.
  const portugueseHyphenClitic = /\b[\p{L}]+-(?:la|las|lo|los|a|as|o|os)\b/u.test(rawNormalized);
  const scores = (Object.keys(LANGUAGE_MARKERS) as Array<Exclude<DetectedLanguage, "unknown">>)
    .map(language => [
      language,
      words.filter(word => LANGUAGE_MARKERS[language].has(word)).length
        + (language === "pt" && portugueseHyphenClitic ? 2 : 0),
    ] as const)
    .sort((a, b) => b[1] - a[1]);
  if (scores[0][1] < 2 || scores[0][1] < scores[1][1] * 1.2) return "unknown";
  return scores[0][0];
}

const PT_STRONG_SPANISH_LEAKAGE = new Set([
  "ascenderlo", "ascenderla", "ascenderlos", "ascenderlas", "aunque", "despues", "entonces",
  "ganas", "habia", "hacia", "logro", "mientras", "ponersela", "ponerselo", "pudo", "quedo",
  "perezoso", "perezosa", "perezosos", "perezosas", "salvaje", "salvajes", "sin", "tuvo",
]);
const PT_STRONG_ENGLISH_LEAKAGE = new Set([
  "after", "although", "because", "before", "could", "during", "however", "inside", "meanwhile",
  "through", "until", "while", "without", "would",
]);

/** High-confidence token backstop for mixed-language model output. */
export function detectForeignLanguageContamination(text: string, expectedLanguage: string): string[] {
  const words = normalizeGuardWords(text);
  if (String(expectedLanguage || "").toLowerCase() !== "pt") return [];
  const spanish = words.filter((word) => PT_STRONG_SPANISH_LEAKAGE.has(word));
  const normalizedText = words.join(" ");
  // "vago" exists in Portuguese as "imprecise", but this subject + copula
  // construction is the common untranslated Spanish label for "preguiçoso".
  // Reject only that contextual leakage; ordinary PT uses remain valid.
  if (/\b(?:homem|mulher|garoto|garota|menino|menina|ele|ela)\s+(?:era|e|foi)\s+(?:tao\s+)?vag[oa]\b/u.test(normalizedText)) {
    spanish.push("vago_contextual");
  }
  const english = [...new Set(words.filter((word) => PT_STRONG_ENGLISH_LEAKAGE.has(word)))];
  return [...new Set([
    ...spanish,
    ...(english.length >= 2 ? english : []),
  ])];
}

export interface LexicalCopyRisk {
  blocked: boolean;
  longest_exact_ngram: number;
  max_content_similarity: number;
  matched_reference_index: number | null;
  references_checked: number;
  cross_language: boolean;
  reasons: string[];
}

export function assessLexicalCopyRisk(
  generated: string,
  references: string[],
  thresholds: { maxExactNgram?: number; maxContentSimilarity?: number } = {},
): LexicalCopyRisk {
  const maxExact = thresholds.maxExactNgram ?? 3;
  const maxSimilarity = thresholds.maxContentSimilarity ?? 0.62;
  const usableReferences = references.map(String).map(value => value.trim()).filter(Boolean);
  const generatedWords = normalizeGuardWords(generated);
  const generatedContent = new Set(generatedWords.filter(word => word.length > 2 && !CONTENT_STOPWORDS.has(word)));
  const generatedLanguage = detectGuardLanguage(generated);
  let longest = 0;
  let bestSimilarity = 0;
  let matchedReferenceIndex: number | null = null;
  let crossLanguage = false;

  usableReferences.forEach((reference, index) => {
    const referenceWords = normalizeGuardWords(reference);
    const referenceLanguage = detectGuardLanguage(reference);
    if (generatedLanguage !== "unknown" && referenceLanguage !== "unknown" && generatedLanguage !== referenceLanguage) {
      crossLanguage = true;
    }

    let localLongest = 0;
    const maxN = Math.min(generatedWords.length, referenceWords.length, 16);
    for (let n = 1; n <= maxN; n++) {
      const generatedNgrams = new Set<string>();
      for (let i = 0; i <= generatedWords.length - n; i++) {
        generatedNgrams.add(generatedWords.slice(i, i + n).join(" "));
      }
      const overlaps = referenceWords.some((_, i) => i <= referenceWords.length - n
        && generatedNgrams.has(referenceWords.slice(i, i + n).join(" ")));
      if (!overlaps) break;
      localLongest = n;
    }

    const referenceContent = new Set(referenceWords.filter(word => word.length > 2 && !CONTENT_STOPWORDS.has(word)));
    const intersection = [...generatedContent].filter(word => referenceContent.has(word)).length;
    const union = new Set([...generatedContent, ...referenceContent]).size;
    const similarity = union ? intersection / union : 0;
    if (localLongest > longest || similarity > bestSimilarity) matchedReferenceIndex = index;
    longest = Math.max(longest, localLongest);
    bestSimilarity = Math.max(bestSimilarity, similarity);
  });

  const reasons: string[] = [];
  if (usableReferences.length === 0) reasons.push("protected_references_missing");
  if (longest > maxExact) reasons.push(`exact_ngram_${longest}`);
  if (bestSimilarity > maxSimilarity) reasons.push(`content_similarity_${bestSimilarity.toFixed(2)}`);
  return {
    blocked: reasons.length > 0,
    longest_exact_ngram: longest,
    max_content_similarity: +bestSimilarity.toFixed(3),
    matched_reference_index: matchedReferenceIndex,
    references_checked: usableReferences.length,
    cross_language: crossLanguage,
    reasons,
  };
}

export interface HookFirstWindowGroundingAssessment {
  passed: boolean;
  blocked: boolean;
  generated_text_fingerprint: string;
  opening_window_valid: boolean;
  evidence_fact_count: number;
  unsupported_outcome_terms: string[];
  reasons: string[];
}

function hasSlidingStairsMechanism(value: unknown): boolean {
  const text = normalizeGuardWords(String(value || "")).join(" ");
  const slide = "(?:desliz\\p{L}*|escorreg\\p{L}*|slid\\p{L}*|glid\\p{L}*)";
  const stairs = "(?:escad\\p{L}*|escaler\\p{L}*|stair\\p{L}*)";
  return new RegExp(`\\b${slide}\\b(?:\\s+\\S+){0,9}\\s+\\b${stairs}\\b|\\b${stairs}\\b(?:\\s+\\S+){0,9}\\s+\\b${slide}\\b`, "u")
    .test(text);
}

function hasExplicitStayLyingIntent(value: unknown): boolean {
  const text = normalizeGuardWords(String(value || "")).join(" ");
  const lying = /\b(?:deitad\p{L}*|acostad\p{L}*|lying|laying|na cama|in bed|en la cama)\b/u.test(text);
  const desire = /\b(?:quer\p{L}*|wanted|wants|wish\p{L}*|prefer\p{L}*|ganas)\b/u.test(text);
  const refusalToRise = /\b(?:sem (?:nem )?(?:se )?levantar(?:-?se)?|nao tinha (?:nenhuma )?(?:vontade|ganas) de levantar(?:-?se)?|nao quer\p{L}* levantar(?:-?se)?|sin levantarse|no tenia ganas de levantarse|no quer\p{L}* levantarse|without getting up|did not want to get up|didn t want to get up|would not get up)\b/u.test(text);
  return (lying && desire) || refusalToRise;
}

/**
 * Detects the stronger spoken premise "wanted to spend the day lying down".
 * Merely saying that another action happened "all day" or "without getting
 * up" is not equivalent: it moves the duration away from the lying-state and
 * erases the desire stated by the narrator.
 */
function hasExplicitDayLyingDesire(value: unknown): boolean {
  const text = normalizeGuardWords(String(value || "")).join(" ");
  const lying = /\b(?:deitad\p{L}*|acostad\p{L}*|lying|laying|na cama|in bed|en la cama)\b/u.test(text);
  const desire = /\b(?:quer\p{L}*|wanted|wants|wish\p{L}*|prefer\p{L}*|ganas)\b/u.test(text);
  const dayScope = /\b(?:passar|pasar|spend)\b(?:\s+\S+){0,3}\s+\b(?:dia|day)\b|\b(?:dia\s+todo|todo\s+(?:o\s+|el\s+)?dia|all\s+day)\b/u.test(text);
  return lying && desire && dayScope;
}

function hasExplicitMaterialIntent(value: unknown): boolean {
  const text = normalizeGuardWords(String(value || "")).join(" ");
  return /\b(?:quer\p{L}*|wanted|wants|wish\p{L}*|prefer\p{L}*|ganas|vontade|decid\p{L}*|resolveu|refus\p{L}*|recus\p{L}*|nao\s+quer\p{L}*|did\s+not\s+want|didn\s+t\s+want|no\s+quer\p{L}*)\b/u.test(text);
}

export interface HookSpokenPremiseContractItem {
  event_id: string;
  source_spoken_proposition: string;
  material_relation: "desire_or_preference" | "decision" | "refusal";
  required_semantic_components: string[];
  preserve_semantics_not_source_word_order: true;
  abstract_label_is_not_coverage: true;
  failure_reason_if_missing: "opening_spoken_material_intent_omitted";
}

export interface HookSpokenPremiseCarrierItem {
  event_id: string;
  target_clause: string;
  source_subject_excerpt: string;
  source_relation_excerpt: string;
  source_intent_target_excerpt: string;
  source_temporal_scope_excerpt: string;
  source_polarity_excerpt: string;
  target_subject_excerpt: string;
  target_relation_excerpt: string;
  target_intent_target_excerpt: string;
  target_temporal_scope_excerpt: string;
  target_polarity_excerpt: string;
}

export interface HookSpokenPremiseCoverageAssessment {
  passed: boolean;
  covered_event_ids: string[];
  reasons: string[];
}

export interface HookSpokenPremiseRoleEquivalence {
  event_id: string;
  subject_equivalent: boolean;
  relation_equivalent: boolean;
  intent_target_equivalent: boolean;
  temporal_scope_equivalent: boolean;
  polarity_equivalent: boolean;
  reason: string;
}

export interface HookVisualActionCarrierItem {
  frame_timestamp_seconds: number;
  target_clause: string;
  source_subject_excerpt: string;
  source_action_excerpt: string;
  source_object_or_state_excerpt: string;
  target_subject_excerpt: string;
  target_action_excerpt: string;
  target_object_or_state_excerpt: string;
}

export interface HookVisualActionCarrierAssessment {
  passed: boolean;
  reasons: string[];
}

/**
 * Converts material intentions spoken during the opening into a mechanical
 * Writer contract. The current video's transcript remains the sole factual
 * source: this helper neither supplies reusable wording nor knows a subject,
 * topic or target story. Its purpose is to stop a tight hook word budget from
 * silently demoting a stated desire/decision/refusal into an optional tone or
 * a generic behaviour label.
 */
export function buildHookSpokenPremiseContract(
  events: readonly any[],
): HookSpokenPremiseContractItem[] {
  return (Array.isArray(events) ? events : []).flatMap((event: any) => {
    const evidenceKind = String(event?.evidence_kind || "").trim().toLocaleLowerCase();
    if (!/(?:transcript|spoken)/u.test(evidenceKind)) return [];

    const sourceText = String(event?.evidence_text || "").trim().slice(0, 900);
    if (!sourceText || !hasExplicitMaterialIntent(sourceText)) return [];

    const normalized = normalizeGuardWords(sourceText).join(" ");
    const relationCandidates: Array<{
      relation: HookSpokenPremiseContractItem["material_relation"];
      index: number;
    }> = [
      {
        relation: "desire_or_preference",
        index: normalized.search(/\b(?:quer\p{L}*|wanted|wants|wish\p{L}*|prefer\p{L}*|ganas|vontade)\b/u),
      },
      {
        relation: "decision",
        index: normalized.search(/\b(?:decid\p{L}*|resolveu|resolved|decided|decidio)\b/u),
      },
      {
        relation: "refusal",
        index: normalized.search(/\b(?:refus\p{L}*|recus\p{L}*|nao\s+quer\p{L}*|nao\s+tinha\s+(?:vontade|ganas)|sem\s+(?:vontade|ganas)|did\s+not\s+want|didn\s+t\s+want|would\s+not|no\s+quer\p{L}*|no\s+tenia\s+ganas|sin\s+ganas)\b/u),
      },
    ].filter((candidate) => candidate.index >= 0)
      .sort((left, right) => left.index - right.index);
    const materialRelation = relationCandidates[0]?.relation || "desire_or_preference";
    const refusal = materialRelation === "refusal";
    const temporalScope = /\b(?:todo\s+(?:o\s+|el\s+)?dia|dia\s+todo|all\s+day|toda\s+(?:a\s+)?(?:manha|tarde|noite)|all\s+(?:morning|afternoon|night)|cada\s+\p{L}+|every\s+\p{L}+|durante|during|por\s+\d+|for\s+\d+)\b/u.test(normalized);

    return [{
      event_id: String(event?.event_id || "").trim().slice(0, 240),
      source_spoken_proposition: sourceText,
      material_relation: materialRelation,
      required_semantic_components: [
        "subject_or_speaker",
        "material_intent_relation",
        "intent_target_state_or_action",
        ...(refusal ? ["polarity_or_refusal"] : []),
        ...(temporalScope ? ["temporal_scope"] : []),
      ],
      preserve_semantics_not_source_word_order: true,
      abstract_label_is_not_coverage: true,
      failure_reason_if_missing: "opening_spoken_material_intent_omitted",
    }];
  });
}

function containsNormalizedLiteral(container: unknown, excerpt: unknown): boolean {
  const normalizedContainer = normalizeGuardWords(String(container || "")).join(" ");
  const normalizedExcerpt = normalizeGuardWords(String(excerpt || "")).join(" ");
  return Boolean(normalizedExcerpt)
    && ` ${normalizedContainer} `.includes(` ${normalizedExcerpt} `);
}

function materialRelationMatches(
  value: unknown,
  relation: HookSpokenPremiseContractItem["material_relation"],
): boolean {
  const text = normalizeGuardWords(String(value || "")).join(" ");
  if (relation === "decision") {
    return /\b(?:decid\p{L}*|resolveu|resolved|chose|chosen)\b/u.test(text);
  }
  if (relation === "refusal") {
    return /\b(?:refus\p{L}*|recus\p{L}*|nao\s+quer\p{L}*|nao\s+tinha\s+(?:vontade|ganas)|sem\s+(?:vontade|ganas)|did\s+not\s+want|didn\s+t\s+want|would\s+not|no\s+quer\p{L}*|no\s+tenia\s+ganas|sin\s+ganas)\b/u.test(text);
  }
  return /\b(?:quer\p{L}*|wanted|wants|wish\p{L}*|prefer\p{L}*|ganas|vontade)\b/u.test(text);
}

/**
 * Verifies the source-only semantic carrier and then requires its target
 * clause inside the final hook. Source excerpts must be literal spans of the
 * current transcript proposition; target excerpts must be literal spans of
 * the translated clause and that complete clause must survive in
 * generatedText. This prevents a visual action from silently replacing the
 * spoken intent target while still allowing source and output languages to
 * differ.
 */
export function assessHookSpokenPremiseContractCoverage(
  generatedText: string,
  contracts: readonly HookSpokenPremiseContractItem[],
  carriers: readonly HookSpokenPremiseCarrierItem[],
  equivalenceVerdicts: readonly HookSpokenPremiseRoleEquivalence[] = [],
): HookSpokenPremiseCoverageAssessment {
  const reasons: string[] = [];
  const coveredEventIds: string[] = [];

  for (const contract of Array.isArray(contracts) ? contracts : []) {
    const eventId = String(contract?.event_id || "");
    const matches = (Array.isArray(carriers) ? carriers : [])
      .filter((carrier) => String(carrier?.event_id || "") === eventId);
    if (matches.length === 0) {
      reasons.push(`spoken_premise_carrier_missing:${eventId}`);
      continue;
    }
    if (matches.length > 1) {
      reasons.push(`spoken_premise_carrier_duplicate:${eventId}`);
      continue;
    }

    const carrier = matches[0];
    const equivalenceMatches = (Array.isArray(equivalenceVerdicts) ? equivalenceVerdicts : [])
      .filter((verdict) => String(verdict?.event_id || "") === eventId);
    if (equivalenceMatches.length === 0) {
      reasons.push(`spoken_premise_role_equivalence_missing:${eventId}`);
    } else if (equivalenceMatches.length > 1) {
      reasons.push(`spoken_premise_role_equivalence_duplicate:${eventId}`);
    } else {
      const equivalence = equivalenceMatches[0];
      if (equivalence.subject_equivalent !== true) {
        reasons.push(`spoken_premise_subject_not_equivalent:${eventId}`);
      }
      if (equivalence.relation_equivalent !== true) {
        reasons.push(`spoken_premise_relation_not_equivalent:${eventId}`);
      }
      if (equivalence.intent_target_equivalent !== true) {
        reasons.push(`spoken_premise_intent_target_not_equivalent:${eventId}`);
      }
      if (contract.required_semantic_components.includes("temporal_scope")
        && equivalence.temporal_scope_equivalent !== true) {
        reasons.push(`spoken_premise_temporal_scope_not_equivalent:${eventId}`);
      }
      if (contract.required_semantic_components.includes("polarity_or_refusal")
        && equivalence.polarity_equivalent !== true) {
        reasons.push(`spoken_premise_polarity_not_equivalent:${eventId}`);
      }
    }
    const sourceComponents: Array<[string, string]> = [
      ["subject", carrier.source_subject_excerpt],
      ["relation", carrier.source_relation_excerpt],
      ["intent_target", carrier.source_intent_target_excerpt],
    ];
    if (contract.required_semantic_components.includes("temporal_scope")) {
      sourceComponents.push(["temporal_scope", carrier.source_temporal_scope_excerpt]);
    }
    if (contract.required_semantic_components.includes("polarity_or_refusal")) {
      sourceComponents.push(["polarity", carrier.source_polarity_excerpt]);
    }
    for (const [component, excerpt] of sourceComponents) {
      if (!containsNormalizedLiteral(contract.source_spoken_proposition, excerpt)) {
        reasons.push(`spoken_premise_source_${component}_not_literal:${eventId}`);
      }
    }
    if (!materialRelationMatches(carrier.source_relation_excerpt, contract.material_relation)) {
      reasons.push(`spoken_premise_source_relation_changed:${eventId}`);
    }

    const targetComponents: Array<[string, string]> = [
      ["subject", carrier.target_subject_excerpt],
      ["relation", carrier.target_relation_excerpt],
      ["intent_target", carrier.target_intent_target_excerpt],
    ];
    if (contract.required_semantic_components.includes("temporal_scope")) {
      targetComponents.push(["temporal_scope", carrier.target_temporal_scope_excerpt]);
    }
    if (contract.required_semantic_components.includes("polarity_or_refusal")) {
      targetComponents.push(["polarity", carrier.target_polarity_excerpt]);
    }
    for (const [component, excerpt] of targetComponents) {
      if (!containsNormalizedLiteral(carrier.target_clause, excerpt)) {
        reasons.push(`spoken_premise_target_${component}_not_literal:${eventId}`);
      }
    }
    if (!materialRelationMatches(carrier.target_relation_excerpt, contract.material_relation)) {
      reasons.push(`spoken_premise_target_relation_changed:${eventId}`);
    }
    if (!containsNormalizedLiteral(generatedText, carrier.target_clause)) {
      reasons.push(`spoken_premise_target_clause_missing_from_hook:${eventId}`);
    }

    if (!reasons.some((reason) => reason.endsWith(`:${eventId}`))) {
      coveredEventIds.push(eventId);
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    passed: uniqueReasons.length === 0,
    covered_event_ids: [...new Set(coveredEventIds)],
    reasons: uniqueReasons,
  };
}

/** Validates one frozen visual action against one real opening frame. */
export function assessHookVisualActionCarrier(
  carrier: HookVisualActionCarrierItem | null | undefined,
  openingEvidence: any,
  targetLanguage = "pt",
): HookVisualActionCarrierAssessment {
  const reasons: string[] = [];
  if (!carrier) return { passed: false, reasons: ["hook_visual_action_carrier_missing"] };

  const timestamp = Number(carrier.frame_timestamp_seconds);
  const frames = Array.isArray(openingEvidence?.frames) ? openingEvidence.frames : [];
  const frame = Number.isFinite(timestamp)
    ? frames.find((candidate: any) => Math.abs(Number(candidate?.timestamp_seconds) - timestamp) <= 0.001)
    : null;
  if (!frame) reasons.push("hook_visual_action_source_frame_missing");
  const sourceText = [frame?.description, frame?.main_action, frame?.text_on_screen]
    .filter(Boolean)
    .join(" ");
  for (const [component, excerpt] of [
    ["subject", carrier.source_subject_excerpt],
    ["action", carrier.source_action_excerpt],
    ["object_or_state", carrier.source_object_or_state_excerpt],
  ] as const) {
    if (!containsNormalizedLiteral(sourceText, excerpt)) {
      reasons.push(`hook_visual_action_source_${component}_not_literal`);
    }
  }
  for (const [component, excerpt] of [
    ["subject", carrier.target_subject_excerpt],
    ["action", carrier.target_action_excerpt],
    ["object_or_state", carrier.target_object_or_state_excerpt],
  ] as const) {
    if (!containsNormalizedLiteral(carrier.target_clause, excerpt)) {
      reasons.push(`hook_visual_action_target_${component}_not_literal`);
    }
  }
  if (!String(carrier.target_clause || "").trim()) reasons.push("hook_visual_action_target_clause_missing");
  const normalizedTargetSubject = normalizeGuardWords(carrier.target_subject_excerpt);
  const targetLanguageBase = String(targetLanguage || "pt").toLocaleLowerCase().split(/[-_]/u)[0];
  const grammaticalSubjectOpeners: Record<string, ReadonlySet<string>> = {
    pt: new Set(["o", "a", "os", "as", "um", "uma", "ele", "ela", "eles", "elas", "isso", "isto", "esse", "essa", "este", "esta", "aquele", "aquela"]),
    en: new Set(["the", "a", "an", "he", "she", "it", "they", "this", "that", "these", "those"]),
    es: new Set(["el", "la", "los", "las", "un", "una", "el", "ella", "ellos", "ellas", "eso", "esto", "ese", "esa", "este", "esta", "aquel", "aquella"]),
  };
  const allowedSubjectOpeners = grammaticalSubjectOpeners[targetLanguageBase]
    || grammaticalSubjectOpeners.pt;
  if (normalizedTargetSubject.length === 0
    || !allowedSubjectOpeners.has(normalizedTargetSubject[0])) {
    reasons.push("hook_visual_action_target_subject_not_standalone");
  }
  if (assessHookOpenLoopStructure(carrier.target_clause).has_open_loop_marker) {
    reasons.push("hook_visual_action_carrier_contains_open_loop");
  }
  const uniqueReasons = [...new Set(reasons)];
  return { passed: uniqueReasons.length === 0, reasons: uniqueReasons };
}

function hookLoopScaffoldingTerm(word: string): boolean {
  return HOOK_LOOP_SCAFFOLDING_WORDS.has(word)
    || HOOK_LOOP_SCAFFOLDING_PREFIXES.some((prefix) => word.startsWith(prefix));
}

function frozenHookLexemeStem(word: string): string {
  const suffixes = [
    "ariamos", "eriamos", "iriamos", "ariam", "eriam", "iriam", "ando", "endo", "indo",
    "ados", "adas", "idos", "idas", "avam", "iam", "ado", "ada", "ido", "ida", "ou", "eu", "iu",
  ];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, -suffix.length);
    }
  }
  if (word.endsWith("s") && word.length > 5) return word.slice(0, -1);
  return word;
}

/**
 * Keeps the model-written curiosity gap inside the immutable 0-5s facts.
 * Every content-bearing term in the loop must already exist in a frozen
 * spoken/visual clause (allowing only conservative inflection matching).
 * Neutral question scaffolding is the sole exception. This makes later-story
 * leakage fail closed even when it is phrased as a question.
 */
export function assessFrozenHookLoopGrounding(
  frozenClauses: readonly string[],
  loopClause: string,
): FrozenHookLoopGroundingAssessment {
  const frozenWords = normalizeGuardWords(
    (Array.isArray(frozenClauses) ? frozenClauses : []).join(" "),
  ).filter((word) => word.length > 2);
  const frozenStems = new Set(frozenWords.map(frozenHookLexemeStem));
  const loopWords = normalizeGuardWords(loopClause);
  const unsupportedTerms = [...new Set(loopWords.filter((word) =>
    word.length > 2
    && !CONTENT_STOPWORDS.has(word)
    && !hookLoopScaffoldingTerm(word)
    && !frozenWords.includes(word)
    && !frozenStems.has(frozenHookLexemeStem(word))
  ))];
  const normalizedLoop = loopWords.join(" ");
  const causalWhyQuestion = /^(?:por que|porque|why|por que)\b/u.test(normalizedLoop);
  const hasUnansweredDimension = /\b(?:ate onde|quanto|quando|onde|poderia|levaria|chegaria|terminaria|sera que|how far|how long|what if|where|when|could|would|hasta donde|cuanto|cuando|donde|podria|llevaria|llegaria|terminaria)\b/u
    .test(normalizedLoop);
  const reasons = [
    ...(frozenWords.length === 0 ? ["hook_loop_frozen_facts_missing"] : []),
    ...(String(loopClause || "").trim() ? [] : ["hook_loop_clause_missing"]),
    ...(unsupportedTerms.length > 0 ? ["hook_loop_adds_unfrozen_story_terms"] : []),
    ...(causalWhyQuestion ? ["hook_loop_causal_why_presupposition"] : []),
    ...(!hasUnansweredDimension ? ["hook_loop_unanswered_dimension_missing"] : []),
  ];
  return {
    passed: reasons.length === 0,
    unsupported_terms: unsupportedTerms,
    reasons,
  };
}

/**
 * Deterministically assembles immutable spoken/visual clauses with a loop-only
 * model result. The model can never rewrite either factual clause because it
 * does not return generated_text.
 */
export function composeFrozenHookClauses(options: {
  spokenClauses: readonly string[];
  visualActionClause: string;
  loopClause: string;
  targetLanguage?: string;
}): string {
  const spoken = (Array.isArray(options.spokenClauses) ? options.spokenClauses : [])
    .map((clause) => String(clause || "").trim().replace(/[.!?;:,]+$/u, ""))
    .filter(Boolean);
  const visual = String(options.visualActionClause || "").trim().replace(/[.!?;:,]+$/u, "");
  const loop = String(options.loopClause || "").trim().replace(/^[;:,\s]+/u, "");
  if (!visual || !loop || !/\?$/u.test(loop)) return "";
  const factualClauses = [...spoken, visual];
  const punctuatedFacts = factualClauses.map((clause) =>
    clause.charAt(0).toLocaleUpperCase() + clause.slice(1)
  );
  return `${punctuatedFacts.join(". ")}; ${loop}`.trim();
}

function hasAbstractStateReplacement(value: unknown): boolean {
  const text = normalizeGuardWords(String(value || "")).join(" ");
  return /\b(?:inercia|preguica|vagabundagem|atitude|comportamento|jeito|estilo|condicao)\b/u.test(text);
}

/**
 * Deterministic, fail-closed backstop for video hooks.
 *
 * A hook is allowed to create an open loop, but its concrete story facts must
 * come from the real 0-5 second evidence.  In particular, a later consequence
 * cannot be pulled into the opening merely because it is true somewhere else
 * in the video.  The semantic judge performs the richer paraphrase check; this
 * guard catches the high-risk, unambiguous summary patterns before a draft can
 * reach that judge or be promoted with stale metadata.
 */
export function assessHookFirstWindowGrounding(
  generatedText: string,
  openingEvidence: any,
): HookFirstWindowGroundingAssessment {
  const reasons: string[] = [];
  const text = String(generatedText || "").trim();
  const normalizedText = normalizeGuardWords(text).join(" ");
  const frames = Array.isArray(openingEvidence?.frames)
    ? openingEvidence.frames
    : Array.isArray(openingEvidence?.visual_facts)
    ? openingEvidence.visual_facts
    : [];
  const transcript = Array.isArray(openingEvidence?.transcript_support)
    ? openingEvidence.transcript_support
    : [];
  const rangeStart = finiteNumber(openingEvidence?.time_range?.start);
  const rangeEnd = finiteNumber(openingEvidence?.time_range?.end);
  const timestamps = frames
    .map((frame: any) => finiteNumber(frame?.timestamp_seconds))
    .filter((value: number | null): value is number => value !== null);
  const openingWindowValid = openingEvidence?.method !== "insufficient"
    && frames.length > 0
    && timestamps.length === frames.length
    && (rangeStart === null || rangeStart >= 0)
    && (rangeEnd === null
      || rangeEnd <= HOOK_OPENING_END_SECONDS + HOOK_OPENING_BOUNDARY_EPSILON_SECONDS)
    && timestamps.every((timestamp: number) => timestamp >= 0
      && timestamp <= HOOK_OPENING_END_SECONDS + HOOK_OPENING_BOUNDARY_EPSILON_SECONDS);

  const evidenceFacts = [
    ...frames.flatMap((frame: any) => [frame?.description, frame?.main_action, frame?.text_on_screen]),
    ...transcript.map((segment: any) => segment?.text),
  ].map((value) => String(value || "").trim()).filter((value) => value.length >= 3);
  const normalizedEvidenceText = normalizeGuardWords(evidenceFacts.join(" ")).join(" ");
  if (!text) reasons.push("hook_text_missing");
  if (!openingWindowValid || evidenceFacts.length === 0) reasons.push("opening_evidence_missing");
  // Require one real opening frame to contain the complete physical mechanism.
  // Concatenating "sliding" from one frame with "stairs" from another can
  // otherwise fabricate a visually plausible but nonexistent action.
  const claimsSlidingStairs = hasSlidingStairsMechanism(text);
  const openingShowsSlidingStairs = frames.some((frame: any) => hasSlidingStairsMechanism([
    frame?.description,
    frame?.main_action,
    frame?.text_on_screen,
  ].filter(Boolean).join(" ")));
  if (claimsSlidingStairs && !openingShowsSlidingStairs) {
    reasons.push("opening_stair_slide_not_grounded");
  }
  // Visual-first does not mean replacing the first spoken premise. When the
  // real 0-5s narration explicitly says the subject wants to remain lying or
  // refuses to get up, the hook must preserve that state/intent while it may
  // also add a same-window visual action.
  const firstOpeningTranscript = transcript
    .map((segment: any) => String(segment?.text || "").trim())
    .find(Boolean) || "";
  const openingStatesDayLyingDesire = hasExplicitDayLyingDesire(firstOpeningTranscript);
  const spokenStateOrIntentPreserved = openingStatesDayLyingDesire
    ? hasExplicitDayLyingDesire(text)
    : hasExplicitStayLyingIntent(text);
  if (hasExplicitStayLyingIntent(firstOpeningTranscript)
    && !spokenStateOrIntentPreserved) {
    reasons.push("opening_spoken_state_or_intent_distorted");
  }
  // Material intent is a proposition, not tone. A visual action plus an
  // abstract label (for example "inertia" or "attitude") cannot replace that
  // the narrator explicitly said the subject wanted, preferred, refused or
  // decided something. This rule is subject-agnostic and uses the real opening
  // transcript; no topic/title metadata can satisfy it.
  if (hasExplicitMaterialIntent(firstOpeningTranscript)
    && !hasExplicitMaterialIntent(text)) {
    reasons.push("opening_spoken_material_intent_omitted");
    if (hasAbstractStateReplacement(text)) {
      reasons.push("opening_spoken_premise_replaced_by_abstraction");
    }
  }
  const openLoopStructure = assessHookOpenLoopStructure(text);
  if (GENERIC_HOOK_META_PATTERN.test(normalizedText)) reasons.push("generic_meta_teaser");
  reasons.push(...openLoopStructure.reasons);
  // "Qual o risco desse avião/teste/documento?" sounds concrete because it
  // repeats a visible noun, but it invents danger when the opening only shows
  // an ordinary object. Require an actual local danger/injury mechanism before
  // allowing this detached risk template. Action-grounded questions such as a
  // visibly bloody surgery remain valid, while the Writer must choose a real
  // unresolved link (ownership, identity, cause or consequence) for neutral
  // objects.
  const detachedRiskQuestion = /\bqual(?: e| o)? risco (?:dess[ea]s?|d[oa]s?) [a-z0-9]+\b/u.test(normalizedText);
  const localRiskMechanism = /\b(?:risco|perigo|ameac\p{L}*|ferid\p{L}*|sangu\p{L}*|arma\p{L}*|queda|cai\p{L}*|fogo|explos\p{L}*|costur\p{L}*|cirurg\p{L}*|descarga|eletrocut\p{L}*|colis\p{L}*|acident\p{L}*|machuc\p{L}*|mort\p{L}*|blood\p{L}*|weapon\p{L}*|fall\p{L}*|fire\p{L}*|stitch\p{L}*|surg\p{L}*|shock\p{L}*|crash\p{L}*|danger\p{L}*|risk\p{L}*)\b/u.test(normalizedEvidenceText);
  if (detachedRiskQuestion && !localRiskMechanism) reasons.push("hook_detached_risk_not_grounded");
  // "Qual o risco dessa criatura/corpo?" is ambiguous about whether the
  // subject poses or suffers danger and does not name a concrete unresolved
  // consequence. Even with a bloody local mechanism, require a natural,
  // factual endurance gap tied to the visible stitched body instead.
  const genericCreatureRiskQuestion = /\bqual(?: e| o)? risco (?:dess[ea]|daquel[ea]) (?:criatura|corpo|animal)\b/u.test(normalizedText);
  if (genericCreatureRiskQuestion) reasons.push("hook_generic_creature_risk_question");
  // Direction-changing body mechanics are high-risk visual hallucinations.
  // A frame may show a muzzle emerging from a mouth while the transcript says
  // the animal put on a skin; neither supports the opposite claim that the
  // animal entered/crawled into the mouth. Only accept that mechanism when an
  // opening fact itself contains the same inward action.
  const inwardBodyMechanism = /\b(?:entr\p{L}*|penetr\p{L}*|invad\p{L}*|rastej\p{L}* para dentro|crawl\p{L}* into|go\p{L}* inside|went inside|enter\p{L}*|se met\p{L}*)\b.{0,56}\b(?:boca|mouth|ouvido|ear|corpo|body|pele|skin)\b/u;
  if (inwardBodyMechanism.test(normalizedText) && !inwardBodyMechanism.test(normalizedEvidenceText)) {
    reasons.push("opening_physical_direction_contradicted");
  }

  const evidenceWords = new Set(normalizeGuardWords(evidenceFacts.join(" ")));
  // These words express an unanswered open loop, not an asserted video fact.
  // They must remain available so a grounded hook can still generate tension.
  const openLoopScaffolding = new Set([
    "ainda", "faltava", "descobrir", "imaginar", "imaginava", "saber", "sabia",
    "onde", "quanto", "conseguiria", "poderia", "provocaria", "causaria", "aconteceria",
    "aguentar", "aguentaria", "resistir", "resistiria",
    "misterio", "segredo", "parecer", "seem", "discover", "imagine", "could", "would",
    "what", "how", "far", "todavia", "entretanto",
  ]);
  const generatedContent = normalizeGuardWords(text)
    .filter((word) => word.length > 2 && !CONTENT_STOPWORDS.has(word) && !openLoopScaffolding.has(word));
  const unsupported = [...new Set(generatedContent.filter((word) => !evidenceWords.has(word)))];

  // Concrete actions/entities that normally belong to development, reveal or
  // payoff. They are not forbidden vocabulary: they are blocked only when the
  // opening evidence does not contain them. This keeps the guard content-aware.
  const outcomePattern = /^(?:engan\p{L}*|espos\p{L}*|filh\p{L}*|famili\p{L}*|sangu\p{L}*|ensanguent\p{L}*|atac\p{L}*|coleg\p{L}*|revel\p{L}*|focinh\p{L}*|atropel\p{L}*|caminh(?:ao|oes)|morr\p{L}*|mort\p{L}*|mat(?:ou|ar|ava|aram|ando|ado|a|am|e|em|asse)|expuls\p{L}*|prend\p{L}*|salv\p{L}*|destru\p{L}*|cas(?:ou|ar|aram|amento|ada|ado)|empreg\p{L}*|promov\p{L}*|mans\p{L}*|rique\p{L}*|victim\p{L}*|blood\p{L}*|attack\p{L}*|kill\p{L}*|dead\p{L}*|death\p{L}*|truck\p{L}*|wife\p{L}*|daughter\p{L}*|family\p{L}*|deceiv\p{L}*|muert\p{L}*|sangr\p{L}*|espos\p{L}*|hij\p{L}*|famil\p{L}*|atac\p{L}*|camion\p{L}*)$/u;
  const unsupportedOutcomeTerms = unsupported.filter((word) => outcomePattern.test(word));
  const explicitLateBridge = /\b(?:depois|entao|mais tarde|no final|por fim|ate que|eventualmente|para|porque|pois|after|then|later|in the end|eventually|to|because|despues|entonces|al final|hasta que|para|porque)\b/u.test(normalizedText);
  const terminalOutcome = unsupportedOutcomeTerms.some((word) => /^(?:atropel|caminh(?:ao|oes)|morr|mort|mat(?:ou|ar|ava|aram|ando|ado|a|am|e|em|asse)|kill|dead|death|truck|muert|camion)/u.test(word));
  const denseOutcomeSummary = unsupportedOutcomeTerms.length >= 2;
  if (unsupportedOutcomeTerms.length > 0 && (explicitLateBridge || terminalOutcome || denseOutcomeSummary)) {
    reasons.push("late_outcome_summary");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    passed: uniqueReasons.length === 0,
    blocked: uniqueReasons.length > 0,
    generated_text_fingerprint: textGuardFingerprint(text),
    opening_window_valid: openingWindowValid,
    evidence_fact_count: evidenceFacts.length,
    unsupported_outcome_terms: unsupportedOutcomeTerms,
    reasons: uniqueReasons,
  };
}

export function visualEvidenceScore(frame: any): number {
  // `surprise_score` is produced directly by the multimodal reference-video
  // analysis (0-100) and is the primary signal for the visual-first hook.
  const numeric = Number(frame?.surprise_score ?? frame?.visual_intensity_score ?? frame?.intensity_score ?? frame?.importance_score);
  const text = `${frame?.description || ""} ${frame?.main_action || ""} ${frame?.scene_type || ""} ${frame?.emotional_tone || ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let score = Number.isFinite(numeric) ? numeric : 0;
  for (const keyword of ["choque", "absurd", "surpre", "inesper", "perigo", "transform", "explos", "cai", "ataca", "engole", "revela", "shocking", "unexpected"]) {
    if (text.includes(keyword)) score += 12;
  }
  if (["action", "transition", "graphic", "acao"].includes(String(frame?.scene_type || "").toLowerCase())) score += 5;
  return score;
}

export interface VisualEvidenceSelection {
  frames: any[];
  method: "opening_hook" | "slot_timestamps" | "structural_phase_intersection" | "structural_window" | "narrative_phase" | "visual_anchor" | "expected_position" | "uniform_fallback" | "insufficient";
  time_range: { start: number; end: number } | null;
  fallback_used: boolean;
  reason: string | null;
  partition_fingerprint?: string | null;
  partition_mode?: CanonicalEvidencePartitionMode | null;
}

export type CanonicalEvidencePartitionMode =
  | "transcript_boundaries"
  | "uniform_no_transcript"
  | "uniform_insufficient_transcript";

export interface CanonicalEvidencePartition {
  contract_version: 1;
  mode: CanonicalEvidencePartitionMode;
  duration_seconds: number;
  hook_end_seconds: number;
  boundaries: number[];
  ranges: Array<{ start: number; end: number }>;
  fingerprint: string;
}

export interface VisualTimelineSelection extends VisualEvidenceSelection {
  slot_index?: number | string | null;
  slot_type?: string | null;
}

export type VisualTimelineViolationReason =
  | "time_range_missing"
  | "time_range_invalid"
  | "time_range_gap"
  | "time_range_overlap"
  | "time_range_start_regressed"
  | "time_range_end_regressed"
  | "timeline_start_not_zero"
  | "hook_time_range_invalid"
  | "timeline_end_mismatch";

export interface VisualTimelineViolation {
  selection_index: number;
  slot_index: number | string;
  slot_type: string | null;
  reason: VisualTimelineViolationReason;
  time_range: { start: number; end: number } | null;
  previous_selection_index: number | null;
  previous_time_range: { start: number; end: number } | null;
}

export interface VisualTimelineAssessment {
  passed: boolean;
  checked_ranges: number;
  violations: VisualTimelineViolation[];
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Assigns every transcript segment to a single structural slot. Overlap-based
 * filtering duplicated boundary events and could leak words spoken after 5s
 * into the hook. Midpoint ownership avoids duplication; the opening is even
 * stricter and accepts only segments fully contained in 0-5s.
 */
export function selectTranscriptSupportForRange(
  segments: any[],
  range: { start: number; end: number } | null | undefined,
  options: { openingHook?: boolean; finalSlot?: boolean; limit?: number } = {},
): any[] {
  const start = Number(range?.start);
  const end = Number(range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const epsilon = 0.001;
  return (Array.isArray(segments) ? segments : [])
    .map((segment, sourceIndex) => ({
      segment,
      sourceIndex,
      start: Number(segment?.start),
      end: Number(segment?.end),
    }))
    .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end >= entry.start)
    .filter((entry) => {
      if (options.openingHook === true) {
        return entry.start >= start - epsilon
          && entry.end <= Math.min(HOOK_OPENING_END_SECONDS, end) + epsilon;
      }
      const midpoint = (entry.start + entry.end) / 2;
      return midpoint >= start - epsilon
        && (options.finalSlot === true ? midpoint <= end + epsilon : midpoint < end - epsilon);
    })
    .sort((left, right) => left.start - right.start || left.sourceIndex - right.sourceIndex)
    .slice(0, Math.max(1, options.limit ?? 24))
    .map((entry) => entry.segment);
}

function slotAliases(slotType: string): string[] {
  const aliases: Record<string, string[]> = {
    hook: ["hook", "opening", "abertura", "inicio"],
    setup: ["setup", "opening", "context", "introducao"],
    desenvolvimento: ["desenvolvimento", "development", "middle", "progressao"],
    tensao: ["tensao", "tension", "climax", "escalada"],
    revelacao: ["revelacao", "reveal", "twist", "climax", "virada"],
    payoff: ["payoff", "resolution", "resolucao", "ending", "desfecho"],
    transicao: ["transicao", "transition"],
    loop: ["loop", "ending", "fechamento"],
  };
  return aliases[slotType] || [slotType];
}

function matchingNarrativeRange(slotType: string, topicAnalysis: any): { start: number; end: number } | null {
  const aliases = slotAliases(slotType);
  const phases = Array.isArray(topicAnalysis?.narrative_progression) ? topicAnalysis.narrative_progression : [];
  const matches = phases.filter((phase: any) => {
    const label = normalizeGuardWords(`${phase?.phase || ""} ${phase?.narrative_role || ""}`).join(" ");
    return aliases.some(alias => label.includes(alias));
  }).map((phase: any) => ({
    start: finiteNumber(phase?.timestamp_start, phase?.start_seconds, phase?.start),
    end: finiteNumber(phase?.timestamp_end, phase?.end_seconds, phase?.end),
  })).filter((range: any) => range.start !== null && range.end !== null && range.end > range.start);
  if (matches.length === 0) return null;
  return {
    start: Math.min(...matches.map((range: any) => range.start as number)),
    end: Math.max(...matches.map((range: any) => range.end as number)),
  };
}

function framesInRange(
  usable: any[],
  range: { start: number; end: number },
  limit: number,
  options: { includeEnd?: boolean; excludeStart?: boolean } = {},
): any[] {
  const epsilon = 1e-6;
  return usable
    .filter((frame) => {
      const afterStart = options.excludeStart === true
        ? frame.timestamp_seconds > range.start + epsilon
        : frame.timestamp_seconds >= range.start - epsilon;
      const beforeEnd = options.includeEnd === true
        ? frame.timestamp_seconds <= range.end + epsilon
        : frame.timestamp_seconds < range.end - epsilon;
      return afterStart && beforeEnd;
    })
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
    .slice(0, limit);
}

function intersectTimeRanges(
  left: { start: number; end: number },
  right: { start: number; end: number },
): { start: number; end: number } | null {
  const range = {
    start: Math.max(left.start, right.start),
    end: Math.min(left.end, right.end),
  };
  return range.end > range.start ? range : null;
}

function structuralTimeRange(
  slotPosition: number,
  totalSlots: number,
  durationSeconds: number,
): { start: number; end: number } | null {
  if (
    !Number.isInteger(slotPosition)
    || !Number.isInteger(totalSlots)
    || slotPosition < 0
    || totalSlots <= 0
    || slotPosition >= totalSlots
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
  ) {
    return null;
  }
  return {
    start: (slotPosition / totalSlots) * durationSeconds,
    end: ((slotPosition + 1) / totalSlots) * durationSeconds,
  };
}

function canonicalTimestamp(value: number): number {
  return Number(value.toFixed(6));
}

function compareNumberPaths(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (Math.abs(left[index] - right[index]) <= 1e-9) continue;
    return left[index] < right[index] ? -1 : 1;
  }
  return left.length - right.length;
}

function visualTransitionScore(frames: any[], boundary: number): number {
  const usable = (Array.isArray(frames) ? frames : [])
    .filter((frame) => typeof frame?.description === "string" && frame.description.trim().length >= 4)
    .map((frame) => ({
      timestamp: Number(frame?.timestamp_seconds),
      sceneType: normalizeGuardWords(String(frame?.scene_type || "")).join(" "),
      action: normalizeGuardWords(String(frame?.main_action || "")).join(" "),
      words: new Set(normalizeGuardWords([
        frame?.description,
        frame?.main_action,
        frame?.scene_type,
        frame?.visual_elements,
      ].filter(Boolean).join(" "))),
    }))
    .filter((frame) => Number.isFinite(frame.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  const before = [...usable].reverse().find((frame) => frame.timestamp < boundary - 1e-6);
  const after = usable.find((frame) => frame.timestamp >= boundary - 1e-6);
  if (!before || !after) return 0;
  const union = new Set([...before.words, ...after.words]);
  let intersection = 0;
  for (const word of before.words) {
    if (after.words.has(word)) intersection++;
  }
  const semanticShift = union.size > 0 ? 1 - (intersection / union.size) : 0;
  const sceneShift = before.sceneType && after.sceneType && before.sceneType !== after.sceneType ? 0.5 : 0;
  const actionShift = before.action && after.action && before.action !== after.action ? 0.25 : 0;
  return semanticShift + sceneShift + actionShift;
}

/**
 * Builds one deterministic partition for every video consumer. The hook owns
 * the real 0-5s opening. Post-hook boundaries snap only to transcript segment
 * edges that do not cut any other segment; visual transitions break exact
 * distance ties but can never move a boundary into spoken evidence.
 */
export function buildCanonicalEvidencePartition(options: {
  totalSlots: number;
  durationSeconds: number;
  transcriptionSegments?: any[];
  visualFrames?: any[];
}): CanonicalEvidencePartition | null {
  const totalSlots = Math.trunc(Number(options.totalSlots));
  const duration = canonicalTimestamp(Number(options.durationSeconds));
  if (!Number.isInteger(totalSlots) || totalSlots <= 0 || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  if (totalSlots === 1) {
    const boundaries = [0, duration];
    return {
      contract_version: 1,
      mode: "uniform_no_transcript",
      duration_seconds: duration,
      hook_end_seconds: Math.min(HOOK_OPENING_END_SECONDS, duration),
      boundaries,
      ranges: [{ start: 0, end: duration }],
      fingerprint: `partition:${textGuardFingerprint(`v1|uniform_no_transcript|${duration}|1|${boundaries.join(",")}`)}`,
    };
  }
  // More than one positive-width slot cannot coexist with a full 0-5s hook
  // when the media itself ends at or before five seconds.
  if (duration <= HOOK_OPENING_END_SECONDS) return null;

  const hookEnd = HOOK_OPENING_END_SECONDS;
  const postHookSlots = totalSlots - 1;
  const requiredInternalBoundaries = Math.max(0, postHookSlots - 1);
  const transcript = (Array.isArray(options.transcriptionSegments) ? options.transcriptionSegments : [])
    .map((segment, sourceIndex) => ({
      sourceIndex,
      start: canonicalTimestamp(Number(segment?.start)),
      end: canonicalTimestamp(Number(segment?.end)),
      text: String(segment?.text || "").trim(),
    }))
    .filter((segment) => Number.isFinite(segment.start)
      && Number.isFinite(segment.end)
      && segment.end > segment.start
      && segment.text.length > 0
      && segment.end > hookEnd
      && segment.start < duration)
    .map((segment) => ({
      ...segment,
      start: Math.max(0, segment.start),
      end: Math.min(duration, segment.end),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.sourceIndex - right.sourceIndex);
  const hasTranscript = transcript.length > 0;
  const rawCandidates = transcript.flatMap((segment) => [segment.start, segment.end]);
  const candidates = [...new Set(rawCandidates
    .map(canonicalTimestamp)
    .filter((timestamp) => timestamp > hookEnd + 1e-6 && timestamp < duration - 1e-6)
    .filter((timestamp) => !transcript.some((segment) =>
      segment.start < timestamp - 1e-6 && segment.end > timestamp + 1e-6
    )))]
    .sort((left, right) => left - right);

  let selected: number[] | null = null;
  if (requiredInternalBoundaries === 0) {
    selected = [];
  } else if (candidates.length >= requiredInternalBoundaries) {
    type State = { distance: number; visual: number; path: number[] };
    let previous = new Map<number, State>();
    for (let ordinal = 0; ordinal < requiredInternalBoundaries; ordinal++) {
      const target = hookEnd + ((ordinal + 1) / postHookSlots) * (duration - hookEnd);
      const current = new Map<number, State>();
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        if (candidateIndex < ordinal) continue;
        if (candidates.length - candidateIndex - 1 < requiredInternalBoundaries - ordinal - 1) continue;
        const candidate = candidates[candidateIndex];
        const localDistance = Math.abs(candidate - target);
        const localVisual = visualTransitionScore(options.visualFrames || [], candidate);
        const predecessors = ordinal === 0
          ? [{ index: -1, state: { distance: 0, visual: 0, path: [] } as State }]
          : [...previous.entries()]
            .filter(([index]) => index < candidateIndex)
            .map(([index, state]) => ({ index, state }));
        for (const predecessor of predecessors) {
          const proposal: State = {
            distance: predecessor.state.distance + localDistance,
            visual: predecessor.state.visual + localVisual,
            path: [...predecessor.state.path, candidate],
          };
          const incumbent = current.get(candidateIndex);
          const better = !incumbent
            || proposal.distance < incumbent.distance - 1e-9
            || (Math.abs(proposal.distance - incumbent.distance) <= 1e-9
              && (proposal.visual > incumbent.visual + 1e-9
                || (Math.abs(proposal.visual - incumbent.visual) <= 1e-9
                  && compareNumberPaths(proposal.path, incumbent.path) < 0)));
          if (better) current.set(candidateIndex, proposal);
        }
      }
      previous = current;
    }
    const finalists = [...previous.values()].sort((left, right) =>
      left.distance - right.distance
      || right.visual - left.visual
      || compareNumberPaths(left.path, right.path)
    );
    selected = finalists[0]?.path || null;
  }

  const mode: CanonicalEvidencePartitionMode = selected !== null && hasTranscript
    ? "transcript_boundaries"
    : hasTranscript
    ? "uniform_insufficient_transcript"
    : "uniform_no_transcript";
  const postHookBoundaries = selected || Array.from(
    { length: requiredInternalBoundaries },
    (_, index) => canonicalTimestamp(hookEnd + ((index + 1) / postHookSlots) * (duration - hookEnd)),
  );
  const boundaries = [0, hookEnd, ...postHookBoundaries, duration];
  const ranges = boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] }));
  if (ranges.length !== totalSlots || ranges.some((range) => range.end <= range.start)) return null;
  const transcriptFingerprint = transcript
    .map((segment) => `${segment.sourceIndex}:${segment.start}-${segment.end}`)
    .join(";");
  const fingerprintBasis = `v1|${mode}|${duration}|${totalSlots}|${boundaries.join(",")}|${transcriptFingerprint}`;
  return {
    contract_version: 1,
    mode,
    duration_seconds: duration,
    hook_end_seconds: hookEnd,
    boundaries,
    ranges,
    fingerprint: `partition:${textGuardFingerprint(fingerprintBasis)}`,
  };
}

/**
 * Video hooks own the real 0-5 second opening. The remaining slots must split
 * the rest of the media continuously; partitioning the whole duration again
 * would leave an uncovered strip immediately after the hook and between later
 * blocks (for seven slots: 5-8.1s, 32.4-36s, etc.).
 */
function continuousPostHookTimeRange(
  slotPosition: number,
  totalSlots: number,
  durationSeconds: number,
): { start: number; end: number } | null {
  if (slotPosition <= 0 || totalSlots <= 1 || durationSeconds <= HOOK_OPENING_END_SECONDS) {
    return structuralTimeRange(slotPosition, totalSlots, durationSeconds);
  }
  const remainingSlots = totalSlots - 1;
  const remainingDuration = durationSeconds - HOOK_OPENING_END_SECONDS;
  const postHookPosition = slotPosition - 1;
  return {
    start: HOOK_OPENING_END_SECONDS + (postHookPosition / remainingSlots) * remainingDuration,
    end: HOOK_OPENING_END_SECONDS + ((postHookPosition + 1) / remainingSlots) * remainingDuration,
  };
}

/** Guarda puro da particao temporal: cobertura exata, contigua e sem overlap. */
export function assessVisualEvidenceTimeline(
  selections: VisualTimelineSelection[],
  options: { durationSeconds?: number | null } = {},
): VisualTimelineAssessment {
  const violations: VisualTimelineViolation[] = [];
  let checkedRanges = 0;
  let previous: {
    selectionIndex: number;
    range: { start: number; end: number };
  } | null = null;
  const epsilon = 1e-6;

  (Array.isArray(selections) ? selections : []).forEach((selection, selectionIndex) => {
    const slotIndex = selection?.slot_index ?? selectionIndex;
    const slotType = selection?.slot_type ? String(selection.slot_type) : null;
    const rawRange = selection?.time_range;
    if (!rawRange) {
      violations.push({
        selection_index: selectionIndex,
        slot_index: slotIndex,
        slot_type: slotType,
        reason: "time_range_missing",
        time_range: null,
        previous_selection_index: previous?.selectionIndex ?? null,
        previous_time_range: previous?.range ?? null,
      });
      return;
    }

    const range = { start: Number(rawRange.start), end: Number(rawRange.end) };
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) {
      violations.push({
        selection_index: selectionIndex,
        slot_index: slotIndex,
        slot_type: slotType,
        reason: "time_range_invalid",
        time_range: range,
        previous_selection_index: previous?.selectionIndex ?? null,
        previous_time_range: previous?.range ?? null,
      });
      return;
    }

    checkedRanges++;
    if (!previous && Math.abs(range.start) > epsilon) {
      violations.push({
        selection_index: selectionIndex,
        slot_index: slotIndex,
        slot_type: slotType,
        reason: "timeline_start_not_zero",
        time_range: range,
        previous_selection_index: null,
        previous_time_range: null,
      });
    }
    if (!previous && slotType === "hook") {
      const duration = finiteNumber(options.durationSeconds);
      const expectedHookEnd = Math.min(
        HOOK_OPENING_END_SECONDS,
        duration !== null && duration > 0 ? duration : HOOK_OPENING_END_SECONDS,
      );
      if (Math.abs(range.start) > epsilon || Math.abs(range.end - expectedHookEnd) > epsilon) {
        violations.push({
          selection_index: selectionIndex,
          slot_index: slotIndex,
          slot_type: slotType,
          reason: "hook_time_range_invalid",
          time_range: range,
          previous_selection_index: null,
          previous_time_range: null,
        });
      }
    }
    if (previous && range.start - previous.range.end > epsilon) {
      violations.push({
        selection_index: selectionIndex,
        slot_index: slotIndex,
        slot_type: slotType,
        reason: "time_range_gap",
        time_range: range,
        previous_selection_index: previous.selectionIndex,
        previous_time_range: previous.range,
      });
    }
    if (previous && previous.range.end - range.start > epsilon) {
      violations.push({
        selection_index: selectionIndex,
        slot_index: slotIndex,
        slot_type: slotType,
        reason: "time_range_overlap",
        time_range: range,
        previous_selection_index: previous.selectionIndex,
        previous_time_range: previous.range,
      });
    }
    if (previous && range.start + epsilon < previous.range.start) {
      violations.push({
        selection_index: selectionIndex,
        slot_index: slotIndex,
        slot_type: slotType,
        reason: "time_range_start_regressed",
        time_range: range,
        previous_selection_index: previous.selectionIndex,
        previous_time_range: previous.range,
      });
    }
    if (previous && range.end + epsilon < previous.range.end) {
      violations.push({
        selection_index: selectionIndex,
        slot_index: slotIndex,
        slot_type: slotType,
        reason: "time_range_end_regressed",
        time_range: range,
        previous_selection_index: previous.selectionIndex,
        previous_time_range: previous.range,
      });
    }
    previous = { selectionIndex, range };
  });

  const duration = finiteNumber(options.durationSeconds);
  if (previous && duration !== null && duration > 0 && Math.abs(previous.range.end - duration) > epsilon) {
    const lastSelection = selections[previous.selectionIndex];
    violations.push({
      selection_index: previous.selectionIndex,
      slot_index: lastSelection?.slot_index ?? previous.selectionIndex,
      slot_type: lastSelection?.slot_type ? String(lastSelection.slot_type) : null,
      reason: "timeline_end_mismatch",
      time_range: previous.range,
      previous_selection_index: previous.selectionIndex > 0 ? previous.selectionIndex - 1 : null,
      previous_time_range: previous.selectionIndex > 0
        ? selections[previous.selectionIndex - 1]?.time_range || null
        : null,
    });
  }

  return {
    passed: violations.length === 0,
    checked_ranges: checkedRanges,
    violations,
  };
}

export function resolveVisualEvidenceForSlot(
  frames: any[],
  slot: any,
  slotPosition: number,
  totalSlots: number,
  options: {
    topicAnalysis?: any;
    durationSeconds?: number | null;
    transcriptionSegments?: any[];
    canonicalPartition?: CanonicalEvidencePartition | null;
    limit?: number;
    allowUniformFallback?: boolean;
  } = {},
): VisualEvidenceSelection {
  const slotType = String(slot?.slot_type || slot || "").trim().toLowerCase();
  const limit = options.limit ?? 6;
  const described = (Array.isArray(frames) ? frames : [])
    .filter(frame => typeof frame?.description === "string" && frame.description.trim().length >= 4);
  if (described.length === 0) {
    return { frames: [], method: "insufficient", time_range: null, fallback_used: false, reason: "no_usable_frame_descriptions" };
  }
  const usable = described
    .map(frame => ({ ...frame, timestamp_seconds: Number(frame.timestamp_seconds) }))
    .filter(frame => Number.isFinite(frame.timestamp_seconds) && frame.timestamp_seconds >= 0);
  if (usable.length === 0) {
    return { frames: [], method: "insufficient", time_range: null, fallback_used: false, reason: "no_usable_frame_timestamps" };
  }
  const explicitStart = finiteNumber(slot?.start_seconds, slot?.timestamp_start, slot?.time_start, slot?.tempo_inicio);
  const explicitEnd = finiteNumber(slot?.end_seconds, slot?.timestamp_end, slot?.time_end, slot?.tempo_fim);
  const duration = finiteNumber(options.durationSeconds, Math.max(...usable.map(frame => frame.timestamp_seconds)));
  const canonicalPartition = options.canonicalPartition || (
    Array.isArray(options.transcriptionSegments) && duration !== null
      ? buildCanonicalEvidencePartition({
        totalSlots,
        durationSeconds: duration,
        transcriptionSegments: options.transcriptionSegments,
        visualFrames: usable,
      })
      : null
  );
  const canonicalRange = canonicalPartition?.ranges?.[slotPosition] || null;
  if (slotType === "hook") {
    // O gancho precisa nascer do que o espectador realmente ve nos primeiros
    // cinco segundos. O restante do video pode esclarecer o contexto dessa
    // acao em outra camada, mas nunca substituir a ancora visual da abertura.
    // Dentro da janela ainda priorizamos surpresa multimodal e devolvemos os
    // frames selecionados em ordem cronologica.
    const openingEnd = Math.min(
      HOOK_OPENING_END_SECONDS,
      duration !== null && duration > 0 ? duration : HOOK_OPENING_END_SECONDS,
    );
    // Slot metadata commonly says that narration lasts 3-4s, but factual hook
    // grounding is always audited against the complete 0-5s opening window.
    // Keeping this range fixed also makes the following partition continuous.
    const range = { start: 0, end: openingEnd };
    if (range.end <= range.start) {
      return {
        frames: [],
        method: "insufficient",
        time_range: range,
        fallback_used: false,
        reason: "hook_timestamp_range_outside_opening",
      };
    }
    const openingFrames = usable.filter(frame => frame.timestamp_seconds >= range.start && frame.timestamp_seconds <= range.end);
    if (openingFrames.length === 0) {
      return {
        frames: [],
        method: "insufficient",
        time_range: range,
        fallback_used: false,
        reason: "opening_window_has_no_frames",
      };
    }
    const selected = openingFrames
      .map((frame, index) => ({ frame, index, score: visualEvidenceScore(frame) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map(candidate => candidate.frame)
      .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
    return {
      frames: selected,
      method: "opening_hook",
      time_range: range,
      fallback_used: false,
      reason: null,
      partition_fingerprint: canonicalPartition?.fingerprint || null,
      partition_mode: canonicalPartition?.mode || null,
    };
  }

  if (!canonicalRange && explicitStart !== null && explicitEnd !== null && explicitEnd > explicitStart) {
    const range = { start: explicitStart, end: explicitEnd };
    const selected = framesInRange(usable, range, limit, { includeEnd: slotPosition === totalSlots - 1 });
    return selected.length > 0
      ? { frames: selected, method: "slot_timestamps", time_range: range, fallback_used: false, reason: null }
      : { frames: [], method: "insufficient", time_range: range, fallback_used: false, reason: "slot_timestamp_range_has_no_frames" };
  }

  const narrativeRange = matchingNarrativeRange(slotType, options.topicAnalysis);
  const structuralRange = canonicalRange || (duration !== null
    ? continuousPostHookTimeRange(slotPosition, totalSlots, duration)
    : null);
  // Topic timestamps are model estimates and commonly round the resolution
  // down to the previous whole second. For the final payoff/loop slot, the
  // real media duration is authoritative: never discard a persisted ending
  // frame merely because a semantic phase ended a fraction of a second early.
  const effectiveNarrativeRange = narrativeRange
    && duration !== null
    && slotPosition === totalSlots - 1
    && ["payoff", "loop"].includes(slotType)
    ? { start: narrativeRange.start, end: Math.max(narrativeRange.end, duration) }
    : narrativeRange;
  if (options.allowUniformFallback === true && structuralRange) {
    // Nao ha prova de cobertura por slot quando existem menos frames do que
    // slots. Falhamos fechado em vez de reutilizar uma mesma fase ampla.
    if (usable.length < totalSlots) {
      return {
        frames: [],
        method: "insufficient",
        time_range: structuralRange,
        fallback_used: false,
        reason: "structural_frame_coverage_insufficient",
      };
    }

    // Topic phases are approximate and often round or omit a complete event.
    // Keep the full continuous structural slice as the factual boundary; the
    // semantic phase may guide prose, but must never shrink evidence coverage.
    const selected = framesInRange(usable, structuralRange, limit, {
      includeEnd: slotPosition === totalSlots - 1,
      excludeStart: slotPosition === 1
        && Math.abs(structuralRange.start - HOOK_OPENING_END_SECONDS) <= 1e-6,
    });
    return selected.length > 0
      ? {
        frames: selected,
        method: "structural_window",
        time_range: structuralRange,
        fallback_used: canonicalPartition ? canonicalPartition.mode !== "transcript_boundaries" : false,
        reason: null,
        partition_fingerprint: canonicalPartition?.fingerprint || null,
        partition_mode: canonicalPartition?.mode || null,
      }
      : {
        frames: [],
        method: "insufficient",
        time_range: structuralRange,
        fallback_used: canonicalPartition ? canonicalPartition.mode !== "transcript_boundaries" : false,
        reason: "structural_window_has_no_frames",
        partition_fingerprint: canonicalPartition?.fingerprint || null,
        partition_mode: canonicalPartition?.mode || null,
      };
  }

  if (effectiveNarrativeRange) {
    const selected = framesInRange(usable, effectiveNarrativeRange, limit, { includeEnd: slotPosition === totalSlots - 1 });
    return selected.length > 0
      ? { frames: selected, method: "narrative_phase", time_range: effectiveNarrativeRange, fallback_used: false, reason: null }
      : { frames: [], method: "insufficient", time_range: effectiveNarrativeRange, fallback_used: false, reason: "narrative_phase_has_no_frames" };
  }

  const aliases = slotAliases(slotType);
  const anchors = (Array.isArray(options.topicAnalysis?.visual_anchor_points) ? options.topicAnalysis.visual_anchor_points : [])
    .filter((anchor: any) => {
      const role = normalizeGuardWords(anchor?.narrative_role || "").join(" ");
      return aliases.some(alias => role.includes(alias));
    });
  if (anchors.length > 0) {
    const anchorTimes = anchors.map((anchor: any) => finiteNumber(anchor?.timestamp_seconds)).filter((value: any) => value !== null) as number[];
    if (anchorTimes.length === 0) {
      return { frames: [], method: "insufficient", time_range: null, fallback_used: false, reason: "visual_anchor_without_timestamp" };
    }
    const selected = [...usable]
      .sort((a, b) => Math.min(...anchorTimes.map(time => Math.abs(a.timestamp_seconds - time)))
        - Math.min(...anchorTimes.map(time => Math.abs(b.timestamp_seconds - time))))
      .slice(0, Math.min(limit, Math.max(1, anchorTimes.length * 2)));
    if (selected.length > 0) {
      return { frames: selected, method: "visual_anchor", time_range: null, fallback_used: false, reason: null };
    }
  }

  const expectedPctRaw = finiteNumber(slot?.expected_position_pct);
  if (duration !== null && duration > 0 && expectedPctRaw !== null) {
    const expectedPct = expectedPctRaw > 1 ? expectedPctRaw / 100 : expectedPctRaw;
    const center = Math.max(0, Math.min(1, expectedPct)) * duration;
    const halfWindow = Math.max(1, duration / Math.max(2, totalSlots * 2));
    const range = { start: Math.max(0, center - halfWindow), end: Math.min(duration, center + halfWindow) };
    const selected = framesInRange(usable, range, limit, { includeEnd: slotPosition === totalSlots - 1 });
    return selected.length > 0
      ? { frames: selected, method: "expected_position", time_range: range, fallback_used: false, reason: null }
      : { frames: [], method: "insufficient", time_range: range, fallback_used: false, reason: "expected_position_has_no_frames" };
  }

  // Fallback uniforme é permitido somente quando foi solicitado explicitamente
  // e há pelo menos um frame utilizável por slot. Caso contrário, falha fechado.
  if (options.allowUniformFallback === true && duration !== null && duration > 0 && totalSlots > 0 && usable.length >= totalSlots) {
    const range = {
      start: (slotPosition / totalSlots) * duration,
      end: ((slotPosition + 1) / totalSlots) * duration,
    };
    const selected = framesInRange(usable, range, limit, { includeEnd: slotPosition === totalSlots - 1 });
    if (selected.length > 0) {
      return { frames: selected, method: "uniform_fallback", time_range: range, fallback_used: true, reason: "no_block_level_timestamps" };
    }
  }

  return {
    frames: [],
    method: "insufficient",
    time_range: null,
    fallback_used: false,
    reason: "block_visual_context_insufficient",
  };
}

/** Compatibilidade para consumidores simples e testes. */
export function selectVisualEvidenceForSlot(
  frames: any[],
  slotType: string,
  slotPosition: number,
  totalSlots: number,
  limit = 6,
): any[] {
  return resolveVisualEvidenceForSlot(frames, { slot_type: slotType }, slotPosition, totalSlots, {
    limit,
    allowUniformFallback: true,
  }).frames;
}
