/**
 * Fail-closed proof that every curated Viral Base narrative block is derived
 * from the persisted spoken transcript, never from a publication title or an
 * AI paraphrase. Produces a per-video JSON/Markdown artifact for the exact
 * 50-video inventory and exits non-zero unless all 50 pass.
 *
 * Required environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional environment:
 *   VIRAL_URL_FILE
 *   VIRAL_REPORT_DIR
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assignExactTranscriptTextToBlocks,
  assertTranscriptTimelineMatchesSource,
  narrativeBlockContractViolations,
  type NarrativeBlock,
  type TranscriptTextSegment,
} from "../supabase/functions/_shared/narrative-blocks.ts";

const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || "your-project-ref").trim();
const EXPECTED_VIDEO_COUNT = 50;
const URL_FILE = path.resolve(process.env.VIRAL_URL_FILE || "tmp/viral-shorts-urls.txt");
const REPORT_DIR = path.resolve(process.env.VIRAL_REPORT_DIR || ".runtime/viral-base-live");

export type DbBlock = NarrativeBlock & {
  id: string;
  bloco_id: number;
  tipo_bloco: string;
  texto: string;
  tempo_inicio: number;
  tempo_fim: number;
};

export type DbTranscript = TranscriptTextSegment & {
  id: string;
  texto: string;
  tempo_inicio: number;
  tempo_fim: number;
};

type BlockProof = {
  block_id: string;
  bloco_id: number;
  type: string;
  start: number;
  end: number;
  transcript_segment_indexes: number[];
  exact_spoken_text: string;
  persisted_text: string;
  exact_match: boolean;
  spoken_keywords: string[];
  spoken_phrases: string[];
  keyword_rows_derived_from_speech: boolean;
  phrase_rows_derived_from_speech: boolean;
  semantic_rows_derived_from_speech: boolean;
  trigger_rows_derived_from_speech: boolean;
};

type VideoProof = {
  youtube_id: string;
  video_id: string | null;
  source_url: string;
  publication_title: string | null;
  status: string | null;
  duration_seconds: number | null;
  transcript_segments: number;
  narrative_blocks: number;
  title_used_as_hook_evidence: false;
  title_equals_spoken_hook: boolean;
  persisted_hook_matches_spoken: boolean;
  persisted_payoff_matches_spoken: boolean;
  hook_text: string | null;
  hook_word_count: number;
  hook_signature: Record<string, unknown> | null;
  development_block_count: number;
  payoff_text: string | null;
  every_transcript_segment_assigned_once: boolean;
  every_block_text_exactly_spoken: boolean;
  every_block_has_spoken_keywords: boolean;
  every_block_has_spoken_phrases: boolean;
  every_block_has_spoken_semantic_terms: boolean;
  every_block_has_spoken_trigger_words: boolean;
  ready: boolean;
  reasons: string[];
  blocks: BlockProof[];
};

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function expectedOrigin(raw: string): string {
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== `${PROJECT_REF}.supabase.co`
    || parsed.port
    || parsed.username
    || parsed.password
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`SUPABASE_URL must be exactly https://${PROJECT_REF}.supabase.co`);
  }
  return parsed.origin;
}

function youtubeId(rawUrl: string): string {
  const normalized = rawUrl.trim().replace(/\\_/g, "_");
  const match = normalized.match(/(?:youtube\.com\/shorts\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!match) throw new Error(`Invalid individual YouTube URL: ${rawUrl}`);
  return match[1];
}

function canonicalUrl(id: string): string {
  return `https://www.youtube.com/shorts/${id}`;
}

function normalizedWords(value: unknown): string[] {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .match(/[a-z0-9]+/g) || [];
}

function normalizedText(value: unknown): string {
  return normalizedWords(value).join(" ");
}

function wordCount(value: unknown): number {
  return String(value || "").trim().match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function stringValues(value: unknown): string[] {
  let candidate = value;
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); } catch { return candidate.trim() ? [candidate.trim()] : []; }
  }
  return Array.isArray(candidate)
    ? candidate.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function hookSignature(text: string): Record<string, unknown> {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = normalizedWords(text);
  const escalation = new Set(["mas", "porem", "entao", "depois", "quando", "so", "ate"]);
  return {
    opening_words: words.slice(0, 8),
    word_count: wordCount(text),
    sentence_count: sentences.length,
    question: text.includes("?"),
    exclamation: text.includes("!"),
    direct_address: /\b(voce|vocês|seu|sua|teu|tua)\b/i.test(normalizedText(text)),
    number_present: /\d/.test(text),
    negative_or_danger_marker: /\b(nunca|nao|sem|perigo|morte|morreu|proibido|impossivel)\b/i.test(normalizedText(text)),
    escalation_marker_count: words.filter((word) => escalation.has(word)).length,
    withholds_resolution: !/\b(no fim|resultado|finalmente|descobriu que)\b/i.test(normalizedText(text)),
  };
}

function assignSegmentIndexes(blocks: DbBlock[], transcript: DbTranscript[]): number[][] {
  const assigned = blocks.map(() => [] as number[]);
  for (let segmentIndex = 0; segmentIndex < transcript.length; segmentIndex++) {
    const segment = transcript[segmentIndex];
    const start = Number(segment.tempo_inicio);
    const end = Number(segment.tempo_fim);
    let bestBlock = -1;
    let bestOverlap = 0;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      const overlap = Math.max(
        0,
        Math.min(end, Number(block.tempo_fim)) - Math.max(start, Number(block.tempo_inicio)),
      );
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestBlock = blockIndex;
      }
    }
    if (bestBlock < 0 || bestOverlap <= 0) {
      throw new Error(`transcript segment ${segmentIndex} has no positive block overlap`);
    }
    assigned[bestBlock].push(segmentIndex);
  }
  return assigned;
}

export type SpokenTimelineValidation = {
  expected_blocks: NarrativeBlock[];
  segment_indexes: number[][];
  every_segment_assigned_once: boolean;
  reasons: string[];
};

/**
 * Rebuilds the exact speech assignment and independently proves that both the
 * transcript and narrative cover the authoritative media timeline. Merely
 * assigning every row to its greatest-overlap block is insufficient: that is
 * true by construction even when the rows cover only the first seconds of a
 * much longer source.
 */
