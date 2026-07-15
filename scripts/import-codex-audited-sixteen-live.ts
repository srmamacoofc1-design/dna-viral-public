/**
 * Fail-closed live importer for the exact 16-video Codex manual audit.
 *
 * Validation of the complete manifest, local MP4/caption/audit/frame evidence,
 * ffprobe durations and SHA-256 hashes finishes before the Supabase client is
 * created. Persistence is one service-role-only PostgreSQL transaction per
 * video through commit_codex_manual_audited_video; this script never invokes
 * Gemini or extract-visual-blocks and never creates a preset.
 *
 * PowerShell (after reviewing the dry-run):
 *   $env:SUPABASE_URL='https://your-project-ref.supabase.co'
 *   $env:SUPABASE_SERVICE_ROLE_KEY=(Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText)
 *   npx tsx scripts/import-codex-audited-sixteen-live.ts --dry-run
 *   npx tsx scripts/import-codex-audited-sixteen-live.ts
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  CODEX_MANUAL_ANALYSIS_SOURCE,
  CODEX_MANUAL_VISUAL_SOURCE,
  EXPECTED_CODEX_MANUAL_AUDIT_IDS,
  materializeCodexAuditVideoFrames,
  createProjectArtifactInspector,
  prepareCodexAuditManifest,
  type CanonicalCodexAuditVideo,
} from "./lib/codex-manual-audit.ts";

const execFileAsync = promisify(execFile);
const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || "your-project-ref").trim();
const EXPECTED_PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  ".runtime",
  "four-video-local-analysis",
  "codex-audit-manifest.json",
);
const AUDIT_ROOTS = [
  path.dirname(MANIFEST_PATH),
  path.join(PROJECT_ROOT, ".runtime", "overflow-audit-a"),
  path.join(PROJECT_ROOT, ".runtime", "overflow-audit-b"),
] as const;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function redact(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED_JWT]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]");
}

async function ffprobeDuration(videoPath: string): Promise<number> {
  const executable = String(process.env.FFPROBE_PATH || "ffprobe").trim();
  const { stdout } = await execFileAsync(executable, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ], { windowsHide: true, timeout: 30_000, maxBuffer: 256 * 1024 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe returned an invalid duration for ${path.basename(videoPath)}`);
  }
  return duration;
}

async function publishFrame(
  client: { storage: any },
  input: {
    youtubeId: string;
    frameNumber: number;
    sourceLocalPath: string;
    expectedSha256: string;
  },
): Promise<{ publicUrl: string; downloadedSha256: string; createdObjectPath?: string }> {
  const bytes = await readFile(input.sourceLocalPath);
  const localSha256 = createHash("sha256").update(bytes).digest("hex");
  if (localSha256 !== input.expectedSha256) {
    throw new Error(`${input.youtubeId} frame ${input.frameNumber}: local bytes changed after validation`);
  }
  const objectPath = [
    "frames",
    "codex-manual",
    input.youtubeId,
    `${String(input.frameNumber).padStart(3, "0")}-${input.expectedSha256}.jpg`,
  ].join("/");
  const bucket = client.storage.from("videos");
  const { data: existing, error: existingError } = await bucket.download(objectPath);
  const existingStatus = Number((existingError as any)?.statusCode ?? (existingError as any)?.status);
  const missingObject = existingStatus === 404 || /(?:^|\b)(?:404|not\s+found|object\s+not\s+found)(?:\b|$)/i
    .test(String(existingError?.message || ""));
  let createdObjectPath: string | undefined;
  if (existing) {
    const existingSha256 = createHash("sha256")
      .update(Buffer.from(await existing.arrayBuffer()))
      .digest("hex");
    if (existingSha256 !== input.expectedSha256) {
      throw new Error(`${input.youtubeId} frame ${input.frameNumber}: pre-existing object hash differs from reviewed evidence`);
    }
  } else {
    if (existingError && !missingObject) {
      throw new Error(`${input.youtubeId} frame ${input.frameNumber}: cannot verify pre-existing object: ${existingError.message}`);
    }
    const { error: uploadError } = await bucket.upload(objectPath, bytes, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) throw new Error(`${input.youtubeId} frame ${input.frameNumber}: upload failed: ${uploadError.message}`);
    createdObjectPath = objectPath;
  }
  const { data: downloaded, error: downloadError } = await bucket.download(objectPath);
  if (downloadError || !downloaded) {
    throw new Error(`${input.youtubeId} frame ${input.frameNumber}: post-upload download failed: ${downloadError?.message || "empty object"}`);
  }
  const downloadedSha256 = createHash("sha256")
    .update(Buffer.from(await downloaded.arrayBuffer()))
    .digest("hex");
  const { data: publicData } = bucket.getPublicUrl(objectPath);
  if (!publicData?.publicUrl) throw new Error(`${input.youtubeId} frame ${input.frameNumber}: public URL missing`);
  return { publicUrl: publicData.publicUrl, downloadedSha256, createdObjectPath };
}

function assertCommitResult(video: CanonicalCodexAuditVideo, raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${video.youtube_id}: atomic RPC returned an invalid result`);
  }
  const result = raw as Record<string, unknown>;
  const expected = {
    transcript_count: video.transcript.length,
    frame_count: video.visual_moments.length,
    block_count: video.blocks.length,
    visual_layer_count: video.blocks.length,
    semantic_layer_count: video.blocks.length,
    word_pattern_block_count: video.blocks.length,
    phrase_pattern_block_count: video.blocks.length,
    verbal_layer_count: video.blocks.length,
    alignment_layer_count: video.blocks.length,
    compatibility_layer_count: video.blocks.length,
  };
  if (result.youtube_id !== video.youtube_id ||
      result.source_type !== CODEX_MANUAL_VISUAL_SOURCE ||
      result.analysis_source !== CODEX_MANUAL_ANALYSIS_SOURCE ||
      result.payload_sha256 !== video.video_payload_sha256) {
    throw new Error(`${video.youtube_id}: atomic RPC traceability mismatch`);
  }
  for (const [key, count] of Object.entries(expected)) {
    if (Number(result[key]) !== count) {
      throw new Error(`${video.youtube_id}: atomic RPC ${key}=${String(result[key])}; expected ${count}`);
    }
  }
}

function assertBatchCommitResult(videos: CanonicalCodexAuditVideo[], raw: unknown, manifestSha256: string): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("manual audit batch RPC returned an invalid result");
  }
  const result = raw as Record<string, unknown>;
  if (result.atomic !== true || result.manifest_sha256 !== manifestSha256 || Number(result.count) !== videos.length) {
    throw new Error("manual audit batch RPC did not confirm the exact atomic cohort");
  }
  if (!Array.isArray(result.results) || result.results.length !== videos.length) {
    throw new Error("manual audit batch RPC returned an incomplete result inventory");
  }
  for (const [index, video] of videos.entries()) {
    assertCommitResult(video, result.results[index]);
  }
}

async function cleanupCreatedObjects(client: { storage: any }, objectPaths: ReadonlySet<string>): Promise<void> {
  if (!objectPaths.size) return;
  const paths = [...objectPaths];
  const { error } = await client.storage.from("videos").remove(paths);
  if (error) {
    console.warn(`[manual-audit] failed to remove ${paths.length} newly-created frame object(s): ${error.message}`);
  } else {
    console.warn(`[manual-audit] removed ${paths.length} newly-created frame object(s) after failed batch`);
  }
}

async function main(): Promise<void> {
  const unexpectedArgs = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
  if (unexpectedArgs.length) throw new Error(`unsupported argument(s): ${unexpectedArgs.join(", ")}`);
  const dryRun = process.argv.includes("--dry-run");

  const manifestBytes = await readFile(MANIFEST_PATH);
  if (manifestBytes.length < 64 || manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new Error(`manifest violates its 64-${MAX_MANIFEST_BYTES} byte limit`);
  }
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`manifest is not valid JSON: ${redact(error)}`);
  }

  const inspectArtifact = await createProjectArtifactInspector(PROJECT_ROOT);
  const manifest = await prepareCodexAuditManifest(rawManifest, {
    projectRoot: PROJECT_ROOT,
    manifestPath: MANIFEST_PATH,
    auditRoots: AUDIT_ROOTS,
    manifestSha256,
    inspectArtifact,
    probeMediaDuration: ffprobeDuration,
  });
  if (manifest.videos.length !== EXPECTED_CODEX_MANUAL_AUDIT_IDS.length) {
    throw new Error("validated manifest inventory changed unexpectedly");
  }
  const allLocalFrames = manifest.videos.flatMap((video) => video.visual_moments);
  if (allLocalFrames.length !== 496 ||
      new Set(allLocalFrames.map((frame) => frame.frame_hash)).size !== 496 ||
      new Set(allLocalFrames.map((frame) => frame.source_local_path)).size !== 496) {
    throw new Error("exact 496-frame globally unique manual evidence inventory is required");
  }
  console.log(
    `[manual-audit] validated ${manifest.videos.length} videos, ${manifest.videos.reduce((sum, video) => sum + video.visual_moments.length, 0)} unique frames and ${manifest.videos.reduce((sum, video) => sum + video.blocks.length, 0)} evidence-linked blocks; manifest=${manifestSha256}`,
  );
  if (dryRun) {
    console.log("[manual-audit] dry-run complete; no database client was created and no writes occurred");
    return;
  }

  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  if (supabaseUrl !== EXPECTED_PROJECT_URL) {
    throw new Error(`SUPABASE_URL must be exactly ${EXPECTED_PROJECT_URL}`);
  }
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-importer": "codex-manual-audit-v1" } },
  });

  const persistedVideos: CanonicalCodexAuditVideo[] = [];
  const newlyCreatedObjectPaths = new Set<string>();
  try {
    for (const [index, video] of manifest.videos.entries()) {
      console.log(`[manual-audit] materializing public frames ${index + 1}/${manifest.videos.length} ${video.youtube_id}`);
      persistedVideos.push(await materializeCodexAuditVideoFrames(
        video,
        async (frame) => {
          const published = await publishFrame(client, frame);
          if (published.createdObjectPath) newlyCreatedObjectPaths.add(published.createdObjectPath);
          return published;
        },
        3,
      ));
    }
    const publicUrls = persistedVideos.flatMap((video) =>
      video.visual_moments.map((frame) => frame.file_path)
    );
    if (publicUrls.length !== 496 || new Set(publicUrls).size !== 496) {
      throw new Error("public frame materialization did not preserve the exact 496-frame inventory");
    }

    // The database transaction validates and commits the full exact cohort at
    // once. It is impossible for the first N videos to remain persisted after
    // a later reviewed payload fails.
    console.log(`[manual-audit] committing one atomic cohort of ${persistedVideos.length} videos`);
    const { data, error } = await client.rpc("commit_codex_manual_audited_batch" as never, {
      _payloads: persistedVideos,
      _manifest_sha256: manifest.manifest_sha256,
    } as never);
    if (error) throw new Error(`manual audit batch: ${error.message}`);
    assertBatchCommitResult(persistedVideos, data, manifest.manifest_sha256);
    console.log(`[manual-audit] complete: ${persistedVideos.length}/${persistedVideos.length} videos committed in one verified transaction; no preset was created`);
  } catch (error) {
    await cleanupCreatedObjects(client, newlyCreatedObjectPaths);
    throw error;
  }
}

main().catch((error) => {
  console.error(`[manual-audit] FAILED: ${redact(error)}`);
  process.exitCode = 1;
});
