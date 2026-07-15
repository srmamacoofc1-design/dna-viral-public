/**
 * DNA STYLE PACK — Fidelidade ao DNA viral na geração
 *
 * Problema resolvido: o assemble-script suprime todo texto literal da base
 * (few-shot, canonical examples, phrase plan) para evitar contaminação de
 * tema — mas com isso o gerador nunca vê COMO um gancho/desenvolvimento
 * viral real é construído, e o roteiro sai genérico.
 *
 * Este módulo extrai da base viral REAL (tabelas públicas: videos,
 * video_blocks, verbal_layer_patterns, block_word_patterns) um "pacote de
 * estilo" por tipo de bloco — esqueletos reais rankeados por engajamento,
 * ritmo (palavras/s), emoção dominante, palavras ponderadas — e o injeta
 * no generation_context pelos canais que o assemble-script JÁ renderiza no
 * prompt (usage_instructions, tone_guidance, vocab_ref). Assim o estilo da
 * base chega ao modelo sem redeploy de edge function, com regras explícitas
 * de anti-cópia (esqueleto sim, assunto/entidades não).
 *
 * Suporta escopo por PRESET: um subconjunto nomeado de vídeos
 * (dataset_cohort com cohort_type="dna_preset" — ver dna-presets.ts) vira
 * uma base DNA própria: os ganchos campeões daquele grupo.
 */
import { supabase } from "@/integrations/supabase/client";

export type TargetLang = "pt" | "en";

export interface BlockStyleExample {
  text: string;
  emotion: string | null;
  words: number;
  engagement_rate: number;
  /** Kept only as protected evidence for anti-copy checks. Never rendered in prompts. */
  video_id?: string;
  strategy?: TextStrategySignature;
}

export type HookOpeningPattern =
  | "question"
  | "negation"
  | "warning"
  | "promise"
  | "discovery"
  | "numeric"
  | "direct_address"
  | "shock_statement"
  | "statement";

export interface TextStrategySignature {
  opening_pattern: HookOpeningPattern;
  word_count: number;
  sentence_count: number;
  avg_sentence_words: number;
  question: boolean;
  exclamation: boolean;
  direct_address: boolean;
  negative_opening: boolean;
  numeric_opening: boolean;
  withheld_payoff: boolean;
  micro_reveal_count: number;
  escalation_marker_count: number;
}

export interface BlockStrategyProfile {
  source_video_count: number;
  dominant_opening_patterns: HookOpeningPattern[];
  word_range: { min: number; target: number; max: number };
  sentence_range: { min: number; target: number; max: number };
  avg_sentence_words: number | null;
  avg_words_per_second?: number | null;
  question_rate: number;
  exclamation_rate: number;
  direct_address_rate: number;
  withheld_payoff_rate: number;
  micro_reveals_per_sentence: number;
  escalation_markers_per_sentence: number;
  dominant_visual_actions: string[];
  /** Taxonomia abstrata; ao contrário de main_action, não contém conteúdo-fonte. */
  dominant_visual_dynamics?: string[];
  dominant_visual_emotions: string[];
  strategy_instruction: string;
}

export interface BlockStyle {
  block_type: string;
  /** Evidência diagnóstica compatível com o idioma de saída; nunca vai ao prompt. */
  examples: BlockStyleExample[];
  /** Evidência anti-cópia em todos os idiomas, usada somente após a geração. */
  protected_examples?: BlockStyleExample[];
  weighted_words: string[];
  impact_phrases: string[];
  dominant_emotion: string | null;
  avg_intensity: number | null;
  median_words: number | null;
  avg_words_per_second: number | null;
  strategy?: BlockStrategyProfile;
}

export interface VideoStrategyEvidence {
  video_id: string;
  engagement_rate: number;
  block_sequence: string;
  hook_strategy: TextStrategySignature | null;
  narrative_progression: string | null;
  micro_turn_count: number | null;
  micro_turn_types: string[];
  visual_hook: {
    action: string | null;
    emotion: string | null;
    intensity: number | null;
    alignment_score: number | null;
  } | null;
  evidence_coverage: number;
}

export interface HookStrategyAnalog {
  source_video_id: string;
  engagement_rate: number;
  /** Unordered single tokens derived from the spoken hook + visual action. */
  context_tokens: string[];
  spoken_hook_strategy: TextStrategySignature;
  narrative_progression: string | null;
  micro_turn_count: number | null;
  micro_turn_types: string[];
  visual_emotion: string | null;
  visual_intensity: number | null;
  evidence_coverage: number;
  source_text_included: false;
  title_included: false;
}

export interface DnaStrategyContract {
  required_block_types: string[];
  min_source_videos: number;
  min_strategy_score: number;
  max_exact_ngram: number;
  max_content_similarity: number;
  max_semantic_similarity?: number;
  protected_reference_required?: boolean;
  semantic_copy_guard_required?: boolean;
  fail_closed: boolean;
  visual_first_required: boolean;
}

export interface DnaExtractionQuality {
  video_coverage: number;
  text_strategy_coverage: number;
  visual_strategy_coverage: number;
  overall: number;
  warnings: string[];
}

export interface DnaAbstractStructuralContract {
  contract_type: "abstract_narrative_order";
  normalized_stage_order: ["hook", "development", "payoff"];
  dominant_sequence_usage: "statistical_reference_only";
  literal_source_sequence_required: false;
  visual_chronology_priority: true;
  fail_closed_for_video_slot_order: true;
}

export function buildAbstractStructuralContract(): DnaAbstractStructuralContract {
  return {
    contract_type: "abstract_narrative_order",
    normalized_stage_order: ["hook", "development", "payoff"],
    dominant_sequence_usage: "statistical_reference_only",
    literal_source_sequence_required: false,
    visual_chronology_priority: true,
    fail_closed_for_video_slot_order: true,
  };
}

export interface DnaStylePack {
  version?: number;
  target_lang: TargetLang;
  scope: "global" | "preset";
  scope_video_ids?: string[];
  total_videos: number;
  dominant_sequence: string | null;
  dominant_sequence_count: number;
  structural_contract?: DnaAbstractStructuralContract;
  block_styles: BlockStyle[];
  video_strategies?: VideoStrategyEvidence[];
  hook_strategy_analogs?: HookStrategyAnalog[];
  strategy_contract?: DnaStrategyContract;
  extraction_quality?: DnaExtractionQuality;
  built_at: string;
}

// Keep one protected textual reference per source video and block type. These
// references never enter the generation prompt; they are persisted only for
// post-generation copy detection. The cap protects the context row from an
// accidentally unbounded global corpus while fully covering normal presets
// such as the 50-video viral base.
export const MAX_PROTECTED_EXAMPLES_PER_BLOCK = 128;

// PostgREST projects commonly cap a single response at 1,000 rows. A
// 50-video preset can legitimately exceed that limit in every evidence table,
// so all evidence reads are paginated with an exact count and a stable UUID
// order. Keeping the ID batch bounded also prevents an oversized `.in(...)`
// query when the global corpus grows beyond a normal preset.
export const STYLE_PACK_PAGE_SIZE = 1000;
const STYLE_PACK_SCOPE_BATCH_SIZE = 50;

type PaginatedStylePackRow = { id: string };

function stylePackQueryFailure(label: string, reason: string): Error {
  return new Error(`DNA style pack query failed [${label}]: ${reason}`);
}

