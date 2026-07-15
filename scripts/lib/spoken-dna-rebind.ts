import { createHash } from "node:crypto";
import {
  assertNarrativeBlockContract,
  assertTranscriptTimelineMatchesSource,
  assignExactTranscriptTextToBlocks,
  type NarrativeBlock,
} from "../../supabase/functions/_shared/narrative-blocks.ts";

export const CODEX_MANUAL_AUDIT_IDS = [
  "Zpi10UTydLU", "0P8vcxxyuoI", "KqGxjJ21Eqk", "xTdr9tsT_4g",
  "vpY4sfLYQSY", "JIcwpf_aE4o", "j19oBZL2d-8", "89_3HIcw80A",
  "6FP7nKEwLDo", "1uVrM46e_yw", "gsF_ZZ94Ue8", "4Cz5ZMsGoT4",
  "xkzJeq1U_oM", "6WNDlb8ame4", "UKsKkmkpDi0", "qyrjKm3KP0o",
] as const;

export const EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS = [
  "5ClZjsEO2mA", "I-n6aSD0GxU", "xvA4RIDpCjI", "Hk9tKIR3LIc",
  "3gnSj4i4ZUs", "2uVOpKc1KF0", "zmzfzxB89GY", "IWyvjlTq1Gk",
  "y410EEYFjUw", "H3OeoDbO_l8", "tbmMTbZ5kmE", "-lf6Rb445nQ",
  "GkKHT1qjXGc", "ExLIjbDfcOQ", "L5dXJXpKNQA", "lMhyllrR880",
] as const;

const ALLOWED_TYPES = new Set([
  "hook", "setup", "desenvolvimento", "tensao", "revelacao", "payoff",
  "transicao", "loop",
]);
const ALLOWED_EMOTIONS = new Set([
  "curiosidade", "surpresa", "medo", "tensao", "alivio", "expectativa", "impacto",
]);
const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "ate", "com", "como", "da", "das", "de", "depois",
  "do", "dos", "e", "ela", "ele", "em", "entao", "era", "essa", "esse", "esta",
  "foi", "isso", "ja", "mais", "mas", "na", "nas", "no", "nos", "o", "os",
  "ou", "para", "pela", "pelo", "por", "quando", "que", "se", "sem", "seu",
  "sua", "tambem", "um", "uma",
]);
const EMOTIONAL_WORDS = new Set([
  "absurdo", "assustado", "choque", "coragem", "curioso", "desespero", "dor",
  "feliz", "finalmente", "medo", "milagre", "morte", "morreu", "perigo", "pior",
  "segredo", "surpresa", "terrivel", "urgente",
]);

export type SpokenTranscriptRow = {
  id: string;
  tempo_inicio: number | string;
  tempo_fim: number | string;
  texto: string;
};

export type ExistingSpokenBlock = NarrativeBlock & {
  id: string;
  bloco_id: number;
  tipo_bloco: string;
  tempo_inicio: number | string;
  tempo_fim: number | string;
  texto: string;
  emocao?: string | null;
  funcao_narrativa?: string | null;
};

export type TrustedVisualAnalysisRow = {
  id: string;
  block_id: string;
  data_source_type: string;
  representative_timestamp?: number | string | null;
  representative_frame_path?: string | null;
  scene_description?: string | null;
  main_action?: string | null;
  [key: string]: unknown;
};

export type SpokenSemanticPayload = {
  keywords: string[];
  keyword_frequencies: Record<string, number>;
  emotional_words: string[];
  repeated_words: string[];
  strong_phrases: string[];
  emotional_type: string;
  emotional_intensity: number;
  verbal_tone: string;
  rare_words: string[];
  dominant_words: string[];
  weighted_word_score: number;
  weighted_phrase_score: number;
};

export type SpokenVerbalPayload = {
  word_count: number;
  phrase_count: number;
  phrase_pattern: string;
  tone: string;
  trigger_words: string[];
  linguistic_density: number;
  emotional_intensity: number;
  semantic_pressure_score: number;
};

