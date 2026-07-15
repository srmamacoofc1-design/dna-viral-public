/**
 * Refreshes the spoken-only layers for the 18 rows whose narrative blocks were
 * already exact, but whose legacy hook/payoff and semantic rows predate the
 * strict spoken-DNA contract. The database commit is one transaction for the
 * exact cohort; this script is dry-run by default.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assignExactTranscriptTextToBlocks,
  assertTranscriptTimelineMatchesSource,
  narrativeBlockContractViolations,
  type NarrativeBlock,
} from "../supabase/functions/_shared/narrative-blocks.ts";
import {
  deriveSpokenSemantic,
  deriveSpokenVerbal,
  spokenDnaPayloadSha256,
  type ExistingSpokenBlock,
  type SpokenTranscriptRow,
} from "./lib/spoken-dna-rebind.ts";

const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || "your-project-ref").trim();
const APPLY_CONFIRMATION = "REFRESH_EXACT_18";
const REPORT_PATH = path.resolve(".runtime/viral-base-live/spoken-dna-audit.json");
const PLAN_PATH = path.resolve(".runtime/viral-base-live/spoken-dna-layer-refresh-plan.json");

export const EXACT_EXISTING_SPOKEN_LAYER_REFRESH_IDS = [
  "OlYMSfYlBFo", "eXs-hEK1qPg", "nFfKqQBRC8g", "raP3axYfubU",
  "Ay-E-FByxyU", "8B0OfDDWqNs", "PzYV3aq2QYM", "jPoq9QTxMDc",
  "8zb89g-AUEY", "bDP1EALyXik", "NatewOBrinA", "bnLlnciv04c",
  "qgBrw-CjvGI", "JGxFwABwiWo", "f1VkuYAF2mM", "EakSssIZ3nQ",
  "7oiC-4hc-dI", "raB_88YjQbk",
] as const;

type AuditReport = {
  inventory?: { expected?: number; audited?: number; passed?: number; failed?: number };
  videos?: Array<{ youtube_id?: string; ready?: boolean }>;
};

type RefreshBlock = {
  source_block_id: string;
  index: number;
  type: string;
  start: number;
  end: number;
  text: string;
  schema_emotion: string;
  semantic: ReturnType<typeof deriveSpokenSemantic>;
  verbal: ReturnType<typeof deriveSpokenVerbal>;
};

type RefreshPayload = {
  schema_version: 1;
  engine: "spoken_dna_layer_refresh_v1";
  youtube_id: string;
  video_id: string;
  duration_seconds: number;
  transcript_sha256: string;
  blocks: RefreshBlock[];
};

type RefreshPlan = {
  schema_version: 1;
  generated_at: string;
  dry_run: boolean;
  exact_youtube_ids: string[];
  audit_sha256: string;
  state_sha256: string;
  payload_sha256: string;
  payloads: RefreshPayload[];
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

function assertExactInventory(ids: readonly string[]): void {
  const actual = [...new Set(ids)].sort();
  const expected = [...EXACT_EXISTING_SPOKEN_LAYER_REFRESH_IDS].sort();
  if (actual.length !== ids.length || actual.length !== expected.length
      || actual.some((id, index) => id !== expected[index])) {
    throw new Error(`layer refresh inventory differs from exact 18: ${actual.join(",")}`);
  }
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

function transcriptStateHash(transcript: SpokenTranscriptRow[]): string {
  return spokenDnaPayloadSha256(transcript.map((row) => ({
    id: row.id,
    start: Number(row.tempo_inicio),
    end: Number(row.tempo_fim),
    text: String(row.texto || ""),
  })));
}

async function buildPayload(client: SupabaseClient, youtubeId: string): Promise<RefreshPayload> {
  const videoId = await findVideoId(client, youtubeId);
  const [video, transcript, blocks] = await Promise.all([
    one<any>(client.from("videos").select("id,duracao,status").eq("id", videoId).single(), `${youtubeId}.video`),
    rows<SpokenTranscriptRow>(client.from("video_transcripts")
      .select("id,tempo_inicio,tempo_fim,texto")
      .eq("video_id", videoId)
      .order("tempo_inicio", { ascending: true })
      .order("tempo_fim", { ascending: true }), `${youtubeId}.transcript`),
    rows<ExistingSpokenBlock>(client.from("video_blocks")
      .select("id,bloco_id,tipo_bloco,tempo_inicio,tempo_fim,texto,emocao,funcao_narrativa")
      .eq("video_id", videoId)
      .order("bloco_id", { ascending: true }), `${youtubeId}.blocks`),
  ]);
  const duration = Number(video.duracao);
  if (video.status !== "completed" || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${youtubeId}: source is not a completed, timed video`);
  }
  assertTranscriptTimelineMatchesSource(transcript, duration);
  const narrative: NarrativeBlock[] = blocks.map((block) => ({
    bloco_id: Number(block.bloco_id),
    tipo_bloco: String(block.tipo_bloco),
    texto: String(block.texto || ""),
    tempo_inicio: Number(block.tempo_inicio),
    tempo_fim: Number(block.tempo_fim),
  }));
  const violations = narrativeBlockContractViolations(narrative, duration);
  if (violations.length) throw new Error(`${youtubeId}: narrative timeline invalid: ${violations.join(",")}`);
  const exact = assignExactTranscriptTextToBlocks(narrative, transcript);
  if (exact.some((block, index) => block.texto !== narrative[index]?.texto)) {
    throw new Error(`${youtubeId}: current block text is not exact spoken transcript`);
  }
  if (blocks[0]?.tipo_bloco !== "hook" || !blocks.some((block) => block.tipo_bloco === "desenvolvimento")
      || !blocks.some((block) => block.tipo_bloco === "payoff")) {
    throw new Error(`${youtubeId}: required hook/development/payoff chain is missing`);
  }
  return {
    schema_version: 1,
    engine: "spoken_dna_layer_refresh_v1",
    youtube_id: youtubeId,
    video_id: videoId,
    duration_seconds: duration,
    transcript_sha256: transcriptStateHash(transcript),
    blocks: blocks.map((block) => {
      const text = String(block.texto || "").trim();
      const type = String(block.tipo_bloco);
      const semantic = deriveSpokenSemantic(text, type);
      return {
        source_block_id: String(block.id),
        index: Number(block.bloco_id),
        type,
        start: Number(block.tempo_inicio),
        end: Number(block.tempo_fim),
        text,
        schema_emotion: String(block.emocao),
        semantic,
        verbal: deriveSpokenVerbal(text, type, semantic),
      };
    }),
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function stateHash(payloads: RefreshPayload[]): string {
  return spokenDnaPayloadSha256(payloads.map((payload) => ({
    youtube_id: payload.youtube_id,
    video_id: payload.video_id,
    duration_seconds: payload.duration_seconds,
    transcript_sha256: payload.transcript_sha256,
    blocks: payload.blocks.map((block) => ({
      source_block_id: block.source_block_id,
      index: block.index,
      type: block.type,
      start: block.start,
      end: block.end,
      text: block.text,
      schema_emotion: block.schema_emotion,
    })),
  })));
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const unknown = process.argv.slice(2).filter((value) => value !== "--apply");
  if (unknown.length) throw new Error(`unknown arguments: ${unknown.join(" ")}`);
  if (apply && process.env.SPOKEN_DNA_LAYER_REFRESH_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error(`apply requires SPOKEN_DNA_LAYER_REFRESH_CONFIRM=${APPLY_CONFIRMATION}`);
  }
  const reportRaw = await readFile(REPORT_PATH, "utf8");
  const report = JSON.parse(reportRaw) as AuditReport;
  if (report.inventory?.expected !== 50 || report.inventory?.audited !== 50 || !Array.isArray(report.videos)) {
    throw new Error("spoken audit report is not the exact 50-video inventory");
  }
  const reportIds = new Set(report.videos.map((row) => String(row.youtube_id || "")));
  assertExactInventory(EXACT_EXISTING_SPOKEN_LAYER_REFRESH_IDS);
  if ([...EXACT_EXISTING_SPOKEN_LAYER_REFRESH_IDS].some((id) => !reportIds.has(id))) {
    throw new Error("spoken audit report lost an expected existing-video id");
  }
  const supabaseUrl = expectedOrigin(requiredEnv("SUPABASE_URL"));
  const client = createClient(supabaseUrl, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const payloads: RefreshPayload[] = [];
  for (const id of EXACT_EXISTING_SPOKEN_LAYER_REFRESH_IDS) payloads.push(await buildPayload(client, id));
  assertExactInventory(payloads.map((payload) => payload.youtube_id));
  const auditSha256 = createHash("sha256").update(reportRaw, "utf8").digest("hex");
  const currentStateSha256 = stateHash(payloads);
  const payloadSha256 = spokenDnaPayloadSha256(payloads);

  if (apply) {
    const previous = JSON.parse(await readFile(PLAN_PATH, "utf8")) as RefreshPlan;
    if (previous.audit_sha256 !== auditSha256 || previous.state_sha256 !== currentStateSha256
        || previous.payload_sha256 !== payloadSha256) {
      throw new Error("database state or audit changed after dry-run; review a new plan before apply");
    }
  }
  const plan: RefreshPlan = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dry_run: !apply,
    exact_youtube_ids: [...EXACT_EXISTING_SPOKEN_LAYER_REFRESH_IDS],
    audit_sha256: auditSha256,
    state_sha256: currentStateSha256,
    payload_sha256: payloadSha256,
    payloads,
  };
  await writeJsonAtomic(PLAN_PATH, plan);
  if (!apply) {
    console.log(JSON.stringify({ dry_run: true, database_writes: 0, exact_inventory_count: payloads.length, plan: PLAN_PATH, payload_sha256: payloadSha256 }));
    return;
  }
  const { data, error } = await client.rpc("refresh_viral_spoken_layers_atomic" as never, {
    _payloads: payloads,
    _payload_sha256: payloadSha256,
    _audit_sha256: auditSha256,
  } as never);
  if (error) throw new Error(`atomic spoken layer refresh failed: ${error.message}`);
  console.log(JSON.stringify({ atomic_commit: data }));
}

await main();
