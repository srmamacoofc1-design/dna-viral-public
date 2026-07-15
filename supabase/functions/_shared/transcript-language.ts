export type LexicallyDetectedTranscriptLanguage = "pt" | "es" | "en";

export interface TranscriptLanguageScore {
  language: LexicallyDetectedTranscriptLanguage;
  score: number;
  distinct_markers: number;
}

export interface TranscriptLanguageReconciliation {
  language: string;
  model_language: string;
  lexical_language: LexicallyDetectedTranscriptLanguage | null;
  source: "empty_audio" | "lexical_evidence" | "model";
  scores: TranscriptLanguageScore[];
}

const LANGUAGE_NAME_ALIASES: Record<string, string> = {
  ar: "ar",
  arabic: "ar",
  arabe: "ar",
  chi: "zh",
  chinese: "zh",
  chines: "zh",
  de: "de",
  deu: "de",
  deutsch: "de",
  dutch: "nl",
  en: "en",
  eng: "en",
  english: "en",
  ingles: "en",
  es: "es",
  espanol: "es",
  spanish: "es",
  spa: "es",
  castilian: "es",
  fr: "fr",
  fra: "fr",
  fre: "fr",
  francais: "fr",
  french: "fr",
  ger: "de",
  german: "de",
  hi: "hi",
  hindi: "hi",
  it: "it",
  ita: "it",
  italian: "it",
  italiano: "it",
  ja: "ja",
  japanese: "ja",
  japones: "ja",
  ko: "ko",
  korean: "ko",
  coreano: "ko",
  nl: "nl",
  nederlands: "nl",
  por: "pt",
  portuguese: "pt",
  portugues: "pt",
  pt: "pt",
  ptbr: "pt",
  ru: "ru",
  rus: "ru",
  russian: "ru",
  russo: "ru",
  zh: "zh",
  zho: "zh",
};

const UNKNOWN_LANGUAGE_LABELS = new Set([
  "",
  "auto",
  "indeterminate",
  "none",
  "null",
  "n/a",
  "na",
  "not detected",
  "und",
  "undefined",
  "unknown",
]);

const TOKEN_MARKERS: Record<LexicallyDetectedTranscriptLanguage, ReadonlySet<string>> = {
  pt: new Set([
    "ainda", "aquilo", "chegava", "chegou", "com", "da", "das", "depois",
    "dessa", "desse", "do", "dos", "ela", "ele", "elas", "eles", "enquanto",
    "entao", "ficava", "ficou", "foi", "foram", "homem", "isso", "ja", "lhe",
    "mais", "mesmo", "muito", "mulher", "nao", "nem", "nessa", "nesse",
    "ninguem", "num", "numa", "pela", "pelas", "pelo", "pelos", "pois",
    "porem", "pra", "preguicoso", "quando", "sem", "seu", "sua", "tambem",
    "tinha", "trabalhava", "trabalho", "voce", "voces",
  ]),
  es: new Set([
    "al", "aprovechaba", "arrastrandose", "ascendiendolo", "bailar", "cepillaba",
    "cerrar", "chicas", "cualquier", "cuando", "del", "deslizandose", "despues",
    "dolares", "ellos", "enamorandose", "entonces", "entraba", "escaleras",
    "esto", "estaba", "evitar", "fiesta", "fueron", "ganas", "habia", "hombre",
    "jefe", "llegar", "llego", "levantarse", "mientras", "mujer", "muy",
    "negocios", "ojos", "pantalones", "pero", "perezosa", "ponia", "seguir",
    "siquiera", "sin", "sino", "suelo", "tambien", "tenia", "trabajo", "tren",
    "unas", "unos", "viaje", "volvio",
  ]),
  en: new Set([
    "although", "and", "because", "been", "before", "could", "did", "does",
    "during", "from", "had", "has", "have", "him", "his", "however", "into",
    "its", "never", "only", "should", "since", "than", "that", "their", "them",
    "then", "there", "these", "they", "this", "those", "through", "until", "was",
    "were", "what", "when", "where", "which", "while", "who", "with", "without",
    "would",
  ]),
};

const PHRASE_MARKERS: Record<LexicallyDetectedTranscriptLanguage, readonly string[]> = {
  pt: [
    "a gente", "ao chegar", "do que", "em vez de", "na mesma hora", "nao tinha",
    "por isso", "so que",
  ],
  es: [
    "a la", "a todas las", "al llegar", "de la", "en vez de", "no tenia",
    "por lo que", "todo el",
  ],
  en: [
    "as soon as", "at the", "because of", "did not", "in order to", "instead of",
    "was not",
  ],
};

function foldLanguageText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
}

/**
 * Converts model/provider labels to a stable base language code. The transcript
 * language is intentionally a base code: regional output preferences belong to
 * generation settings, not to forensic audio evidence.
 */