async function fetchStylePackRowsPaginated<T extends PaginatedStylePackRow>(
  db: typeof supabase,
  config: {
    table: string;
    columns: string;
    scopeColumn: string;
    scopeIds: string[];
    label: string;
  },
): Promise<T[]> {
  const ids = [...new Set(config.scopeIds.map(id => String(id || "").trim()).filter(Boolean))].sort();
  if (!ids.length) return [];

  const result: T[] = [];
  const allRowIds = new Set<string>();

  for (let batchStart = 0; batchStart < ids.length; batchStart += STYLE_PACK_SCOPE_BATCH_SIZE) {
    const batchIds = ids.slice(batchStart, batchStart + STYLE_PACK_SCOPE_BATCH_SIZE);
    let expectedCount: number | null = null;
    let offset = 0;
    let previousId: string | null = null;

    while (expectedCount === null || offset < expectedCount) {
      const response = await (db as any)
        .from(config.table)
        .select(config.columns, { count: "exact" })
        .in(config.scopeColumn, batchIds)
        .order("id", { ascending: true })
        .range(offset, offset + STYLE_PACK_PAGE_SIZE - 1);

      if (response.error) {
        const code = response.error.code ? `${response.error.code}: ` : "";
        throw stylePackQueryFailure(config.label, `${code}${response.error.message || "unknown PostgREST error"}`);
      }
      if (!Number.isInteger(response.count) || response.count < 0) {
        throw stylePackQueryFailure(config.label, "exact row count was not returned");
      }
      if (expectedCount === null) expectedCount = response.count;
      else if (response.count !== expectedCount) {
        throw stylePackQueryFailure(
          config.label,
          `row count changed during pagination (${expectedCount} -> ${response.count})`,
        );
      }

      const page = Array.isArray(response.data) ? response.data as T[] : [];
      if (!page.length) {
        if (offset === expectedCount) break;
        throw stylePackQueryFailure(
          config.label,
          `pagination ended at ${offset} of ${expectedCount} rows`,
        );
      }

      for (const row of page) {
        const rowId = String(row?.id || "").trim();
        if (!rowId) throw stylePackQueryFailure(config.label, "row without a stable id");
        if (previousId !== null && rowId <= previousId) {
          throw stylePackQueryFailure(config.label, `non-deterministic id order at ${rowId}`);
        }
        if (allRowIds.has(rowId)) {
          throw stylePackQueryFailure(config.label, `duplicate row id ${rowId}`);
        }
        previousId = rowId;
        allRowIds.add(rowId);
        result.push(row);
      }

      offset += page.length;
      if (offset > expectedCount) {
        throw stylePackQueryFailure(config.label, `received ${offset} rows but exact count is ${expectedCount}`);
      }
    }
  }

  // Batches are independently ordered because each has a different ID scope.
  // Re-sort the combined set so downstream consolidation is reproducible.
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export interface StylePackFormatOpts {
  /** Gancho no modo máximo impacto (padrão: ligado). */
  hookApelao?: boolean;
  /** Modo vídeo: roteiro nasce do que é VISTO (frames), áudio é apoio. */
  visualFirst?: boolean;
  /** Nome do preset ativo, para rastreabilidade no prompt. */
  presetName?: string;
  /** ID persistido do preset, nunca usado como conteúdo do prompt. */
  presetId?: string;
}

// ─── Detecção de idioma (mesma heurística do assemble-script) ────────
const PT_MARKERS = new Set(["de","do","da","dos","das","que","não","uma","um","com","para","por","os","as","no","na","nos","nas","em","se","ou","mais","foi","são","era","até","isso","essa","esse","ela","ele","você","muito","como","quando","mas","tem","sua","seu","este","esta","já","pode","sobre","depois","então"]);
const EN_MARKERS = new Set(["the","and","is","was","are","were","have","has","had","will","would","can","could","should","this","that","with","from","for","but","not","they","their","them","what","when","where","which","who","how","been","being","does","did","just","than","then","also","into","about","after","before","between","through","during","without","again","because","each","few","more","most","other","some","such","only","over","very"]);
const ES_MARKERS = new Set(["de","del","la","las","el","los","que","una","uno","con","para","por","en","se","sin","más","fue","son","era","hasta","eso","esa","ese","ella","él","usted","muy","como","cuando","pero","tiene","su","sus","este","esta","ya","puede","sobre","después","entonces","mientras","aunque","había"]);

export function detectTextLanguage(text: string): "pt" | "en" | "es" | "unknown" {
  if (!text || text.length < 10) return "unknown";
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, "").split(/\s+/).filter(w => w.length > 1);
  let pt = 0, en = 0, es = 0;
  for (const w of words) {
    if (PT_MARKERS.has(w)) pt++;
    if (EN_MARKERS.has(w)) en++;
    if (ES_MARKERS.has(w)) es++;
  }
  const ranked: Array<["pt" | "en" | "es", number]> = [["pt", pt], ["en", en], ["es", es]];
  ranked.sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === 0) return "unknown";
  if (ranked[0][1] >= Math.max(2, ranked[1][1] * 1.2)) return ranked[0][0];
  return "unknown";
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const DIRECT_ADDRESS = new Set(["voce", "vocês", "voces", "you", "your"]);
const AMBIGUOUS_PORTUGUESE_POSSESSIVES = new Set(["seu", "sua", "seus", "suas"]);
const NEGATIONS = new Set(["nao", "nunca", "ninguem", "jamais", "not", "never", "nobody", "no"]);
const WARNING_WORDS = new Set(["cuidado", "alerta", "pare", "evite", "warning", "beware", "stop", "avoid"]);
const PROMISE_WORDS = new Set(["descubra", "revelar", "segredo", "vai", "will", "discover", "secret", "reveal"]);
const DISCOVERY_WORDS = new Set(["descobriu", "encontrou", "percebeu", "found", "discovered", "realized"]);
const ESCALATION_WORDS = new Set(["mas", "so", "ainda", "entao", "porem", "até", "ate", "suddenly", "but", "then", "until", "however", "worse", "more"]);
const WITHHOLDING_WORDS = new Set(["ate", "final", "depois", "quando", "so que", "porém", "porem", "until", "end", "then", "but", "what happened"]);
const CONTENT_STOPWORDS = new Set([
  ...PT_MARKERS, ...EN_MARKERS,
  "pra", "pro", "aqui", "ali", "ainda", "tambem", "também", "tudo", "todo", "toda",
  "como", "onde", "porque", "why", "there", "here", "really", "thing", "things",
]);

