/**
 * Imports the user-provided Shorts into the shared Viral Base, runs the real
 * multimodal pipeline and creates a fail-closed shared DNA v3 preset.
 *
 * Required environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional environment:
 *   VIRAL_IMPORT_LIMIT=1       smoke-test only the first item
 *   VIRAL_SKIP_PRESET=1        do not require/publish the 50-video preset
 *   VIRAL_CONCURRENCY=2        maximum simultaneous pipelines (1..3)
 *   VIRAL_FORCE_REPROCESS=1    rerun items that already pass the audit
 */

(globalThis as any).localStorage = (globalThis as any).localStorage ?? {
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assignExactTranscriptTextToBlocks,
  narrativeBlockContractViolations,
  type NarrativeBlock,
} from "../supabase/functions/_shared/narrative-blocks.ts";

const execFileAsync = promisify(execFile);
const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || "your-project-ref").trim();
const DEFAULT_URL_FILE = path.resolve("tmp/viral-shorts-urls.txt");
const DEFAULT_WORK_DIR = path.resolve("work/viral-base-2026-07");
const DEFAULT_REPORT_DIR = path.resolve(".runtime/viral-base-live");
const DEFAULT_PRESET_NAME = "Base Viral — 50 Shorts Fornecidos (Jul 2026)";
const EXPECTED_SOURCE_COUNT = 50;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const REQUIRED_BLOCK_TYPES = ["hook", "desenvolvimento", "payoff"];
const TRUSTED_VISUAL_SOURCE_TYPES = [
  "gemini_video_understanding",
  "codex_manual_visual_audit",
] as const;
const CODEX_MANUAL_ANALYSIS_SOURCE = "Codex manual multimodal audit + YouTube pt-orig captions";
const REPORT_VERSION = 1;

type JsonRecord = Record<string, any>;

type Source = {
  id: string;
  url: string;
  infoPath: string;
  videoPath: string;
};

type AuditCounts = {
  transcripts: number;
  multimodal_moments: number;
  frames: number;
  blocks: number;
  visual_blocks: number;
  semantic_blocks: number;
  word_pattern_blocks: number;
  phrase_pattern_blocks: number;
  verbal_blocks: number;
  alignments: number;
  image_compatibility: number;
};

type Audit = {
  ready: boolean;
  reasons: string[];
  counts: AuditCounts;
  block_types: string[];
  visual_coverage: number;
  visual_source_type: string | null;
};

function isVisualOnlyAuditGap(audit: Audit): boolean {
  return !audit.ready
    && audit.visual_source_type !== "codex_manual_visual_audit"
    && audit.reasons.length > 0
    && audit.reasons.every((reason) => reason.startsWith("visual_coverage_"));
}

type ItemResult = {
  source_id: string;
  source_url: string;
  video_id: string | null;
  status: "completed" | "failed";
  reused: boolean;
  title: string | null;
  channel: string | null;
  upload_date: string | null;
  views: number;
  likes: number;
  comments: number;
  engagement_rate: number;
  audit: Audit | null;
  error: string | null;
};

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} é obrigatório`);
  return value;
}

function expectedSupabaseOrigin(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("SUPABASE_URL invalida");
  }
  const expectedHost = `${PROJECT_REF}.supabase.co`;
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== expectedHost
    || parsed.port
    || parsed.username
    || parsed.password
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`SUPABASE_URL deve ser exatamente https://${expectedHost}`);
  }
  return parsed.origin;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function boolEnv(name: string): boolean {
  return /^(1|true|yes|sim)$/i.test(String(process.env[name] || ""));
}

