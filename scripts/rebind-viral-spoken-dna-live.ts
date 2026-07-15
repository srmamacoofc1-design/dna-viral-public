/**
 * Builds (dry-run by default) the exact spoken-DNA repair batch selected by
 * `audit-viral-spoken-dna-live.ts`. The database mutation is a single RPC, so
 * either all exact 16 non-manual failures commit or none of them do.
 *
 * Required environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Apply (never the default):
 *   SPOKEN_DNA_REBIND_CONFIRM=REPAIR_EXACT_16 \
 *     npx vite-node scripts/rebind-viral-spoken-dna-live.ts --apply
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertExactRepairInventory,
  buildSpokenDnaRebindPayload,
  CODEX_MANUAL_AUDIT_IDS,
  EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS,
  spokenDnaPayloadSha256,
  type ExistingSpokenBlock,
  type SpokenDnaRebindPayload,
  type SpokenTranscriptRow,
  type TrustedVisualAnalysisRow,
} from "./lib/spoken-dna-rebind.ts";

const execFileAsync = promisify(execFile);
const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || "your-project-ref").trim();
const DEFAULT_REPORT = path.resolve(".runtime/viral-base-live/spoken-dna-audit.json");
const DEFAULT_PLAN = path.resolve(".runtime/viral-base-live/spoken-dna-rebind-plan.json");
const DEFAULT_SNAPSHOT = path.resolve(".runtime/viral-base-live/pre-spoken-rebind-snapshot.json");
const APPLY_CONFIRMATION = "REPAIR_EXACT_16";
const SNAPSHOT_TABLES = [
  "video_transcripts",
  "video_blocks",
  "visual_block_analysis",
  "block_semantic_patterns",
  "block_word_patterns",
  "block_phrase_patterns",
  "block_verbal_analysis",
  "text_visual_alignment",
  "text_image_compatibility",
  "video_frames",
] as const;
const SNAPSHOT_METADATA_KEYS = [
  "youtube_id",
  "source_idempotency_key",
  "analysis_source",
  "multimodal_visual_analysis",
  "spoken_dna_rebind_v1",
] as const;

type AuditReport = {
  inventory?: { expected?: number; audited?: number; passed?: number; failed?: number };
  videos?: Array<{
    youtube_id?: string;
    video_id?: string | null;
    ready?: boolean;
    reasons?: string[];
  }>;
};

type RebindSnapshot = {
  schema_version: 1;
  created_at: string;
  exact_youtube_ids: string[];
  exact_video_ids: string[];
  audit_sha256: string;
  row_counts: Record<string, number>;
  state_sha256: string;
  manifest_sha256: string;
  rows: Record<string, any[]>;
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
    || parsed.port || parsed.username || parsed.password
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search || parsed.hash
  ) {
    throw new Error(`SUPABASE_URL must be exactly https://${PROJECT_REF}.supabase.co`);
  }
  return parsed.origin;
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
  const metadata = await rows<any>(
    client.from("video_metadata")
      .select("video_id,chave,valor")
      .in("chave", ["youtube_id", "source_idempotency_key"])
      .in("valor", [youtubeId, `youtube:${youtubeId}`]),
    `${youtubeId}.identity`,
  );
  const ids = [...new Set(metadata.map((row) => String(row.video_id || "")).filter(Boolean))];
  if (ids.length !== 1) throw new Error(`${youtubeId}: expected one video identity, received ${ids.length}`);
  return ids[0];
}

async function fetchAllRows(
  client: SupabaseClient,
  table: string,
  idColumn: "id" | "video_id",
  ids: string[],
  metadataKeys?: readonly string[],
): Promise<any[]> {
  const pageSize = 1_000;
  const result: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query: any = client.from(table).select("*").in(idColumn, ids);
    if (metadataKeys) query = query.in("chave", [...metadataKeys]);
    query = query.order(idColumn, { ascending: true });
    if (idColumn !== "id" || table !== "videos") query = query.order("id", { ascending: true });
    const page = await rows<any>(query.range(offset, offset + pageSize - 1), `${table}[${offset}]`);
    result.push(...page);
    if (page.length < pageSize) return result;
  }
}

function distinctBlockCoverage(rows: any[], videoId: string): number {
  return new Set(rows.filter((row) => row.video_id === videoId).map((row) => row.block_id).filter(Boolean)).size;
}

function assertSnapshotComplete(snapshot: RebindSnapshot): void {
  assertExactRepairInventory(snapshot.exact_youtube_ids);
  if (snapshot.schema_version !== 1 || snapshot.exact_video_ids.length !== 16
      || new Set(snapshot.exact_video_ids).size !== 16) {
    throw new Error("pre-rebind snapshot does not contain the exact 16 unique video ids");
  }
  const requiredTables = ["videos", ...SNAPSHOT_TABLES, "video_metadata"];
  for (const table of requiredTables) {
    if (!Array.isArray(snapshot.rows?.[table]) || snapshot.row_counts?.[table] !== snapshot.rows[table].length) {
      throw new Error(`pre-rebind snapshot table is incomplete: ${table}`);
    }
  }
  if (snapshot.rows.videos.length !== 16) throw new Error("pre-rebind snapshot videos count is not 16");
  const blockRows = snapshot.rows.video_blocks;
  for (const videoId of snapshot.exact_video_ids) {
    const blocks = blockRows.filter((row) => row.video_id === videoId);
    if (blocks.length < 3 || blocks.length > 18) throw new Error(`${videoId}: snapshot block count outside 3-18`);
    if (!snapshot.rows.video_transcripts.some((row) => row.video_id === videoId)) {
      throw new Error(`${videoId}: snapshot transcript missing`);
    }
    if (snapshot.rows.video_frames.filter((row) => row.video_id === videoId).length < 3) {
      throw new Error(`${videoId}: snapshot trusted/current frames missing`);
    }
    for (const table of [
      "visual_block_analysis",
      "block_semantic_patterns",
      "block_word_patterns",
      "block_phrase_patterns",
      "block_verbal_analysis",
      "text_visual_alignment",
      "text_image_compatibility",
    ]) {
      if (distinctBlockCoverage(snapshot.rows[table], videoId) < blocks.length) {
        throw new Error(`${videoId}: snapshot ${table} block coverage is incomplete`);
      }
    }
    const metadata = snapshot.rows.video_metadata.filter((row) => row.video_id === videoId);
    if (!metadata.some((row) => row.chave === "youtube_id" || row.chave === "source_idempotency_key")
        || !metadata.some((row) => row.chave === "analysis_source")
        || !metadata.some((row) => row.chave === "multimodal_visual_analysis")) {
      throw new Error(`${videoId}: snapshot relevant metadata is incomplete`);
    }
  }
  const stateSha256 = spokenDnaPayloadSha256(snapshot.rows);
  if (snapshot.state_sha256 !== stateSha256) throw new Error("pre-rebind snapshot state SHA-256 mismatch");
  const manifestSha256 = spokenDnaPayloadSha256({
    schema_version: snapshot.schema_version,
    created_at: snapshot.created_at,
    exact_youtube_ids: snapshot.exact_youtube_ids,
    exact_video_ids: snapshot.exact_video_ids,
    audit_sha256: snapshot.audit_sha256,
    row_counts: snapshot.row_counts,
    state_sha256: snapshot.state_sha256,
  });
  if (snapshot.manifest_sha256 !== manifestSha256) throw new Error("pre-rebind snapshot manifest SHA-256 mismatch");
}

async function captureSnapshot(
  client: SupabaseClient,
  youtubeIds: string[],
  auditSha256: string,
): Promise<RebindSnapshot> {
  assertExactRepairInventory(youtubeIds);
  const identityPairs: Array<{ youtubeId: string; videoId: string }> = [];
  for (const youtubeId of youtubeIds) {
    identityPairs.push({ youtubeId, videoId: await findVideoId(client, youtubeId) });
  }
  const videoIds = identityPairs.map((pair) => pair.videoId);
  const snapshotRows: Record<string, any[]> = {
    videos: await fetchAllRows(client, "videos", "id", videoIds),
  };
  for (const table of SNAPSHOT_TABLES) {
    snapshotRows[table] = await fetchAllRows(client, table, "video_id", videoIds);
  }
  snapshotRows.video_metadata = await fetchAllRows(
    client,
    "video_metadata",
    "video_id",
    videoIds,
    SNAPSHOT_METADATA_KEYS,
  );
  const rowCounts = Object.fromEntries(Object.entries(snapshotRows).map(([table, tableRows]) => [table, tableRows.length]));
  const createdAt = new Date().toISOString();
  const stateSha256 = spokenDnaPayloadSha256(snapshotRows);
  const manifest = {
    schema_version: 1 as const,
    created_at: createdAt,
    exact_youtube_ids: [...youtubeIds],
    exact_video_ids: [...videoIds],
    audit_sha256: auditSha256,
    row_counts: rowCounts,
    state_sha256: stateSha256,
  };
  const snapshot: RebindSnapshot = {
    ...manifest,
    manifest_sha256: spokenDnaPayloadSha256(manifest),
    rows: snapshotRows,
  };
  assertSnapshotComplete(snapshot);
  return snapshot;
}

async function requireMatchingSnapshot(
  client: SupabaseClient,
  youtubeIds: string[],
  auditSha256: string,
): Promise<RebindSnapshot> {
  let stored: RebindSnapshot;
  try {
    stored = JSON.parse(await readFile(DEFAULT_SNAPSHOT, "utf8")) as RebindSnapshot;
  } catch (error) {
    throw new Error(`apply requires a valid pre-existing ${DEFAULT_SNAPSHOT}: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertSnapshotComplete(stored);
  if (stored.audit_sha256 !== auditSha256) throw new Error("pre-rebind snapshot was built from a different audit report");
  assertExactRepairInventory(stored.exact_youtube_ids);
  const current = await captureSnapshot(client, youtubeIds, auditSha256);
  if (current.state_sha256 !== stored.state_sha256
      || current.exact_video_ids.some((id, index) => id !== stored.exact_video_ids[index])) {
    throw new Error("database state changed after the pre-rebind snapshot; run a new dry-run and review it");
  }
  return stored;
}

function selectExactFailures(report: AuditReport): string[] {
  const videos = Array.isArray(report.videos) ? report.videos : [];
  if (report.inventory?.expected !== 50 || report.inventory?.audited !== 50 || videos.length !== 50) {
    throw new Error("spoken-DNA report is not the exact audited 50-video inventory");
  }
  const ids = videos.map((video) => String(video.youtube_id || "").trim());
  if (ids.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id)) || new Set(ids).size !== 50) {
    throw new Error("spoken-DNA report contains missing, invalid or duplicate YouTube ids");
  }
  const manual = new Set<string>(CODEX_MANUAL_AUDIT_IDS);
  const failedNonManual = videos
    .filter((video) => !video.ready && !manual.has(String(video.youtube_id || "")))
    .map((video) => String(video.youtube_id));
  assertExactRepairInventory(failedNonManual);
  const expected = new Set<string>(EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS);
  const unexpectedlyReady = videos.filter((video) =>
    video.ready && expected.has(String(video.youtube_id || ""))
  );
  if (unexpectedlyReady.length) {
    throw new Error(`repair allowlist contains already-ready report rows: ${unexpectedlyReady.map((row) => row.youtube_id).join(",")}`);
  }
  return [...EXPECTED_NON_MANUAL_SPOKEN_DNA_REPAIR_IDS];
}

async function buildPayload(
  client: SupabaseClient,
  youtubeId: string,
): Promise<SpokenDnaRebindPayload> {
  const videoId = await findVideoId(client, youtubeId);
  const [video, transcripts, blocks, visuals] = await Promise.all([
    one<any>(client.from("videos").select("id,duracao,status").eq("id", videoId).single(), `${youtubeId}.video`),
    rows<SpokenTranscriptRow>(client.from("video_transcripts")
      .select("id,tempo_inicio,tempo_fim,texto")
      .eq("video_id", videoId)
      .order("tempo_inicio", { ascending: true })
      .order("tempo_fim", { ascending: true }), `${youtubeId}.transcripts`),
    rows<ExistingSpokenBlock>(client.from("video_blocks")
      .select("id,bloco_id,tipo_bloco,tempo_inicio,tempo_fim,texto,emocao,funcao_narrativa")
      .eq("video_id", videoId)
      .order("bloco_id", { ascending: true }), `${youtubeId}.blocks`),
    rows<TrustedVisualAnalysisRow>(client.from("visual_block_analysis")
      .select("*")
      .eq("video_id", videoId)
      .eq("data_source_type", "gemini_video_understanding"), `${youtubeId}.visuals`),
  ]);
  if (video.id !== videoId) throw new Error(`${youtubeId}: video id changed during lookup`);
  return buildSpokenDnaRebindPayload({
    youtubeId,
    videoId,
    durationSeconds: Number(video.duracao),
    transcripts,
    blocks,
    visualAnalyses: visuals,
  });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function runFinalAudit(): Promise<void> {
  const result = await execFileAsync(process.execPath, [
    path.resolve("node_modules/vite-node/vite-node.mjs"),
    "--script",
    path.resolve("scripts/audit-viral-spoken-dna-live.ts"),
  ], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 180_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  const audited = JSON.parse(await readFile(DEFAULT_REPORT, "utf8")) as AuditReport;
  if (audited.inventory?.passed !== 50 || audited.inventory?.failed !== 0) {
    throw new Error(`post-commit spoken-DNA audit is ${audited.inventory?.passed || 0}/50, expected 50/50`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const unknownFlags = process.argv.slice(2).filter((argument) => argument !== "--apply");
  if (unknownFlags.length) throw new Error(`unknown arguments: ${unknownFlags.join(" ")}`);
  if (apply && process.env.SPOKEN_DNA_REBIND_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error(`apply requires SPOKEN_DNA_REBIND_CONFIRM=${APPLY_CONFIRMATION}`);
  }
  const reportRaw = await readFile(DEFAULT_REPORT, "utf8");
  const report = JSON.parse(reportRaw) as AuditReport;
  const ids = selectExactFailures(report);
  const supabaseUrl = expectedOrigin(requiredEnv("SUPABASE_URL"));
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auditSha256 = createHash("sha256").update(reportRaw, "utf8").digest("hex");
  const snapshot = apply
    ? await requireMatchingSnapshot(client, ids, auditSha256)
    : await captureSnapshot(client, ids, auditSha256);
  if (!apply) await writeJsonAtomic(DEFAULT_SNAPSHOT, snapshot);
  const payloads: SpokenDnaRebindPayload[] = [];
  for (const id of ids) {
    try {
      payloads.push(await buildPayload(client, id));
    } catch (error) {
      throw new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assertExactRepairInventory(payloads.map((payload) => payload.youtube_id));
  const payloadSha256 = spokenDnaPayloadSha256(payloads);
  const plan = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dry_run: !apply,
    atomic_batch: true,
    exact_inventory_count: payloads.length,
    audit_sha256: auditSha256,
    pre_rebind_snapshot: DEFAULT_SNAPSHOT,
    pre_rebind_state_sha256: snapshot.state_sha256,
    pre_rebind_manifest_sha256: snapshot.manifest_sha256,
    payload_sha256: payloadSha256,
    modes: {
      layers_only: payloads.filter((payload) => payload.mode === "layers_only").length,
      full_rebind: payloads.filter((payload) => payload.mode === "full_rebind").length,
    },
    payloads,
  };
  await writeJsonAtomic(DEFAULT_PLAN, plan);
  if (!apply) {
    console.log(JSON.stringify({
      dry_run: true,
      database_writes: 0,
      exact_inventory_count: payloads.length,
      modes: plan.modes,
      payload_sha256: payloadSha256,
      plan: DEFAULT_PLAN,
      snapshot: DEFAULT_SNAPSHOT,
      snapshot_state_sha256: snapshot.state_sha256,
      snapshot_manifest_sha256: snapshot.manifest_sha256,
    }));
    return;
  }
  const { data, error } = await client.rpc("rebind_viral_spoken_dna_atomic", {
    _payloads: payloads,
    _payload_sha256: payloadSha256,
    _audit_sha256: auditSha256,
  });
  if (error) throw new Error(`atomic spoken-DNA rebind failed: ${error.message}`);
  console.log(JSON.stringify({ atomic_commit: data }));
  await runFinalAudit();
}

await main();