export function normalizeTranscriptLanguageCode(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  if (!trimmed) return "unknown";

  const folded = foldLanguageText(trimmed);
  if (UNKNOWN_LANGUAGE_LABELS.has(folded)) return "unknown";

  // Providers often append a region in parentheses to a language name, for
  // example "Portuguese (Brazil)" or "Spanish (US)".
  if (/\b(?:portuguese|portugues)\b/u.test(folded)) return "pt";
  if (/\b(?:spanish|espanol|castilian)\b/u.test(folded)) return "es";
  if (/\b(?:english|ingles)\b/u.test(folded)) return "en";

  const compact = folded.replace(/\s+/g, "");
  const descriptiveAlias = LANGUAGE_NAME_ALIASES[compact];
  if (descriptiveAlias) return descriptiveAlias;

  const tag = trimmed.toLocaleLowerCase().replace(/_/g, "-");
  const primary = tag.match(/^[a-z]{2,3}(?=-|$)/u)?.[0] ?? "";
  if (primary) return LANGUAGE_NAME_ALIASES[primary] ?? primary;

  return "unknown";
}

function countPhraseOccurrences(text: string, phrase: string): number {
  if (!text || !phrase) return 0;
  const surrounded = ` ${text} `;
  const needle = ` ${phrase} `;
  let count = 0;
  let cursor = 0;
  while (count < 3) {
    const index = surrounded.indexOf(needle, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function scoreLanguage(
  language: LexicallyDetectedTranscriptLanguage,
  foldedTranscript: string,
  tokens: string[],
): TranscriptLanguageScore {
  const tokenCounts = new Map<string, number>();
  for (const token of tokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);

  let score = 0;
  const distinctMarkers = new Set<string>();
  for (const marker of TOKEN_MARKERS[language]) {
    const occurrences = Math.min(tokenCounts.get(marker) ?? 0, 3);
    if (!occurrences) continue;
    score += occurrences;
    distinctMarkers.add(`token:${marker}`);
  }

  for (const phrase of PHRASE_MARKERS[language]) {
    const occurrences = countPhraseOccurrences(foldedTranscript, phrase);
    if (!occurrences) continue;
    score += occurrences * 2;
    distinctMarkers.add(`phrase:${phrase}`);
  }

  // These suffixes remain distinct after accent folding and are especially
  // useful when articles/names make a Romance-language sample look ambiguous.
  if (language === "pt") {
    const morphology = new Set(tokens.filter((token) => /(?:cao|coes)$/u.test(token)));
    score += Math.min(morphology.size, 3) * 2;
    for (const marker of morphology) distinctMarkers.add(`morphology:${marker}`);
  } else if (language === "es") {
    const morphology = new Set(tokens.filter((token) => /(?:cion|ciones)$/u.test(token)));
    score += Math.min(morphology.size, 3) * 2;
    for (const marker of morphology) distinctMarkers.add(`morphology:${marker}`);
  }

  return {
    language,
    score,
    distinct_markers: distinctMarkers.size,
  };
}

function getStrongLexicalLanguage(
  transcriptText: string,
): { language: LexicallyDetectedTranscriptLanguage | null; scores: TranscriptLanguageScore[] } {
  const foldedTranscript = foldLanguageText(transcriptText);
  const tokens = foldedTranscript ? foldedTranscript.split(/\s+/u).filter(Boolean) : [];
  const scores = (["pt", "es", "en"] as const)
    .map((language) => scoreLanguage(language, foldedTranscript, tokens))
    .sort((left, right) => right.score - left.score || right.distinct_markers - left.distinct_markers);

  if (tokens.length < 8) return { language: null, scores };

  const [best, runnerUp] = scores;
  const minimumScore = tokens.length >= 20 ? 6 : 5;
  const minimumDistinctMarkers = tokens.length >= 20 ? 4 : 3;
  const strong = best.score >= minimumScore
    && best.distinct_markers >= minimumDistinctMarkers
    && best.score - runnerUp.score >= 3
    && (runnerUp.score < 4 || best.score >= runnerUp.score * 1.45);

  return { language: strong ? best.language : null, scores };
}

/**
 * Reconciles a provider label with the words that were actually transcribed.
 * It never translates, rewrites, or returns a modified transcript.
 */
export function reconcileTranscriptLanguage(
  transcriptText: unknown,
  modelLanguage: unknown,
): TranscriptLanguageReconciliation {
  const text = typeof transcriptText === "string" ? transcriptText : "";
  const model = normalizeTranscriptLanguageCode(modelLanguage);

  if (!text.trim()) {
    return {
      language: "unknown",
      model_language: model,
      lexical_language: null,
      source: "empty_audio",
      scores: [],
    };
  }

  const lexical = getStrongLexicalLanguage(text);
  if (lexical.language) {
    return {
      language: lexical.language,
      model_language: model,
      lexical_language: lexical.language,
      source: "lexical_evidence",
      scores: lexical.scores,
    };
  }

  return {
    language: model,
    model_language: model,
    lexical_language: null,
    source: "model",
    scores: lexical.scores,
  };
}
