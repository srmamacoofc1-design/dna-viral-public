/**
 * Executa, sem UI, o fluxo real "vídeo operacional + Preset DNA".
 *
 * O script é deliberadamente fail-closed:
 * - usa apenas SUPABASE_SERVICE_ROLE_KEY/EDGE_INTERNAL_SERVICE_TOKEN do ambiente;
 * - resolve um usuário real por e-mail e mantém todos os recursos sob esse owner;
 * - exige um preset DNA compartilhado, ativo e v3-ready;
 * - usa o mesmo upload TUS de 6 MiB e os mesmos corpos do frontend;
 * - exige a aprovação do Escritor DNA ↔ Avaliador Viral e da validação formal;
 * - nunca grava a transcrição, segmentos ou descrições de frames nos relatórios.
 *
 * Uso (PowerShell, sem colocar a chave no comando/histórico):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = (Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText)
 *   npx vite-node scripts/test-viral-preset-on-video-live.ts
 *
 * Variáveis opcionais:
 *   TARGET_VIDEO_PATH, TARGET_USER_EMAIL, TARGET_PRESET_ID, TARGET_PRESET_NAME,
 *   TARGET_LANGUAGE, TARGET_NOTES, REPORT_DIR, RESET_RUN=1,
 *   REFERENCE_POLL_TIMEOUT_MS, FUNCTION_TIMEOUT_MS, FFPROBE_PATH.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";
import {
  DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS,
  DEFAULT_VIRAL_REVIEW_THRESHOLDS,
  normalizeViralEvaluation,
} from "../supabase/functions/_shared/viral-review-loop";
import { assessVisualTimelineCoverage } from "../supabase/functions/_shared/visual-timeline-coverage";

const execFileAsync = promisify(execFile);

const DEFAULT_VIDEO_PATH = path.resolve(".runtime/target-preflight/sample.mp4");
const DEFAULT_USER_EMAIL = "user@example.com";
const DEFAULT_PRESET_NAME = "Base Viral — 50 Shorts Fornecidos (Jul 2026)";
const EXPECTED_DEFAULT_PRESET_VIDEO_COUNT = 50;
const REFERENCE_VIDEO_BUCKET = "reference-videos";
const MAX_REFERENCE_VIDEO_BYTES = 300 * 1024 * 1024;
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const MAX_FRONTEND_REVISIONS = 2;
const REPORT_SCHEMA_VERSION = 1;
const BANNED_REPORT_KEYS = new Set([
  "transcription",
  "transcription_segments",
  "transcript_text",
  "transcript_segments",
  "frames",
  "visual_frames",
  "transcription_full",
  "main_action",
  "text_on_screen",
  "visual_description",
  "scene_description",
  "dominant_visual_actions",
  "canonical_examples",
  "examples",
  "protected_examples",
]);

type JsonRecord = Record<string, any>;

interface RuntimeConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  edgeBearerToken: string;
  targetVideoPath: string;
  targetUserEmail: string;
  targetPresetId: string | null;
  targetPresetName: string;
  language: string;
  notes: string | null;
  reportDir: string;
  resetRun: boolean;
  referencePollTimeoutMs: number;
  functionTimeoutMs: number;
  ffprobePath: string;
}

interface Checkpoint {
  schema_version: 1;
  run_key: string;
  reference_video_id?: string;
  topics_ready?: boolean;
  generation_context_id?: string;
  script_assembly_id?: string;
  revision_attempts?: number;
  validation_status?: string;
  promotion_status?: string;
  promoted_script_id?: string;
  completed?: boolean;
  updated_at: string;
}

interface ArtifactPaths {
  checkpoint: string;
  json: string;
  markdown: string;
  tusState: string;
}

interface RunReport {
  schema_version: number;
  run_key: string | null;
  status: "running" | "completed" | "failed";
  started_at: string;
  finished_at: string | null;
  source: JsonRecord | null;
  target_user: JsonRecord | null;
  preset: JsonRecord | null;
  reference_analysis: JsonRecord | null;
  topic_analysis: JsonRecord | null;
  pipeline: JsonRecord;
  writer_evaluator: JsonRecord | null;
  generated_script: JsonRecord | null;
  artifacts: JsonRecord | null;
  error: JsonRecord | null;
  disclaimer: string;
}

class FunctionHttpError extends Error {
  constructor(
    readonly functionName: string,
    readonly status: number,
    readonly payload: JsonRecord,
  ) {
    super(`${functionName} HTTP ${status}: ${payload.error || payload.status_reason || "resposta não aprovada"}`);
    this.name = "FunctionHttpError";
  }
}

const runtimeSecrets: string[] = [];
const viteRuntimeEnv = ((import.meta as any).env || {}) as Record<string, string | undefined>;
let artifactPaths: ArtifactPaths | null = null;
let checkpoint: Checkpoint | null = null;
let report: RunReport = {
  schema_version: REPORT_SCHEMA_VERSION,
  run_key: null,
  status: "running",
  started_at: new Date().toISOString(),
  finished_at: null,
  source: null,
  target_user: null,
  preset: null,
  reference_analysis: null,
  topic_analysis: null,
  pipeline: { stages: [] },
  writer_evaluator: null,
  generated_script: null,
  artifacts: null,
  error: null,
  disclaimer: "Métricas do Avaliador Viral são estimativas de IA pré-publicação, não garantia de desempenho real.",
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function env(name: string, fallback = ""): string {
  return String(process.env[name] ?? viteRuntimeEnv[name] ?? fallback).trim();
}

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  throw new Error(`Variável obrigatória ausente: ${names.join(" ou ")}`);
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} deve ser um inteiro positivo.`);
  return value;
}

function enabled(name: string): boolean {
  return /^(1|true|yes|sim)$/i.test(env(name));
}

function loadConfig(): RuntimeConfig {
  const supabaseUrl = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const edgeBearerToken = env("EDGE_INTERNAL_SERVICE_TOKEN", serviceRoleKey);
  runtimeSecrets.push(serviceRoleKey, edgeBearerToken);
  return {
    supabaseUrl,
    serviceRoleKey,
    edgeBearerToken,
    targetVideoPath: path.resolve(env("TARGET_VIDEO_PATH", DEFAULT_VIDEO_PATH)),
    targetUserEmail: env("TARGET_USER_EMAIL", DEFAULT_USER_EMAIL).toLowerCase(),
    targetPresetId: env("TARGET_PRESET_ID") || null,
    targetPresetName: env("TARGET_PRESET_NAME", DEFAULT_PRESET_NAME),
    language: env("TARGET_LANGUAGE", "pt"),
    notes: env("TARGET_NOTES") || null,
    reportDir: path.resolve(env("REPORT_DIR", path.join(".runtime", "viral-preset-live"))),
    resetRun: enabled("RESET_RUN"),
    referencePollTimeoutMs: positiveIntegerEnv("REFERENCE_POLL_TIMEOUT_MS", 45 * 60_000),
    functionTimeoutMs: positiveIntegerEnv("FUNCTION_TIMEOUT_MS", 15 * 60_000),
    ffprobePath: env("FFPROBE_PATH", "ffprobe"),
  };
}

function redacted(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value ?? "Erro desconhecido");
  for (const secret of runtimeSecrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text.slice(0, 2_000);
}

function safeError(error: unknown): JsonRecord {
  if (error instanceof FunctionHttpError) {
    return {
      type: error.name,
      function: error.functionName,
      http_status: error.status,
      code: error.payload.error_code || error.payload.code || null,
      retryable: error.payload.retryable === true,
      message: redacted(error),
    };
  }
  return {
    type: error instanceof Error ? error.name : "Error",
    message: redacted(error),
  };
}

function stage(name: string, status: "running" | "completed" | "failed", details?: JsonRecord): void {
  const stages = Array.isArray(report.pipeline.stages) ? report.pipeline.stages : [];
  const entry = { name, status, at: new Date().toISOString(), ...(details || {}) };
  const index = stages.findIndex((item: JsonRecord) => item?.name === name);
  if (index >= 0) stages[index] = entry;
  else stages.push(entry);
  report.pipeline.stages = stages;
  console.log(`[${status.toUpperCase()}] ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

async function writeTextAtomic(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, value, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stylePackFingerprint(stylePack: JsonRecord): string {
  return `sha256:${createHash("sha256").update(canonicalJson(stylePack)).digest("hex")}`;
}

async function saveCheckpoint(patch: Partial<Checkpoint> = {}): Promise<void> {
  if (!artifactPaths || !checkpoint) return;
  checkpoint = { ...checkpoint, ...patch, updated_at: new Date().toISOString() };
  await writeJsonAtomic(artifactPaths.checkpoint, checkpoint);
}

async function loadCheckpoint(filePath: string, runKey: string, reset: boolean): Promise<Checkpoint> {
  const fresh: Checkpoint = {
    schema_version: 1,
    run_key: runKey,
    updated_at: new Date().toISOString(),
  };
  if (reset || !(await pathExists(filePath))) return fresh;
  const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!isRecord(parsed) || parsed.schema_version !== 1 || parsed.run_key !== runKey) {
    throw new Error("Checkpoint incompatível; use RESET_RUN=1 para iniciar uma execução limpa.");
  }
  return parsed as Checkpoint;
}

function assertSafeArtifact(value: unknown): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (BANNED_REPORT_KEYS.has(key)) throw new Error(`Relatório recusado: campo sensível ${key}.`);
      visit(child);
    }
  };
  visit(value);
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of runtimeSecrets.filter((item) => item.length >= 12)) {
    if (serialized.includes(secret)) throw new Error("Relatório recusado: possível segredo detectado.");
  }
}

function markdownCell(value: unknown): string {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdown(current: RunReport): string {
  const source = current.source || {};
  const preset = current.preset || {};
  const reference = current.reference_analysis || {};
  const evaluation = current.writer_evaluator?.final_evaluation || {};
  const metrics = evaluation.estimated_metrics || {};
  const criteria = evaluation.criterion_scores || {};
  const blocks = Array.isArray(current.generated_script?.blocks) ? current.generated_script!.blocks : [];
  const lines = [
    "# Teste ao vivo — Preset DNA em vídeo operacional",
    "",
    `- Status: **${current.status}**`,
    `- Início: ${current.started_at}`,
    `- Fim: ${current.finished_at || "em andamento"}`,
    `- Run key: \`${current.run_key || "preflight"}\``,
    "",
    "## Fonte",
    "",
    `- Arquivo: \`${source.path || "—"}\``,
    `- Tamanho: ${source.size_bytes ?? "—"} bytes`,
    `- Duração: ${source.duration_seconds ?? "—"} s`,
    `- Vídeo: ${source.video_codec || "—"}, ${source.width || "—"}×${source.height || "—"}, ${source.fps || "—"} fps`,
    `- Áudio: ${source.audio_codec || "—"}, ${source.audio_sample_rate || "—"} Hz, ${source.audio_channels || "—"} canal(is)`,
    "",
    "## Preset DNA",
    "",
    `- Nome: ${preset.name || "—"}`,
    `- ID: \`${preset.id || "—"}\``,
    `- Vídeos modeladores: ${preset.video_count ?? "—"}`,
    `- Confiança: ${preset.confidence_score ?? "—"}%`,
    `- Gancho Apelão: **ligado**`,
    "",
    "## Análise operacional",
    "",
    `- Reference video ID: \`${reference.reference_video_id || "—"}\``,
    `- Segmentos de áudio analisados: ${reference.transcription_segment_count ?? "—"}`,
    `- Momentos visuais analisados: ${reference.visual_frame_count ?? "—"}`,
    `- Tema central: ${current.topic_analysis?.central_topic || "—"}`,
    "",
    "## Escritor DNA ↔ Avaliador Viral",
    "",
    `- Aprovado: **${current.writer_evaluator?.passed === true ? "sim" : "não"}**`,
    `- Iterações internas: ${current.writer_evaluator?.iterations_completed ?? "—"}`,
    `- Motivo final: ${current.writer_evaluator?.termination_reason || "—"}`,
    "",
    "| Métrica estimada | Resultado |",
    "|---|---:|",
    `| Continuaram assistindo | ${markdownCell(metrics.continue_rate_percent)}% |`,
    `| Pularam o vídeo | ${markdownCell(metrics.skip_rate_percent)}% |`,
    `| Duração média assistida | ${markdownCell(metrics.avg_view_percentage)}% |`,
    "",
    "| Critério | Nota |",
    "|---|---:|",
    ...Object.entries(criteria).map(([key, value]) => `| ${markdownCell(key)} | ${markdownCell(value)}/10 |`),
    "",
    `Validação formal: **${current.pipeline.validation_status || "não concluída"}**.`,
    "",
    "## Promoção final",
    "",
    `- Status: **${current.pipeline.promotion_status || "não concluída"}**`,
    `- Promoted script ID: \`${current.pipeline.promoted_script_id || "—"}\``,
  ];

  if (blocks.length) {
    lines.push("", "## Roteiro gerado", "");
    for (const block of blocks) {
      lines.push(
        `### ${markdownCell(block.index)}. ${markdownCell(block.slot_type)}`,
        "",
        String(block.generated_text || "(bloco sem texto aprovado)"),
        "",
      );
    }
  }

  if (current.error) {
    lines.push("", "## Falha", "", `- ${markdownCell(current.error.message)}`);
  }
  lines.push("", `> ${current.disclaimer}`, "", "> A transcrição integral e os frames-fonte foram deliberadamente excluídos deste relatório.", "");
  return lines.join("\n");
}

async function writeArtifacts(): Promise<void> {
  if (!artifactPaths) return;
  report.artifacts = {
    json: artifactPaths.json,
    markdown: artifactPaths.markdown,
    checkpoint: artifactPaths.checkpoint,
  };
  assertSafeArtifact(report);
  const markdown = renderMarkdown(report);
  assertSafeArtifact(markdown);
  await writeJsonAtomic(artifactPaths.json, report);
  await writeTextAtomic(artifactPaths.markdown, markdown);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function safeVideoExtension(fileName: string): string {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (!/^(mp4|mov|webm|avi|mpeg|mpg|m4v|3gp)$/.test(extension)) {
    throw new Error(`Extensão de vídeo não aceita: ${extension || "ausente"}`);
  }
  return extension;
}

function contentTypeForExtension(extension: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    "3gp": "video/3gpp",
  };
  return map[extension] || "video/mp4";
}

async function durableReferencePath(
  userId: string,
  fileSha256: string,
  extension: string,
): Promise<string> {
  if (!/^[0-9a-f]{64}$/i.test(fileSha256)) throw new Error("SHA-256 local inválido para o caminho durável.");
  // Content-addressed paths survive file renames/mtime changes and ensure that
  // a same-size remote object really corresponds to the bytes hashed locally.
  return `reference/${userId}/upload-${fileSha256.toLowerCase()}.${extension}`;
}

async function probeVideo(ffprobePath: string, filePath: string): Promise<JsonRecord> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error",
    "-show_entries",
    "format=duration,size,bit_rate,format_name:stream=index,codec_type,codec_name,profile,width,height,avg_frame_rate,sample_rate,channels,channel_layout,bit_rate",
    "-of", "json",
    "--",
    filePath,
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed.streams) || !isRecord(parsed.format)) {
    throw new Error("ffprobe retornou metadados inválidos.");
  }
  const video = parsed.streams.find((stream: JsonRecord) => stream.codec_type === "video");
  const audio = parsed.streams.find((stream: JsonRecord) => stream.codec_type === "audio");
  if (!video) throw new Error("O arquivo não contém stream de vídeo.");
  if (!audio) throw new Error("O arquivo não contém áudio; a transcrição obrigatória não poderá ser produzida.");
  const [fpsNumerator, fpsDenominator] = String(video.avg_frame_rate || "0/1").split("/").map(Number);
  return {
    duration_seconds: Number(parsed.format.duration) || null,
    container: parsed.format.format_name || null,
    bit_rate: Number(parsed.format.bit_rate) || null,
    video_codec: video.codec_name || null,
    video_profile: video.profile || null,
    width: Number(video.width) || null,
    height: Number(video.height) || null,
    fps: fpsDenominator ? Number((fpsNumerator / fpsDenominator).toFixed(3)) : null,
    audio_codec: audio.codec_name || null,
    audio_sample_rate: Number(audio.sample_rate) || null,
    audio_channels: Number(audio.channels) || null,
    audio_layout: audio.channel_layout || null,
  };
}

async function findUserByEmail(client: SupabaseClient, email: string): Promise<JsonRecord> {
  const matches: JsonRecord[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Falha ao listar usuários: ${error.message}`);
    const users = data.users as unknown as JsonRecord[];
    matches.push(...users.filter((user) => user.email?.trim().toLowerCase() === email));
    if (users.length < perPage) break;
    if (page === 100) throw new Error("Busca de usuário excedeu 100 páginas.");
  }
  if (matches.length !== 1) throw new Error(`Esperado exatamente 1 usuário para ${email}; encontrados: ${matches.length}.`);
  return matches[0];
}

async function resolveSharedPreset(client: SupabaseClient, config: RuntimeConfig): Promise<JsonRecord> {
  let query = client
    .from("dataset_cohort")
    .select("id, cohort_name, cohort_type, created_by, video_ids, video_count, confidence_score, active, rules_json, updated_at")
    .eq("cohort_type", "dna_preset")
    .eq("active", true)
    .is("created_by", null);
  query = config.targetPresetId
    ? query.eq("id", config.targetPresetId)
    : query.eq("cohort_name", config.targetPresetName);
  const { data, error } = await query.limit(10);
  if (error) throw new Error(`Falha ao localizar preset compartilhado: ${error.message}`);
  if (data.length !== 1) {
    const selector = config.targetPresetId || config.targetPresetName;
    throw new Error(`Preset DNA compartilhado deve ser único (${selector}); encontrados: ${data.length}.`);
  }
  return data[0];
}

async function invokeFunction(
  config: RuntimeConfig,
  functionName: string,
  body: JsonRecord,
  timeoutMs = config.functionTimeoutMs,
): Promise<JsonRecord> {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.edgeBearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload: JsonRecord = {};
  if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text);
      payload = isRecord(parsed) ? parsed : { result: parsed };
    } catch {
      payload = { error: text.slice(0, 500) };
    }
  }
  if (!response.ok) throw new FunctionHttpError(functionName, response.status, payload);
  return payload;
}

async function storageObjectSize(client: SupabaseClient, storagePath: string): Promise<number | null> {
  const directory = path.posix.dirname(storagePath);
  const fileName = path.posix.basename(storagePath);
  const { data, error } = await client.storage.from(REFERENCE_VIDEO_BUCKET).list(directory, {
    limit: 100,
    search: fileName,
  });
  if (error) throw new Error(`Falha ao consultar Storage: ${error.message}`);
  const object = data.find((item) => item.name === fileName);
  if (!object) return null;
  const size = Number((object.metadata as JsonRecord | null)?.size);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

async function waitForStorageObjectSize(
  client: SupabaseClient,
  storagePath: string,
  expectedSize: number,
): Promise<void> {
  let observed: number | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    observed = await storageObjectSize(client, storagePath);
    if (observed === expectedSize) return;
    if (attempt < 7) await sleep(1_000);
  }
  throw new Error(`Upload TUS não foi confirmado no Storage: esperado=${expectedSize}, observado=${observed ?? "ausente"}.`);
}

function tusHttpStatus(error: unknown): number | null {
  const status = Number((error as any)?.originalResponse?.getStatus?.());
  return Number.isFinite(status) ? status : null;
}

async function uploadWithTus(
  config: RuntimeConfig,
  filePath: string,
  size: number,
  storagePath: string,
  contentType: string,
  tusStatePath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(tusStatePath), { recursive: true });
  if (!(await pathExists(tusStatePath))) await fs.writeFile(tusStatePath, "{}", { encoding: "utf8", mode: 0o600 });
  const FileUrlStorage = (tus as unknown as { FileUrlStorage?: new (filePath: string) => any }).FileUrlStorage;
  if (!FileUrlStorage) throw new Error("tus-js-client não disponibilizou FileUrlStorage no runtime Node.");
  const urlStorage = new FileUrlStorage(tusStatePath);

  const runUpload = async (allowResume: boolean): Promise<void> => {
    const upload = new tus.Upload(createReadStream(filePath) as any, {
      endpoint: `${config.supabaseUrl}/storage/v1/upload/resumable`,
      uploadSize: size,
      fingerprint: async () => `dna-reference-${createHash("sha256").update(`${storagePath}\0${size}`).digest("hex")}`,
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000, 20_000],
      headers: {
        // Storage autentica a chave Supabase; EDGE_INTERNAL_SERVICE_TOKEN é
        // exclusivo para chamadas entre Edge Functions.
        authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
        "x-upsert": "true",
      },
      metadata: {
        bucketName: REFERENCE_VIDEO_BUCKET,
        objectName: storagePath,
        contentType,
        cacheControl: "3600",
      },
      chunkSize: TUS_CHUNK_SIZE,
      uploadDataDuringCreation: true,
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: false,
      urlStorage,
    });
    let resumed: any = null;
    if (allowResume) {
      const previous = await upload.findPreviousUploads();
      resumed = previous
        .filter((item) => item.metadata?.bucketName === REFERENCE_VIDEO_BUCKET && item.metadata?.objectName === storagePath)
        .sort((a, b) => Date.parse(b.creationTime) - Date.parse(a.creationTime))[0] || null;
      if (resumed) upload.resumeFromPreviousUpload(resumed);
    }
    let lastProgress = -10;
    try {
      await new Promise<void>((resolve, reject) => {
        upload.options.onError = reject;
        upload.options.onSuccess = () => resolve();
        upload.options.onProgress = (sent, total) => {
          const percent = total > 0 ? Math.floor((sent / total) * 100) : 0;
          if (percent >= lastProgress + 10 || percent === 100) {
            lastProgress = percent;
            console.log(`[UPLOAD] ${percent}%`);
          }
        };
        upload.start();
      });
    } catch (error) {
      const status = tusHttpStatus(error);
      if (resumed && (status === 404 || status === 410)) {
        await urlStorage.removeUpload(resumed.urlStorageKey);
        return runUpload(false);
      }
      throw error;
    }
  };

  await runUpload(true);
}

async function reserveReference(
  client: SupabaseClient,
  userId: string,
  fileName: string,
  storagePath: string,
): Promise<JsonRecord> {
  const select = () => client
    .from("reference_videos")
    .select("id, user_id, file_name, storage_bucket, storage_path, status, duration_seconds, error_message, updated_at")
    .eq("user_id", userId)
    .eq("storage_bucket", REFERENCE_VIDEO_BUCKET)
    .eq("storage_path", storagePath)
    .maybeSingle();
  const existing = await select();
  if (existing.error) throw new Error(`Falha ao consultar referência: ${existing.error.message}`);
  if (existing.data) return existing.data;
  const created = await client.from("reference_videos").insert({
    file_name: fileName,
    storage_path: storagePath,
    storage_bucket: REFERENCE_VIDEO_BUCKET,
    status: "uploading",
    user_id: userId,
  }).select("id, user_id, file_name, storage_bucket, storage_path, status, duration_seconds, error_message, updated_at").maybeSingle();
  if (created.data) return created.data;
  // Uma segunda execução pode vencer a corrida entre SELECT e INSERT.
  const winner = await select();
  if (winner.error || !winner.data) {
    throw new Error(`Falha ao reservar referência: ${created.error?.message || winner.error?.message || "sem linha persistida"}`);
  }
  return winner.data;
}

async function referenceState(client: SupabaseClient, referenceVideoId: string, userId: string): Promise<JsonRecord> {
  const { data, error } = await client.from("reference_videos")
    .select("id, user_id, file_name, storage_bucket, storage_path, status, duration_seconds, error_message, updated_at")
    .eq("id", referenceVideoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || "Referência desapareceu durante o processamento.");
  return data;
}

async function referenceCounts(client: SupabaseClient, referenceVideoId: string): Promise<JsonRecord> {
  const [transcript, frames] = await Promise.all([
    client.from("reference_video_transcripts")
      .select("segment_count, transcript_status", { count: "exact" })
      .eq("reference_video_id", referenceVideoId)
      .maybeSingle(),
    client.from("reference_video_frames")
      .select("timestamp_seconds", { count: "exact" })
      .eq("reference_video_id", referenceVideoId)
      .order("timestamp_seconds", { ascending: true }),
  ]);
  if (transcript.error) throw new Error(`Falha ao conferir transcrição: ${transcript.error.message}`);
  if (frames.error) throw new Error(`Falha ao conferir frames: ${frames.error.message}`);
  return {
    transcription_segment_count: Number(transcript.data?.segment_count) || 0,
    transcript_status: transcript.data?.transcript_status || null,
    visual_frame_count: frames.count ?? 0,
    // A reaction layout legitimately persists one embedded row and one reactor
    // row at the same instant. Coverage is temporal, so that instant must be
    // counted once here just like it is inside process-reference-video.
    visual_timestamps: [...new Set((frames.data || [])
      .map((frame: JsonRecord) => Number(frame.timestamp_seconds))
      .filter(Number.isFinite))],
    first_visual_timestamp: Number(frames.data?.[0]?.timestamp_seconds) || 0,
    last_visual_timestamp: Number(frames.data?.[frames.data.length - 1]?.timestamp_seconds) || 0,
  };
}

async function ensureReferenceReady(
  client: SupabaseClient,
  config: RuntimeConfig,
  reference: JsonRecord,
  storagePath: string,
  fileName: string,
  userId: string,
  independentDuration?: number,
): Promise<JsonRecord> {
  let state = await referenceState(client, reference.id, userId);
  let normalDispatches = 0;
  const maxNormalDispatches = 6;
  const activeProcessingStatuses = new Set(["processing", "processing_audio", "processing_visual"]);
  let lastDispatchFingerprint = "";
  let lastDispatchAt = 0;
  let forcedRepair = false;
  const deadline = Date.now() + config.referencePollTimeoutMs;
  while (Date.now() < deadline) {
    state = await referenceState(client, reference.id, userId);
    if (state.status === "ready") {
      const counts = await referenceCounts(client, reference.id);
      // A transcript row marked ready is complete even when it contains zero
      // speech segments (for example, a reaction/animation driven only by music).
      const transcriptReady = counts.transcript_status === "ready";
      const duration = Number(state.duration_seconds) || 0;
      const visualCoverage = assessVisualTimelineCoverage(
        (counts.visual_timestamps || []).map((timestamp: number) => ({ timestamp_seconds: timestamp })),
        duration,
        { maxMoments: 30, secondsPerMoment: 3, minMoments: 3 },
      );
      const visualsReady = visualCoverage.passed;
      if (transcriptReady && visualsReady) return { ...state, ...counts };

      // A resposta `ready` não pode mascarar uma gravação parcial. Uma única
      // reconstrução forçada torna o checkpoint autorrecuperável; uma segunda
      // inconsistência encerra o fluxo sem aceitar evidência incompleta.
      if (forcedRepair) {
        throw new Error("Referência continuou incompleta após reconstrução forçada.");
      }
      forcedRepair = true;
      await dispatchReferenceProcessing(true);
      continue;
    }

    if (state.status === "error") {
      throw new Error(`Análise de referência falhou: ${state.error_message || "erro sem detalhe"}`);
    }

    const status = String(state.status || "pending");
    const updatedAt = Date.parse(state.updated_at || "");
    const processingAge = Date.now() - updatedAt;
    const isActiveProcessing = activeProcessingStatuses.has(status);
    const staleProcessing = isActiveProcessing
      && (!Number.isFinite(processingAge) || processingAge >= 10 * 60_000);
    const needsDispatch = status === "awaiting_visual" || !isActiveProcessing || staleProcessing;
    const dispatchFingerprint = `${status}:${state.updated_at || "missing-updated-at"}`;
    const sameCheckpointCoolingDown = dispatchFingerprint === lastDispatchFingerprint
      && Date.now() - lastDispatchAt < 15_000;

    if (needsDispatch && !sameCheckpointCoolingDown) {
      if (normalDispatches >= maxNormalDispatches) {
        throw new Error(
          `Processamento da referência não avançou após ${maxNormalDispatches} despachos; `
          + `último checkpoint: ${status}.`,
        );
      }
      normalDispatches += 1;
      lastDispatchFingerprint = dispatchFingerprint;
      lastDispatchAt = Date.now();
      const dispatchResult = await dispatchReferenceProcessing(false);

      // HTTP 202 is a successful durable checkpoint. In particular,
      // `awaiting_visual` means the audio phase finished and the loop must
      // immediately dispatch the visual phase instead of waiting for a worker
      // that no longer exists.
      if (dispatchResult?.status === "awaiting_visual") continue;
      continue;
    }
    await sleep(5_000);
  }
  throw new Error(`Timeout aguardando análise da referência após ${config.referencePollTimeoutMs} ms.`);

  async function dispatchReferenceProcessing(force: boolean): Promise<JsonRecord | null> {
    // reference_video_id is the authority. The Edge Function derives owner,
    // bucket and path from that durable row; caller-provided ownership is never
    // trusted. `force` is reserved for repairing an impossible partial-ready row.
    try {
      return await invokeFunction(config, "process-reference-video", {
        reference_video_id: reference.id,
        storage_path: storagePath,
        file_name: fileName,
        user_id: userId,
        ...(Number.isFinite(independentDuration) && (independentDuration ?? 0) > 0
          ? { video_duration: independentDuration }
          : {}),
        ...(force ? { force: true } : {}),
      });
    } catch (error) {
      // A client timeout does not necessarily cancel the Edge Function. Keep
      // polling its durable state, but never suppress a real HTTP/application error.
      const name = error instanceof Error ? error.name : "";
      if (name !== "AbortError" && name !== "TimeoutError") throw error;
      console.warn("process-reference-video excedeu o timeout do cliente; acompanhando o status persistido.");
      return null;
    }
  }
}

async function topicSummary(client: SupabaseClient, referenceVideoId: string): Promise<JsonRecord> {
  const { data, error } = await client.from("reference_video_topics")
    .select("central_topic, detected_language, estimated_target_word_count, key_topics, narrative_progression, forbidden_foreign_entities, visual_anchor_points, topic_status")
    .eq("reference_video_id", referenceVideoId)
    .maybeSingle();
  if (error || !data || data.topic_status !== "ready") {
    throw new Error(error?.message || "Análise temática não ficou pronta.");
  }
  const narrativePhaseCount = Array.isArray(data.narrative_progression) ? data.narrative_progression.length : 0;
  const visualAnchorCount = Array.isArray(data.visual_anchor_points) ? data.visual_anchor_points.length : 0;
  if (String(data.central_topic || "").trim().length < 4 || narrativePhaseCount < 3 || visualAnchorCount < 3) {
    throw new Error("Análise temática persistida não possui tema, três fases e três âncoras visuais válidas.");
  }
  return {
    status: data.topic_status,
    central_topic: data.central_topic,
    detected_language: data.detected_language,
    estimated_target_word_count: data.estimated_target_word_count,
    key_topic_count: Array.isArray(data.key_topics) ? data.key_topics.length : 0,
    narrative_phase_count: narrativePhaseCount,
    forbidden_entity_category_count: Array.isArray(data.forbidden_foreign_entities) ? data.forbidden_foreign_entities.length : 0,
    visual_anchor_count: visualAnchorCount,
  };
}

async function loadContext(client: SupabaseClient, contextId: string, userId: string): Promise<JsonRecord> {
  const { data, error } = await client.from("generation_contexts")
    .select("id, user_id, status, generation_rules, slot_sequence")
    .eq("id", contextId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || "Contexto checkpoint não pertence ao usuário alvo.");
  return data;
}

function contextMatchesReference(row: JsonRecord, referenceVideoId: string): boolean {
  const rules = isRecord(row.generation_rules) ? row.generation_rules : {};
  const payload = isRecord(rules.context_payload) ? rules.context_payload : {};
  const video = isRecord(payload.video_reference_context) ? payload.video_reference_context : {};
  return row.status === "ready"
    && rules.input_mode === "video"
    && video.reference_video_id === referenceVideoId
    && Array.isArray(row.slot_sequence)
    && row.slot_sequence.length > 0;
}

async function injectSharedPreset(
  client: SupabaseClient,
  contextId: string,
  userId: string,
  preset: JsonRecord,
  stylePack: JsonRecord,
  helpers: {
    formatStylePackLines: (pack: any, options?: JsonRecord) => string[];
    validateDnaStylePack: (pack: any) => JsonRecord;
    buildHookStrategyAnalogs: (pack: any) => JsonRecord[];
  },
  sourceFingerprint: string,
): Promise<JsonRecord> {
  const row = await loadContext(client, contextId, userId);
  const rules = JSON.parse(JSON.stringify(row.generation_rules || {}));
  const payload = rules.context_payload;
  if (!payload) throw new Error("generation_rules sem context_payload.");
  const readiness = helpers.validateDnaStylePack(stylePack);
  if (readiness.ready !== true) throw new Error(`DNA incompleto: ${(readiness.reasons || []).join(", ")}`);
  const expectedStrategyProfiles = Object.fromEntries((stylePack.block_styles || [])
    .filter((block: JsonRecord) => block.strategy)
    .map((block: JsonRecord) => [block.block_type, block.strategy]));
  const expectedProtectedExamples = (stylePack.block_styles || []).flatMap((block: JsonRecord) =>
    (block.protected_examples || block.examples || []).map((example: JsonRecord) => ({
      block_type: block.block_type,
      text: example.text,
      video_id: example.video_id ?? null,
    })));
  const expectedHookStrategyAnalogs = helpers.buildHookStrategyAnalogs(stylePack);
  if (expectedHookStrategyAnalogs.length !== Number(stylePack.total_videos)) {
    throw new Error(`DNA contextual incompleto: ${expectedHookStrategyAnalogs.length}/${stylePack.total_videos} analogias de gancho.`);
  }

  if (rules.style_pack?.injected_at && Number(rules.style_pack.version) >= 3 && rules.style_pack.status === "ready") {
    const samePreset = rules.style_pack.preset_id === preset.id;
    const sameHook = rules.style_pack.hook_apelao === true;
    const sameLanguage = rules.style_pack.target_lang === stylePack.target_lang;
    const sameSource = rules.style_pack.source_fingerprint === sourceFingerprint;
    const sameStrategies = canonicalJson(rules.style_pack.strategy_profiles) === canonicalJson(expectedStrategyProfiles);
    const sameProtectedEvidence = canonicalJson(rules.style_pack.protected_examples) === canonicalJson(expectedProtectedExamples);
    const sameHookStrategyAnalogs = canonicalJson(rules.style_pack.hook_strategy_analogs)
      === canonicalJson(expectedHookStrategyAnalogs);
    const sameContract = canonicalJson(rules.style_pack.strategy_contract) === canonicalJson(stylePack.strategy_contract);
    const sameStructuralContract = canonicalJson(rules.style_pack.structural_contract)
      === canonicalJson(stylePack.structural_contract);
    const sameDominantSequence = rules.style_pack.dominant_sequence === stylePack.dominant_sequence
      && Number(rules.style_pack.dominant_sequence_count) === Number(stylePack.dominant_sequence_count);
    const strictGuard = rules.style_pack.strategy_contract?.protected_reference_required === true
      && rules.style_pack.strategy_contract?.semantic_copy_guard_required === true
      && rules.style_pack.structural_contract?.contract_type === "abstract_narrative_order"
      && rules.style_pack.structural_contract?.visual_chronology_priority === true
      && rules.style_pack.structural_contract?.literal_source_sequence_required === false
      && Array.isArray(rules.style_pack.protected_examples)
      && rules.style_pack.protected_examples.length > 0
      && Array.isArray(rules.style_pack.hook_strategy_analogs)
      && rules.style_pack.hook_strategy_analogs.length === Number(stylePack.total_videos);
    if (samePreset && sameHook && sameLanguage && sameSource && sameStrategies
      && sameProtectedEvidence && sameHookStrategyAnalogs && sameContract && sameStructuralContract
      && sameDominantSequence && strictGuard) {
      return { injected: true, channel: rules.style_pack.channel, reused: true };
    }
    throw new Error("Contexto já contém outro DNA; reconstrução obrigatória.");
  }

  if (rules.input_mode !== "video") throw new Error(`Contexto inesperado: input_mode=${rules.input_mode}.`);
  if ((stylePack.extraction_quality?.visual_strategy_coverage ?? 0) < 0.6) {
    throw new Error("DNA visual insuficiente: menos de 60% dos vídeos-base têm evidência visual.");
  }
  const topics = payload.video_reference_context?.topic_analysis;
  if (!topics) throw new Error("Modo vídeo sem topic_analysis; injeção recusada.");
  const lines = helpers.formatStylePackLines(stylePack, {
    hookApelao: true,
    visualFirst: true,
    presetName: preset.cohort_name,
    presetId: preset.id,
  });
  topics.semantic_alignment_rules = topics.semantic_alignment_rules || {};
  const existingTone = topics.semantic_alignment_rules.tone_guidance || "";
  topics.semantic_alignment_rules.tone_guidance = `${existingTone ? `${existingTone}\n` : ""}${lines.join("\n")}`;
  const channel = "topic_analysis.semantic_alignment_rules.tone_guidance";

  let slotSequence = Array.isArray(row.slot_sequence) ? row.slot_sequence : null;
  if (slotSequence) {
    const styles = new Map((stylePack.block_styles || []).map((block: JsonRecord) => [block.block_type, block]));
    slotSequence = slotSequence.map((slot: JsonRecord) => {
      const style = styles.get(slot.slot_type) as JsonRecord | undefined;
      return style?.strategy ? { ...slot, dna_strategy_ref: style.strategy } : slot;
    });
  }

  rules.style_pack = {
    injected_at: new Date().toISOString(),
    channel,
    target_lang: stylePack.target_lang,
    total_videos: stylePack.total_videos,
    scope: stylePack.scope,
    preset_name: preset.cohort_name,
    preset_id: preset.id,
    source_fingerprint: sourceFingerprint,
    hook_apelao: true,
    status: "ready",
    strategy_contract: stylePack.strategy_contract,
    dominant_sequence: stylePack.dominant_sequence,
    dominant_sequence_count: stylePack.dominant_sequence_count,
    structural_contract: stylePack.structural_contract,
    extraction_quality: stylePack.extraction_quality,
    strategy_profiles: expectedStrategyProfiles,
    hook_strategy_analogs: expectedHookStrategyAnalogs,
    protected_examples: expectedProtectedExamples,
    version: 3,
  };

  const update: JsonRecord = { generation_rules: rules };
  if (slotSequence) update.slot_sequence = slotSequence;
  const { data, error } = await client.from("generation_contexts")
    .update(update)
    .eq("id", contextId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || "Injeção DNA não atualizou o contexto alvo.");
  return { injected: true, channel, reused: false };
}

async function loadAssembly(client: SupabaseClient, assemblyId: string, userId: string, contextId?: string): Promise<JsonRecord> {
  let query = client.from("script_assemblies")
    .select("id, user_id, source_generation_context_id, assembly_name, assembly_rules, script_blocks, status, validation_status, validation_version, validation_result, validated_at")
    .eq("id", assemblyId)
    .eq("user_id", userId);
  if (contextId) query = query.eq("source_generation_context_id", contextId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error(error?.message || "Assembly checkpoint não pertence a esta execução.");
  return data;
}

function agentReportFrom(value: unknown): JsonRecord | null {
  if (!isRecord(value) || value.enabled !== true) return null;
  if (typeof value.passed !== "boolean") return null;
  if (!isRecord(value.final_evaluation)) return null;
  return value;
}

function requireAgentApproval(value: unknown, stageName: string): JsonRecord {
  const agent = agentReportFrom(value);
  if (!agent) {
    const raw = isRecord(value) ? value : null;
    const termination = typeof raw?.termination_reason === "string" ? raw.termination_reason : null;
    throw new Error(`${stageName}: relatório obrigatório Escritor/Avaliador ausente ou inválido${termination ? ` (${termination})` : ""}.`);
  }
  const iterations = Number(agent.iterations_completed);
  const maxIterations = Number(agent.max_iterations);
  const rawFinal = agent.final_evaluation;
  const locallyVerified = normalizeViralEvaluation(rawFinal, iterations || 1);
  const auditTrail = Array.isArray(agent.audit_trail) ? agent.audit_trail : [];
  const structuralApproval = agent.writer_agent === "dna_writer"
    && agent.evaluator_agent === "viral_evaluator"
    && agent.termination_reason === "quality_gate_passed"
    && agent.metrics_kind === "pre_publication_ai_estimates"
    && Number.isSafeInteger(iterations)
    && iterations >= 1
    && Number.isSafeInteger(maxIterations)
    && maxIterations >= 1
    && maxIterations <= DEFAULT_VIRAL_REVIEW_MAX_ITERATIONS
    && iterations <= maxIterations
    && auditTrail.length >= iterations;
  if (!structuralApproval
    || agent.passed !== true
    || rawFinal?.passed !== true
    || locallyVerified.passed !== true) {
    const gates = locallyVerified.failed_gates.join(", ") || agent.termination_reason || "sem motivo";
    throw new Error(`${stageName}: Avaliador Viral reprovou na verificação local (${gates}).`);
  }
  return {
    ...agent,
    thresholds: DEFAULT_VIRAL_REVIEW_THRESHOLDS,
    final_evaluation: locallyVerified,
  };
}

function agentFromAssembly(assembly: JsonRecord): JsonRecord | null {
  return isRecord(assembly.assembly_rules) ? agentReportFrom(assembly.assembly_rules.writer_evaluator_loop) : null;
}

function sanitizeAgentReport(agent: JsonRecord): JsonRecord {
  const evaluation = isRecord(agent.final_evaluation) ? agent.final_evaluation : {};
  const metrics = isRecord(evaluation.estimated_metrics) ? evaluation.estimated_metrics : {};
  const scores = isRecord(evaluation.criterion_scores) ? evaluation.criterion_scores : {};
  const narrative = isRecord(evaluation.narrative_fidelity_gate) ? evaluation.narrative_fidelity_gate : {};
  return {
    enabled: agent.enabled === true,
    passed: agent.passed === true,
    termination_reason: agent.termination_reason || null,
    iterations_completed: Number(agent.iterations_completed) || 0,
    max_iterations: Number(agent.max_iterations) || 0,
    thresholds: { ...DEFAULT_VIRAL_REVIEW_THRESHOLDS },
    metrics_disclaimer: agent.metrics_disclaimer || evaluation.metrics_disclaimer || null,
    final_evaluation: {
      iteration: Number(evaluation.iteration) || null,
      passed: evaluation.passed === true,
      overall_score: Number(evaluation.overall_score) || null,
      failed_gates: Array.isArray(evaluation.failed_gates) ? evaluation.failed_gates.slice(0, 20).map(String) : [],
      estimated_metrics: {
        continue_rate_percent: Number(metrics.continue_rate_percent) || 0,
        skip_rate_percent: Number(metrics.skip_rate_percent) || 0,
        avg_view_percentage: Number(metrics.avg_view_percentage) || 0,
      },
      criterion_scores: {
        hook: Number(scores.hook) || 0,
        development: Number(scores.development) || 0,
        payoff: Number(scores.payoff) || 0,
        visual_fidelity: Number(scores.visual_fidelity) || 0,
        dna_strategy_application: Number(scores.dna_strategy_application) || 0,
        originality: Number(scores.originality) || 0,
        pacing: Number(scores.pacing) || 0,
      },
      narrative_fidelity_gate: {
        required: narrative.required === true,
        passed: narrative.passed === true,
        audited_microevents: Number(narrative.audited_microevents) || 0,
        required_audited_microevents: Number(narrative.required_audited_microevents) || 0,
        reasons: Array.isArray(narrative.reasons) ? narrative.reasons.slice(0, 20).map(String) : [],
        complete_narrative_gap_count: Array.isArray(narrative.complete_narrative_gaps)
          ? narrative.complete_narrative_gaps.length
          : 0,
        causal_error_count: Array.isArray(narrative.causal_errors) ? narrative.causal_errors.length : 0,
      },
      feedback: {
        revision_priorities: Array.isArray(evaluation.feedback?.revision_priorities)
          ? evaluation.feedback.revision_priorities.slice(0, 12).map(String)
          : [],
      },
    },
    audit_trail: Array.isArray(agent.audit_trail)
      ? agent.audit_trail.slice(0, 12).map((item: JsonRecord) => ({
          iteration: Number(item?.iteration) || null,
          evaluator: {
            passed: item?.evaluator?.passed === true,
            overall_score: Number(item?.evaluator?.overall_score) || null,
          },
        }))
      : [],
    error: agent.error ? redacted(agent.error) : null,
  };
}

function sanitizeBlocks(blocks: unknown, assemblyRules?: unknown): JsonRecord[] {
  if (!Array.isArray(blocks)) return [];
  const generationLog = isRecord(assemblyRules) && Array.isArray(assemblyRules.generation_log)
    ? assemblyRules.generation_log.filter(isRecord)
    : [];

  return blocks.map((block: JsonRecord) => {
    const index = Number(block.index);
    const diagnostic = [...generationLog].reverse().find((entry) =>
      Number(entry.slot_index) === index
      && (
        typeof entry.dna_strategy_passed === "boolean"
        || typeof entry.dna_copy_guard_passed === "boolean"
        || typeof entry.output_language_passed === "boolean"
      )
    );
    const strategyValidation = isRecord(block.dna_strategy_validation) ? block.dna_strategy_validation : null;
    const copyGuard = isRecord(block.dna_copy_guard) ? block.dna_copy_guard : null;
    const languageValidation = isRecord(block.output_language_validation) ? block.output_language_validation : null;
    const strategyScore = Number(
      block.dna_strategy_score ?? strategyValidation?.score ?? diagnostic?.dna_strategy_score,
    );

    return {
      index: block.index ?? null,
      slot_type: block.slot_type ?? null,
      status: block.status ?? null,
      word_count: Number(block.word_count) || 0,
      generated_text: typeof block.generated_text === "string" ? block.generated_text : "",
      effective_word_contract: isRecord(block.effective_word_contract) ? block.effective_word_contract : null,
      visual_evidence_trace: isRecord(block.visual_evidence_trace) ? block.visual_evidence_trace : null,
      hook_strategy_trace: block.slot_type === "hook" && isRecord(block.hook_strategy_trace)
        ? block.hook_strategy_trace
        : null,
      hook_first_window_grounding: block.slot_type === "hook" && isRecord(block.hook_first_window_grounding)
        ? block.hook_first_window_grounding
        : null,
      hook_semantic_opening_grounding: block.slot_type === "hook" && copyGuard
        ? {
            checked: copyGuard.hook_opening_grounding_checked === true,
            grounded: copyGuard.hook_opening_grounded === true,
            spoils_later_outcome: copyGuard.hook_spoils_later_outcome === true,
            reason: typeof copyGuard.hook_opening_reason === "string"
              ? copyGuard.hook_opening_reason.slice(0, 500)
              : null,
            generated_text_fingerprint: typeof copyGuard.generated_text_fingerprint === "string"
              ? copyGuard.generated_text_fingerprint
              : null,
          }
        : null,
      dna_strategy_score: Number.isFinite(strategyScore) ? strategyScore : null,
      dna_strategy_passed: typeof block.dna_strategy_passed === "boolean"
        ? block.dna_strategy_passed
        : typeof strategyValidation?.passed === "boolean"
          ? strategyValidation.passed
          : diagnostic?.dna_strategy_passed === true,
      dna_copy_guard_passed: typeof block.dna_copy_guard_passed === "boolean"
        ? block.dna_copy_guard_passed
        : typeof copyGuard?.passed === "boolean"
          ? copyGuard.passed
          : diagnostic?.dna_copy_guard_passed === true,
      output_language_passed: typeof block.output_language_passed === "boolean"
        ? block.output_language_passed
        : typeof languageValidation?.passed === "boolean"
          ? languageValidation.passed
          : diagnostic?.output_language_passed === true,
    };
  });
}

function assertHookOpeningContract(assembly: JsonRecord, stylePack: JsonRecord): JsonRecord {
  const blocks = Array.isArray(assembly.script_blocks) ? assembly.script_blocks.filter(isRecord) : [];
  const hook = blocks.find((block) => String(block.slot_type || "").toLowerCase() === "hook");
  if (!hook) throw new Error("Contrato 3-5s: bloco hook ausente.");
  const text = String(hook.generated_text || "").trim();
  const actualWords = text.split(/\s+/).filter(Boolean).length;
  const hookBlockStyle = Array.isArray(stylePack.block_styles)
    ? stylePack.block_styles.find((block: JsonRecord) => String(block?.block_type || "").toLowerCase() === "hook")
    : null;
  const profile = isRecord(stylePack.strategy_profiles?.hook)
    ? stylePack.strategy_profiles.hook
    : isRecord(hookBlockStyle?.strategy)
      ? hookBlockStyle.strategy
      : isRecord(hookBlockStyle)
        ? hookBlockStyle
        : {};
  const measuredRate = Number(profile.avg_words_per_second ?? hookBlockStyle?.avg_words_per_second);
  const wordsPerSecond = Number.isFinite(measuredRate) && measuredRate >= 0.5 && measuredRate <= 6
    ? measuredRate
    : 3.5;
  const estimatedSpokenSeconds = actualWords / wordsPerSecond;
  const effective = isRecord(hook.effective_word_contract) ? hook.effective_word_contract : null;
  const trace = isRecord(hook.visual_evidence_trace) ? hook.visual_evidence_trace : null;
  const rangeEnd = Number(trace?.time_range?.end);
  const frameTimestamps = Array.isArray(trace?.frame_timestamps)
    ? trace.frame_timestamps.map(Number).filter(Number.isFinite)
    : [];

  if (!effective
    || actualWords < Number(effective.min)
    || actualWords > Number(effective.max)) {
    throw new Error(`Contrato 3-5s: hook com ${actualWords} palavras fora do intervalo efetivo.`);
  }
  if (estimatedSpokenSeconds < 3 || estimatedSpokenSeconds > 5) {
    throw new Error(`Contrato 3-5s: duração estimada do hook=${estimatedSpokenSeconds.toFixed(2)}s.`);
  }
  if (!Number.isFinite(rangeEnd) || rangeEnd > 5) {
    throw new Error(`Contrato visual do hook excede 5s (fim=${Number.isFinite(rangeEnd) ? rangeEnd : "ausente"}).`);
  }
  if (frameTimestamps.length === 0 || frameTimestamps.some((timestamp) => timestamp > 5)) {
    throw new Error("Contrato visual do hook contém frame ausente ou posterior a 5s.");
  }
  return {
    passed: true,
    word_count: actualWords,
    words_per_second: +wordsPerSecond.toFixed(3),
    estimated_spoken_seconds: +estimatedSpokenSeconds.toFixed(3),
    allowed_seconds: { min: 3, max: 5 },
    effective_word_contract: effective,
    opening_time_range: trace?.time_range || null,
    opening_frame_timestamps: frameTimestamps,
  };
}

function sanitizeValidationSummary(value: unknown): JsonRecord | null {
  if (!isRecord(value) || !isRecord(value.summary)) return null;
  const summary = value.summary;
  return {
    total_slots: Number(summary.total_slots) || 0,
    criteria_checked_count: Number(summary.criteria_checked_count) || 0,
    criteria_true_count: Number(summary.criteria_true_count) || 0,
    critical_failures: Number(summary.critical_failures) || 0,
    exact_slot_coverage_passed: summary.exact_slot_coverage_passed === true,
    global_word_count_passed: summary.global_word_count_passed === true,
    current_viral_fingerprint_passed: summary.current_viral_fingerprint_passed === true,
    visual_timeline_passed: summary.visual_timeline_passed === true,
    viral_review_gate_failed: summary.viral_review_gate_failed === true,
  };
}

function sanitizedStrategy(strategy: unknown): JsonRecord | null {
  if (!isRecord(strategy)) return null;
  return {
    source_video_count: Number(strategy.source_video_count) || 0,
    dominant_opening_patterns: Array.isArray(strategy.dominant_opening_patterns)
      ? strategy.dominant_opening_patterns.slice(0, 12).map(String)
      : [],
    word_range: isRecord(strategy.word_range) ? strategy.word_range : null,
    sentence_range: isRecord(strategy.sentence_range) ? strategy.sentence_range : null,
    avg_sentence_words: Number(strategy.avg_sentence_words) || null,
    avg_words_per_second: Number(strategy.avg_words_per_second) || null,
    question_rate: Number(strategy.question_rate) || 0,
    exclamation_rate: Number(strategy.exclamation_rate) || 0,
    direct_address_rate: Number(strategy.direct_address_rate) || 0,
    withheld_payoff_rate: Number(strategy.withheld_payoff_rate) || 0,
    micro_reveals_per_sentence: Number(strategy.micro_reveals_per_sentence) || 0,
    escalation_markers_per_sentence: Number(strategy.escalation_markers_per_sentence) || 0,
    dominant_visual_dynamics: Array.isArray(strategy.dominant_visual_dynamics)
      ? strategy.dominant_visual_dynamics.slice(0, 12).map(String)
      : [],
    dominant_visual_emotions: Array.isArray(strategy.dominant_visual_emotions)
      ? strategy.dominant_visual_emotions.slice(0, 12).map(String)
      : [],
    strategy_instruction: typeof strategy.strategy_instruction === "string"
      ? strategy.strategy_instruction.slice(0, 1_500)
      : null,
  };
}

function normalizedLanguage(value: unknown): string {
  return String(value || "").trim().toLowerCase().split(/[-_]/)[0];
}

function assertPresetConsistency(preset: JsonRecord, stylePack: JsonRecord, config: RuntimeConfig): void {
  const rawPresetIds = Array.isArray(preset.video_ids)
    ? preset.video_ids.map(String).map((id: string) => id.trim()).filter(Boolean)
    : [];
  const presetIds = [...new Set(rawPresetIds)];
  if (presetIds.length === 0 || presetIds.length !== rawPresetIds.length) {
    throw new Error("Preset compartilhado possui video_ids ausentes ou duplicados.");
  }
  if (Number(preset.video_count) !== presetIds.length) {
    throw new Error(`Preset inconsistente: video_count=${preset.video_count}, video_ids únicos=${presetIds.length}.`);
  }
  if (stylePack.scope !== "preset") throw new Error(`Style pack inesperado: scope=${stylePack.scope || "ausente"}.`);
  if (Number(stylePack.version) < 3) throw new Error("Style pack não está na versão 3.");
  if (Number(stylePack.total_videos) !== presetIds.length) {
    throw new Error(`Style pack inconsistente: total_videos=${stylePack.total_videos}, esperado=${presetIds.length}.`);
  }
  const scopeIds = Array.isArray(stylePack.scope_video_ids)
    ? [...new Set(stylePack.scope_video_ids.map(String).map((id: string) => id.trim()).filter(Boolean))]
    : [];
  const expectedSet = new Set(presetIds);
  if (scopeIds.length !== presetIds.length || scopeIds.some((id: string) => !expectedSet.has(id))) {
    throw new Error("Style pack não cobre exatamente os video_ids do preset compartilhado.");
  }
  const strategyIds = Array.isArray(stylePack.video_strategies)
    ? [...new Set(stylePack.video_strategies.map((item: JsonRecord) => String(item?.video_id || "").trim()).filter(Boolean))]
    : [];
  if (strategyIds.length !== presetIds.length || strategyIds.some((id: string) => !expectedSet.has(id))) {
    throw new Error("Style pack não possui evidência estratégica individual para todos os vídeos do preset.");
  }
  const hookAnalogs = Array.isArray(stylePack.hook_strategy_analogs)
    ? stylePack.hook_strategy_analogs
    : [];
  if (hookAnalogs.length > 0 && hookAnalogs.length !== presetIds.length) {
    throw new Error("Style pack possui uma camada parcial de analogias contextuais de gancho.");
  }
  const quality = isRecord(stylePack.extraction_quality) ? stylePack.extraction_quality : {};
  if (Number(quality.video_coverage) < 1 || Number(quality.visual_strategy_coverage) < 1) {
    throw new Error("Preset não possui cobertura completa de vídeos e estratégia visual.");
  }
  if (Number(quality.text_strategy_coverage) < 0.8) {
    throw new Error("Preset possui menos de 80% de cobertura estratégica textual.");
  }
  const requiredTypes = Array.isArray(stylePack.strategy_contract?.required_block_types)
    ? stylePack.strategy_contract.required_block_types.map(String)
    : [];
  for (const blockType of requiredTypes) {
    const block = Array.isArray(stylePack.block_styles)
      ? stylePack.block_styles.find((candidate: JsonRecord) => candidate?.block_type === blockType)
      : null;
    if (Number(block?.strategy?.source_video_count) !== presetIds.length) {
      throw new Error(`Estratégia obrigatória ${blockType} não cobre os ${presetIds.length} vídeos do preset.`);
    }
  }
  if (preset.cohort_name === DEFAULT_PRESET_NAME && presetIds.length !== EXPECTED_DEFAULT_PRESET_VIDEO_COUNT) {
    throw new Error(`O preset padrão exige ${EXPECTED_DEFAULT_PRESET_VIDEO_COUNT} vídeos; encontrados ${presetIds.length}.`);
  }
  if (normalizedLanguage(config.language) !== normalizedLanguage(stylePack.target_lang)) {
    throw new Error(`Idioma do teste (${config.language}) diverge do DNA (${stylePack.target_lang || "ausente"}).`);
  }
}

function presetSummary(preset: JsonRecord, stylePack: JsonRecord, sourceFingerprint: string): JsonRecord {
  return {
    id: preset.id,
    name: preset.cohort_name,
    shared: preset.created_by === null,
    active: preset.active === true,
    video_count: Number(preset.video_count) || (Array.isArray(preset.video_ids) ? preset.video_ids.length : 0),
    confidence_score: Number(preset.confidence_score) || 0,
    target_language: stylePack.target_lang || null,
    source_fingerprint: sourceFingerprint,
    extraction_quality: stylePack.extraction_quality || null,
    strategy_contract: stylePack.strategy_contract || null,
    block_strategies: (stylePack.block_styles || []).map((block: JsonRecord) => ({
      block_type: block.block_type,
      source_count: Number(block.strategy?.source_video_count) || 0,
      median_words: Number(block.median_words) || null,
      avg_words_per_second: Number(block.avg_words_per_second) || null,
      dominant_emotion: block.dominant_emotion || null,
      strategy: sanitizedStrategy(block.strategy),
    })),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const stat = await fs.stat(config.targetVideoPath);
  if (!stat.isFile()) throw new Error("TARGET_VIDEO_PATH não aponta para um arquivo.");
  if (stat.size <= 0) throw new Error("O vídeo está vazio.");
  if (stat.size > MAX_REFERENCE_VIDEO_BYTES) throw new Error("O vídeo excede 300 MiB.");
  const extension = safeVideoExtension(config.targetVideoPath);
  const contentType = contentTypeForExtension(extension);

  stage("preflight", "running");
  const [media, fileSha256] = await Promise.all([
    probeVideo(config.ffprobePath, config.targetVideoPath),
    sha256File(config.targetVideoPath),
  ]);
  report.source = {
    path: config.targetVideoPath,
    file_name: path.basename(config.targetVideoPath),
    size_bytes: stat.size,
    sha256: fileSha256,
    ...media,
  };
  stage("preflight", "completed");

  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const [user, preset] = await Promise.all([
    findUserByEmail(client, config.targetUserEmail),
    resolveSharedPreset(client, config),
  ]);
  report.target_user = { id: user.id, email: user.email };

  // O módulo contém helpers puros; o polyfill evita que o client browser criado
  // pelo módulo acesse localStorage no Node. Nenhuma operação usa esse client.
  (globalThis as any).localStorage = (globalThis as any).localStorage ?? {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => undefined,
  };
  const dna = await import("../src/lib/dna-style-pack");
  const stylePack = preset.rules_json?.style_pack;
  if (!isRecord(stylePack)) throw new Error("Preset compartilhado não possui rules_json.style_pack.");
  const readiness = dna.validateDnaStylePack(stylePack as any);
  if (!readiness.ready) throw new Error(`Preset DNA não está pronto: ${readiness.reasons.join(", ")}`);
  assertPresetConsistency(preset, stylePack, config);
  const sourceFingerprint = stylePackFingerprint(stylePack);
  report.preset = presetSummary(preset, stylePack, sourceFingerprint);

  const runKey = createHash("sha256")
    .update([user.id, preset.id, sourceFingerprint, fileSha256, config.language, "hook-apelao:true"].join("|"))
    .digest("hex")
    .slice(0, 24);
  artifactPaths = {
    checkpoint: path.join(config.reportDir, `test-viral-preset-on-video-${runKey}.checkpoint.json`),
    json: path.join(config.reportDir, `test-viral-preset-on-video-${runKey}.json`),
    markdown: path.join(config.reportDir, `test-viral-preset-on-video-${runKey}.md`),
    tusState: path.join(config.reportDir, `test-viral-preset-on-video-${runKey}.tus.json`),
  };
  report.run_key = runKey;
  checkpoint = await loadCheckpoint(artifactPaths.checkpoint, runKey, config.resetRun);
  // A retomada precisa reconfirmar validacao local e promocao idempotente antes
  // de voltar ao estado concluido.
  await saveCheckpoint({ completed: false });

  const storagePath = await durableReferencePath(
    user.id,
    fileSha256,
    extension,
  );
  let reference = await reserveReference(client, user.id, path.basename(config.targetVideoPath), storagePath);
  const independentDuration = Number(media.duration_seconds);
  if (Number.isFinite(independentDuration) && independentDuration > 0) {
    const { data: durationUpdated, error: durationUpdateError } = await client
      .from("reference_videos")
      .update({ duration_seconds: independentDuration })
      .eq("id", reference.id)
      .eq("user_id", user.id)
      .select("id, user_id, file_name, storage_bucket, storage_path, status, duration_seconds, error_message, updated_at")
      .maybeSingle();
    if (durationUpdateError) throw new Error(`Failed to save independent duration: ${durationUpdateError.message}`);
    if (durationUpdated) reference = durationUpdated;
  }
  if (checkpoint.reference_video_id && checkpoint.reference_video_id !== reference.id) {
    throw new Error("Checkpoint aponta para outra referência; use RESET_RUN=1 após auditar o conflito.");
  }
  await saveCheckpoint({ reference_video_id: reference.id });

  stage("private_resumable_upload", "running", { reference_video_id: reference.id });
  const remoteSize = await storageObjectSize(client, storagePath);
  if (remoteSize !== stat.size) {
    const statusUpdate = await client.from("reference_videos").update({
      status: "uploading",
      error_message: null,
      file_name: path.basename(config.targetVideoPath),
      storage_bucket: REFERENCE_VIDEO_BUCKET,
      storage_path: storagePath,
    }).eq("id", reference.id).eq("user_id", user.id);
    if (statusUpdate.error) throw new Error(`Falha ao preparar upload: ${statusUpdate.error.message}`);
    await uploadWithTus(config, config.targetVideoPath, stat.size, storagePath, contentType, artifactPaths.tusState);
    await waitForStorageObjectSize(client, storagePath, stat.size);
    const pending = await client.from("reference_videos").update({ status: "pending", error_message: null })
      .eq("id", reference.id).eq("user_id", user.id);
    if (pending.error) throw new Error(`Upload terminou, mas a fila não foi atualizada: ${pending.error.message}`);
  }
  stage("private_resumable_upload", "completed", { reused: remoteSize === stat.size });

  stage("process_reference_video", "running");
  reference = await ensureReferenceReady(
    client,
    config,
    reference,
    storagePath,
    path.basename(config.targetVideoPath),
    user.id,
    Number.isFinite(independentDuration) && independentDuration > 0 ? independentDuration : undefined,
  );
  report.reference_analysis = {
    reference_video_id: reference.id,
    status: reference.status,
    duration_seconds: Number(reference.duration_seconds) || null,
    transcription_segment_count: reference.transcription_segment_count,
    visual_frame_count: reference.visual_frame_count,
    storage_bucket: REFERENCE_VIDEO_BUCKET,
    storage_path: storagePath,
  };
  stage("process_reference_video", "completed", {
    transcription_segment_count: reference.transcription_segment_count,
    visual_frame_count: reference.visual_frame_count,
  });

  stage("analyze_reference_topics", "running");
  let savedTopic: JsonRecord | null = null;
  if (checkpoint.topics_ready) {
    try {
      savedTopic = await topicSummary(client, reference.id);
    } catch {
      // O banco é a autoridade. Um checkpoint adiantado não pode pular IA.
      await saveCheckpoint({ topics_ready: false });
    }
  }
  if (!savedTopic) {
    // Corpo idêntico ao frontend.
    const topicResponse = await invokeFunction(config, "analyze-reference-topics", {
      reference_video_id: reference.id,
    });
    if (topicResponse.status !== "ready") throw new Error(`analyze-reference-topics retornou ${topicResponse.status || "status ausente"}.`);
    await saveCheckpoint({ topics_ready: true });
    savedTopic = await topicSummary(client, reference.id);
  }
  report.topic_analysis = savedTopic;
  stage("analyze_reference_topics", "completed", {
    central_topic: report.topic_analysis.central_topic,
    visual_anchor_count: report.topic_analysis.visual_anchor_count,
  });

  let contextId = checkpoint.generation_context_id;
  if (contextId) {
    const reusable = await loadContext(client, contextId, user.id).catch(() => null);
    if (!reusable || !contextMatchesReference(reusable, reference.id)) {
      contextId = undefined;
      await saveCheckpoint({ generation_context_id: undefined });
      stage("discard_stale_generation_context", "completed");
    }
  }
  if (!contextId) {
    stage("build_generation_context", "running");
    // O frontend envia user_id porque usa JWT de usuário. Em service-role o
    // contrato seguro da Edge Function exige internal_user_id.
    const contextBody: JsonRecord = {
      mode: "video",
      internal_user_id: user.id,
      reference_video_id: reference.id,
      language: config.language,
      dna_preset_id: preset.id,
    };
    if (config.notes) contextBody.notes = config.notes;
    const contextResponse = await invokeFunction(config, "build-complete-generation-context", contextBody);
    if (contextResponse.status !== "ready") {
      throw new Error(`build-complete-generation-context retornou ${contextResponse.status || "status ausente"}: ${contextResponse.status_reason || "sem motivo"}.`);
    }
    contextId = String(contextResponse.generation_context_id || "");
    if (!contextId) throw new Error("build-complete-generation-context não retornou generation_context_id.");
    const savedContext = await loadContext(client, contextId, user.id);
    if (!contextMatchesReference(savedContext, reference.id)) {
      throw new Error("Contexto recém-criado não está ready ou não aponta para a referência operacional correta.");
    }
    await saveCheckpoint({ generation_context_id: contextId });
    stage("build_generation_context", "completed", { generation_context_id: contextId });
  } else {
    stage("build_generation_context", "completed", { generation_context_id: contextId, reused: true });
  }

  stage("inject_dna_preset", "running");
  const injection = await injectSharedPreset(client, contextId, user.id, preset, stylePack, {
    formatStylePackLines: dna.formatStylePackLines,
    validateDnaStylePack: dna.validateDnaStylePack,
    buildHookStrategyAnalogs: dna.buildHookStrategyAnalogs,
  }, sourceFingerprint);
  if (injection.injected !== true) throw new Error("Preset DNA não foi injetado.");
  report.pipeline.generation_context_id = contextId;
  report.pipeline.dna_injection = {
    preset_id: preset.id,
    hook_apelao: true,
    visual_first: true,
    ...injection,
  };
  stage("inject_dna_preset", "completed", injection);

  let assemblyId = checkpoint.script_assembly_id;
  let assembly: JsonRecord;
  let currentAgent: JsonRecord;
  if (assemblyId) {
    assembly = await loadAssembly(client, assemblyId, user.id, contextId);
    currentAgent = requireAgentApproval(agentFromAssembly(assembly), "assembly retomado");
    stage("assemble_script", "completed", { script_assembly_id: assemblyId, reused: true });
  } else {
    stage("assemble_script", "running");
    // Corpo idêntico ao frontend; o próprio assemble-script executa até quatro
    // iterações internas Escritor DNA ↔ Avaliador Viral no modo vídeo.
    const assemblyResponse = await invokeFunction(config, "assemble-script", {
      generation_context_id: contextId,
    });
    assemblyId = String(assemblyResponse.script_assembly_id || "");
    if (!assemblyId) throw new Error("assemble-script não retornou script_assembly_id.");
    currentAgent = requireAgentApproval(assemblyResponse.writer_evaluator_loop, "assemble-script");
    assembly = await loadAssembly(client, assemblyId, user.id, contextId);
    await saveCheckpoint({ script_assembly_id: assemblyId, revision_attempts: 0 });
    stage("assemble_script", "completed", { script_assembly_id: assemblyId });
  }

  let validationStatus = "unknown";
  let revisionAttempts = Number(checkpoint.revision_attempts) || 0;
  // Always revalidate the current immutable text. A persisted `approved`
  // boolean alone cannot prove that script_blocks were not edited afterwards.
  stage("validate_script_against_dna", "running");
  const validation = await invokeFunction(config, "validate-script-against-dna", {
    script_assembly_id: assemblyId,
  });
  validationStatus = String(validation.validation_status || "unknown");
  await saveCheckpoint({ validation_status: validationStatus });
  stage("validate_script_against_dna", "completed", { validation_status: validationStatus });

  // Espelha o segundo loop do frontend: até duas revisões de uma assembly que
  // passou pelo loop interno, mas ainda recebeu needs_revision na validação DNA.
  while (validationStatus === "needs_revision" && revisionAttempts < MAX_FRONTEND_REVISIONS) {
    revisionAttempts += 1;
    stage(`revise_script_assembly_${revisionAttempts}`, "running");
    const revision = await invokeFunction(config, "revise-script-assembly", {
      script_assembly_id: assemblyId,
    });
    currentAgent = requireAgentApproval(revision.writer_evaluator_loop, `revisão ${revisionAttempts}`);
    const nextAssemblyId = String(revision.new_script_assembly_id || "");
    if (!nextAssemblyId) throw new Error(`Revisão ${revisionAttempts} não retornou new_script_assembly_id.`);
    assemblyId = nextAssemblyId;
    assembly = await loadAssembly(client, assemblyId, user.id, contextId);
    await saveCheckpoint({
      script_assembly_id: assemblyId,
      revision_attempts: revisionAttempts,
      validation_status: "unknown",
      promotion_status: undefined,
      promoted_script_id: undefined,
      completed: false,
    });
    stage(`revise_script_assembly_${revisionAttempts}`, "completed", { script_assembly_id: assemblyId });

    stage(`revalidate_script_${revisionAttempts}`, "running");
    const revalidation = await invokeFunction(config, "validate-script-against-dna", {
      script_assembly_id: assemblyId,
    });
    validationStatus = String(revalidation.validation_status || "unknown");
    await saveCheckpoint({ validation_status: validationStatus });
    stage(`revalidate_script_${revisionAttempts}`, "completed", { validation_status: validationStatus });
  }

  if (validationStatus !== "approved") {
    throw new Error(`Validação não aprovada após ${revisionAttempts} revisão(ões): ${validationStatus}.`);
  }
  // Releitura final impede que resposta intermediária ou checkpoint inconsistente
  // seja usado para montar o relatório.
  assembly = await loadAssembly(client, assemblyId, user.id, contextId);
  if (assembly.validation_status !== "approved") {
    throw new Error(`Assembly final não persistiu validation_status=approved (${assembly.validation_status || "ausente"}).`);
  }
  currentAgent = requireAgentApproval(agentFromAssembly(assembly), "assembly final");
  const hookOpeningContract = assertHookOpeningContract(assembly, stylePack);
  report.pipeline.script_assembly_id = assemblyId;
  report.pipeline.validation_status = validationStatus;
  report.pipeline.revision_attempts = revisionAttempts;
  report.writer_evaluator = sanitizeAgentReport(currentAgent);
  report.generated_script = {
    script_assembly_id: assemblyId,
    assembly_name: assembly.assembly_name,
    status: assembly.status,
    validation_status: validationStatus,
    validation_version: Number(assembly.validation_version) || null,
    validated_at: assembly.validated_at || null,
    validation_summary: sanitizeValidationSummary(assembly.validation_result),
    total_word_count: Array.isArray(assembly.script_blocks)
      ? assembly.script_blocks.reduce((sum: number, block: JsonRecord) => sum + (Number(block.word_count) || 0), 0)
      : 0,
    hook_opening_contract: hookOpeningContract,
    blocks: sanitizeBlocks(assembly.script_blocks, assembly.assembly_rules),
  };

  stage("promote_script_final", "running");
  const promotion = await invokeFunction(config, "promote-script-final", {
    script_assembly_id: assemblyId,
  });
  const promotionStatus = String(promotion.status || "").trim();
  const promotedScriptId = String(promotion.promoted_script_id || promotion.video_script_id || "").trim();
  if (!["promoted", "already_promoted"].includes(promotionStatus) || !promotedScriptId) {
    throw new Error(
      `promote-script-final não confirmou a promoção: status=${promotionStatus || "ausente"}, id=${promotedScriptId ? "presente" : "ausente"}.`,
    );
  }
  if (checkpoint.promoted_script_id && checkpoint.promoted_script_id !== promotedScriptId) {
    throw new Error("A promoção retornou um ID diferente do checkpoint desta execução.");
  }
  report.pipeline.promotion_status = promotionStatus;
  report.pipeline.promoted_script_id = promotedScriptId;
  assembly = await loadAssembly(client, assemblyId, user.id, contextId);
  if (assembly.status !== "final" || assembly.validation_status !== "approved") {
    throw new Error(
      `Assembly promovida não persistiu estado final/aprovado (status=${assembly.status || "ausente"}, validation=${assembly.validation_status || "ausente"}).`,
    );
  }
  report.generated_script.status = assembly.status;
  report.generated_script.validation_status = assembly.validation_status;
  report.generated_script.promoted_script_id = promotedScriptId;
  stage("promote_script_final", "completed", {
    promotion_status: promotionStatus,
    promoted_script_id: promotedScriptId,
  });
  await saveCheckpoint({
    script_assembly_id: assemblyId,
    revision_attempts: revisionAttempts,
    validation_status: validationStatus,
    promotion_status: promotionStatus,
    promoted_script_id: promotedScriptId,
  });

  report.status = "completed";
  report.finished_at = new Date().toISOString();
  await writeArtifacts();
  await saveCheckpoint({
    script_assembly_id: assemblyId,
    revision_attempts: revisionAttempts,
    validation_status: validationStatus,
    promotion_status: promotionStatus,
    promoted_script_id: promotedScriptId,
    completed: true,
  });
  console.log(`Relatório JSON: ${artifactPaths.json}`);
  console.log(`Relatório Markdown: ${artifactPaths.markdown}`);
}

try {
  await main();
} catch (error) {
  report.status = "failed";
  report.finished_at = new Date().toISOString();
  report.error = safeError(error);
  stage("pipeline", "failed", { message: report.error.message });
  if (!artifactPaths) {
    const fallbackDir = path.resolve(env("REPORT_DIR", path.join(".runtime", "viral-preset-live")));
    const fallbackKey = `preflight-${Date.now()}`;
    artifactPaths = {
      checkpoint: path.join(fallbackDir, `${fallbackKey}.checkpoint.json`),
      json: path.join(fallbackDir, `${fallbackKey}.json`),
      markdown: path.join(fallbackDir, `${fallbackKey}.md`),
      tusState: path.join(fallbackDir, `${fallbackKey}.tus.json`),
    };
  }
  try {
    await writeArtifacts();
  } catch (reportError) {
    console.error(`Falha adicional ao salvar relatório seguro: ${redacted(reportError)}`);
  }
  console.error(`Pipeline interrompido: ${report.error.message}`);
  process.exitCode = 1;
}
