/**
 * Recovers the original YouTube pt-orig caption timeline for the exact 16
 * stale rows, creates deterministic transcript ids, and commits the caption
 * replacement plus spoken-DNA rebind in one database transaction.
 *
 * The script is deliberately dry-run by default.  Captions are the only
 * speech source; video titles and descriptions are never read into blocks,
 * hooks, keywords, phrases, or triggers.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS,
  assertExactRepairInventory,
  buildSpokenDnaRebindPayload,
  spokenDnaPayloadSha256,
  type ExistingSpokenBlock,
  type SpokenDnaRebindPayload,
  type SpokenTranscriptRow,
  type TrustedVisualAnalysisRow,
} from "./lib/spoken-dna-rebind.ts";

const execFileAsync = promisify(execFile);
const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || "your-project-ref").trim();
const APPLY_CONFIRMATION = "REPAIR_SOURCE_CAPTIONS_16";
const ROOT = path.resolve(".runtime/retranscription");
const REPORT_PATH = path.resolve(".runtime/viral-base-live/spoken-dna-audit.json");
const PLAN_PATH = path.resolve(".runtime/viral-base-live/source-caption-spoken-rebind-plan.json");

type AuditReport = {
  inventory?: { expected?: number; audited?: number; passed?: number; failed?: number };
  videos?: Array<{ youtube_id?: string; ready?: boolean }>;
};

type SourceCaptionTranscript = SpokenTranscriptRow & {
  duracao: number;
  language_code: "pt";
};

type SourceCaptionRepairPayload = {
  schema_version: 1;
  engine: "source_caption_spoken_rebind_v1";
  youtube_id: string;
  video_id: string;
  duration_seconds: number;
  caption_sha256: string;
  transcripts: SourceCaptionTranscript[];
  rebind: SpokenDnaRebindPayload;
};

type RepairPlan = {
  schema_version: 1;
  generated_at: string;
  dry_run: boolean;
  exact_youtube_ids: string[];
  audit_sha256: string;
  source_artifact_sha256: string;
  database_state_sha256: string;
  payload_sha256: string;
  payloads: SourceCaptionRepairPayload[];
};

type YoutubeInfo = { duration?: unknown; id?: unknown };
type Json3Event = {
  tStartMs?: unknown;
  dDurationMs?: unknown;
  segs?: Array<{ utf8?: unknown }>;
};

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function expectedOrigin(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.hostname !== `${PROJECT_REF}.supabase.co`
      || parsed.port || parsed.username || parsed.password
      || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error(`SUPABASE_URL must be exactly https://${PROJECT_REF}.supabase.co`);
  }
  return parsed.origin;
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`);
  return parsed;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed, "utf8").digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeCaptionText(value: unknown): string {
  return String(value || "")
    .replace(/[\u200b\ufeff]/gu, "")
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Parses only actual caption text rows. Empty JSON3 timing updates and exact
 * duplicate updates are discarded without rewriting any spoken phrase. */