export type SpokenRebindBlock = {
  index: number;
  type: string;
  start: number;
  end: number;
  text: string;
  transcript_segment_ids: string[];
  transcript_segment_indexes: number[];
  source_block_id: string;
  source_visual_analysis_id: string;
  narrative_function: string;
  schema_emotion: string;
  semantic: SpokenSemanticPayload;
  verbal: SpokenVerbalPayload;
};

export type SpokenDnaRebindPayload = {
  schema_version: 1;
  engine: "spoken_dna_rebind_v1";
  mode: "layers_only" | "full_rebind";
  youtube_id: string;
  video_id: string;
  duration_seconds: number;
  transcript_sha256: string;
  blocks: SpokenRebindBlock[];
};

export type BuildSpokenDnaRebindInput = {
  youtubeId: string;
  videoId: string;
  durationSeconds: number;
  transcripts: SpokenTranscriptRow[];
  blocks: ExistingSpokenBlock[];
  visualAnalyses: TrustedVisualAnalysisRow[];
};

type CanonicalTranscript = {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
};

type BlockDraft = {
  source: ExistingSpokenBlock;
  type: string;
  start: number;
  end: number;
  transcript: CanonicalTranscript[];
};

function finiteNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`);
  return parsed;
}

function normalizedWord(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeSpokenText(value: unknown): string {
  return normalizedWord(value).replace(/\s+/g, " ");
}

function surfaceTokens(value: string): Array<{ surface: string; normalized: string }> {
  return (value.match(/[\p{L}\p{N}]+/gu) || []).map((surface) => ({
    surface: surface.toLocaleLowerCase("pt-BR"),
    normalized: normalizedWord(surface),
  })).filter((token) => token.normalized.length > 0);
}

function sentencePhrases(value: string): string[] {
  const candidates = value.match(/[^.!?]+[.!?]?/gu) || [value];
  const phrases = candidates.map((phrase) => phrase.trim()).filter(Boolean);
  return [...new Set(phrases)].slice(0, 4);
}

function emotionalIntensity(type: string): number {
  if (type === "hook" || type === "payoff") return 88;
  if (type === "tensao" || type === "revelacao") return 82;
  if (type === "desenvolvimento") return 70;
  return 62;
}

function toneForType(type: string): string {
  if (type === "hook") return "chocante";
  if (type === "tensao") return "urgente";
  if (type === "revelacao" || type === "payoff") return "emocional";
  if (type === "loop") return "misterioso";
  return "narrativo";
}

function emotionForType(type: string): string {
  if (type === "hook") return "curiosidade";
  if (type === "tensao") return "tensao";
  if (type === "revelacao") return "surpresa";
  if (type === "payoff") return "impacto";
  return "expectativa";
}

function functionForType(type: string): string {
  const functions: Record<string, string> = {
    hook: "Abrir uma lacuna de curiosidade com a primeira fala exata",
    setup: "Estabelecer o contexto narrado",
    desenvolvimento: "Avançar a cadeia causal da narração",
    tensao: "Elevar o risco ou a incerteza narrada",
    revelacao: "Entregar uma mudança ou micro-revelação",
    payoff: "Resolver a promessa narrativa com a fala final",
    transicao: "Conectar dois movimentos narrativos",
    loop: "Reconectar o fim ao início",
  };
  return functions[type] || functions.desenvolvimento;
}

export function deriveSpokenSemantic(text: string, type: string): SpokenSemanticPayload {
  const tokens = surfaceTokens(text);
  if (!tokens.length) throw new Error("spoken block has no lexical token");
  const counts = new Map<string, { count: number; surface: string }>();
  for (const token of tokens) {
    const current = counts.get(token.normalized);
    counts.set(token.normalized, {
      count: (current?.count || 0) + 1,
      surface: current?.surface || token.surface,
    });
  }
  const ranked = [...counts.entries()]
    .filter(([token]) => !STOP_WORDS.has(token))
    .sort((left, right) =>
      right[1].count - left[1].count
      || right[0].length - left[0].length
      || left[0].localeCompare(right[0])
    );
  const fallback = [...counts.entries()].sort((left, right) =>
    right[1].count - left[1].count || left[0].localeCompare(right[0])
  );
  const selected = (ranked.length ? ranked : fallback).slice(0, 10);
  const keywords = selected.map(([, value]) => value.surface);
  const keywordFrequencies = Object.fromEntries(selected.map(([, value]) => [value.surface, value.count]));
  const emotionalWords = selected
    .filter(([token]) => EMOTIONAL_WORDS.has(token))
    .map(([, value]) => value.surface);
  const repeatedWords = selected.filter(([, value]) => value.count > 1).map(([, value]) => value.surface);
  const rareWords = selected.filter(([, value]) => value.count === 1).slice(0, 5).map(([, value]) => value.surface);
  const dominantWords = selected.slice(0, 3).map(([, value]) => value.surface);
  const intensity = emotionalIntensity(type);
  return {
    keywords,
    keyword_frequencies: keywordFrequencies,
    emotional_words: emotionalWords,
    repeated_words: repeatedWords,
    strong_phrases: sentencePhrases(text),
    emotional_type: emotionForType(type),
    emotional_intensity: intensity,
    verbal_tone: toneForType(type),
    rare_words: rareWords,
    dominant_words: dominantWords,
    weighted_word_score: Math.min(95, 55 + keywords.length * 3 + Math.min(10, repeatedWords.length * 2)),
    weighted_phrase_score: Math.min(95, 62 + Math.min(24, sentencePhrases(text).length * 6)),
  };
}

export function deriveSpokenVerbal(
  text: string,
  type: string,
  semantic = deriveSpokenSemantic(text, type),
): SpokenVerbalPayload {
  const tokens = surfaceTokens(text);
  const unique = new Set(tokens.map((token) => token.normalized));
  const phrases = sentencePhrases(text);
  const pattern = text.includes("?") ? "pergunta"
    : type === "hook" ? "abertura_afirmativa"
    : type === "payoff" ? "resolucao"
    : type === "revelacao" ? "descoberta"
    : type === "tensao" ? "escalada"
    : "afirmacao_narrativa";
  return {
    word_count: tokens.length,
    phrase_count: phrases.length,
    phrase_pattern: pattern,
    tone: semantic.verbal_tone,
    trigger_words: semantic.keywords.slice(0, 6),
    linguistic_density: Number(((unique.size / Math.max(1, tokens.length)) * 100).toFixed(4)),
    emotional_intensity: semantic.emotional_intensity,
    semantic_pressure_score: Math.min(100, semantic.emotional_intensity + Math.min(12, phrases.length * 2)),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function spokenDnaPayloadSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalTranscripts(
  source: SpokenTranscriptRow[],
  duration: number,
): CanonicalTranscript[] {
  const rows = source.map((row, originalIndex) => {
    const id = String(row.id || "").trim();
    const start = finiteNumber(row.tempo_inicio, `transcript[${originalIndex}].start`);
    const end = finiteNumber(row.tempo_fim, `transcript[${originalIndex}].end`);
    const text = String(row.texto || "").trim();
    if (!id || !text || start < 0 || end <= start) {
      throw new Error(`transcript[${originalIndex}] is invalid`);
    }
    return { id, start, end, text, originalIndex };
  }).sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error("transcript ids are not unique");
  }
  assertTranscriptTimelineMatchesSource(rows.map((row) => ({
    tempo_inicio: row.start,
    tempo_fim: row.end,
  })), duration);
  return rows.map((row, index) => ({ ...row, index }));
}

function sortedBlocks(source: ExistingSpokenBlock[]): ExistingSpokenBlock[] {
  const blocks = source.map((block) => ({ ...block })).sort((left, right) =>
    Number(left.bloco_id) - Number(right.bloco_id)
    || Number(left.tempo_inicio) - Number(right.tempo_inicio)
  );
  if (!blocks.length || new Set(blocks.map((block) => block.id)).size !== blocks.length) {
    throw new Error("existing narrative blocks are missing or duplicated");
  }
  return blocks;
}

function greatestOverlapAssignments(
  blocks: ExistingSpokenBlock[],
  transcript: CanonicalTranscript[],
): number[][] {
  const assignments = blocks.map(() => [] as number[]);
  for (const segment of transcript) {
    let best = -1;
    let bestOverlap = 0;
    blocks.forEach((block, index) => {
      const overlap = Math.max(0,
        Math.min(segment.end, Number(block.tempo_fim))
        - Math.max(segment.start, Number(block.tempo_inicio)));
      if (overlap > bestOverlap) {
        best = index;
        bestOverlap = overlap;
      }
    });
    if (best < 0 || bestOverlap <= 0) throw new Error(`segment_${segment.index}_without_overlap`);
    assignments[best].push(segment.index);
  }
  return assignments;
}

function canKeepCurrentBlocks(
  blocks: ExistingSpokenBlock[],
  transcript: CanonicalTranscript[],
  duration: number,
): { keep: boolean; assignments: number[][] } {
  try {
    assertNarrativeBlockContract(blocks, duration);
    const exact = assignExactTranscriptTextToBlocks(blocks, transcript.map((segment) => ({
      tempo_inicio: segment.start,
      tempo_fim: segment.end,
      texto: segment.text,
    })));
    const assignments = greatestOverlapAssignments(blocks, transcript);
    const keep = exact.every((block, index) =>
      String(block.texto || "") === String(blocks[index].texto || "")
      && assignments[index].length > 0
    );
    return { keep, assignments };
  } catch {
    return { keep: false, assignments: [] };
  }
}

function nearestCut(transcript: CanonicalTranscript[], boundary: number): number {
  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < transcript.length; index++) {
    const split = (transcript[index - 1].end + transcript[index].start) / 2;
    const distance = Math.abs(split - boundary);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function transcriptGroups(
  transcript: CanonicalTranscript[],
  blocks: ExistingSpokenBlock[],
): CanonicalTranscript[][] {
  if (transcript.length < 3) throw new Error("at least three transcript segments are required");
  const cuts = new Set<number>();
  for (let index = 0; index < blocks.length - 1; index++) {
    const boundary = (Number(blocks[index].tempo_fim) + Number(blocks[index + 1].tempo_inicio)) / 2;
    cuts.add(nearestCut(transcript, boundary));
  }
  const desired = Math.min(18, transcript.length);
  while (cuts.size + 1 < Math.min(3, desired)) {
    for (const fraction of [1 / 3, 2 / 3, 1 / 2]) {
      const cut = Math.max(1, Math.min(transcript.length - 1, Math.round(transcript.length * fraction)));
      cuts.add(cut);
      if (cuts.size + 1 >= Math.min(3, desired)) break;
    }
  }
  let orderedCuts = [...cuts].filter((cut) => cut > 0 && cut < transcript.length).sort((a, b) => a - b);
  if (orderedCuts.length > 17) {
    orderedCuts = orderedCuts.filter((_, index) =>
      index === 0 || index === orderedCuts.length - 1
      || index % Math.ceil(orderedCuts.length / 17) === 0
    ).slice(0, 17);
  }
  const endpoints = [0, ...orderedCuts, transcript.length];
  return endpoints.slice(0, -1).map((start, index) => transcript.slice(start, endpoints[index + 1]));
}

function bestSourceBlock(
  blocks: ExistingSpokenBlock[],
  start: number,
  end: number,
): ExistingSpokenBlock {
  const midpoint = (start + end) / 2;
  return [...blocks].sort((left, right) => {
    const leftOverlap = Math.max(0, Math.min(end, Number(left.tempo_fim)) - Math.max(start, Number(left.tempo_inicio)));
    const rightOverlap = Math.max(0, Math.min(end, Number(right.tempo_fim)) - Math.max(start, Number(right.tempo_inicio)));
    if (rightOverlap !== leftOverlap) return rightOverlap - leftOverlap;
    const leftDistance = Math.abs(midpoint - ((Number(left.tempo_inicio) + Number(left.tempo_fim)) / 2));
    const rightDistance = Math.abs(midpoint - ((Number(right.tempo_inicio) + Number(right.tempo_fim)) / 2));
    return leftDistance - rightDistance || Number(left.bloco_id) - Number(right.bloco_id);
  })[0];
}

function resegmentedDrafts(
  transcript: CanonicalTranscript[],
  blocks: ExistingSpokenBlock[],
  duration: number,
): BlockDraft[] {
  const groups = transcriptGroups(transcript, blocks);
  // Provider segments sometimes overlap (for example around a subtitle or a
  // forced ASR cut).  Splitting at `previous.end` / `next.start` would copy
  // that overlap into two narrative blocks.  A boundary between the two
  // segment centres gives each neighbour its majority overlap while keeping
  // the repaired block timeline exactly contiguous.
  const boundaries = groups.slice(0, -1).map((group, index) => {
    const previous = group.at(-1)!;
    const next = groups[index + 1][0];
    // Sequential source captions can use the exact next cue boundary. This
    // keeps each cue wholly within its assigned block (the database permits
    // only rounding-sized spillover). JSON3 display overlaps use the centre
    // fallback below, which still keeps greatest-overlap assignment stable.
    if (previous.end <= next.start) return Number(next.start.toFixed(6));
    const previousCentre = (previous.start + previous.end) / 2;
    const nextCentre = (next.start + next.end) / 2;
    if (nextCentre < previousCentre) {
      throw new Error(`transcript centres are not chronological at repaired boundary ${index + 1}`);
    }
    return Number(((previousCentre + nextCentre) / 2).toFixed(6));
  });
  const drafts = groups.map((group, index) => {
    const start = index === 0 ? 0 : boundaries[index - 1];
    const end = index === groups.length - 1 ? duration : boundaries[index];
    const source = bestSourceBlock(blocks, start, end);
    const proposed = ALLOWED_TYPES.has(String(source.tipo_bloco)) ? String(source.tipo_bloco) : "desenvolvimento";
    return { source, type: proposed, start, end, transcript: group };
  });
  normalizeDraftTypes(drafts);
  return drafts;
}

function normalizeDraftTypes(drafts: BlockDraft[]): void {
  if (drafts.length < 3) throw new Error("at least three narrative drafts are required");
  drafts[0].type = "hook";
  drafts[drafts.length - 1].type = "payoff";
  for (let index = 1; index < drafts.length - 1; index++) {
    if (drafts[index].type === "hook") drafts[index].type = "setup";
    if (drafts[index].type === "payoff") drafts[index].type = "revelacao";
  }
  if (!drafts.slice(1, -1).some((draft) => draft.type === "desenvolvimento")) {
    drafts[Math.max(1, Math.min(drafts.length - 2, Math.floor(drafts.length / 2)))].type = "desenvolvimento";
  }
}

function mergeAdjacentDrafts(drafts: BlockDraft[], leftIndex: number): void {
  const left = drafts[leftIndex];
  const right = drafts[leftIndex + 1];
  if (!left || !right) throw new Error("cannot merge non-adjacent narrative drafts");
  drafts.splice(leftIndex, 2, {
    source: left.source,
    type: left.type,
    start: left.start,
    end: right.end,
    transcript: [...left.transcript, ...right.transcript],
  });
  normalizeDraftTypes(drafts);
}

/** Assign each caption to the same greatest-positive-overlap block rule used
 * by the database and live audit. Caption tracks frequently overlap while a
 * word is being painted on screen, so carrying the preliminary group blindly
 * could put one genuine cue in the neighboring block on a tie. */
function assignDraftsByGreatestOverlap(
  sourceDrafts: BlockDraft[],
  transcript: CanonicalTranscript[],
): BlockDraft[] {
  const drafts = sourceDrafts.map((draft) => ({ ...draft, transcript: [...draft.transcript] }));
  while (true) {
    const assignments = drafts.map(() => [] as CanonicalTranscript[]);
    for (const segment of transcript) {
      let bestIndex = -1;
      let bestOverlap = 0;
      for (const [index, draft] of drafts.entries()) {
        const overlap = Math.max(0, Math.min(segment.end, draft.end) - Math.max(segment.start, draft.start));
        if (overlap > bestOverlap) {
          bestIndex = index;
          bestOverlap = overlap;
        }
      }
      if (bestIndex < 0 || bestOverlap <= 0) {
        throw new Error(`repaired transcript segment ${segment.index} has no positive block overlap`);
      }
      assignments[bestIndex].push(segment);
    }
    const empty = assignments.findIndex((items) => items.length === 0);
    if (empty < 0) {
      return drafts.map((draft, index) => ({ ...draft, transcript: assignments[index] }));
    }
    if (drafts.length <= 3) {
      throw new Error("three repaired blocks cannot each receive exact speech");
    }
    mergeAdjacentDrafts(drafts, empty >= drafts.length - 1 ? empty - 1 : empty);
  }
}

function temporalVisualCandidates(
  draft: BlockDraft,
  source: TrustedVisualAnalysisRow[],
): TrustedVisualAnalysisRow[] {
  return source.filter((row) => {
    const timestamp = Number(row.representative_timestamp);
    return row.data_source_type === "gemini_video_understanding"
      && String(row.id || "").trim().length > 0
      && String(row.block_id || "").trim().length > 0
      && Number.isFinite(timestamp)
      && timestamp >= draft.start - 0.5 && timestamp <= draft.end + 0.5;
  });
}

function hasOneToOneVisualAssignment(
  drafts: BlockDraft[],
  source: TrustedVisualAnalysisRow[],
): boolean {
  const candidates = drafts.map((draft) => temporalVisualCandidates(draft, source));
  if (candidates.some((items) => items.length === 0)) return false;
  const visualOwners = new Map<string, number>();
  const visit = (draftIndex: number, seen: Set<string>): boolean => {
    for (const visual of candidates[draftIndex]) {
      if (seen.has(visual.id)) continue;
      seen.add(visual.id);
      const owner = visualOwners.get(visual.id);
      if (owner === undefined || visit(owner, seen)) {
        visualOwners.set(visual.id, draftIndex);
        return true;
      }
    }
    return false;
  };
  for (const index of [...drafts.keys()].sort((left, right) =>
    candidates[left].length - candidates[right].length || left - right
  )) {
    if (!visit(index, new Set<string>())) return false;
  }
  return true;
}

/**
 * A caption repair can reveal that legacy block boundaries fall between two
 * genuine visual observations. Rather than invent a visual analysis for that
 * sliver, merge adjacent exact-speech groups until every resulting block has
 * one unique, temporally overlapping Gemini observation. This preserves every
 * caption token and makes the visual link stricter, not looser.
 */
function coalesceDraftsForVisualEvidence(
  sourceDrafts: BlockDraft[],
  sourceVisuals: TrustedVisualAnalysisRow[],
): BlockDraft[] {
  const drafts = sourceDrafts.map((draft) => ({ ...draft, transcript: [...draft.transcript] }));
  while (drafts.length > 3 && !hasOneToOneVisualAssignment(drafts, sourceVisuals)) {
    const candidateCounts = drafts.map((draft) => temporalVisualCandidates(draft, sourceVisuals).length);
    const withoutVisual = candidateCounts.findIndex((count) => count === 0);
    const focus = withoutVisual >= 0
      ? withoutVisual
      : candidateCounts.reduce((best, count, index) =>
        count < candidateCounts[best] ? index : best, 0);
    const mergeAt = focus >= drafts.length - 1 ? focus - 1 : focus;
    mergeAdjacentDrafts(drafts, mergeAt);
  }
  if (!hasOneToOneVisualAssignment(drafts, sourceVisuals)) {
    throw new Error("no trusted Gemini visual timestamp overlaps enough repaired transcript blocks");
  }
  return drafts;
}

function chooseTrustedVisuals(
  drafts: BlockDraft[],
  source: TrustedVisualAnalysisRow[],
): TrustedVisualAnalysisRow[] {
  const available = source.filter((row) =>
    row.data_source_type === "gemini_video_understanding"
    && String(row.id || "").trim()
    && String(row.block_id || "").trim()
    && Number.isFinite(Number(row.representative_timestamp))
  );
  if (available.length < drafts.length) {
    throw new Error(`trusted Gemini visual rows ${available.length}/${drafts.length}`);
  }
  const eligibleByDraft = drafts.map((draft, index) => {
    const candidates = available.filter((row) => {
      const timestamp = Number(row.representative_timestamp);
      // A visual observation can support this repaired block only when it is
      // actually from this moment of the source. A block id alone is legacy
      // metadata and must never permit a distant scene to be copied in.
      return timestamp >= draft.start - 0.5 && timestamp <= draft.end + 0.5;
    });
    if (!candidates.length) {
      throw new Error(
        `no trusted Gemini visual timestamp overlaps repaired block ${index + 1} `
        + `(${draft.start.toFixed(3)}-${draft.end.toFixed(3)})`,
      );
    }
    return { draft, index, candidates };
  });
  const unused = new Map(available.map((row) => [row.id, row]));
  const selected = new Array<TrustedVisualAnalysisRow>(drafts.length);
  // Assign constrained blocks first. This avoids a broad block consuming the
  // only visual moment that can prove a narrow neighboring block.
  for (const { draft, index, candidates: eligible } of [...eligibleByDraft].sort((left, right) =>
    left.candidates.length - right.candidates.length || left.index - right.index
  )) {
    const midpoint = (draft.start + draft.end) / 2;
    const candidates = eligible.filter((row) => unused.has(row.id)).sort((left, right) => {
      const leftTimestamp = Number(left.representative_timestamp);
      const rightTimestamp = Number(right.representative_timestamp);
      // Temporal truth wins over the legacy block id. The id is only a
      // tie-breaker because a repaired boundary may intentionally move away
      // from the old (invalid) segmentation.
      const leftSourcePenalty = left.block_id === draft.source.id ? 0 : 10_000;
      const rightSourcePenalty = right.block_id === draft.source.id ? 0 : 10_000;
      return leftSourcePenalty + Math.abs(leftTimestamp - midpoint)
        - (rightSourcePenalty + Math.abs(rightTimestamp - midpoint))
        || left.id.localeCompare(right.id);
    });
    const chosen = candidates[0];
    if (!chosen) {
      throw new Error(`trusted Gemini visual assignment exhausted for repaired block ${index + 1}`);
    }
    unused.delete(chosen.id);
    selected[index] = chosen;
  }
  return selected;
}

function payloadBlock(
  draft: BlockDraft,
  index: number,
  visual: TrustedVisualAnalysisRow,
): SpokenRebindBlock {
  const text = draft.transcript.map((segment) => segment.text).join(" ").trim();
  const semantic = deriveSpokenSemantic(text, draft.type);
  const sourceEmotion = String(draft.source.emocao || "").trim();
  return {
    index: index + 1,
    type: draft.type,
    start: Number(draft.start.toFixed(6)),
    end: Number(draft.end.toFixed(6)),
    text,
    transcript_segment_ids: draft.transcript.map((segment) => segment.id),
    transcript_segment_indexes: draft.transcript.map((segment) => segment.index),
    source_block_id: draft.source.id,
    source_visual_analysis_id: visual.id,
    narrative_function: String(draft.source.funcao_narrativa || "").trim() || functionForType(draft.type),
    schema_emotion: ALLOWED_EMOTIONS.has(sourceEmotion) ? sourceEmotion : emotionForType(draft.type),
    semantic,
    verbal: deriveSpokenVerbal(text, draft.type, semantic),
  };
}

function assertPayloadIsAuditable(payload: SpokenDnaRebindPayload, transcript: CanonicalTranscript[]): void {
  const narrative = payload.blocks.map((block) => ({
    bloco_id: block.index,
    tipo_bloco: block.type,
    tempo_inicio: block.start,
    tempo_fim: block.end,
    texto: block.text,
  }));
  assertNarrativeBlockContract(narrative, payload.duration_seconds);
  const exact = assignExactTranscriptTextToBlocks(narrative, transcript.map((segment) => ({
    tempo_inicio: segment.start,
    tempo_fim: segment.end,
    texto: segment.text,
  })));
  exact.forEach((block, index) => {
    if (String(block.texto || "") !== payload.blocks[index].text) {
      throw new Error(`rebuilt block ${index + 1} is not the exact greatest-overlap transcript assignment`);
    }
  });
  const usedIds = payload.blocks.flatMap((block) => block.transcript_segment_ids);
  if (usedIds.length !== transcript.length || new Set(usedIds).size !== transcript.length) {
    throw new Error("rebuilt transcript assignment is not exactly once");
  }
  for (const block of payload.blocks) {
    const normalized = ` ${normalizeSpokenText(block.text)} `;
    if (!block.semantic.keywords.length || !block.semantic.strong_phrases.length) {
      throw new Error(`rebuilt block ${block.index} is missing spoken patterns`);
    }
    for (const keyword of block.semantic.keywords) {
      if (!normalized.includes(` ${normalizeSpokenText(keyword)} `)) {
        throw new Error(`rebuilt block ${block.index} keyword is not spoken: ${keyword}`);
      }
    }
    for (const phrase of block.semantic.strong_phrases) {
      if (!normalized.includes(` ${normalizeSpokenText(phrase)} `)) {
        throw new Error(`rebuilt block ${block.index} phrase is not spoken: ${phrase}`);
      }
    }
  }
}

export function buildSpokenDnaRebindPayload(
  input: BuildSpokenDnaRebindInput,
): SpokenDnaRebindPayload {
  if (!(EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS as readonly string[]).includes(input.youtubeId)) {
    throw new Error(`${input.youtubeId} is not in the exact non-manual repair allowlist`);
  }
  const duration = finiteNumber(input.durationSeconds, "durationSeconds");
  if (duration <= 0 || duration > 600) throw new Error("durationSeconds must be between 0 and 600");
  const transcript = canonicalTranscripts(input.transcripts, duration);
  const blocks = sortedBlocks(input.blocks);
  const current = canKeepCurrentBlocks(blocks, transcript, duration);
  let drafts: BlockDraft[];
  let mode: SpokenDnaRebindPayload["mode"];
  if (current.keep) {
    mode = "layers_only";
    drafts = blocks.map((source, index) => ({
      source,
      type: String(source.tipo_bloco),
      start: Number(source.tempo_inicio),
      end: Number(source.tempo_fim),
      transcript: current.assignments[index].map((segmentIndex) => transcript[segmentIndex]),
    }));
  } else {
    mode = "full_rebind";
    drafts = resegmentedDrafts(transcript, blocks, duration);
    drafts = coalesceDraftsForVisualEvidence(drafts, input.visualAnalyses);
    drafts = assignDraftsByGreatestOverlap(drafts, transcript);
  }
  const visuals = chooseTrustedVisuals(drafts, input.visualAnalyses);
  const payload: SpokenDnaRebindPayload = {
    schema_version: 1,
    engine: "spoken_dna_rebind_v1",
    mode,
    youtube_id: input.youtubeId,
    video_id: input.videoId,
    duration_seconds: duration,
    transcript_sha256: spokenDnaPayloadSha256(transcript.map(({ id, index, start, end, text }) => ({
      id, index, start, end, text,
    }))),
    blocks: drafts.map((draft, index) => payloadBlock(draft, index, visuals[index])),
  };
  assertPayloadIsAuditable(payload, transcript);
  return payload;
}

export function assertExactRepairInventory(ids: readonly string[]): void {
  const actual = [...new Set(ids)].sort();
  const expected = [...EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS].sort();
  if (actual.length !== ids.length || actual.length !== expected.length
      || actual.some((id, index) => id !== expected[index])) {
    throw new Error(`repair inventory differs from exact allowlist: ${actual.join(",")}`);
  }
}