function normalizeWords(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const HOOK_ANALOGY_STOPWORDS = new Set([
  ...CONTENT_STOPWORDS,
  "cada", "vez", "este", "esta", "esse", "essa", "aquele", "aquela", "homem", "mulher",
  "hombre", "mujer", "ella", "ellos", "ellas", "pero", "para", "porque", "cuando", "dentro",
  "this", "that", "these", "those", "man", "woman", "person", "someone", "when", "into", "from",
  "depois", "entao", "entonces", "muito", "muita", "muitos", "muitas", "mais", "menos",
]);

/**
 * Builds title-free analogy candidates for contextual hook transfer. The
 * Writer receives only an unordered bag of salient words plus the spoken-hook
 * strategy signature; it never receives a source hook sentence or title.
 */
export function buildHookStrategyAnalogs(pack: DnaStylePack): HookStrategyAnalog[] {
  const hookExamples = new Map<string, string>();
  for (const block of pack.block_styles || []) {
    if (block.block_type !== "hook") continue;
    for (const example of block.protected_examples || block.examples || []) {
      const videoId = String(example.video_id || "").trim();
      const text = String(example.text || "").trim();
      if (videoId && text && !hookExamples.has(videoId)) hookExamples.set(videoId, text);
    }
  }

  return (pack.video_strategies || [])
    .filter((item) => item?.hook_strategy && String(item.video_id || "").trim())
    .map((item) => {
      const sourceText = hookExamples.get(item.video_id) || "";
      const visualAction = String(item.visual_hook?.action || "");
      const contextTokens = [...new Set(normalizeWords(`${sourceText} ${visualAction}`)
        .filter((token) => token.length >= 3 && !HOOK_ANALOGY_STOPWORDS.has(token)))]
        .slice(0, 18);
      return {
        source_video_id: item.video_id,
        engagement_rate: Number.isFinite(Number(item.engagement_rate)) ? Number(item.engagement_rate) : 0,
        context_tokens: contextTokens,
        spoken_hook_strategy: sourceText ? deriveTextStrategy(sourceText) : item.hook_strategy!,
        narrative_progression: item.narrative_progression || null,
        micro_turn_count: Number.isFinite(Number(item.micro_turn_count)) ? Number(item.micro_turn_count) : null,
        micro_turn_types: (item.micro_turn_types || []).map(String).filter(Boolean).slice(0, 12),
        visual_emotion: item.visual_hook?.emotion || null,
        visual_intensity: Number.isFinite(Number(item.visual_hook?.intensity)) ? Number(item.visual_hook?.intensity) : null,
        evidence_coverage: Number.isFinite(Number(item.evidence_coverage)) ? Number(item.evidence_coverage) : 0,
        source_text_included: false as const,
        title_included: false as const,
      };
    })
    .sort((left, right) => right.engagement_rate - left.engagement_rate)
    .slice(0, 128);
}

function sentenceLengths(text: string): number[] {
  return (text || "")
    .split(/[.!?;:\n]+/)
    .map(s => wordCount(s.trim()))
    .filter(Boolean);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundedRate(value: number): number {
  return +clamp01(value).toFixed(2);
}

export function deriveTextStrategy(text: string): TextStrategySignature {
  const words = normalizeWords(text);
  const first = words[0] || "";
  const firstWindow = new Set(words.slice(0, 4));
  const normalized = words.join(" ");
  const sentences = sentenceLengths(text);
  const question = /\?/.test(text);
  const exclamation = /!/.test(text);
  // A possessive later in the clause normally refers to a third-person
  // subject ("ela perdeu sua face"), not to the viewer. At sentence start it
  // remains intentionally tagged as ambiguous/direct so generated-script
  // validation can accept either direct_address or its statement/shock
  // fallback without corrupting every source phrase that merely contains it.
  const directAddress = words.slice(0, 6).some(w => DIRECT_ADDRESS.has(w))
    || AMBIGUOUS_PORTUGUESE_POSSESSIVES.has(first);
  const negativeOpening = [...firstWindow].some(w => NEGATIONS.has(w));
  const numericOpening = /^\d/.test(first);

  let opening: HookOpeningPattern = "statement";
  if (question) opening = "question";
  else if ([...firstWindow].some(w => WARNING_WORDS.has(w))) opening = "warning";
  else if (negativeOpening) opening = "negation";
  else if ([...firstWindow].some(w => DISCOVERY_WORDS.has(w))) opening = "discovery";
  else if ([...firstWindow].some(w => PROMISE_WORDS.has(w))) opening = "promise";
  else if (numericOpening) opening = "numeric";
  else if (directAddress) opening = "direct_address";
  else if (exclamation || words.length <= 9) opening = "shock_statement";

  const escalationMarkerCount = words.filter(w => ESCALATION_WORDS.has(w)).length;
  const withheldPayoff = [...WITHHOLDING_WORDS].some(marker => normalized.includes(marker));
  const microRevealCount = Math.max(0, sentences.length - 1) + escalationMarkerCount;

  return {
    opening_pattern: opening,
    word_count: words.length,
    sentence_count: Math.max(1, sentences.length),
    avg_sentence_words: sentences.length
      ? +(sentences.reduce((sum, n) => sum + n, 0) / sentences.length).toFixed(1)
      : words.length,
    question,
    exclamation,
    direct_address: directAddress,
    negative_opening: negativeOpening,
    numeric_opening: numericOpening,
    withheld_payoff: withheldPayoff,
    micro_reveal_count: microRevealCount,
    escalation_marker_count: escalationMarkerCount,
  };
}

export interface CopyRiskAssessment {
  blocked: boolean;
  longest_exact_ngram: number;
  max_content_similarity: number;
  matched_reference_index: number | null;
  reasons: string[];
}

/**
 * Deterministic anti-copy guard. Exact overlap catches literal copying while
 * content-token Jaccard catches near-copy/entity reuse even after punctuation,
 * accents and stopwords change. The original references are never put in the
 * generation prompt by this module.
 */
export function assessCopyRisk(
  generated: string,
  references: string[],
  thresholds: { maxExactNgram?: number; maxContentSimilarity?: number } = {},
): CopyRiskAssessment {
  const maxExact = thresholds.maxExactNgram ?? 3;
  const maxSimilarity = thresholds.maxContentSimilarity ?? 0.62;
  const generatedWords = normalizeWords(generated);
  const generatedContent = new Set(generatedWords.filter(w => w.length > 2 && !CONTENT_STOPWORDS.has(w)));
  let longest = 0;
  let bestSimilarity = 0;
  let matchedReferenceIndex: number | null = null;

  references.forEach((reference, index) => {
    const refWords = normalizeWords(reference);
    let localLongest = 0;
    const maxN = Math.min(generatedWords.length, refWords.length, 12);
    for (let n = 1; n <= maxN; n++) {
      const grams = new Set<string>();
      for (let i = 0; i <= generatedWords.length - n; i++) grams.add(generatedWords.slice(i, i + n).join(" "));
      if (refWords.some((_, i) => i <= refWords.length - n && grams.has(refWords.slice(i, i + n).join(" ")))) {
        localLongest = n;
      } else if (n > localLongest + 1) {
        break;
      }
    }

    const refContent = new Set(refWords.filter(w => w.length > 2 && !CONTENT_STOPWORDS.has(w)));
    const intersection = [...generatedContent].filter(w => refContent.has(w)).length;
    const union = new Set([...generatedContent, ...refContent]).size;
    const similarity = union ? intersection / union : 0;
    if (localLongest > longest || similarity > bestSimilarity) matchedReferenceIndex = index;
    longest = Math.max(longest, localLongest);
    bestSimilarity = Math.max(bestSimilarity, similarity);
  });

  const reasons: string[] = [];
  if (longest > maxExact) reasons.push(`exact_ngram_${longest}`);
  if (bestSimilarity > maxSimilarity) reasons.push(`content_similarity_${bestSimilarity.toFixed(2)}`);
  return {
    blocked: reasons.length > 0,
    longest_exact_ngram: longest,
    max_content_similarity: +bestSimilarity.toFixed(3),
    matched_reference_index: matchedReferenceIndex,
    reasons,
  };
}

export interface StrategyComplianceAssessment {
  passed: boolean;
  score: number;
  checks: Record<string, boolean>;
}

export function evaluateStrategyCompliance(
  generated: string,
  blockType: string,
  profile?: BlockStrategyProfile | null,
): StrategyComplianceAssessment {
  if (!profile || !generated.trim()) return { passed: false, score: 0, checks: { strategy_available: !!profile, text_present: !!generated.trim() } };
  const signature = deriveTextStrategy(generated);
  const checks: Record<string, boolean> = {
    word_range: signature.word_count >= profile.word_range.min && signature.word_count <= profile.word_range.max,
    sentence_range: signature.sentence_count >= profile.sentence_range.min && signature.sentence_count <= profile.sentence_range.max,
    opening_pattern: profile.dominant_opening_patterns.length === 0 || profile.dominant_opening_patterns.includes(signature.opening_pattern),
  };
  if (blockType === "hook") {
    checks.hook_unresolved = !profile.withheld_payoff_rate || signature.withheld_payoff || signature.word_count <= profile.word_range.target;
  }
  if (["desenvolvimento", "tensao", "revelacao"].includes(blockType)) {
    checks.progressive_disclosure = profile.micro_reveals_per_sentence < 0.35 || signature.micro_reveal_count > 0 || signature.sentence_count > 1;
  }
  const values = Object.values(checks);
  const score = values.length ? values.filter(Boolean).length / values.length : 0;
  const requiredScore = blockType === "hook" ? 0.75 : 0.67;
  return { passed: score >= requiredScore, score: +score.toFixed(2), checks };
}

export function validateDnaStylePack(pack: DnaStylePack | null | undefined): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!pack) return { ready: false, reasons: ["pack_missing"] };
  if (!pack.total_videos) reasons.push("no_source_videos");
  if (!pack.block_styles?.length) reasons.push("no_block_strategies");
  if (!pack.block_styles?.some(b => b.block_type === "hook" && b.strategy)) reasons.push("hook_strategy_missing");
  if (!pack.dominant_sequence) reasons.push("dominant_sequence_missing");
  if (!Number.isInteger(pack.dominant_sequence_count) || pack.dominant_sequence_count < 1) {
    reasons.push("dominant_sequence_count_missing");
  }
  const structural = pack.structural_contract;
  if (!structural) reasons.push("abstract_structural_contract_missing");
  else {
    if (structural.contract_type !== "abstract_narrative_order") reasons.push("abstract_structural_contract_type_invalid");
    if (structural.normalized_stage_order?.join("|") !== "hook|development|payoff") {
      reasons.push("abstract_structural_stage_order_invalid");
    }
    if (structural.dominant_sequence_usage !== "statistical_reference_only") {
      reasons.push("dominant_sequence_usage_invalid");
    }
    if (structural.literal_source_sequence_required !== false) reasons.push("literal_source_sequence_copy_forbidden");
    if (structural.visual_chronology_priority !== true) reasons.push("visual_chronology_priority_missing");
    if (structural.fail_closed_for_video_slot_order !== true) reasons.push("video_slot_order_fail_closed_missing");
  }
  if (!pack.strategy_contract?.fail_closed) reasons.push("strategy_contract_missing");
  if (pack.strategy_contract?.protected_reference_required !== true) reasons.push("protected_reference_contract_missing");
  if (pack.strategy_contract?.semantic_copy_guard_required !== true) reasons.push("semantic_copy_guard_contract_missing");
  for (const requiredType of pack.strategy_contract?.required_block_types || []) {
    const block = pack.block_styles.find(candidate => candidate.block_type === requiredType);
    if (!block?.strategy) {
      reasons.push(`required_strategy_missing_${requiredType}`);
    }
    const protectedReferences = block?.protected_examples ?? block?.examples ?? [];
    // Coverage is source-based, not row-based: repeated references from the
    // same video must not make an incomplete guard look complete. Legacy
    // evidence without video_id remains distinguishable by normalized text,
    // while newly consolidated packs always carry the durable source ID.
    const protectedSourceKeys = new Set(protectedReferences.map((reference) => {
      const videoId = reference.video_id?.trim();
      return videoId ? `video:${videoId}` : `text:${normalizeWords(reference.text).join(" ")}`;
    }).filter(key => key !== "text:"));
    const protectedCount = protectedSourceKeys.size;
    if (protectedCount === 0) reasons.push(`protected_reference_missing_${requiredType}`);
    if (protectedCount > 0 && protectedCount < (pack.strategy_contract?.min_source_videos ?? 1)) {
      reasons.push(`insufficient_protected_references_${requiredType}_${protectedCount}`);
    }
    const expectedProtectedCount = block?.strategy
      ? Math.min(block.strategy.source_video_count, MAX_PROTECTED_EXAMPLES_PER_BLOCK)
      : 0;
    if (expectedProtectedCount > 0 && protectedCount < expectedProtectedCount) {
      reasons.push(`incomplete_protected_coverage_${requiredType}_${protectedCount}_of_${expectedProtectedCount}`);
    }
    if (block?.strategy && block.strategy.source_video_count < (pack.strategy_contract?.min_source_videos ?? 1)) {
      reasons.push(`insufficient_strategy_sources_${requiredType}_${block.strategy.source_video_count}`);
    }
  }
  if (pack.strategy_contract && pack.total_videos < pack.strategy_contract.min_source_videos) {
    reasons.push(`insufficient_source_videos_${pack.total_videos}_of_${pack.strategy_contract.min_source_videos}`);
  }
  if ((pack.extraction_quality?.text_strategy_coverage ?? 0) <= 0) reasons.push("text_strategy_evidence_missing");
  return { ready: reasons.length === 0, reasons };
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function topOf(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

function percentile(nums: number[], pct: number): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[index];
}

function topValues(values: Array<string | null | undefined>, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value);
}