export function parsePtOrigJson3(
  raw: string,
  youtubeId: string,
  sourceDuration: number,
): SourceCaptionTranscript[] {
  let root: { events?: unknown };
  try {
    root = JSON.parse(raw) as { events?: unknown };
  } catch (error) {
    throw new Error(`${youtubeId}: pt-orig JSON3 is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(root.events)) throw new Error(`${youtubeId}: pt-orig JSON3 has no events array`);
  const duration = finite(sourceDuration, `${youtubeId}.source_duration`);
  if (duration <= 0 || duration > 600) throw new Error(`${youtubeId}: source duration outside 0-600 seconds`);

  const cues: Array<{ start: number; displayEnd: number; text: string; order: number }> = [];
  for (const [order, rawEvent] of (root.events as Json3Event[]).entries()) {
    const event = rawEvent || {};
    if (!Array.isArray(event.segs)) continue;
    const text = normalizeCaptionText(event.segs.map((segment) => String(segment?.utf8 || "")).join(""));
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const start = roundMilliseconds(finite(event.tStartMs, `${youtubeId}.event_${order + 1}.tStartMs`) / 1_000);
    const rawEnd = finite(event.tStartMs, `${youtubeId}.event_${order + 1}.tStartMs`)
      + finite(event.dDurationMs, `${youtubeId}.event_${order + 1}.dDurationMs`);
    const displayEnd = roundMilliseconds(Math.min(duration, rawEnd / 1_000));
    if (start < 0 || displayEnd <= start) continue;
    const previous = cues.at(-1);
    if (previous && previous.text === text
        && Math.abs(previous.start - start) < 0.02
        && Math.abs(previous.displayEnd - displayEnd) < 0.02) {
      continue;
    }
    cues.push({ start, displayEnd, text, order });
  }
  const sorted = cues.sort((left, right) =>
    left.start - right.start || left.displayEnd - right.displayEnd || left.order - right.order
  );
  if (sorted.length < 3) throw new Error(`${youtubeId}: pt-orig caption has fewer than three spoken rows`);
  // JSON3 `dDurationMs` is the on-screen paint duration. Adjacent chunks are
  // deliberately displayed together, but they are not simultaneous speech.
  // Use the next official cue start as the end of the current spoken chunk so
  // the stored transcript remains sequential and can be matched exactly to a
  // single narrative block without falsely treating subtitle rendering as two
  // people talking at once.
  const result = sorted.map((cue, index) => {
    const nextStart = sorted[index + 1]?.start;
    const end = roundMilliseconds(nextStart && nextStart > cue.start
      ? Math.min(cue.displayEnd, nextStart)
      : cue.displayEnd);
    if (end <= cue.start) throw new Error(`${youtubeId}: caption cue ${index + 1} has no sequential speech interval`);
    const id = deterministicUuid(`${youtubeId}:pt-orig:${cue.order}:${cue.start.toFixed(3)}:${end.toFixed(3)}:${cue.text}`);
    return {
      id,
      tempo_inicio: cue.start,
      tempo_fim: end,
      duracao: roundMilliseconds(end - cue.start),
      texto: cue.text,
      language_code: "pt" as const,
    };
  });
  if (new Set(result.map((row) => row.id)).size !== result.length) {
    throw new Error(`${youtubeId}: deterministic caption ids collided`);
  }
  return result;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sourcePaths(youtubeId: string) {
  const directory = path.join(ROOT, youtubeId);
  return {
    directory,
    caption: path.join(directory, `${youtubeId}.pt-orig.json3`),
    info: path.join(directory, `${youtubeId}.info.json`),
  };
}

async function ensureSourceArtifacts(youtubeId: string): Promise<void> {
  const paths = sourcePaths(youtubeId);
  if (await exists(paths.caption) && await exists(paths.info)) return;
  await mkdir(paths.directory, { recursive: true });
  const executable = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await execFileAsync(executable, [
        "--no-playlist",
        "--skip-download",
        "--write-info-json",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", "pt-orig",
        "--sub-format", "json3",
        "--no-overwrites",
        "--sleep-requests", "1",
        "-o", path.join(paths.directory, "%(id)s.%(ext)s"),
        `https://www.youtube.com/shorts/${youtubeId}`,
      ], { timeout: 180_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      if (await exists(paths.caption) && await exists(paths.info)) return;
      throw new Error("yt-dlp did not produce both pt-orig JSON3 and info JSON");
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(15_000 * attempt);
    }
  }
  throw new Error(`${youtubeId}: cannot recover original pt-orig caption artifact: ${String(lastError)}`);
}

async function rows<T>(
  promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  label: string,
): Promise<T[]> {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message || "query failed"}`);
  return result.data || [];
}

async function one<T>(
  promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  label: string,
): Promise<T> {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message || "query failed"}`);
  if (!result.data) throw new Error(`${label}: row missing`);
  return result.data;
}

async function findVideoId(client: SupabaseClient, youtubeId: string): Promise<string> {
  const metadata = await rows<any>(client.from("video_metadata")
    .select("video_id,chave,valor")
    .in("chave", ["youtube_id", "source_idempotency_key"])
    .in("valor", [youtubeId, `youtube:${youtubeId}`]), `${youtubeId}.identity`);
  const ids = [...new Set(metadata.map((row) => String(row.video_id || "")).filter(Boolean))];
  if (ids.length !== 1) throw new Error(`${youtubeId}: expected one video identity, got ${ids.length}`);
  return ids[0];
}