export function validateSpokenTimeline(
  videoDuration: unknown,
  blocks: DbBlock[],
  transcript: DbTranscript[],
): SpokenTimelineValidation {
  const reasons: string[] = [];
  const duration = Number(videoDuration);
  let expectedBlocks: NarrativeBlock[] = [];
  let segmentIndexes: number[][] = blocks.map(() => []);
  let timelineValid = false;
  let contractValid = false;

  if (!Number.isFinite(duration) || duration <= 0 || duration > 3_600) {
    reasons.push("video_duration_invalid");
  } else {
    try {
      assertTranscriptTimelineMatchesSource(transcript, duration);
      timelineValid = true;
    } catch (error) {
      reasons.push(`transcript_timeline_invalid:${error instanceof Error ? error.message : String(error)}`);
    }

    const violations = narrativeBlockContractViolations(blocks, duration);
    if (violations.length) {
      reasons.push(`narrative_timeline_invalid:${violations.join("|")}`);
    } else {
      contractValid = true;
    }
  }

  try {
    expectedBlocks = assignExactTranscriptTextToBlocks(blocks, transcript);
    segmentIndexes = assignSegmentIndexes(blocks, transcript);
  } catch (error) {
    reasons.push(`transcript_assignment_failed:${error instanceof Error ? error.message : String(error)}`);
    return {
      expected_blocks: expectedBlocks,
      segment_indexes: segmentIndexes,
      every_segment_assigned_once: false,
      reasons,
    };
  }

  const flattened = segmentIndexes.flat();
  const exactSet = flattened.length === transcript.length
    && new Set(flattened).size === transcript.length
    && flattened.every((index) => index >= 0 && index < transcript.length);
  const everyBlockHasSpeech = segmentIndexes.length === blocks.length
    && segmentIndexes.every((indexes) => indexes.length > 0);
  const strictlyContained = segmentIndexes.every((indexes, blockIndex) => {
    const blockStart = Number(blocks[blockIndex]?.tempo_inicio);
    const blockEnd = Number(blocks[blockIndex]?.tempo_fim);
    const boundaryTolerance = Math.max(0.5, duration * 0.01);
    return indexes.every((index) => {
      const segment = transcript[index];
      return Number(segment.tempo_inicio) >= blockStart - boundaryTolerance
        && Number(segment.tempo_fim) <= blockEnd + boundaryTolerance;
    });
  });
  const everySegmentOnce = timelineValid && contractValid && exactSet
    && everyBlockHasSpeech && strictlyContained;
  if (!everySegmentOnce) reasons.push("transcript_segment_assignment_not_one_to_one_and_contained");

  return {
    expected_blocks: expectedBlocks,
    segment_indexes: segmentIndexes,
    every_segment_assigned_once: everySegmentOnce,
    reasons,
  };
}