function youtubeId(url: string): string {
  const match = url.match(/(?:youtube\.com\/shorts\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!match) throw new Error(`URL sem ID de vídeo individual: ${url}`);
  return match[1];
}

function canonicalUrl(id: string): string {
  return `https://www.youtube.com/shorts/${id}`;
}

function safeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeLanguage(value: unknown): string {
  const language = String(value || "pt").trim().toLowerCase().split(/[-_]/)[0];
  return /^(pt|en|es)$/.test(language) ? language : "pt";
}

function redact(value: unknown): string {
  return String(value instanceof Error ? value.message : value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._-]+/g, "[REDACTED]")
    .slice(0, 1800);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function readSources(urlFile: string, workDir: string): Promise<Source[]> {
  const lines = (await readFile(urlFile, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\_/g, "_"))
    .filter(Boolean);
  const unique = new Map<string, Source>();
  for (const rawUrl of lines) {
    const id = youtubeId(rawUrl);
    const directory = path.join(workDir, id);
    unique.set(id, {
      id,
      url: canonicalUrl(id),
      infoPath: path.join(directory, `${id}.info.json`),
      videoPath: path.join(directory, `${id}.mp4`),
    });
  }
  return [...unique.values()];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function ensureDownloaded(source: Source): Promise<void> {
  if (await exists(source.videoPath) && await exists(source.infoPath)) return;
  await mkdir(path.dirname(source.videoPath), { recursive: true });
  await execFileAsync("yt-dlp", [
    "--no-playlist",
    "--continue",
    "--write-info-json",
    "--no-overwrites",
    "-f", "bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/b[height<=480]",
    "--merge-output-format", "mp4",
    "-o", path.join(path.dirname(source.videoPath), "%(id)s.%(ext)s"),
    source.url,
  ], { timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  if (!await exists(source.videoPath) || !await exists(source.infoPath)) {
    throw new Error(`yt-dlp não produziu os dois arquivos esperados para ${source.id}`);
  }
}

async function invokeFunction(
  supabaseUrl: string,
  serviceRoleKey: string,
  name: string,
  body: JsonRecord,
  timeoutMs = 8 * 60_000,
  maxAttempts = 6,
): Promise<JsonRecord> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 6) {
    throw new Error(`${name}: maxAttempts deve estar entre 1 e 6`);
  }
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retryAfterMs = 0;
    let retryAllowed = true;
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: JsonRecord = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 500) }; }
      if (response.ok && !payload.error) return payload;

      const detail = payload.error || payload.code || payload.raw || "falha";
      lastError = new Error(`${name} HTTP ${response.status}: ${detail}`);
      const providerRateLimited = response.status === 429
        || /(?:http\s*)?429|rate\s*limit|quota\s*(?:exhausted|excedida|esgotada)/i.test(String(detail));
      const providerCredentialFailure = /(?:http\s*)?(?:401|403)|ai\s+analysis\s+failed:\s*(?:401|403)/i.test(String(detail));
      const activeClaim = response.status === 409
        || /multimodal.*(?:andamento|processing)|análise multimodal em andamento/i.test(String(detail));
      const retryable = payload.retryable === true
        || providerRateLimited
        || providerCredentialFailure
        || activeClaim
        || response.status === 408
        || response.status === 409
        || response.status === 425
        || response.status === 429
        || response.status >= 500;
      retryAllowed = retryable;
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 120_000)
        : providerRateLimited
        ? 60_000
        : activeClaim
        ? 120_000
        : 0;
      if (!retryable || attempt === maxAttempts) throw lastError;
    } catch (error) {
      if (controller.signal.aborted) {
        lastError = new Error(`${name} excedeu ${Math.round(timeoutMs / 1000)}s`);
      } else if (!(error instanceof Error && error === lastError)) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (!retryAllowed || attempt === maxAttempts) throw lastError;
    } finally {
      clearTimeout(timeout);
    }

    const delayMs = retryAfterMs || Math.min(1_500 * 2 ** (attempt - 1), 20_000);
    console.warn(`[${name}] tentativa ${attempt}/${maxAttempts} falhou; repetindo em ${Math.round(delayMs / 1000)}s: ${lastError?.message}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw lastError ?? new Error(`${name} falhou sem resposta`);
}

async function countRows(client: SupabaseClient, table: string, videoId: string): Promise<number> {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("video_id", videoId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function countDistinctBlocks(
  client: SupabaseClient,
  table: string,
  videoId: string,
  filters: Record<string, string | readonly string[]> = {},
): Promise<number> {
  let query = client.from(table).select("block_id").eq("video_id", videoId);
  for (const [column, value] of Object.entries(filters)) {
    query = Array.isArray(value)
      ? query.in(column, [...value])
      : query.eq(column, value as string);
  }
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return new Set((data || []).map((row: any) => row.block_id).filter(Boolean)).size;
}

function visualMomentCount(value: unknown): number {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function normalizedSpokenText(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .match(/[a-z0-9]+/g)?.join(" ") || "";
}

function isContiguousSpokenSubstring(candidate: unknown, exactBlockText: unknown): boolean {
  const needle = normalizedSpokenText(candidate);
  const speech = normalizedSpokenText(exactBlockText);
  return needle.length > 0 && (` ${speech} `).includes(` ${needle} `);
}

async function trustedVisualFrames(
  client: SupabaseClient,
  videoId: string,
): Promise<{ count: number; sources: string[] }> {
  const { data, error } = await client.from("video_frames")
    .select("frame_hash, timestamp_seconds, source_method")
    .eq("video_id", videoId)
    .in("source_method", [...TRUSTED_VISUAL_SOURCE_TYPES]);
  if (error) throw new Error(`video_frames: ${error.message}`);
  const moments = new Set((data || []).map((row: any) => {
    const hash = String(row.frame_hash || "").trim();
    return hash || (Number.isFinite(Number(row.timestamp_seconds)) ? `at:${Number(row.timestamp_seconds).toFixed(3)}` : "");
  }).filter(Boolean));
  const sources = [...new Set((data || [])
    .map((row: any) => String(row.source_method || "").trim())
    .filter(Boolean))];
  return { count: moments.size, sources };
}

async function trustedVisualBlocks(
  client: SupabaseClient,
  videoId: string,
): Promise<{ count: number; sources: string[] }> {
  const { data, error } = await client.from("visual_block_analysis")
    .select("block_id, data_source_type")
    .eq("video_id", videoId)
    .in("data_source_type", [...TRUSTED_VISUAL_SOURCE_TYPES]);
  if (error) throw new Error(`visual_block_analysis: ${error.message}`);
  return {
    count: new Set((data || []).map((row: any) => row.block_id).filter(Boolean)).size,
    sources: [...new Set((data || [])
      .map((row: any) => String(row.data_source_type || "").trim())
      .filter(Boolean))],
  };
}

async function auditVideo(
  client: SupabaseClient,
  videoId: string,
  expectedDuration: number,
): Promise<Audit> {
  const [
    transcriptsResult,
    frameEvidence,
    visualBlockEvidence,
    semanticBlocks,
    wordPatternRowsResult,
    phrasePatternRowsResult,
    verbalBlocks,
    alignments,
    imageCompatibility,
    blocksResult,
    visualMetadataResult,
    analysisSourceResult,
  ] = await Promise.all([
    client.from("video_transcripts")
      .select("id, tempo_inicio, tempo_fim, texto")
      .eq("video_id", videoId)
      .order("tempo_inicio", { ascending: true }),
    trustedVisualFrames(client, videoId),
    trustedVisualBlocks(client, videoId),
    countDistinctBlocks(client, "block_semantic_patterns", videoId),
    client.from("block_word_patterns")
      .select("block_id,word")
      .eq("video_id", videoId),
    client.from("block_phrase_patterns")
      .select("block_id,phrase")
      .eq("video_id", videoId),
    countDistinctBlocks(client, "block_verbal_analysis", videoId),
    countDistinctBlocks(client, "text_visual_alignment", videoId),
    countDistinctBlocks(client, "text_image_compatibility", videoId),
    client.from("video_blocks")
      .select("id, bloco_id, tipo_bloco, texto, tempo_inicio, tempo_fim")
      .eq("video_id", videoId)
      .order("bloco_id", { ascending: true }),
    client.from("video_metadata").select("chave, valor").eq("video_id", videoId)
      .in("chave", ["multimodal_visual_analysis", "codex_manual_visual_analysis"]),
    client.from("video_metadata").select("valor").eq("video_id", videoId)
      .eq("chave", "analysis_source").maybeSingle(),
  ]);
  if (transcriptsResult.error) throw new Error(`video_transcripts: ${transcriptsResult.error.message}`);
  if (blocksResult.error) throw new Error(`video_blocks: ${blocksResult.error.message}`);
  if (wordPatternRowsResult.error) throw new Error(`block_word_patterns: ${wordPatternRowsResult.error.message}`);
  if (phrasePatternRowsResult.error) throw new Error(`block_phrase_patterns: ${phrasePatternRowsResult.error.message}`);
  if (visualMetadataResult.error) throw new Error(`video_metadata: ${visualMetadataResult.error.message}`);
  if (analysisSourceResult.error) throw new Error(`analysis_source: ${analysisSourceResult.error.message}`);
  const frameSources = frameEvidence.sources;
  const visualSources = visualBlockEvidence.sources;
  const visualSourceType = frameSources.length === 1 && visualSources.length === 1 && frameSources[0] === visualSources[0]
    ? frameSources[0]
    : null;
  const expectedMetadataKey = visualSourceType === "codex_manual_visual_audit"
    ? "codex_manual_visual_analysis"
    : visualSourceType === "gemini_video_understanding"
    ? "multimodal_visual_analysis"
    : null;
  const visualMetadata = (visualMetadataResult.data || []).find((row: any) => row.chave === expectedMetadataKey);
  const multimodalMoments = visualMomentCount(visualMetadata?.valor);
  const persistedBlocks = (blocksResult.data || []) as NarrativeBlock[];
  const transcriptRows = (transcriptsResult.data || []) as Array<{
    tempo_inicio: number;
    tempo_fim: number;
    texto: string;
  }>;
  const transcripts = transcriptRows.length;
  const blockTypes = [...new Set(persistedBlocks.map((row) => String(row.tipo_bloco || "")).filter(Boolean))];
  const blocks = blocksResult.data?.length || 0;
  const wordPatternRows = wordPatternRowsResult.data || [];
  const phrasePatternRows = phrasePatternRowsResult.data || [];
  const wordPatternBlocks = new Set(wordPatternRows.map((row: any) => row.block_id).filter(Boolean)).size;
  const phrasePatternBlocks = new Set(phrasePatternRows.map((row: any) => row.block_id).filter(Boolean)).size;
  const counts: AuditCounts = {
    transcripts,
    multimodal_moments: multimodalMoments,
    frames: frameEvidence.count,
    blocks,
    visual_blocks: visualBlockEvidence.count,
    semantic_blocks: semanticBlocks,
    word_pattern_blocks: wordPatternBlocks,
    phrase_pattern_blocks: phrasePatternBlocks,
    verbal_blocks: verbalBlocks,
    alignments,
    image_compatibility: imageCompatibility,
  };
  const reasons: string[] = [];
  if (transcripts < 1) reasons.push("transcript_missing");
  if (!visualSourceType) {
    reasons.push(`trusted_visual_source_mismatch_frames_${frameSources.join("+") || "none"}_blocks_${visualSources.join("+") || "none"}`);
  }
  if (!expectedMetadataKey || !visualMetadata) reasons.push("trusted_visual_metadata_missing_or_mismatched");
  const analysisSource = String(analysisSourceResult.data?.valor || "");
  if (visualSourceType === "codex_manual_visual_audit" && analysisSource !== CODEX_MANUAL_ANALYSIS_SOURCE) {
    reasons.push("codex_manual_analysis_source_mismatch");
  }
  if (visualSourceType === "gemini_video_understanding" && !/gemini/i.test(analysisSource)) {
    reasons.push("gemini_analysis_source_mismatch");
  }
  if (multimodalMoments < 3) reasons.push(`multimodal_moments_${multimodalMoments}_below_3`);
  if (frameEvidence.count < 3) reasons.push(`visual_moments_${frameEvidence.count}_below_3`);
  if (blocks < 3) reasons.push(`narrative_blocks_${blocks}_below_3`);
  if (blocks > 18) reasons.push(`narrative_blocks_${blocks}_above_18`);
  for (const required of REQUIRED_BLOCK_TYPES) {
    if (!blockTypes.includes(required)) reasons.push(`required_block_missing_${required}`);
  }
  for (const violation of narrativeBlockContractViolations(persistedBlocks, expectedDuration)) {
    reasons.push(`narrative_timeline_${violation}`);
  }
  try {
    const exactSpeechBlocks = assignExactTranscriptTextToBlocks(persistedBlocks, transcriptRows);
    if (exactSpeechBlocks.some((expected, index) =>
      String(expected.texto ?? "") !== String(persistedBlocks[index]?.texto ?? "")
    )) {
      reasons.push("transcript_block_text_mismatch");
    }
  } catch {
    reasons.push("transcript_block_assignment_error");
  }
  const blockTextById = new Map((blocksResult.data || []).map((block: any) => [
    String(block.id),
    String(block.texto || ""),
  ]));
  const wordsByBlock = new Map<string, any[]>();
  for (const row of wordPatternRows as any[]) {
    const blockId = String(row.block_id || "");
    wordsByBlock.set(blockId, [...(wordsByBlock.get(blockId) || []), row]);
  }
  const phrasesByBlock = new Map<string, any[]>();
  for (const row of phrasePatternRows as any[]) {
    const blockId = String(row.block_id || "");
    phrasesByBlock.set(blockId, [...(phrasesByBlock.get(blockId) || []), row]);
  }
  const wordContentValid = [...blockTextById].every(([blockId, exactText]) => {
    const rowsForBlock = wordsByBlock.get(blockId) || [];
    return rowsForBlock.length > 0
      && rowsForBlock.every((row) => isContiguousSpokenSubstring(row.word, exactText));
  });
  const phraseContentValid = [...blockTextById].every(([blockId, exactText]) => {
    const rowsForBlock = phrasesByBlock.get(blockId) || [];
    return rowsForBlock.length > 0
      && rowsForBlock.every((row) => isContiguousSpokenSubstring(row.phrase, exactText));
  });
  if (!wordContentValid) reasons.push("word_pattern_not_contiguous_spoken_block_text");
  if (!phraseContentValid) reasons.push("phrase_pattern_not_contiguous_spoken_block_text");
  // This curated preset is fail-closed: every narrative block must be backed
  // by one of the two explicit trusted visual observation sources, never by a
  // calculated/corpus-level majority.
  if (visualBlockEvidence.count < blocks) reasons.push(`visual_coverage_${visualBlockEvidence.count}_of_${blocks}`);
  if (semanticBlocks < blocks) reasons.push(`semantic_coverage_${semanticBlocks}_of_${blocks}`);
  if (wordPatternBlocks < blocks) reasons.push(`word_pattern_coverage_${wordPatternBlocks}_of_${blocks}`);
  if (phrasePatternBlocks < blocks) reasons.push(`phrase_pattern_coverage_${phrasePatternBlocks}_of_${blocks}`);
  if (verbalBlocks < blocks) reasons.push(`verbal_coverage_${verbalBlocks}_of_${blocks}`);
  if (alignments < blocks) reasons.push(`alignment_coverage_${alignments}_of_${blocks}`);
  if (imageCompatibility < blocks) reasons.push(`image_compatibility_${imageCompatibility}_of_${blocks}`);
  return {
    ready: reasons.length === 0,
    reasons,
    counts,
    block_types: blockTypes,
    visual_coverage: blocks ? +(visualBlockEvidence.count / blocks).toFixed(4) : 0,
    visual_source_type: visualSourceType,
  };
}

async function findExistingVideo(client: SupabaseClient, source: Source): Promise<JsonRecord | null> {
  const { data: metadata, error: metadataError } = await client.from("video_metadata")
    .select("video_id")
    .in("chave", ["youtube_id", "source_idempotency_key"])
    .in("valor", [source.id, `youtube:${source.id}`])
    .limit(1);
  if (metadataError) throw metadataError;
  const metadataId = metadata?.[0]?.video_id;
  if (metadataId) {
    const { data, error } = await client.from("videos").select("*").eq("id", metadataId).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const { data, error } = await client.from("videos").select("*").eq("origem", source.url).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertVideo(
  client: SupabaseClient,
  source: Source,
  info: JsonRecord,
  fileSize: number,
): Promise<{ video: JsonRecord; created: boolean }> {
  const views = safeNumber(info.view_count);
  const likes = safeNumber(info.like_count);
  const comments = safeNumber(info.comment_count);
  if (views <= 0) throw new Error("view_count ausente; este vídeo não pode ponderar o DNA");
  const engagementRate = (likes + comments) / views;
  const payload = {
    titulo: String(info.title || source.id).slice(0, 500),
    origem: source.url,
    tipo_entrada: "link",
    segmento: "curiosidade" as const,
    estilo_visual: "animacao" as const,
    idioma: normalizeLanguage(info.language),
    duracao: safeNumber(info.duration),
    tamanho: fileSize,
    views,
    likes,
    comments,
    engagement_rate: engagementRate,
    approved_for_global: true,
  };
  const existing = await findExistingVideo(client, source);
  if (existing) {
    if (existing.created_by) {
      throw new Error("fonte ja pertence a uma biblioteca pessoal; a CLI nao a promovera para a Base Global");
    }
    const { data, error } = await client.from("videos").update(payload).eq("id", existing.id).select("*").single();
    if (error) throw error;
    return { video: data, created: false };
  }
  const { data, error } = await client.from("videos")
    .insert({ ...payload, created_by: null, status: "pending" as const })
    .select("*")
    .single();
  if (error) throw error;
  return { video: data, created: true };
}

async function uploadSource(client: SupabaseClient, videoId: string, videoPath: string): Promise<string> {
  const buffer = await readFile(videoPath);
  if (!buffer.length || buffer.length > MAX_VIDEO_BYTES) throw new Error(`arquivo inválido: ${buffer.length} bytes`);
  const storagePath = `dna-sources/viral-base-2026-07/${videoId}.mp4`;
  const { error } = await client.storage.from("videos").upload(storagePath, buffer, {
    upsert: true,
    contentType: "video/mp4",
    cacheControl: "3600",
  });
  if (error) throw new Error(`Storage: ${error.message}`);
  return storagePath;
}

async function replaceSourceMetadata(
  client: SupabaseClient,
  videoId: string,
  source: Source,
  info: JsonRecord,
  storagePath: string,
): Promise<void> {
  const { error: metadataError } = await client.from("video_metadata").upsert([
    { video_id: videoId, chave: "file_path", valor: storagePath },
    { video_id: videoId, chave: "youtube_id", valor: source.id },
    { video_id: videoId, chave: "source_idempotency_key", valor: `youtube:${source.id}` },
    { video_id: videoId, chave: "source_channel", valor: String(info.channel || info.uploader || "") },
    { video_id: videoId, chave: "upload_date", valor: String(info.upload_date || "") },
    { video_id: videoId, chave: "analysis_source", valor: "yt-dlp metadata + Gemini whole-video multimodal pipeline" },
  ], { onConflict: "video_id,chave" });
  if (metadataError) throw metadataError;
  const language = normalizeLanguage(info.language);
  const { error: languageDelete } = await client.from("video_languages").delete().eq("video_id", videoId);
  if (languageDelete) throw languageDelete;
  const { error: languageInsert } = await client.from("video_languages").insert({
    video_id: videoId,
    language_code: language,
    is_original: true,
  });
  if (languageInsert) throw languageInsert;
}

async function resetQueue(client: SupabaseClient, videoId: string, priority: number): Promise<void> {
  const { data, error } = await client.from("processing_queue")
    .select("id")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const payload = {
    status: "pending" as const,
    priority,
    started_at: null,
    completed_at: null,
    error_message: null,
  };
  if (data?.[0]) {
    const result = await client.from("processing_queue").update(payload).eq("id", data[0].id);
    if (result.error) throw result.error;
  } else {
    const result = await client.from("processing_queue").insert({ video_id: videoId, ...payload });
    if (result.error) throw result.error;
  }
  const status = await client.from("videos").update({ status: "pending" }).eq("id", videoId);
  if (status.error) throw status.error;
}

async function markPipelineStarted(client: SupabaseClient, videoId: string): Promise<void> {
  const startedAt = new Date().toISOString();
  const video = await client.from("videos").update({ status: "processing" }).eq("id", videoId);
  if (video.error) throw video.error;
  const queue = await client.from("processing_queue").update({
    status: "processing",
    started_at: startedAt,
    completed_at: null,
    error_message: null,
  }).eq("video_id", videoId).eq("status", "pending");
  if (queue.error) throw queue.error;
}

async function markPipelineCompleted(client: SupabaseClient, videoId: string, audit: Audit): Promise<void> {
  const completedAt = new Date().toISOString();
  const video = await client.from("videos").update({
    status: "completed",
    numero_frames: audit.counts.frames,
    numero_blocos: audit.counts.blocks,
  }).eq("id", videoId);
  if (video.error) throw video.error;
  const queue = await client.from("processing_queue").update({
    status: "completed",
    completed_at: completedAt,
    error_message: null,
  }).eq("video_id", videoId);
  if (queue.error) throw queue.error;
}

async function runDirectPipeline(
  client: SupabaseClient,
  supabaseUrl: string,
  serviceRoleKey: string,
  videoId: string,
  storagePath: string,
  duration: number,
): Promise<Audit> {
  await markPipelineStarted(client, videoId);
  const transcribe = (force = false) => invokeFunction(supabaseUrl, serviceRoleKey, "transcribe-video", {
    video_id: videoId,
    file_path: storagePath,
    video_duration: duration,
    ...(force ? { force: true } : {}),
  });
  const analyzeNarrative = () => invokeFunction(supabaseUrl, serviceRoleKey, "analyze-narrative", {
    video_id: videoId,
    orchestrated: true,
  }, 3 * 60_000);
  const extractVisuals = () => invokeFunction(supabaseUrl, serviceRoleKey, "extract-visual-blocks", {
    video_id: videoId,
  });
  const runMandatoryDerivedLayers = async () => {
    // These layers are mandatory for this curated base even though the browser
    // pipeline historically treated them as optional.
    for (const functionName of [
      "extract-block-semantics",
      "extract-verbal-dna",
      "calculate-text-visual-alignment",
      "calculate-text-image-compatibility",
    ]) {
      const timeoutMs = functionName === "extract-block-semantics" ? 210_000 : 8 * 60_000;
      await invokeFunction(supabaseUrl, serviceRoleKey, functionName, { video_id: videoId }, timeoutMs);
    }
  };

  const multimodal = await transcribe();
  if (safeNumber(multimodal.segments_count) < 1 || safeNumber(multimodal.visual_moments) < 3) {
    throw new Error("transcribe-video não confirmou transcrição e pelo menos 3 momentos visuais");
  }
  const narrative = await analyzeNarrative();
  if (safeNumber(narrative.blocks_count) < 3) throw new Error("analyze-narrative produziu menos de 3 blocos");
  const visual = await extractVisuals();
  if (safeNumber(visual.observed_blocks) < 1 || safeNumber(visual.multimodal_moments) < 3) {
    throw new Error("extract-visual-blocks não confirmou evidência visual real");
  }
  await runMandatoryDerivedLayers();

  let audit = await auditVideo(client, videoId, duration);
  if (!audit.ready) {
    const needsFreshVisualRead = audit.reasons.some((reason) =>
      reason.startsWith("multimodal_moments_")
      || reason.startsWith("visual_moments_")
      || reason.startsWith("visual_coverage_"));
    const needsNarrativeRetry = needsFreshVisualRead || audit.reasons.some((reason) =>
      reason.startsWith("narrative_blocks_")
      || reason.startsWith("required_block_missing_")
      || reason.startsWith("narrative_timeline_")
      || reason.startsWith("transcript_block_"));

    console.warn(`[${videoId}] auditoria pediu remediação: ${audit.reasons.join(", ")}`);
    if (needsFreshVisualRead) {
      const refreshed = await transcribe(true);
      if (safeNumber(refreshed.segments_count) < 1 || safeNumber(refreshed.visual_moments) < 3) {
        throw new Error("releitura visual não confirmou evidência multimodal suficiente");
      }
    }
    if (needsNarrativeRetry) {
      const retriedNarrative = await analyzeNarrative();
      if (safeNumber(retriedNarrative.blocks_count) < 3) {
        throw new Error("remediação narrativa produziu menos de 3 blocos");
      }
    }
    await extractVisuals();
    await runMandatoryDerivedLayers();
    audit = await auditVideo(client, videoId, duration);
  }
  if (!audit.ready) throw new Error(`auditoria incompleta: ${audit.reasons.join(", ")}`);
  await markPipelineCompleted(client, videoId, audit);
  return audit;
}

async function processOne(
  client: SupabaseClient,
  supabaseUrl: string,
  serviceRoleKey: string,
  source: Source,
  priority: number,
  forceReprocess: boolean,
): Promise<ItemResult> {
  let videoId: string | null = null;
  let info: JsonRecord = {};
  try {
    await ensureDownloaded(source);
    const fileStat = await stat(source.videoPath);
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_VIDEO_BYTES) {
      throw new Error(`mídia fora do limite: ${fileStat.size} bytes`);
    }
    info = JSON.parse(await readFile(source.infoPath, "utf8"));
    const expectedDuration = safeNumber(info.duration);
    if (expectedDuration <= 0) throw new Error(`duracao de fonte invalida para ${source.id}`);
    const { video, created } = await upsertVideo(client, source, info, fileStat.size);
    videoId = video.id;

    if (!forceReprocess) {
      const existingAudit = await auditVideo(client, videoId, expectedDuration);
      if (existingAudit.ready) {
        if (video.status !== "completed") {
          await markPipelineCompleted(client, videoId, existingAudit);
        }
        console.log(`[${source.id}] reutilizado: auditoria completa`);
        return resultFrom(source, videoId, info, existingAudit, true, null);
      }

      // A partial legacy run can already contain a valid transcript, exact
      // narrative blocks and every derived text layer while only its visual
      // block association is incomplete. Re-running upload, whole-video
      // transcription and narrative generation in that case wastes provider
      // quota and can replace otherwise approved evidence. Repair the visual
      // association first; the strict audit below still fails closed unless
      // every block is backed by a real persisted Gemini observation.
      if (isVisualOnlyAuditGap(existingAudit)) {
        console.log(`[${source.id}] remediacao visual isolada`);
        try {
          // The input is immutable. A deterministic 422 cannot improve on six
          // identical calls, so try once and then fall through to the complete
          // pipeline, which can refresh the underlying visual evidence.
          const visual = await invokeFunction(supabaseUrl, serviceRoleKey, "extract-visual-blocks", {
            video_id: videoId,
          }, 8 * 60_000, 1);
          if (safeNumber(visual.multimodal_moments) >= 3) {
            const repairedAudit = await auditVideo(client, videoId, expectedDuration);
            if (repairedAudit.ready) {
              await markPipelineCompleted(client, videoId, repairedAudit);
              console.log(`[${source.id}] concluido: remediacao visual 100%`);
              return resultFrom(source, videoId, info, repairedAudit, true, null);
            }
            console.warn(`[${source.id}] remediacao visual ainda incompleta: ${repairedAudit.reasons.join(", ")}`);
          }
        } catch (isolatedRepairError) {
          console.warn(`[${source.id}] remediacao visual isolada falhou uma vez; seguindo para pipeline completo: ${redact(isolatedRepairError)}`);
        }
      }
    }

    console.log(`[${source.id}] upload e análise multimodal${created ? " (novo)" : " (retomada)"}`);
    const storagePath = await uploadSource(client, videoId, source.videoPath);
    await replaceSourceMetadata(client, videoId, source, info, storagePath);
    await resetQueue(client, videoId, priority);
    const audit = await runDirectPipeline(
      client,
      supabaseUrl,
      serviceRoleKey,
      videoId,
      storagePath,
      expectedDuration,
    );
    console.log(`[${source.id}] concluído: ${audit.counts.blocks} blocos, ${(audit.visual_coverage * 100).toFixed(0)}% visual`);
    return resultFrom(source, videoId, info, audit, false, null);
  } catch (error) {
    const message = redact(error);
    console.error(`[${source.id}] FALHOU: ${message}`);
    if (videoId) {
      try {
        const [videoUpdate, queueUpdate] = await Promise.all([
          client.from("videos").update({ status: "failed" }).eq("id", videoId),
          client.from("processing_queue").update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: message,
          }).eq("video_id", videoId),
        ]);
        const cleanupErrors = [videoUpdate.error, queueUpdate.error].filter(Boolean);
        if (cleanupErrors.length) {
          console.error(`[${source.id}] falha ao persistir estado failed: ${cleanupErrors.map((item) => redact(item)).join("; ")}`);
        }
      } catch (cleanupError) {
        console.error(`[${source.id}] falha de rede ao persistir estado failed: ${redact(cleanupError)}`);
      }
    }
    return resultFrom(source, videoId, info, null, false, message);
  }
}

function resultFrom(
  source: Source,
  videoId: string | null,
  info: JsonRecord,
  audit: Audit | null,
  reused: boolean,
  error: string | null,
): ItemResult {
  const views = safeNumber(info.view_count);
  const likes = safeNumber(info.like_count);
  const comments = safeNumber(info.comment_count);
  return {
    source_id: source.id,
    source_url: source.url,
    video_id: videoId,
    status: error ? "failed" : "completed",
    reused,
    title: info.title ? String(info.title).slice(0, 500) : null,
    channel: info.channel || info.uploader || null,
    upload_date: info.upload_date ? String(info.upload_date) : null,
    views,
    likes,
    comments,
    engagement_rate: views ? +((likes + comments) / views).toFixed(8) : 0,
    audit,
    error,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return results;
}

async function createSharedPreset(
  client: SupabaseClient,
  videoIds: string[],
  name: string,
  publishedInLast30Days: number,
): Promise<{ id: string; stylePack: JsonRecord }> {
  const dna = await import("../src/lib/dna-style-pack");
  const stylePack = await dna.buildDnaStylePack("pt", { videoIds, client: client as any });
  const readiness = dna.validateDnaStylePack(stylePack);
  if (!stylePack || !readiness.ready) {
    throw new Error(`DNA v3 reprovado: ${readiness.reasons.join(", ")}`);
  }
  if (stylePack.total_videos !== EXPECTED_SOURCE_COUNT) {
    throw new Error(`DNA consolidou ${stylePack.total_videos}/${EXPECTED_SOURCE_COUNT} fontes`);
  }
  const quality = stylePack.extraction_quality;
  if (quality.video_coverage !== 1 || quality.text_strategy_coverage !== 1 || quality.visual_strategy_coverage !== 1) {
    throw new Error(`cobertura DNA incompleta: ${JSON.stringify(quality)}`);
  }
  for (const type of REQUIRED_BLOCK_TYPES) {
    const block = stylePack.block_styles.find((candidate: any) => candidate.block_type === type);
    if (!block?.strategy) throw new Error(`estratégia ausente: ${type}`);
    const expected = Math.min(block.strategy.source_video_count, dna.MAX_PROTECTED_EXAMPLES_PER_BLOCK);
    const protectedSources = new Set((block.protected_examples || []).map((item: any) => item.video_id).filter(Boolean));
    if (protectedSources.size !== expected) {
      throw new Error(`guarda ${type}: ${protectedSources.size}/${expected} fontes protegidas`);
    }
  }

  const { data: previous, error: previousError } = await client.from("dataset_cohort")
    .select("id")
    .eq("cohort_type", "dna_preset")
    .eq("cohort_name", name);
  if (previousError) throw previousError;

  const { data: created, error: createError } = await client.from("dataset_cohort").insert({
    cohort_name: name,
    cohort_type: "dna_preset",
    created_by: null,
    video_ids: videoIds,
    video_count: videoIds.length,
    confidence_score: 100,
    active: true,
    data_source_type: "derived",
    origin_level: "calculated",
    rules_json: {
      kind: "dna_preset",
      target_lang: "pt",
      style_pack: stylePack,
      consolidated_at: new Date().toISOString(),
      source_inventory: {
        requested_entries: 61,
        unique_videos: EXPECTED_SOURCE_COUNT,
        duplicates_removed: 11,
        published_in_last_30_days: publishedInLast30Days,
      },
    },
  }).select("id").single();
  if (createError || !created) throw new Error(createError?.message || "preset não foi criado");

  const mappings = videoIds.map((videoId) => ({ cohort_id: created.id, video_id: videoId }));
  const { error: mappingError } = await client.from("dataset_cohort_videos").insert(mappings);
  if (mappingError) {
    await client.from("dataset_cohort").delete().eq("id", created.id);
    throw new Error(`mapeamento do preset: ${mappingError.message}`);
  }
  const previousIds = (previous || []).map((row: any) => row.id).filter((id: string) => id !== created.id);
  if (previousIds.length) {
    const { error: deleteError } = await client.from("dataset_cohort").delete().in("id", previousIds);
    if (deleteError) console.warn(`Preset novo está válido, mas versões anteriores não foram removidas: ${deleteError.message}`);
  }
  return { id: created.id, stylePack: stylePack as unknown as JsonRecord };
}

async function requireNominalSpokenDnaAudit(
  urlFile: string,
  reportDir: string,
): Promise<void> {
  try {
    await execFileAsync(process.execPath, [
      path.resolve("node_modules/vite-node/vite-node.mjs"),
      "--script",
      path.resolve("scripts/audit-viral-spoken-dna-live.ts"),
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VIRAL_URL_FILE: urlFile,
        VIRAL_REPORT_DIR: reportDir,
      },
      timeout: 180_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`auditoria nominal falada bloqueou o preset: ${redact(error)}`);
  }
  const nominal = JSON.parse(
    await readFile(path.join(reportDir, "spoken-dna-audit.json"), "utf8"),
  ) as { inventory?: { expected?: number; audited?: number; passed?: number; failed?: number } };
  if (nominal.inventory?.expected !== EXPECTED_SOURCE_COUNT
      || nominal.inventory?.audited !== EXPECTED_SOURCE_COUNT
      || nominal.inventory?.passed !== EXPECTED_SOURCE_COUNT
      || nominal.inventory?.failed !== 0) {
    throw new Error(
      `auditoria nominal falada reprovada: ${nominal.inventory?.passed || 0}/${EXPECTED_SOURCE_COUNT}`,
    );
  }
}

function stylePackSummary(stylePack: JsonRecord): JsonRecord {
  return {
    version: stylePack.version,
    total_videos: stylePack.total_videos,
    dominant_sequence: stylePack.dominant_sequence,
    extraction_quality: stylePack.extraction_quality,
    strategy_contract: stylePack.strategy_contract,
    block_strategies: (stylePack.block_styles || []).map((block: JsonRecord) => ({
      block_type: block.block_type,
      dominant_emotion: block.dominant_emotion,
      median_words: block.median_words,
      avg_words_per_second: block.avg_words_per_second,
      protected_source_count: new Set((block.protected_examples || []).map((item: JsonRecord) => item.video_id).filter(Boolean)).size,
      strategy: block.strategy,
    })),
  };
}

async function main(): Promise<void> {
  const supabaseUrl = expectedSupabaseOrigin(requiredEnv("SUPABASE_URL"));
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const urlFile = path.resolve(process.env.VIRAL_URL_FILE || DEFAULT_URL_FILE);
  const workDir = path.resolve(process.env.VIRAL_WORK_DIR || DEFAULT_WORK_DIR);
  const reportDir = path.resolve(process.env.VIRAL_REPORT_DIR || DEFAULT_REPORT_DIR);
  const presetName = String(process.env.VIRAL_PRESET_NAME || DEFAULT_PRESET_NAME).trim();
  const limit = intEnv("VIRAL_IMPORT_LIMIT", 0, 0, EXPECTED_SOURCE_COUNT);
  const concurrency = intEnv("VIRAL_CONCURRENCY", 2, 1, 3);
  const skipPreset = boolEnv("VIRAL_SKIP_PRESET");
  const forceReprocess = boolEnv("VIRAL_FORCE_REPROCESS");

  const allSources = await readSources(urlFile, workDir);
  if (allSources.length !== EXPECTED_SOURCE_COUNT) {
    throw new Error(`inventário normalizado contém ${allSources.length}/${EXPECTED_SOURCE_COUNT} fontes`);
  }
  const sources = limit ? allSources.slice(0, limit) : allSources;
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const startedAt = new Date().toISOString();
  console.log(`Base Viral: ${sources.length} item(ns), concorrência ${concurrency}, preset=${skipPreset ? "não" : "sim"}`);
  const results = await mapWithConcurrency(sources, concurrency, (source, index) =>
    processOne(client, supabaseUrl, serviceRoleKey, source, index, forceReprocess));
  const completed = results.filter((item) => item.status === "completed");
  const failed = results.filter((item) => item.status === "failed");

  let preset: JsonRecord | null = null;
  let presetError: string | null = null;
  if (!skipPreset) {
    if (sources.length !== EXPECTED_SOURCE_COUNT || completed.length !== EXPECTED_SOURCE_COUNT) {
      presetError = `preset bloqueado: ${completed.length}/${EXPECTED_SOURCE_COUNT} vídeos passaram; ${failed.length} falharam`;
    } else {
      try {
        const videoIds = completed.map((item) => item.video_id).filter((id): id is string => Boolean(id));
        if (new Set(videoIds).size !== EXPECTED_SOURCE_COUNT) {
          throw new Error("preset bloqueado: IDs de vídeo não são 50/50 únicos");
        }
        await requireNominalSpokenDnaAudit(urlFile, reportDir);
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const publishedInLast30Days = completed.filter((item) => {
          const match = (item.upload_date || "").match(/^(\d{4})(\d{2})(\d{2})$/);
          if (!match) return false;
          const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
          return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= Date.now();
        }).length;
        const created = await createSharedPreset(client, videoIds, presetName, publishedInLast30Days);
        preset = { id: created.id, name: presetName, shared: true, ...stylePackSummary(created.stylePack) };
        console.log(`Preset compartilhado criado: ${presetName} (${created.id})`);
      } catch (error) {
        presetError = redact(error);
        console.error(`PRESET BLOQUEADO: ${presetError}`);
      }
    }
  }

  const report = {
    version: REPORT_VERSION,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    inventory: {
      requested_entries: 61,
      unique_sources: allSources.length,
      duplicates_removed: 11,
      processed_this_run: sources.length,
      completed: completed.length,
      failed: failed.length,
    },
    preset,
    preset_error: presetError,
    videos: results,
  };
  await writeJsonAtomic(path.join(reportDir, "viral-base-live-report.json"), report);
  await writeFile(path.join(reportDir, "viral-base-live-summary.md"), [
    "# Base Viral — relatório de execução",
    "",
    `- Concluídos: **${completed.length}/${sources.length}**`,
    `- Falhas: **${failed.length}**`,
    `- Preset: **${preset?.name || "não publicado"}**`,
    `- Preset ID: \`${preset?.id || "—"}\``,
    `- Erro do preset: ${presetError || "nenhum"}`,
    "",
    ...results.map((item) => `- ${item.status === "completed" ? "✅" : "❌"} \`${item.source_id}\` — ${item.title || item.error || "sem título"}`),
    "",
  ].join("\n"), "utf8");
  if (failed.length || presetError) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`IMPORTAÇÃO INTERROMPIDA: ${redact(error)}`);
  process.exitCode = 1;
}