async function sourceCaptionRows(youtubeId: string): Promise<{ duration: number; transcripts: SourceCaptionTranscript[]; artifactHash: string }> {
  const paths = sourcePaths(youtubeId);
  const [captionRaw, infoRaw] = await Promise.all([readFile(paths.caption, "utf8"), readFile(paths.info, "utf8")]);
  let info: YoutubeInfo;
  try {
    info = JSON.parse(infoRaw) as YoutubeInfo;
  } catch (error) {
    throw new Error(`${youtubeId}: info JSON invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (String(info.id || "") !== youtubeId) throw new Error(`${youtubeId}: info JSON belongs to another source`);
  const duration = roundMilliseconds(finite(info.duration, `${youtubeId}.info.duration`));
  const transcripts = parsePtOrigJson3(captionRaw, youtubeId, duration);
  const artifactHash = createHash("sha256").update(captionRaw, "utf8").digest("hex");
  return { duration, transcripts, artifactHash };
}

function assertRepairAudit(report: AuditReport): void {
  if (report.inventory?.expected !== 50 || report.inventory?.audited !== 50 || !Array.isArray(report.videos)) {
    throw new Error("spoken audit report is not the exact 50-video inventory");
  }
  const failing = report.videos.filter((row) => !row.ready).map((row) => String(row.youtube_id || ""));
  assertExactRepairInventory(failing);
}

async function buildPayload(client: SupabaseClient, youtubeId: string): Promise<SourceCaptionRepairPayload> {
  const videoId = await findVideoId(client, youtubeId);
  const [{ duration, transcripts, artifactHash }, video, blocks, visuals] = await Promise.all([
    sourceCaptionRows(youtubeId),
    one<any>(client.from("videos").select("id,duracao,status").eq("id", videoId).single(), `${youtubeId}.video`),
    rows<ExistingSpokenBlock>(client.from("video_blocks")
      .select("id,bloco_id,tipo_bloco,tempo_inicio,tempo_fim,texto,emocao,funcao_narrativa")
      .eq("video_id", videoId)
      .order("bloco_id", { ascending: true }), `${youtubeId}.blocks`),
    rows<TrustedVisualAnalysisRow>(client.from("visual_block_analysis")
      .select("*")
      .eq("video_id", videoId)
      .eq("data_source_type", "gemini_video_understanding"), `${youtubeId}.visuals`),
  ]);
  if (video.id !== videoId || video.status !== "completed") {
    throw new Error(`${youtubeId}: source video is not a completed stable row`);
  }
  const previousDuration = Number(video.duracao);
  if (!Number.isFinite(previousDuration) || previousDuration <= 0
      || Math.abs(previousDuration - duration) > Math.max(2, duration * 0.05)) {
    throw new Error(`${youtubeId}: downloaded media duration ${duration}s conflicts with stored duration ${video.duracao}`);
  }
  const rebind = buildSpokenDnaRebindPayload({
    youtubeId,
    videoId,
    durationSeconds: duration,
    transcripts,
    blocks,
    visualAnalyses: visuals,
  });
  return {
    schema_version: 1,
    engine: "source_caption_spoken_rebind_v1",
    youtube_id: youtubeId,
    video_id: videoId,
    duration_seconds: duration,
    caption_sha256: artifactHash,
    transcripts,
    rebind,
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function sourceArtifactHash(payloads: SourceCaptionRepairPayload[]): string {
  return spokenDnaPayloadSha256(payloads.map((payload) => ({
    youtube_id: payload.youtube_id,
    video_id: payload.video_id,
    duration_seconds: payload.duration_seconds,
    caption_sha256: payload.caption_sha256,
    transcripts: payload.transcripts,
  })));
}

function databaseStateHash(payloads: SourceCaptionRepairPayload[]): string {
  return spokenDnaPayloadSha256(payloads.map((payload) => ({
    youtube_id: payload.youtube_id,
    video_id: payload.video_id,
    rebind: {
      mode: payload.rebind.mode,
      transcript_sha256: payload.rebind.transcript_sha256,
      blocks: payload.rebind.blocks.map((block) => ({
        source_block_id: block.source_block_id,
        source_visual_analysis_id: block.source_visual_analysis_id,
        index: block.index,
        type: block.type,
        start: block.start,
        end: block.end,
        text: block.text,
      })),
    },
  })));
}

async function runFinalAudit(): Promise<void> {
  const result = await execFileAsync(process.execPath, [
    path.resolve("node_modules/vite-node/vite-node.mjs"),
    "--script", path.resolve("scripts/audit-viral-spoken-dna-live.ts"),
  ], {
    cwd: process.cwd(), env: process.env, timeout: 180_000,
    windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  const audit = JSON.parse(await readFile(REPORT_PATH, "utf8")) as AuditReport;
  if (audit.inventory?.passed !== 50 || audit.inventory?.failed !== 0) {
    throw new Error(`post-repair audit is ${audit.inventory?.passed || 0}/50, expected 50/50`);
  }
}

async function main(): Promise<void> {
  const download = process.argv.includes("--download");
  const apply = process.argv.includes("--apply");
  const unknown = process.argv.slice(2).filter((value) => value !== "--download" && value !== "--apply");
  if (unknown.length) throw new Error(`unknown arguments: ${unknown.join(" ")}`);
  if (apply && process.env.SOURCE_CAPTION_SPOKEN_REBIND_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error(`apply requires SOURCE_CAPTION_SPOKEN_REBIND_CONFIRM=${APPLY_CONFIRMATION}`);
  }
  if (download) {
    for (const id of EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS) await ensureSourceArtifacts(id);
  }
  const reportRaw = await readFile(REPORT_PATH, "utf8");
  const report = JSON.parse(reportRaw) as AuditReport;
  assertRepairAudit(report);
  const client = createClient(expectedOrigin(requiredEnv("SUPABASE_URL")), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const payloads: SourceCaptionRepairPayload[] = [];
  for (const id of EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS) {
    try {
      payloads.push(await buildPayload(client, id));
    } catch (error) {
      throw new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assertExactRepairInventory(payloads.map((payload) => payload.youtube_id));
  const auditSha256 = createHash("sha256").update(reportRaw, "utf8").digest("hex");
  const artifactsSha256 = sourceArtifactHash(payloads);
  const stateSha256 = databaseStateHash(payloads);
  const payloadSha256 = spokenDnaPayloadSha256(payloads);

  if (apply) {
    const previous = JSON.parse(await readFile(PLAN_PATH, "utf8")) as RepairPlan;
    if (previous.audit_sha256 !== auditSha256
        || previous.source_artifact_sha256 !== artifactsSha256
        || previous.database_state_sha256 !== stateSha256
        || previous.payload_sha256 !== payloadSha256) {
      throw new Error("source artifacts, audit, or database state changed after dry-run; review a new plan before apply");
    }
  }
  const plan: RepairPlan = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dry_run: !apply,
    exact_youtube_ids: [...EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS],
    audit_sha256: auditSha256,
    source_artifact_sha256: artifactsSha256,
    database_state_sha256: stateSha256,
    payload_sha256: payloadSha256,
    payloads,
  };
  await writeJsonAtomic(PLAN_PATH, plan);
  if (!apply) {
    console.log(JSON.stringify({
      dry_run: true,
      database_writes: 0,
      downloaded_source_artifacts: download,
      exact_inventory_count: payloads.length,
      modes: payloads.reduce<Record<string, number>>((counts, payload) => {
        counts[payload.rebind.mode] = (counts[payload.rebind.mode] || 0) + 1;
        return counts;
      }, {}),
      plan: PLAN_PATH,
      payload_sha256: payloadSha256,
    }));
    return;
  }
  const { data, error } = await client.rpc("repair_viral_source_captions_and_rebind_atomic" as never, {
    _payloads: payloads,
    _payload_sha256: payloadSha256,
    _audit_sha256: auditSha256,
  } as never);
  if (error) throw new Error(`source-caption atomic repair failed: ${error.message}`);
  console.log(JSON.stringify({ atomic_commit: data }));
  await runFinalAudit();
}

await main();