/**
 * Reduz uma ação visual livre a uma dinâmica narrativa fechada. O texto cru
 * pode conter objetos/personagens do vídeo-base e, por isso, nunca deve entrar
 * no prompt de geração.
 */
export function classifyVisualDynamic(raw: string | null | undefined): string | null {
  const text = normalizeWords(String(raw || "")).join(" ");
  if (!text) return null;
  const has = (...needles: string[]) => needles.some(needle => text.includes(needle));
  if (has("transform", "cresc", "encolh", "derret", "mud", "convert", "metamorf")) return "transformacao";
  if (has("revert", "inverter", "ving", "retornar", "trocar pape", "virada", "turnaround")) return "reversao";
  if (has("descob", "revel", "perceb", "encontr", "uncover", "find", "realiz")) return "descoberta";
  if (has("fug", "escap", "correr", "atravess", "subir", "cair", "lancar", "arremess", "move")) return "deslocamento";
  if (has("atac", "cort", "engol", "esmag", "explod", "dispar", "captur", "sabotar", "perigo", "amea")) return "impacto";
  if (has("criar", "fabric", "montar", "cozinh", "mold", "build", "make")) return "criacao";
  if (has("salvar", "ajudar", "compartilh", "proteger", "resgatar", "help", "save")) return "cooperacao";
  if (has("engan", "trair", "trapac", "armadilha", "deceiv", "betray", "trick")) return "ruptura";
  return "interacao";
}

function buildStrategyInstruction(blockType: string, profile: Omit<BlockStrategyProfile, "strategy_instruction">): string {
  const openings = profile.dominant_opening_patterns.join("/") || "statement";
  const rhythm = profile.avg_words_per_second ? ` Ritmo observado: ~${profile.avg_words_per_second} palavras/s.` : "";
  const sentenceLength = profile.avg_sentence_words
    ? ` Comprimento típico observado: ~${profile.avg_sentence_words} palavras por frase; use-o como referência, sem violar as faixas.`
    : "";
  const base = `Use abertura ${openings}; mantenha o bloco entre ${profile.word_range.min}-${profile.word_range.max} palavras e ${profile.sentence_range.min}-${profile.sentence_range.max} frase(s). Medianas observadas: ${profile.word_range.target} palavras e ${profile.sentence_range.target} frase(s); são estatísticas, não metas simultâneas.${rhythm}${sentenceLength}`;
  if (blockType === "hook") {
    return `${base} Abra uma lacuna concreta de curiosidade ligada ao conteúdo novo e não entregue a resolução.`;
  }
  if (["desenvolvimento", "tensao", "revelacao"].includes(blockType)) {
    return `${base} Entregue uma micro-revelação por frase e aumente informação/tensão sem repetir a frase anterior.`;
  }
  if (blockType === "payoff") {
    return `${base} Resolva exatamente a promessa aberta pelo hook com informação observável do novo contexto.`;
  }
  return `${base} Cumpra a função narrativa sem introduzir entidades externas ao novo contexto.`;
}

function buildBlockStrategyProfile(
  blockType: string,
  signatures: TextStrategySignature[],
  sourceVideoCount: number,
  visualRows: any[],
  wordsPerSecond: number[],
): BlockStrategyProfile | undefined {
  if (!signatures.length) return undefined;
  const wordCounts = signatures.map(s => s.word_count);
  const sentenceCounts = signatures.map(s => s.sentence_count);
  const sentenceWords = signatures.map(s => s.avg_sentence_words).filter(Number.isFinite);
  const openingCounts = new Map<HookOpeningPattern, number>();
  signatures.forEach(s => openingCounts.set(s.opening_pattern, (openingCounts.get(s.opening_pattern) || 0) + 1));
  const dominantOpenings = [...openingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pattern]) => pattern);
  const sum = (selector: (s: TextStrategySignature) => number) => signatures.reduce((total, s) => total + selector(s), 0);
  const totalSentences = Math.max(1, sum(s => s.sentence_count));
  const base: Omit<BlockStrategyProfile, "strategy_instruction"> = {
    source_video_count: sourceVideoCount,
    dominant_opening_patterns: dominantOpenings,
    word_range: {
      min: Math.max(1, percentile(wordCounts, 0.1) ?? Math.min(...wordCounts)),
      target: median(wordCounts) ?? wordCounts[0],
      max: percentile(wordCounts, 0.9) ?? Math.max(...wordCounts),
    },
    sentence_range: {
      min: Math.max(1, percentile(sentenceCounts, 0.1) ?? 1),
      target: median(sentenceCounts) ?? 1,
      max: percentile(sentenceCounts, 0.9) ?? Math.max(...sentenceCounts),
    },
    avg_sentence_words: sentenceWords.length ? +(sentenceWords.reduce((a, b) => a + b, 0) / sentenceWords.length).toFixed(1) : null,
    avg_words_per_second: wordsPerSecond.length
      ? +(wordsPerSecond.reduce((sum, value) => sum + value, 0) / wordsPerSecond.length).toFixed(2)
      : null,
    question_rate: roundedRate(sum(s => s.question ? 1 : 0) / signatures.length),
    exclamation_rate: roundedRate(sum(s => s.exclamation ? 1 : 0) / signatures.length),
    direct_address_rate: roundedRate(sum(s => s.direct_address ? 1 : 0) / signatures.length),
    withheld_payoff_rate: roundedRate(sum(s => s.withheld_payoff ? 1 : 0) / signatures.length),
    micro_reveals_per_sentence: +(sum(s => s.micro_reveal_count) / totalSentences).toFixed(2),
    escalation_markers_per_sentence: +(sum(s => s.escalation_marker_count) / totalSentences).toFixed(2),
    dominant_visual_actions: topValues(visualRows.map(v => v.main_action), 4),
    dominant_visual_dynamics: topValues(visualRows.map(v => classifyVisualDynamic(v.main_action || v.scene_description)), 4),
    dominant_visual_emotions: topValues(visualRows.map(v => v.visual_emotion), 3),
  };
  return { ...base, strategy_instruction: buildStrategyInstruction(blockType, base) };
}