async function exactOne<T>(promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>, label: string): Promise<T> {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message || "query failed"}`);
  if (!result.data) throw new Error(`${label}: no row`);
  return result.data;
}

async function rows<T>(promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>, label: string): Promise<T[]> {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message || "query failed"}`);
  return result.data || [];
}

async function findVideoId(client: SupabaseClient, id: string): Promise<string | null> {
  const metadata = await rows<any>(
    client.from("video_metadata")
      .select("video_id,chave,valor")
      .in("chave", ["youtube_id", "source_idempotency_key"])
      .in("valor", [id, `youtube:${id}`]),
    `${id}.metadata`,
  );
  const videoIds = [...new Set(metadata.map((row) => String(row.video_id || "")).filter(Boolean))];
  if (videoIds.length > 1) throw new Error(`${id}: video lookup is not unique`);
  return videoIds[0] || null;
}

async function auditVideo(client: SupabaseClient, id: string): Promise<VideoProof> {
  const reasons: string[] = [];
  const videoId = await findVideoId(client, id);
  if (!videoId) {
    return {
      youtube_id: id,
      video_id: null,
      source_url: canonicalUrl(id),
      publication_title: null,
      status: null,
      duration_seconds: null,
      transcript_segments: 0,
      narrative_blocks: 0,
      title_used_as_hook_evidence: false,
      title_equals_spoken_hook: false,
      persisted_hook_matches_spoken: false,
      persisted_payoff_matches_spoken: false,
      hook_text: null,
      hook_word_count: 0,
      hook_signature: null,
      development_block_count: 0,
      payoff_text: null,
      every_transcript_segment_assigned_once: false,
      every_block_text_exactly_spoken: false,
      every_block_has_spoken_keywords: false,
      every_block_has_spoken_phrases: false,
      every_block_has_spoken_semantic_terms: false,
      every_block_has_spoken_trigger_words: false,
      ready: false,
      reasons: ["video_not_found"],
      blocks: [],
    };
  }

  const [video, blocks, transcript, wordRows, phraseRows, semanticRows, verbalRows] = await Promise.all([
    exactOne<any>(client.from("videos").select("titulo,status,duracao,hook_text,payoff_text").eq("id", videoId).single(), `${id}.video`),
    rows<DbBlock>(client.from("video_blocks")
      .select("id,bloco_id,tipo_bloco,texto,tempo_inicio,tempo_fim")
      .eq("video_id", videoId)
      .order("bloco_id", { ascending: true }), `${id}.blocks`),
    rows<DbTranscript>(client.from("video_transcripts")
      .select("id,texto,tempo_inicio,tempo_fim")
      .eq("video_id", videoId)
      .order("tempo_inicio", { ascending: true }), `${id}.transcript`),
    rows<any>(client.from("block_word_patterns")
      .select("block_id,word,weighted_score")
      .eq("video_id", videoId), `${id}.words`),
    rows<any>(client.from("block_phrase_patterns")
      .select("block_id,phrase,weighted_score")
      .eq("video_id", videoId), `${id}.phrases`),
    rows<any>(client.from("block_semantic_patterns")
      .select("block_id,block_emotional_words,block_repeated_words,block_strong_phrases,rare_words,dominant_words")
      .eq("video_id", videoId), `${id}.semantic`),
    rows<any>(client.from("block_verbal_analysis")
      .select("block_id,trigger_words")
      .eq("video_id", videoId), `${id}.verbal`),
  ]);

  if (video.status !== "completed") reasons.push(`video_status_${video.status || "missing"}`);
  if (!transcript.length) reasons.push("transcript_missing");
  if (blocks.length < 3 || blocks.length > 18) reasons.push(`block_count_${blocks.length}_outside_3_18`);

  const required = new Set(blocks.map((block) => String(block.tipo_bloco || "")));
  for (const type of ["hook", "desenvolvimento", "payoff"]) {
    if (!required.has(type)) reasons.push(`required_block_missing_${type}`);
  }

  const timeline = validateSpokenTimeline(video.duracao, blocks, transcript);
  const expectedBlocks = timeline.expected_blocks;
  const segmentIndexes = timeline.segment_indexes;
  const everySegmentOnce = timeline.every_segment_assigned_once;
  reasons.push(...timeline.reasons);

  const wordsByBlock = new Map<string, any[]>();
  for (const row of wordRows) wordsByBlock.set(row.block_id, [...(wordsByBlock.get(row.block_id) || []), row]);
  const phrasesByBlock = new Map<string, any[]>();
  for (const row of phraseRows) phrasesByBlock.set(row.block_id, [...(phrasesByBlock.get(row.block_id) || []), row]);
  const semanticByBlock = new Map<string, any>();
  for (const row of semanticRows) semanticByBlock.set(String(row.block_id), row);
  const verbalByBlock = new Map<string, any>();
  for (const row of verbalRows) verbalByBlock.set(String(row.block_id), row);

  const blockProofs: BlockProof[] = blocks.map((block, index) => {
    const persistedText = String(block.texto || "").trim();
    const exactSpokenText = String(expectedBlocks[index]?.texto || "").trim();
    const normalizedBlock = normalizedText(exactSpokenText);
    const blockWords = (wordsByBlock.get(block.id) || [])
      .map((row) => String(row.word || "").trim())
      .filter(Boolean);
    const blockPhrases = (phrasesByBlock.get(block.id) || [])
      .map((row) => String(row.phrase || "").trim())
      .filter(Boolean);
    const semantic = semanticByBlock.get(String(block.id));
    const semanticTerms = semantic ? [
      ...stringValues(semantic.block_emotional_words),
      ...stringValues(semantic.block_repeated_words),
      ...stringValues(semantic.block_strong_phrases),
      ...stringValues(semantic.rare_words),
      ...stringValues(semantic.dominant_words),
    ] : [];
    const triggerWords = stringValues(verbalByBlock.get(String(block.id))?.trigger_words);
    // Legacy extraction can store a short multi-word key (for example
    // "não conseguiu") in the word-pattern table. It is valid only when the
    // whole normalized key occurs contiguously in the exact spoken block.
    const keywordRowsDerived = blockWords.length > 0 && blockWords.every((word) => {
      const normalizedKeyword = normalizedText(word);
      return normalizedKeyword.length > 0
        && (` ${normalizedBlock} `).includes(` ${normalizedKeyword} `);
    });
    const phraseRowsDerived = blockPhrases.length > 0 && blockPhrases.every((phrase) => {
      const normalizedPhrase = normalizedText(phrase);
      return normalizedPhrase.length > 0 && (` ${normalizedBlock} `).includes(` ${normalizedPhrase} `);
    });
    const semanticRowsDerived = Boolean(semantic) && semanticTerms.every((term) => {
      const normalizedTerm = normalizedText(term);
      return normalizedTerm.length > 0 && (` ${normalizedBlock} `).includes(` ${normalizedTerm} `);
    });
    const triggerRowsDerived = Boolean(verbalByBlock.get(String(block.id))) && triggerWords.every((term) => {
      const normalizedTerm = normalizedText(term);
      return normalizedTerm.length > 0 && (` ${normalizedBlock} `).includes(` ${normalizedTerm} `);
    });
    return {
      block_id: block.id,
      bloco_id: Number(block.bloco_id),
      type: String(block.tipo_bloco || ""),
      start: Number(block.tempo_inicio),
      end: Number(block.tempo_fim),
      transcript_segment_indexes: segmentIndexes[index] || [],
      exact_spoken_text: exactSpokenText,
      persisted_text: persistedText,
      exact_match: persistedText === exactSpokenText && exactSpokenText.length > 0,
      spoken_keywords: blockWords,
      spoken_phrases: blockPhrases,
      keyword_rows_derived_from_speech: keywordRowsDerived,
      phrase_rows_derived_from_speech: phraseRowsDerived,
      semantic_rows_derived_from_speech: semanticRowsDerived,
      trigger_rows_derived_from_speech: triggerRowsDerived,
    };
  });

  const everyBlockExact = blocks.length > 0 && blockProofs.every((block) => block.exact_match);
  const everyBlockHasKeywords = blocks.length > 0 && blockProofs.every((block) => block.keyword_rows_derived_from_speech);
  const everyBlockHasPhrases = blocks.length > 0 && blockProofs.every((block) => block.phrase_rows_derived_from_speech);
  const everyBlockHasSemanticTerms = blocks.length > 0 && blockProofs.every((block) => block.semantic_rows_derived_from_speech);
  const everyBlockHasTriggerWords = blocks.length > 0 && blockProofs.every((block) => block.trigger_rows_derived_from_speech);
  if (!everyBlockExact) reasons.push("one_or_more_block_texts_not_exact_transcript_speech");
  if (!everyBlockHasKeywords) reasons.push("one_or_more_keyword_layers_not_derived_from_block_speech");
  if (!everyBlockHasPhrases) reasons.push("one_or_more_phrase_layers_not_derived_from_block_speech");
  if (!everyBlockHasSemanticTerms) reasons.push("one_or_more_semantic_layers_not_derived_from_block_speech");
  if (!everyBlockHasTriggerWords) reasons.push("one_or_more_verbal_trigger_layers_not_derived_from_block_speech");

  const hook = blockProofs.find((block) => block.type === "hook") || null;
  const payoff = [...blockProofs].reverse().find((block) => block.type === "payoff") || null;
  if (!hook?.exact_match) reasons.push("spoken_hook_missing_or_not_exact");
  if (!payoff?.exact_match) reasons.push("spoken_payoff_missing_or_not_exact");
  const persistedHookMatches = Boolean(
    hook?.exact_match && String(video.hook_text || "").trim() === hook.exact_spoken_text,
  );
  const persistedPayoffMatches = Boolean(
    payoff?.exact_match && String(video.payoff_text || "").trim() === payoff.exact_spoken_text,
  );
  if (!persistedHookMatches) reasons.push("persisted_hook_text_not_exact_spoken_hook");
  if (!persistedPayoffMatches) reasons.push("persisted_payoff_text_not_exact_spoken_payoff");

  return {
    youtube_id: id,
    video_id: videoId,
    source_url: canonicalUrl(id),
    publication_title: video.titulo ? String(video.titulo) : null,
    status: video.status ? String(video.status) : null,
    duration_seconds: Number.isFinite(Number(video.duracao)) ? Number(video.duracao) : null,
    transcript_segments: transcript.length,
    narrative_blocks: blocks.length,
    // The title is deliberately not passed to any comparison/derivation above.
    title_used_as_hook_evidence: false,
    title_equals_spoken_hook: Boolean(hook && String(video.titulo || "").trim() === hook.exact_spoken_text),
    persisted_hook_matches_spoken: persistedHookMatches,
    persisted_payoff_matches_spoken: persistedPayoffMatches,
    hook_text: hook?.exact_spoken_text || null,
    hook_word_count: hook ? wordCount(hook.exact_spoken_text) : 0,
    hook_signature: hook ? hookSignature(hook.exact_spoken_text) : null,
    development_block_count: blockProofs.filter((block) => block.type === "desenvolvimento").length,
    payoff_text: payoff?.exact_spoken_text || null,
    every_transcript_segment_assigned_once: everySegmentOnce,
    every_block_text_exactly_spoken: everyBlockExact,
    every_block_has_spoken_keywords: everyBlockHasKeywords,
    every_block_has_spoken_phrases: everyBlockHasPhrases,
    every_block_has_spoken_semantic_terms: everyBlockHasSemanticTerms,
    every_block_has_spoken_trigger_words: everyBlockHasTriggerWords,
    ready: reasons.length === 0,
    reasons,
    blocks: blockProofs,
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function hookExcerpt(value: string | null): string {
  if (!value) return "—";
  const words = value.trim().split(/\s+/).slice(0, 22).join(" ");
  return value.trim().split(/\s+/).length > 22 ? `${words}…` : words;
}

async function main(): Promise<void> {
  const supabaseUrl = expectedOrigin(requiredEnv("SUPABASE_URL"));
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const sourceLines = (await readFile(URL_FILE, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const ids = [...new Set(sourceLines.map(youtubeId))];
  if (ids.length !== EXPECTED_VIDEO_COUNT) {
    throw new Error(`normalized inventory contains ${ids.length}/${EXPECTED_VIDEO_COUNT} unique videos`);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const videos: VideoProof[] = [];
  for (const id of ids) {
    try {
      videos.push(await auditVideo(client, id));
    } catch (error) {
      videos.push({
        youtube_id: id,
        video_id: null,
        source_url: canonicalUrl(id),
        publication_title: null,
        status: null,
        duration_seconds: null,
        transcript_segments: 0,
        narrative_blocks: 0,
        title_used_as_hook_evidence: false,
        title_equals_spoken_hook: false,
        persisted_hook_matches_spoken: false,
        persisted_payoff_matches_spoken: false,
        hook_text: null,
        hook_word_count: 0,
        hook_signature: null,
        development_block_count: 0,
        payoff_text: null,
        every_transcript_segment_assigned_once: false,
        every_block_text_exactly_spoken: false,
        every_block_has_spoken_keywords: false,
        every_block_has_spoken_phrases: false,
        every_block_has_spoken_semantic_terms: false,
        every_block_has_spoken_trigger_words: false,
        ready: false,
        reasons: [`audit_error:${error instanceof Error ? error.message : String(error)}`],
        blocks: [],
      });
    }
  }

  const passed = videos.filter((video) => video.ready).length;
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    evidence_rule: "Publication titles are identity metadata only. Each persisted block, keyword and phrase must be derived from exact temporally assigned transcript speech.",
    inventory: {
      expected: EXPECTED_VIDEO_COUNT,
      audited: videos.length,
      passed,
      failed: videos.length - passed,
      all_passed: passed === EXPECTED_VIDEO_COUNT,
    },
    videos,
  };
  await writeJsonAtomic(path.join(REPORT_DIR, "spoken-dna-audit.json"), report);
  await writeFile(path.join(REPORT_DIR, "spoken-dna-audit.md"), [
    "# Auditoria do DNA falado — 50 Shorts",
    "",
    "O título de publicação é somente metadado de identidade. A prova usa exclusivamente transcrição temporal, blocos e padrões derivados da fala.",
    "",
    `- Aprovados: **${passed}/${EXPECTED_VIDEO_COUNT}**`,
    `- Reprovados: **${videos.length - passed}**`,
    "",
    ...videos.map((video) => [
      `## ${video.ready ? "PASS" : "FAIL"} — ${video.youtube_id}`,
      "",
      `- Gancho falado: ${hookExcerpt(video.hook_text)}`,
      `- Segmentos/blocos: ${video.transcript_segments}/${video.narrative_blocks}`,
      `- Desenvolvimento/payoff: ${video.development_block_count}/${video.payoff_text ? "sim" : "não"}`,
      `- Título usado como evidência: não`,
      `- Motivos: ${video.reasons.length ? video.reasons.join(", ") : "nenhum"}`,
      "",
    ].join("\n")),
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    expected: EXPECTED_VIDEO_COUNT,
    audited: videos.length,
    passed,
    failed: videos.length - passed,
    report: path.join(REPORT_DIR, "spoken-dna-audit.json"),
  }));
  if (passed !== EXPECTED_VIDEO_COUNT) process.exitCode = 1;
}

// vite-node may put its own loader in argv[1], so check the complete command
// line instead of assuming the user script is always at that position.
const thisFile = path.resolve(fileURLToPath(import.meta.url));
const invokedAsCli = process.argv.slice(1).some((argument) => {
  try { return path.resolve(argument) === thisFile; } catch { return false; }
});
if (invokedAsCli) await main();