// ─── Construção do pacote a partir da base real ──────────────────────
export async function buildDnaStylePack(
  targetLang: TargetLang,
  opts?: { videoIds?: string[]; client?: typeof supabase },
): Promise<DnaStylePack | null> {
  // Batch/import tools use a service-role client so they can consolidate a
  // shared preset without creating a fake browser session. Browser callers
  // keep using the regular authenticated client by default.
  const db = opts?.client ?? supabase;
  const scopedIds = opts?.videoIds
    ? [...new Set(opts.videoIds.map(id => String(id || "").trim()).filter(Boolean))].sort()
    : undefined;
  const isScoped = !!(scopedIds && scopedIds.length > 0);

  let videosQuery = db
    .from("videos")
    // Publication titles/captions are never spoken-hook evidence. Hook
    // strategy is derived exclusively from video_blocks(tipo_bloco=hook).
    .select("id, views, likes, comments, engagement_rate, duracao, idioma, narrative_progression_type, micro_turn_count, micro_turn_types")
    .eq("status", "completed")
    .gt("views", 0);
  if (isScoped) videosQuery = videosQuery.in("id", scopedIds!);
  else videosQuery = videosQuery.eq("approved_for_global", true);

  const videosRes = await videosQuery.order("id", { ascending: true });
  if (videosRes.error) {
    throw stylePackQueryFailure(
      "videos",
      `${videosRes.error.code ? `${videosRes.error.code}: ` : ""}${videosRes.error.message || "unknown PostgREST error"}`,
    );
  }
  const videos = videosRes.data || [];
  if (!videos.length) return null;

  // Scope every evidence table to the videos that actually passed the source
  // eligibility query. The injected client is retained for every page,
  // including service-role clients used by batch import scripts.
  const allowedIds = videos.map(video => video.id);
  const [blocks, semantics, visuals, alignments, layersRes] = await Promise.all([
    fetchStylePackRowsPaginated<any>(db, {
      table: "video_blocks",
      columns: "id, video_id, tipo_bloco, texto, tempo_inicio, tempo_fim, emocao, funcao_narrativa, semantic_shift_score, visual_shift_score, block_density_score, elemento_visual, descricao_visual",
      scopeColumn: "video_id",
      scopeIds: allowedIds,
      label: "video_blocks",
    }),
    fetchStylePackRowsPaginated<any>(db, {
      table: "block_semantic_patterns",
      columns: "id, block_id, video_id, block_type, block_emotional_intensity, block_emotional_type, block_verbal_tone, weighted_phrase_score, weighted_word_score",
      scopeColumn: "video_id",
      scopeIds: allowedIds,
      label: "block_semantic_patterns",
    }),
    fetchStylePackRowsPaginated<any>(db, {
      table: "visual_block_analysis",
      columns: "id, block_id, video_id, block_type, main_action, scene_description, visual_emotion, avg_visual_intensity_score, scene_change_count, scene_change_detected, confidence_score",
      scopeColumn: "video_id",
      scopeIds: allowedIds,
      label: "visual_block_analysis",
    }),
    fetchStylePackRowsPaginated<any>(db, {
      table: "text_visual_alignment",
      columns: "id, block_id, video_id, alignment_score, action_alignment_score, emotion_alignment_score, intensity_alignment_score, visual_action, visual_emotion, confidence_score",
      scopeColumn: "video_id",
      scopeIds: allowedIds,
      label: "text_visual_alignment",
    }),
    // Consolidação verbal global (ponderada por engajamento) — usada quando sem escopo
    isScoped
      ? Promise.resolve({ data: [] as any[], error: null })
      : db.from("verbal_layer_patterns")
          .select("layer_type, top_phrases, top_emotions, avg_emotion_intensity, engagement_weighted_words"),
  ]);

  if ((layersRes as any).error) {
    const error = (layersRes as any).error;
    throw stylePackQueryFailure(
      "verbal_layer_patterns",
      `${error.code ? `${error.code}: ` : ""}${error.message || "unknown PostgREST error"}`,
    );
  }
  const layers = (layersRes as any).data || [];
  if (!blocks.length) return null;

  // Engajamento por vídeo: (likes + comments) / views — fórmula oficial da base
  const engagement = new Map<string, number>();
  const sourceLanguage = new Map<string, string>();
  for (const v of videos) {
    const views = Number(v.views) || 0;
    if (views > 0) {
      const storedRate = Number(v.engagement_rate);
      const computedRate = ((Number(v.likes) || 0) + (Number(v.comments) || 0)) / views;
      engagement.set(v.id, Number.isFinite(storedRate) && storedRate > 0 ? storedRate : computedRate);
    }
    const lang = String(v.idioma || "").toLowerCase().split(/[-_]/)[0];
    if (lang) sourceLanguage.set(v.id, lang);
  }

  const semanticByBlock = new Map(semantics.map((row: any) => [row.block_id, row]));
  const visualByBlock = new Map<string, any[]>();
  for (const row of visuals as any[]) {
    const list = visualByBlock.get(row.block_id) || [];
    list.push(row);
    visualByBlock.set(row.block_id, list);
  }
  const alignmentByBlock = new Map<string, any[]>();
  for (const row of alignments as any[]) {
    const list = alignmentByBlock.get(row.block_id) || [];
    list.push(row);
    alignmentByBlock.set(row.block_id, list);
  }

  // Palavras ponderadas por tipo de bloco no ESCOPO (block_word_patterns)
  const scopedWordsByType = new Map<string, Map<string, number>>();
  if (isScoped) {
    const wordPatterns = await fetchStylePackRowsPaginated<any>(db, {
      table: "block_word_patterns",
      columns: "id, block_id, video_id, word, is_emotional, is_impact, is_dominant",
      scopeColumn: "video_id",
      scopeIds: allowedIds,
      label: "block_word_patterns",
    });
    const blockType = new Map(blocks.map(b => [b.id, b.tipo_bloco]));
    for (const wp of wordPatterns) {
      const tipo = blockType.get(wp.block_id);
      if (!tipo || !wp.word) continue;
      const lang = sourceLanguage.get(wp.video_id);
      if (lang && lang !== targetLang) continue;
      // Pondera pelo engajamento do vídeo de origem; bônus para emocional/impacto
      const weight = (engagement.get(wp.video_id) || 0) * (wp.is_emotional || wp.is_impact ? 2 : 1);
      const map = scopedWordsByType.get(tipo) || new Map<string, number>();
      map.set(wp.word, (map.get(wp.word) || 0) + weight + 0.0001);
      scopedWordsByType.set(tipo, map);
    }
  }

  // Sequência estrutural dominante (blocos ordenados por tempo, por vídeo)
  const byVideo = new Map<string, typeof blocks>();
  for (const b of blocks) {
    if (!engagement.has(b.video_id)) continue;
    const list = byVideo.get(b.video_id) || [];
    list.push(b);
    byVideo.set(b.video_id, list);
  }
  const seqCounts = new Map<string, number>();
  for (const [, list] of byVideo) {
    const seq = [...list]
      .sort((a, b) => (a.tempo_inicio ?? 0) - (b.tempo_inicio ?? 0))
      .map(b => b.tipo_bloco || "?")
      .join(" → ");
    seqCounts.set(seq, (seqCounts.get(seq) || 0) + 1);
  }
  const topSeq = [...seqCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  // Camadas verbais globais indexadas por tipo
  const layerByType = new Map<string, any>();
  for (const l of layers) layerByType.set(l.layer_type, l);

  // Estilo por tipo de bloco
  const byType = new Map<string, typeof blocks>();
  for (const b of blocks) {
    if (!b.tipo_bloco || !engagement.has(b.video_id)) continue;
    const list = byType.get(b.tipo_bloco) || [];
    list.push(b);
    byType.set(b.tipo_bloco, list);
  }

  const blockStyles: BlockStyle[] = [];
  for (const [tipo, list] of byType) {
    const wordCounts: number[] = [];
    const wpsList: number[] = [];
    const emotionCounts = new Map<string, number>();
    const candidates: BlockStyleExample[] = [];
    const protectedCandidates: BlockStyleExample[] = [];
    const signatures: TextStrategySignature[] = [];
    const sourceVideos = new Set<string>();
    const typeVisualRows: any[] = [];

    for (const b of list) {
      const texto = (b.texto || "").trim();
      if (!texto) continue;
      sourceVideos.add(b.video_id);
      const words = wordCount(texto);
      const signature = deriveTextStrategy(texto);
      signatures.push(signature);
      typeVisualRows.push(...(visualByBlock.get(b.id) || []));
      if (words >= 2) wordCounts.push(words);
      const semantic = semanticByBlock.get(b.id) as any;
      const resolvedEmotion = b.emocao || semantic?.block_emotional_type || null;
      if (resolvedEmotion) emotionCounts.set(resolvedEmotion, (emotionCounts.get(resolvedEmotion) || 0) + 1);

      const dur = (Number(b.tempo_fim) || 0) - (Number(b.tempo_inicio) || 0);
      if (dur > 0.5 && words >= 2) {
        const wps = words / dur;
        if (wps >= 0.5 && wps <= 6) wpsList.push(wps);
      }

      // A evidência protegida mantém todos os idiomas. Ela nunca é renderizada
      // no prompt e serve para detectar cópia/paráfrase depois da geração.
      if (words >= 1) {
        protectedCandidates.push({
          text: texto.slice(0, 2000),
          emotion: resolvedEmotion,
          words,
          engagement_rate: engagement.get(b.video_id) || 0,
          video_id: b.video_id,
          strategy: signature,
        });
      }

      // Candidato diagnóstico: tamanho útil e idioma compatível.
      if (words < 3 || words > 60) continue;
      const lang = detectTextLanguage(texto);
      if (lang !== "unknown" && lang !== targetLang) continue;
      candidates.push({
        text: texto.length > 220 ? texto.slice(0, 220) + "…" : texto,
        emotion: resolvedEmotion,
        words,
        engagement_rate: engagement.get(b.video_id) || 0,
        video_id: b.video_id,
        strategy: signature,
      });
    }

    // Top 3 por engajamento do vídeo de origem, sem textos duplicados
    candidates.sort((a, b) => b.engagement_rate - a.engagement_rate);
    const seen = new Set<string>();
    const examples: BlockStyleExample[] = [];
    for (const c of candidates) {
      const key = c.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      examples.push(c);
      if (examples.length >= 3) break;
    }

    // Uma referência por vídeo primeiro, para que o guarda cubra o preset em
    // vez de repetir vários blocos de uma única fonte de alto engajamento.
    protectedCandidates.sort((a, b) => b.engagement_rate - a.engagement_rate || b.words - a.words);
    const protectedExamples: BlockStyleExample[] = [];
    const protectedVideos = new Set<string>();
    const protectedTexts = new Set<string>();
    for (const candidate of protectedCandidates) {
      const textKey = candidate.text.toLowerCase();
      const videoKey = candidate.video_id || textKey;
      if (protectedTexts.has(textKey) || protectedVideos.has(videoKey)) continue;
      protectedTexts.add(textKey);
      protectedVideos.add(videoKey);
      protectedExamples.push(candidate);
      if (protectedExamples.length >= MAX_PROTECTED_EXAMPLES_PER_BLOCK) break;
    }

    const layer = layerByType.get(tipo);
    let weightedWords: string[];
    if (isScoped) {
      const map = scopedWordsByType.get(tipo) || new Map<string, number>();
      weightedWords = [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([w]) => w)
        .filter(w => w.length > 1 && detectTextLanguage(w) !== (targetLang === "pt" ? "en" : "pt"))
        .slice(0, 8);
    } else {
      weightedWords = (layer?.engagement_weighted_words || [])
        .map((w: any) => String(w.word || ""))
        .filter((w: string) => w.length > 1 && detectTextLanguage(w) !== (targetLang === "pt" ? "en" : "pt"))
        .slice(0, 8);
    }
    const impactPhrases: string[] = isScoped
      ? []
      : (layer?.top_phrases || [])
          .map((p: any) => String(p.word || p.phrase || ""))
          .filter((p: string) => {
            if (p.length < 4) return false;
            const lang = detectTextLanguage(p);
            return lang === "unknown" || lang === targetLang;
          })
          .slice(0, 4);

    blockStyles.push({
      block_type: tipo,
      examples,
      protected_examples: protectedExamples,
      weighted_words: weightedWords,
      impact_phrases: impactPhrases,
      dominant_emotion: isScoped ? topOf(emotionCounts) : (layer?.top_emotions?.[0]?.value || topOf(emotionCounts)),
      avg_intensity: layer?.avg_emotion_intensity ?? null,
      median_words: median(wordCounts),
      avg_words_per_second: wpsList.length
        ? +(wpsList.reduce((s, n) => s + n, 0) / wpsList.length).toFixed(1)
        : null,
      strategy: buildBlockStrategyProfile(tipo, signatures, sourceVideos.size, typeVisualRows, wpsList),
    });
  }

  // Ordena na ordem canônica da narrativa
  const order = ["hook", "setup", "desenvolvimento", "tensao", "revelacao", "payoff", "transicao", "loop"];
  blockStyles.sort((a, b) => {
    const ia = order.indexOf(a.block_type); const ib = order.indexOf(b.block_type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // Evidence is consolidated video by video before the aggregate contract is
  // produced. This prevents a single high-engagement hook from silently
  // standing in for the whole preset.
  const videoById = new Map(videos.map((v: any) => [v.id, v]));
  const videoStrategies: VideoStrategyEvidence[] = [];
  for (const [videoId, list] of byVideo) {
    const video = videoById.get(videoId) as any;
    const ordered = [...list].sort((a, b) => Number(a.tempo_inicio) - Number(b.tempo_inicio));
    const hookBlock = ordered.find(b => b.tipo_bloco === "hook");
    const hookText = String(hookBlock?.texto || "").trim();
    const hookVisuals = hookBlock ? (visualByBlock.get(hookBlock.id) || []) : [];
    const hookAlignments = hookBlock ? (alignmentByBlock.get(hookBlock.id) || []) : [];
    const visual = [...hookVisuals].sort((a, b) => (Number(b.avg_visual_intensity_score) || 0) - (Number(a.avg_visual_intensity_score) || 0))[0];
    const alignmentValues = hookAlignments.map(a => Number(a.alignment_score)).filter(Number.isFinite);
    const evidenceParts = [
      ordered.length > 0,
      !!hookText,
      ordered.some(b => semanticByBlock.has(b.id)),
      ordered.some(b => (visualByBlock.get(b.id) || []).length > 0),
      ordered.some(b => (alignmentByBlock.get(b.id) || []).length > 0),
    ];
    const rawTurns = Array.isArray(video?.micro_turn_types) ? video.micro_turn_types : [];
    videoStrategies.push({
      video_id: videoId,
      engagement_rate: engagement.get(videoId) || 0,
      block_sequence: ordered.map(b => b.tipo_bloco || "?").join(" → "),
      hook_strategy: hookText ? deriveTextStrategy(hookText) : null,
      narrative_progression: video?.narrative_progression_type || null,
      micro_turn_count: Number.isFinite(Number(video?.micro_turn_count)) ? Number(video.micro_turn_count) : null,
      micro_turn_types: rawTurns.map((value: any) => String(value)).filter(Boolean),
      visual_hook: visual ? {
        action: visual.main_action || visual.scene_description || null,
        emotion: visual.visual_emotion || null,
        intensity: Number.isFinite(Number(visual.avg_visual_intensity_score)) ? Number(visual.avg_visual_intensity_score) : null,
        alignment_score: alignmentValues.length
          ? +(alignmentValues.reduce((a, b) => a + b, 0) / alignmentValues.length).toFixed(2)
          : null,
      } : null,
      evidence_coverage: +(evidenceParts.filter(Boolean).length / evidenceParts.length).toFixed(2),
    });
  }
  videoStrategies.sort((a, b) => b.engagement_rate - a.engagement_rate);

  const eligibleBlocks = blocks.filter(b => engagement.has(b.video_id));
  const textBlocks = eligibleBlocks.filter(b => String(b.texto || "").trim().length > 0);
  const visuallyCoveredVideos = new Set<string>();
  for (const [videoId, videoBlocks] of byVideo) {
    const eligible = videoBlocks.filter(block => String(block.texto || "").trim().length > 0);
    const covered = eligible.filter(block => (visualByBlock.get(block.id) || []).length > 0);
    if (eligible.length > 0 && covered.length / eligible.length >= 0.6) visuallyCoveredVideos.add(videoId);
  }
  const expectedVideos = isScoped ? Math.max(1, scopedIds!.length) : Math.max(1, videos.length);
  const videoCoverage = roundedRate(byVideo.size / expectedVideos);
  const textCoverage = roundedRate(textBlocks.length / Math.max(1, eligibleBlocks.length));
  const visualCoverage = roundedRate(visuallyCoveredVideos.size / Math.max(1, byVideo.size));
  const warnings: string[] = [];
  if (byVideo.size < 3) warnings.push("low_sample_size_less_than_3_videos");
  if (textCoverage < 0.8) warnings.push("text_strategy_coverage_below_80pct");
  if (visualCoverage < 0.8) warnings.push("visual_strategy_coverage_below_80pct");
  const extractionQuality: DnaExtractionQuality = {
    video_coverage: videoCoverage,
    text_strategy_coverage: textCoverage,
    visual_strategy_coverage: visualCoverage,
    overall: +(videoCoverage * 0.2 + textCoverage * 0.5 + visualCoverage * 0.3).toFixed(2),
    warnings,
  };
  // Estes três papéis formam o contrato mínimo. Não reduzir a lista conforme
  // os dados disponíveis: isso transformaria ausência de evidência em sucesso.
  const requiredTypes = ["hook", "desenvolvimento", "payoff"];
  const strategyContract: DnaStrategyContract = {
    required_block_types: requiredTypes,
    min_source_videos: 3,
    min_strategy_score: 0.82,
    max_exact_ngram: 3,
    max_content_similarity: 0.62,
    max_semantic_similarity: 0.78,
    protected_reference_required: true,
    semantic_copy_guard_required: true,
    fail_closed: true,
    visual_first_required: true,
  };

  const pack: DnaStylePack = {
    version: 3,
    target_lang: targetLang,
    scope: isScoped ? "preset" : "global",
    ...(isScoped ? { scope_video_ids: scopedIds } : {}),
    total_videos: byVideo.size,
    dominant_sequence: topSeq?.[0] || null,
    dominant_sequence_count: topSeq?.[1] || 0,
    structural_contract: buildAbstractStructuralContract(),
    block_styles: blockStyles,
    video_strategies: videoStrategies,
    strategy_contract: strategyContract,
    extraction_quality: extractionQuality,
    built_at: new Date().toISOString(),
  };
  pack.hook_strategy_analogs = buildHookStrategyAnalogs(pack);
  return pack;
}

// ─── Formatação como instruções de prompt ────────────────────────────
export function formatStylePackLines(pack: DnaStylePack, opts?: StylePackFormatOpts): string[] {
  const hookApelao = opts?.hookApelao ?? true;
  const lines: string[] = [];
  const origem = opts?.presetName
    ? `preset "${opts.presetName}" (${pack.total_videos} vídeos virais REAIS)`
    : `${pack.total_videos} vídeos virais REAIS da base`;
  lines.push(`=== PACOTE DE ESTILO DNA — extraído de ${origem} ===`);
  if (pack.dominant_sequence) {
    lines.push(`SEQUÊNCIA ESTRUTURAL DOMINANTE DA BASE (referência estatística abstrata; ${pack.dominant_sequence_count}/${pack.total_videos} fontes): ${pack.dominant_sequence}`);
  }
  lines.push(`CONTRATO ESTRUTURAL ABSTRATO: hook → desenvolvimento/escalada → payoff/desfecho. Não copie literalmente a sequência de uma fonte. No modo vídeo, preserve essa ordem de papéis usando a cronologia VISUAL do conteúdo novo como verdade prioritária.`);
  lines.push(`CONTRATO DNA: reproduza as ESTRATÉGIAS estruturais medidas abaixo, nunca o texto-fonte. Nenhuma frase, entidade, nome, lugar ou assunto dos vídeos-base é fornecido ao gerador.`);
  lines.push(`ANTI-CÓPIA: use somente métricas abstratas (abertura, extensão, ritmo, progressão e emoção). Qualquer sequência literal de 4+ palavras compartilhada com a base invalida o bloco.`);
  if (pack.extraction_quality) {
    lines.push(`QUALIDADE DA EXTRAÇÃO: geral ${Math.round(pack.extraction_quality.overall * 100)}% · texto ${Math.round(pack.extraction_quality.text_strategy_coverage * 100)}% · visual ${Math.round(pack.extraction_quality.visual_strategy_coverage * 100)}%.`);
  }

  for (const bs of pack.block_styles) {
    const label = bs.block_type.toUpperCase();
    const stats: string[] = [];
    if (bs.median_words) stats.push(`~${bs.median_words} palavras`);
    if (bs.avg_words_per_second) stats.push(`ritmo ${bs.avg_words_per_second} palavras/s`);
    if (bs.dominant_emotion) stats.push(`emoção dominante: ${bs.dominant_emotion}${bs.avg_intensity ? ` (intensidade ${Number(bs.avg_intensity).toFixed(1)}/5)` : ""}`);
    if (stats.length) lines.push(`[${label}] ${stats.join(" · ")}`);
    if (bs.strategy) {
      const s = bs.strategy;
      lines.push(`[${label}] ESTRATÉGIA MEDIDA: ${s.strategy_instruction}`);
      lines.push(`[${label}] CONTRATO: abertura=${s.dominant_opening_patterns.join("/") || "statement"}; palavras=${s.word_range.min}-${s.word_range.max}; frases=${s.sentence_range.min}-${s.sentence_range.max}; medianas descritivas=${s.word_range.target} palavras/${s.sentence_range.target} frase(s) (não impor simultaneamente); micro-revelações/frase=${s.micro_reveals_per_sentence}; marcadores de escalada/frase=${s.escalation_markers_per_sentence}.`);
      if (s.dominant_visual_dynamics?.length || s.dominant_visual_emotions.length) {
        lines.push(`[${label}] PADRÃO VISUAL ABSTRATO: dinâmica=${s.dominant_visual_dynamics?.join("/") || "não medido"}; emoções=${s.dominant_visual_emotions.join("/") || "não medido"}.`);
      }
    }
  }

  lines.push(`APLICAÇÃO OBRIGATÓRIA: cada bloco DEVE satisfazer seu contrato mensurável. Se não houver evidência/estratégia para um bloco obrigatório, NÃO improvise: interrompa a geração.`);

  if (hookApelao) {
    lines.push(`MODO GANCHO APELÃO — OBRIGATÓRIO: use máxima intensidade na ação, no objeto e nos verbos concretos comprovados nos primeiros 0-5 segundos. Termine com uma consequência ou alcance ainda sem resposta. Nunca revele família, vítima, ataque, sucesso, fracasso, transformação, payoff ou desfecho posterior no gancho; a promessa pode apontar somente para a consequência desconhecida, sem inventar fatos. Máxima curiosidade nos primeiros 2 segundos.`);
    lines.push(`DESENVOLVIMENTO DE RETENÇÃO — OBRIGATÓRIO: cada frase deve acrescentar uma ação, consequência ou micro-revelação observável. Nunca parafraseie a frase anterior. Escale causalmente até o payoff.`);
  }

  if (opts?.visualFirst) {
    lines.push(`PRIORIDADE VISUAL — OBRIGATÓRIA (modo vídeo): escolha primeiro o frame/ação visível de maior intensidade e faça dele o fato concreto do hook. Cada frase seguinte deve mapear para um novo frame/ação em ordem causal; a transcrição serve apenas para identificar relações e fatos. Se não houver frames analisados, interrompa a geração.`);
  }

  return lines;
}

/** Pacote formatado como texto único (canal `notes` do modo tema/transform). */
export function buildStylePackNotes(pack: DnaStylePack, opts?: StylePackFormatOpts): string {
  return formatStylePackLines(pack, opts).join("\n");
}

// ─── Injeção no generation_context já criado ─────────────────────────
/**
 * Enriquece o generation_context com o pacote de estilo pelos canais que o
 * assemble-script renderiza no prompt. Requer usuário autenticado (RLS:
 * update permitido ao dono da linha). Não altera status nem slots
 * obrigatórios — apenas acrescenta orientação de estilo.
 */
export async function injectStylePackIntoContext(
  generationContextId: string,
  pack: DnaStylePack,
  formatOpts?: StylePackFormatOpts,
): Promise<{ injected: boolean; channel: string | null; reason?: string }> {
  const { data: row, error } = await supabase
    .from("generation_contexts")
    .select("id, generation_rules, slot_sequence")
    .eq("id", generationContextId)
    .single();

  if (error || !row) {
    return { injected: false, channel: null, reason: error?.message || "contexto não encontrado" };
  }

  const rules = JSON.parse(JSON.stringify(row.generation_rules || {}));
  const payload = rules?.context_payload;
  if (!payload) {
    return { injected: false, channel: null, reason: "generation_rules sem context_payload" };
  }
  const readiness = validateDnaStylePack(pack);
  if (!readiness.ready) {
    return { injected: false, channel: null, reason: `DNA incompleto: ${readiness.reasons.join(", ")}` };
  }
  if (rules.style_pack?.injected_at && Number(rules.style_pack?.version) >= 3 && rules.style_pack?.status === "ready") {
    const samePreset = (rules.style_pack.preset_id || null) === (formatOpts?.presetId || null);
    const sameHookMode = Boolean(rules.style_pack.hook_apelao) === Boolean(formatOpts?.hookApelao ?? true);
    const sameLanguage = rules.style_pack.target_lang === pack.target_lang;
    const strictGuard = rules.style_pack.strategy_contract?.protected_reference_required === true
      && rules.style_pack.strategy_contract?.semantic_copy_guard_required === true
      && rules.style_pack.structural_contract?.contract_type === "abstract_narrative_order"
      && rules.style_pack.structural_contract?.visual_chronology_priority === true
      && rules.style_pack.structural_contract?.literal_source_sequence_required === false
      && Array.isArray(rules.style_pack.protected_examples)
      && rules.style_pack.protected_examples.length > 0
      && Array.isArray(rules.style_pack.hook_strategy_analogs)
      && rules.style_pack.hook_strategy_analogs.length > 0;
    if (samePreset && sameHookMode && sameLanguage) {
      if (strictGuard) return { injected: true, channel: rules.style_pack.channel, reason: "já injetado" };
      // Same DNA selection, but an older injection is missing a now-required
      // fail-closed guard. Continue and replace it in place.
    } else {
      return { injected: false, channel: null, reason: "contexto já contém outro DNA; reconstrua o contexto antes de trocar preset/modo" };
    }
  }

  const mode = rules?.input_mode || "video";
  if (mode === "video" && (pack.extraction_quality?.visual_strategy_coverage ?? 0) < 0.6) {
    return { injected: false, channel: null, reason: "DNA visual insuficiente: menos de 60% dos vídeos-base têm evidência visual" };
  }
  const lines = formatStylePackLines(pack, {
    ...formatOpts,
    visualFirst: formatOpts?.visualFirst ?? mode === "video",
  });
  let channel: string | null = null;

  if (mode === "theme") {
    payload.theme_constraints = payload.theme_constraints || {};
    payload.theme_constraints.usage_instructions = [
      ...(payload.theme_constraints.usage_instructions || []),
      ...lines,
    ];
    channel = "theme_constraints.usage_instructions";
  } else if (mode === "transform") {
    payload.transform_constraints = payload.transform_constraints || {};
    payload.transform_constraints.usage_instructions = [
      ...(payload.transform_constraints.usage_instructions || []),
      ...lines,
    ];
    channel = "transform_constraints.usage_instructions";
  } else if (mode === "video") {
    // Só injeta se topic_analysis existe — criar um vazio faria os slots
    // exigirem tema "N/A". tone_guidance é renderizado no system prompt.
    const topics = payload.video_reference_context?.topic_analysis;
    if (topics) {
      topics.semantic_alignment_rules = topics.semantic_alignment_rules || {};
      const existing = topics.semantic_alignment_rules.tone_guidance || "";
      topics.semantic_alignment_rules.tone_guidance =
        (existing ? existing + "\n" : "") + lines.join("\n");
      channel = "topic_analysis.semantic_alignment_rules.tone_guidance";
    } else {
      return { injected: false, channel: null, reason: "modo vídeo sem topic_analysis — injeção pulada por segurança" };
    }
  }

  // Anexa somente o perfil ABSTRATO ao slot. Vocabulário e frases da base não
  // entram no prompt: ficam protegidos exclusivamente para o guarda anti-cópia.
  let slotSequence = row.slot_sequence as any[] | null;
  if (Array.isArray(slotSequence)) {
    const styleByType = new Map(pack.block_styles.map(b => [b.block_type, b]));
    slotSequence = slotSequence.map((slot: any) => {
      const style = styleByType.get(slot.slot_type);
      if (!style?.strategy) return slot;
      return { ...slot, dna_strategy_ref: style.strategy };
    });
  }

  rules.style_pack = {
    injected_at: new Date().toISOString(),
    channel,
    target_lang: pack.target_lang,
    total_videos: pack.total_videos,
    scope: pack.scope,
    preset_name: formatOpts?.presetName ?? null,
    preset_id: formatOpts?.presetId ?? null,
    hook_apelao: formatOpts?.hookApelao ?? true,
    status: "ready",
    strategy_contract: pack.strategy_contract,
    extraction_quality: pack.extraction_quality,
    dominant_sequence: pack.dominant_sequence,
    dominant_sequence_count: pack.dominant_sequence_count,
    structural_contract: pack.structural_contract,
    strategy_profiles: Object.fromEntries(pack.block_styles
      .filter(block => block.strategy)
      .map(block => [block.block_type, block.strategy])),
    hook_strategy_analogs: buildHookStrategyAnalogs(pack),
    protected_examples: pack.block_styles.flatMap(block => (block.protected_examples || block.examples).map(example => ({
      block_type: block.block_type,
      text: example.text,
      video_id: example.video_id ?? null,
    }))),
    version: 3,
  };

  const update: { generation_rules: any; slot_sequence?: any } = { generation_rules: rules };
  if (slotSequence) update.slot_sequence = slotSequence;

  const { error: upErr } = await supabase
    .from("generation_contexts")
    .update(update)
    .eq("id", generationContextId);

  if (upErr) {
    return { injected: false, channel, reason: upErr.message };
  }
  return { injected: true, channel };
}

/**
 * Conveniência: resolve o pacote (preset salvo ou base global) e injeta no
 * contexto em um passo. Retorna falha explícita: os callers usam o resultado
 * para interromper a geração em vez de improvisar um estilo genérico.
 */
export async function applyDnaStylePack(
  generationContextId: string,
  targetLang: TargetLang = "pt",
  opts?: { presetId?: string | null; hookApelao?: boolean },
): Promise<{ injected: boolean; channel: string | null; reason?: string }> {
  try {
    let pack: DnaStylePack | null = null;
    let presetName: string | undefined;
    let resolvedPresetId = opts?.presetId?.trim() || null;
    let resolvedPreset: {
      id: string;
      cohort_name: string;
      video_ids: unknown;
      rules_json: unknown;
    } | null = null;

    if (!resolvedPresetId) {
      const { data, error } = await supabase
        .from("dataset_cohort")
        .select("id, cohort_name, video_ids, rules_json")
        .eq("cohort_type", "dna_preset")
        .eq("active", true)
        .is("created_by", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return { injected: false, channel: null, reason: error.message };
      if (data) {
        resolvedPreset = data;
        resolvedPresetId = data.id;
      }
    }

    // Base Global resolves to the active shared v3 preset first. An explicit
    // selection remains fail-closed and is never silently swapped for another.
    if (resolvedPresetId) {
      const presetResponse = resolvedPreset
        ? { data: resolvedPreset, error: null }
        : await supabase
          .from("dataset_cohort")
          .select("id, cohort_name, video_ids, rules_json")
          .eq("id", resolvedPresetId)
          .eq("cohort_type", "dna_preset")
          .maybeSingle();
      const { data: preset, error: presetError } = presetResponse;
      if (presetError) return { injected: false, channel: null, reason: presetError.message };
      if (!preset) {
        return { injected: false, channel: null, reason: `Preset DNA não encontrado: ${resolvedPresetId}` };
      }
      presetName = preset.cohort_name;
      const cached = (preset.rules_json as any)?.style_pack;
      const cachedReadiness = validateDnaStylePack(cached as DnaStylePack | null | undefined);
      if (cached?.block_styles?.length
        && cached.target_lang === targetLang
        && Number(cached.version) >= 3
        && cachedReadiness.ready) {
        pack = cached as DnaStylePack;
      } else {
        const ids = Array.isArray(preset.video_ids) ? (preset.video_ids as string[]) : [];
        if (!ids.length) return { injected: false, channel: null, reason: `Preset DNA "${presetName}" não contém vídeos` };
        pack = await buildDnaStylePack(targetLang, { videoIds: ids });
        if (!pack) return { injected: false, channel: null, reason: `Preset DNA "${presetName}" não pôde ser consolidado` };
      }
    }

    if (!pack) {
      pack = await buildDnaStylePack(targetLang);
    }
    if (!pack) return { injected: false, channel: null, reason: "base viral vazia" };

    return await injectStylePackIntoContext(generationContextId, pack, {
      hookApelao: opts?.hookApelao ?? true,
      presetName,
      presetId: resolvedPresetId ?? undefined,
    });
  } catch (e: any) {
    console.warn("DNA style pack failed (non-blocking):", e);
    return { injected: false, channel: null, reason: e?.message || "erro desconhecido" };
  }
}
