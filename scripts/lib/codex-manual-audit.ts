import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  narrativeBlockContractViolations,
  type NarrativeBlock,
} from "../../supabase/functions/_shared/narrative-blocks.ts";

export const CODEX_MANUAL_VISUAL_SOURCE = "codex_manual_visual_audit";
export const CODEX_MANUAL_ANALYSIS_SOURCE =
  "Codex manual multimodal audit + YouTube pt-orig captions";

export const EXPECTED_CODEX_MANUAL_AUDIT_IDS = [
  "Zpi10UTydLU",
  "0P8vcxxyuoI",
  "KqGxjJ21Eqk",
  "xTdr9tsT_4g",
  "vpY4sfLYQSY",
  "JIcwpf_aE4o",
  "j19oBZL2d-8",
  "89_3HIcw80A",
  "6FP7nKEwLDo",
  "1uVrM46e_yw",
  "gsF_ZZ94Ue8",
  "4Cz5ZMsGoT4",
  "xkzJeq1U_oM",
  "6WNDlb8ame4",
  "UKsKkmkpDi0",
  "qyrjKm3KP0o",
] as const;

const ALLOWED_BLOCK_TYPES = new Set([
  "hook",
  "setup",
  "desenvolvimento",
  "tensao",
  "revelacao",
  "payoff",
  "transicao",
  "loop",
]);
/**
 * The database deliberately has a compact enum while the manual review keeps
 * its descriptive Portuguese label. `emotion` is preserved in the payload;
 * only `schema_emotion` is reduced to the database taxonomy. Unknown labels
 * still fail closed rather than silently becoming a generic emotion.
 */
const EMOTION_MAP: Record<string, string> = {
  // Curiosity / information gap.
  curiosidade: "curiosidade", estranheza: "curiosidade", misterio: "curiosidade",
  investigacao: "curiosidade", ideia: "curiosidade", atencao: "curiosidade",
  contexto: "curiosidade", complexidade: "curiosidade", memoria: "curiosidade",
  paradoxo: "curiosidade", cautela: "curiosidade", incerteza: "curiosidade",
  confusao: "curiosidade", monotonia: "curiosidade",

  // Surprise / reversal.
  surpresa: "surpresa", choque: "surpresa", absurdo: "surpresa",
  descoberta: "surpresa", revelacao: "surpresa", reversao: "surpresa",
  inversao: "surpresa", despertar: "surpresa", transformacao: "surpresa",
  mudanca: "surpresa", explosao: "surpresa", engano: "surpresa",
  deslumbramento: "surpresa", impacto: "impacto",
  ironia: "surpresa",

  // Threat, loss and aversion.
  medo: "medo", panico: "medo", horror: "medo", perigo: "medo",
  ameaca: "medo", risco: "medo", desespero: "medo", opressao: "medo",
  aprisionamento: "medo", claustrofobia: "medo", hostilidade: "medo",
  crueldade: "medo", dor: "medo", transgressao: "medo", abandono: "medo",
  rejeicao: "medo", repulsa: "medo", degradacao: "medo", fracasso: "medo",
  tristeza: "medo", solidao: "medo", vigilancia: "medo", traicao: "medo",
  vergonha: "medo", humilhacao: "medo", frustracao: "medo", carencia: "medo",
  alarme: "medo", arrependimento: "medo",

  // Pressure, obstacle and conflict.
  tensao: "tensao", conflito: "tensao", confronto: "tensao", cerco: "tensao",
  controle: "tensao", compulsao: "tensao", obsessao: "tensao",
  competicao: "tensao", ciume: "tensao", ganancia: "tensao", ambicao: "tensao",
  cobica: "tensao", tentacao: "tensao", hesitacao: "tensao", nervosismo: "tensao",
  urgencia: "tensao", decisao: "tensao", defesa: "tensao", rebeliao: "tensao",
  revolta: "tensao", sacrificio: "tensao", ruptura: "tensao", insatisfacao: "tensao",
  suspeita: "tensao", incomodo: "tensao", assimetria: "tensao",
  arrogancia: "tensao", vaidade: "tensao",
  acusacao: "tensao", injustica: "tensao", vinganca: "tensao",

  // Resolution, affiliation and positive release.
  alivio: "alivio", alegria: "alivio", satisfacao: "alivio",
  reconciliacao: "alivio", triunfo: "alivio", recompensa: "alivio",
  libertacao: "alivio", confianca: "alivio", afeto: "alivio", empatia: "alivio",
  cuidado: "alivio", justica: "alivio", refugio: "alivio", lealdade: "alivio",
  dedicacao: "alivio", inspiracao: "alivio", orgulho: "alivio", euforia: "alivio",
  encantamento: "alivio", humor: "alivio", comedia: "alivio", comicidade: "alivio",
  alianca: "alivio", adaptacao: "alivio", persistencia: "alivio", progresso: "alivio",
  engenhosidade: "alivio", improviso: "alivio", determinacao: "alivio",
  admiracao: "alivio", desapego: "alivio",

  // Forward pull.
  expectativa: "expectativa", desejo: "expectativa", romance: "expectativa",
  paixao: "expectativa", esperanca: "expectativa", preparacao: "expectativa",
  proximidade: "expectativa", saudade: "expectativa",
};

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const MAX_CAPTION_BYTES = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024;
const MAX_FRAME_BYTES = 12 * 1024 * 1024;
const MIN_FRAME_BYTES = 1_024;
const MIN_VISUAL_MOMENTS = 30;
const MAX_VISUAL_MOMENTS = 180;
const MIN_MANUAL_BLOCKS = 12;
const MAX_MANUAL_BLOCKS = 18;
const PUBLIC_STORAGE_PROJECT_REF = String(
  process.env.SUPABASE_PROJECT_REF || "your-project-ref",
).trim();
const EXACT_PUBLIC_STORAGE_HOST = `${PUBLIC_STORAGE_PROJECT_REF}.supabase.co`;

type JsonRecord = Record<string, unknown>;

export type VerifiedLocalArtifact = {
  path: string;
  size: number;
  sha256: string;
};

export type ArtifactInspector = (
  rawPath: string,
  constraints: {
    label: string;
    extensions: readonly string[];
    minBytes: number;
    maxBytes: number;
  },
) => Promise<VerifiedLocalArtifact>;

export type MediaDurationProbe = (absoluteVideoPath: string) => Promise<number>;

export type CanonicalTranscriptSegment = {
  index: number;
  start: number;
  end: number;
  duration: number;
  text: string;
};

export type CanonicalVisualMoment = {
  frame_number: number;
  timestamp_seconds: number;
  file_path: string;
  source_local_path: string;
  frame_hash: string;
  frame_role: string;
  scene_change_flag: boolean;
  visual_intensity_score: number;
  description: string;
  action: string;
  objects: string[];
  human_presence: boolean;
  animal_presence: boolean;
  text_on_screen_presence: boolean;
  emotion: string;
  surprise_score: number;
};

export type CanonicalManualBlock = {
  index: number;
  start: number;
  end: number;
  type: string;
  emotion: string;
  schema_emotion: string;
  narrative_function: string;
  text: string;
  evidence_scope: "visual_confirmed" | "mixed" | "narration_only";
  transcript_segment_indexes: number[];
  evidence_frame_numbers: number[];
  representative_frame_number: number;
  representative_frame_path: string;
  representative_source_local_path: string;
  representative_timestamp: number;
  visual: JsonRecord;
  semantic: JsonRecord;
  verbal: JsonRecord;
  alignment: JsonRecord;
  compatibility: JsonRecord;
};

export type CanonicalCodexAuditVideo = {
  youtube_id: string;
  source_url: string;
  title: string;
  channel: string;
  duration_seconds: number;
  language: "pt";
  source_type: typeof CODEX_MANUAL_VISUAL_SOURCE;
  analysis_source: typeof CODEX_MANUAL_ANALYSIS_SOURCE;
  source: {
    video: VerifiedLocalArtifact;
    captions_json3: VerifiedLocalArtifact;
    captions_vtt: VerifiedLocalArtifact;
    transcript: VerifiedLocalArtifact;
    audit_notes: VerifiedLocalArtifact;
  };
  transcript: CanonicalTranscriptSegment[];
  visual_moments: CanonicalVisualMoment[];
  blocks: CanonicalManualBlock[];
  summary: JsonRecord;
  video_payload_sha256: string;
};

export type CanonicalCodexAuditManifest = {
  schema_version: 1;
  generated_at: string;
  evidence_policy: string;
  manifest_sha256: string;
  videos: CanonicalCodexAuditVideo[];
};

export type ManualFramePublisher = (input: {
  youtubeId: string;
  frameNumber: number;
  sourceLocalPath: string;
  expectedSha256: string;
}) => Promise<{
  publicUrl: string;
  downloadedSha256: string;
  createdObjectPath?: string;
}>;

export type PrepareManifestOptions = {
  projectRoot: string;
  manifestPath: string;
  auditRoots?: readonly string[];
  manifestSha256: string;
  inspectArtifact: ArtifactInspector;
  probeMediaDuration: MediaDurationProbe;
  readArtifactText?: (absolutePath: string) => Promise<string>;
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string, maxLength = 20_000): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maxLength) throw new Error(`${label} is empty or too long`);
  return result;
}

function number(value: unknown, label: string, min: number, max: number): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return result;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  const result = number(value, label, min, max);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be an integer`);
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function stringArray(
  value: unknown,
  label: string,
  limits: { min?: number; max?: number; itemMax?: number } = {},
): string[] {
  const result = array(value, label).map((item, index) =>
    text(item, `${label}[${index}]`, limits.itemMax ?? 240)
  );
  const min = limits.min ?? 0;
  const max = limits.max ?? 40;
  if (result.length < min || result.length > max) {
    throw new Error(`${label} must contain ${min}-${max} items`);
  }
  return [...new Set(result)];
}

function rawIndexArray(value: unknown, label: string, maxIndex: number): number[] {
  const indexes = array(value, label).map((item, index) =>
    integer(item, `${label}[${index}]`, 0, maxIndex)
  );
  if (!indexes.length || new Set(indexes).size !== indexes.length) {
    throw new Error(`${label} must contain unique indexes`);
  }
  return indexes;
}

function normalizeEmotion(value: unknown, label: string): { original: string; schema: string } {
  const original = text(value, label, 80).toLowerCase();
  const key = original.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const schema = EMOTION_MAP[key];
  if (!schema) throw new Error(`${label} is not mapped to the database emotion enum`);
  return { original, schema };
}

function words(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) || [];
}

function directKeywords(blockText: string): string[] {
  const stop = new Set([
    "para", "com", "uma", "que", "por", "mais", "como", "mas", "ela", "ele",
    "seu", "sua", "isso", "essa", "esse", "quando", "depois", "entao", "ainda",
  ]);
  const counts = new Map<string, number>();
  for (const token of words(blockText)) {
    if (!stop.has(token)) counts.set(token, (counts.get(token) || 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([token]) => token);
  return ranked;
}

/** A phrase pattern is lexical evidence, not a quotation field. Keeping the
 * words while dropping terminal punctuation makes its normalized contiguous
 * relation to the exact block unambiguous in PostgreSQL as well. */
function spokenPhrasePattern(blockText: string): string {
  const first = blockText.split(/(?<=[.!?])\s+/)[0].slice(0, 500);
  return first.replace(/[.!?…]+$/u, "").trim() || blockText.slice(0, 500).trim();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as JsonRecord;
  return `{${Object.keys(source).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(source[key])}`
  ).join(",")}}`;
}

export function youtubeIdFromSourceUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let candidate = "";
  if (host === "youtu.be") {
    candidate = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    candidate = parts[0] === "shorts" || parts[0] === "embed"
      ? parts[1] || ""
      : parts[0] === "watch"
      ? parsed.searchParams.get("v") || ""
      : "";
  }
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

async function assertTranscriptArtifactMatchesManifest(
  artifact: VerifiedLocalArtifact,
  youtubeId: string,
  sourceUrl: string,
  duration: number,
  transcript: readonly CanonicalTranscriptSegment[],
  readArtifactText: (absolutePath: string) => Promise<string>,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readArtifactText(artifact.path));
  } catch (error) {
    throw new Error(`${youtubeId}.transcript artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = record(parsed, `${youtubeId}.transcript_artifact`);
  if (text(root.youtube_id, `${youtubeId}.transcript_artifact.youtube_id`, 11) !== youtubeId) {
    throw new Error(`${youtubeId}.transcript artifact youtube_id mismatch`);
  }
  const artifactSource = text(root.source, `${youtubeId}.transcript_artifact.source`, 500);
  if (youtubeIdFromSourceUrl(artifactSource) !== youtubeId || youtubeIdFromSourceUrl(sourceUrl) !== youtubeId) {
    throw new Error(`${youtubeId}.transcript artifact source_url mismatch`);
  }
  if (!/^pt(?:-orig|-br)?$/i.test(text(root.language, `${youtubeId}.transcript_artifact.language`, 20))) {
    throw new Error(`${youtubeId}.transcript artifact is not original Portuguese`);
  }
  const artifactDuration = number(
    root.duration_seconds,
    `${youtubeId}.transcript_artifact.duration_seconds`,
    1,
    600,
  );
  if (Math.abs(artifactDuration - duration) > 1.5) {
    throw new Error(`${youtubeId}.transcript artifact duration mismatch`);
  }
  const artifactSegments = array(root.segments, `${youtubeId}.transcript_artifact.segments`).map(
    (raw, index) => {
      const segment = record(raw, `${youtubeId}.transcript_artifact.segments[${index}]`);
      return {
        index,
        start: number(segment.start, `${youtubeId}.transcript_artifact.segments[${index}].start`, 0, duration + 1.5),
        end: number(segment.end, `${youtubeId}.transcript_artifact.segments[${index}].end`, 0, duration + 1.5),
        text: text(segment.text, `${youtubeId}.transcript_artifact.segments[${index}].text`, 5_000),
      };
    },
  );
  const manifestSegments = transcript.map(({ index, start, end, text: segmentText }) => ({
    index,
    start,
    end,
    text: segmentText,
  }));
  if (canonicalJson(artifactSegments) !== canonicalJson(manifestSegments)) {
    throw new Error(`${youtubeId}.transcript artifact segments differ from manifest.transcript_segments`);
  }
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalCodexVideoPayloadHash(
  video: Omit<CanonicalCodexAuditVideo, "video_payload_sha256"> | CanonicalCodexAuditVideo,
): string {
  const { video_payload_sha256: _discarded, ...withoutHash } = video as CanonicalCodexAuditVideo;
  return sha256Text(canonicalJson(withoutHash));
}

export async function materializeCodexAuditVideoFrames(
  source: CanonicalCodexAuditVideo,
  publish: ManualFramePublisher,
  concurrency = 3,
): Promise<CanonicalCodexAuditVideo> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("manual frame publication concurrency must be between 1 and 4");
  }
  const video = structuredClone(source);
  const published = new Map<number, { publicUrl: string; sourceLocalPath: string }>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, video.visual_moments.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= video.visual_moments.length) return;
      const frame = video.visual_moments[index];
      const sourceLocalPath = frame.source_local_path || frame.file_path;
      const result = await publish({
        youtubeId: video.youtube_id,
        frameNumber: frame.frame_number,
        sourceLocalPath,
        expectedSha256: frame.frame_hash,
      });
      let parsed: URL;
      try {
        parsed = new URL(result.publicUrl);
      } catch {
        throw new Error(`${video.youtube_id} frame ${frame.frame_number} public URL is invalid`);
      }
      const expectedPath = `/storage/v1/object/public/videos/frames/codex-manual/${video.youtube_id}/${String(frame.frame_number).padStart(3, "0")}-${frame.frame_hash}.jpg`;
      if (parsed.protocol !== "https:"
          || parsed.hostname !== EXACT_PUBLIC_STORAGE_HOST
          || parsed.port !== ""
          || parsed.username !== ""
          || parsed.password !== ""
          || parsed.pathname !== expectedPath
          || parsed.search !== ""
          || parsed.hash !== "") {
        throw new Error(`${video.youtube_id} frame ${frame.frame_number} is not a public videos-bucket URL`);
      }
      if (result.downloadedSha256 !== frame.frame_hash ||
          !/^[0-9a-f]{64}$/.test(result.downloadedSha256)) {
        throw new Error(`${video.youtube_id} frame ${frame.frame_number} post-upload SHA-256 mismatch`);
      }
      frame.source_local_path = sourceLocalPath;
      frame.file_path = result.publicUrl;
      published.set(frame.frame_number, { publicUrl: result.publicUrl, sourceLocalPath });
    }
  });
  await Promise.all(workers);
  if (published.size !== video.visual_moments.length) {
    throw new Error(`${video.youtube_id} did not materialize every reviewed frame`);
  }
  for (const block of video.blocks) {
    const frame = published.get(block.representative_frame_number);
    if (!frame) throw new Error(`${video.youtube_id} block ${block.index} lost its representative frame`);
    block.representative_source_local_path = frame.sourceLocalPath;
    block.representative_frame_path = frame.publicUrl;
  }
  video.video_payload_sha256 = canonicalCodexVideoPayloadHash(video);
  return video;
}

export function assertExactManualAuditIds(ids: readonly string[]): void {
  const actual = [...ids];
  const expected = [...EXPECTED_CODEX_MANUAL_AUDIT_IDS];
  if (actual.length !== expected.length || new Set(actual).size !== actual.length) {
    throw new Error(`manual audit inventory must contain ${expected.length} unique videos`);
  }
  const missing = expected.filter((id) => !actual.includes(id));
  const unexpected = actual.filter((id) => !expected.includes(id as typeof expected[number]));
  if (missing.length || unexpected.length) {
    throw new Error(
      `manual audit inventory mismatch; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }
}

function artifactCandidates(projectRoot: string, auditRoots: readonly string[], id: string): {
  video: string[];
  captionsJson3: string[];
  captionsVtt: string[];
  transcript: string[];
  notes: string[];
} {
  return {
    video: [
      path.join(projectRoot, "work", "viral-base-2026-07", id, `${id}.mp4`),
      ...auditRoots.map((auditRoot) => path.join(auditRoot, `${id}.mp4`)),
    ],
    captionsJson3: auditRoots.map((auditRoot) => path.join(auditRoot, `${id}.pt-orig.json3`)),
    captionsVtt: auditRoots.map((auditRoot) => path.join(auditRoot, `${id}.pt-orig.vtt`)),
    transcript: auditRoots.map((auditRoot) => path.join(auditRoot, `${id}.transcript.json`)),
    notes: auditRoots.map((auditRoot) => path.join(auditRoot, `${id}.analysis.md`)),
  };
}

async function firstVerified(
  candidates: readonly string[],
  inspector: ArtifactInspector,
  constraints: Parameters<ArtifactInspector>[1],
): Promise<VerifiedLocalArtifact> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await inspector(candidate, constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${constraints.label} not found`);
}

function validateTranscript(
  rawSegments: unknown,
  duration: number,
  label: string,
): CanonicalTranscriptSegment[] {
  const rows = array(rawSegments, label);
  if (!rows.length || rows.length > 1_000) throw new Error(`${label} has an invalid segment count`);
  const segments = rows.map((raw, index) => {
    const item = record(raw, `${label}[${index}]`);
    const sourceIndex = integer(item.index, `${label}[${index}].index`, 0, rows.length - 1);
    if (sourceIndex !== index) throw new Error(`${label} indexes must be contiguous from zero`);
    const start = number(item.start, `${label}[${index}].start`, 0, duration + 1.5);
    const end = number(item.end, `${label}[${index}].end`, 0, duration + 1.5);
    if (end <= start) throw new Error(`${label}[${index}] duration must be positive`);
    return {
      index,
      start,
      end,
      duration: end - start,
      text: text(item.text, `${label}[${index}].text`, 5_000),
    };
  });
  if (segments[0].start > 1) throw new Error(`${label} does not cover the opening`);
  if (segments.at(-1)!.end < duration * 0.95) throw new Error(`${label} does not cover 95% of the source`);
  for (let index = 1; index < segments.length; index++) {
    const delta = segments[index].start - segments[index - 1].end;
    if (delta > 0.5 || delta < -0.1) throw new Error(`${label} has a gap or overlap at ${index}`);
  }
  return segments;
}

async function validateVisualMoments(
  rawMoments: unknown,
  duration: number,
  inspector: ArtifactInspector,
  label: string,
): Promise<CanonicalVisualMoment[]> {
  const rows = array(rawMoments, label);
  if (rows.length < MIN_VISUAL_MOMENTS || rows.length > MAX_VISUAL_MOMENTS) {
    throw new Error(`${label} must contain ${MIN_VISUAL_MOMENTS}-${MAX_VISUAL_MOMENTS} moments`);
  }
  const moments: CanonicalVisualMoment[] = [];
  for (let index = 0; index < rows.length; index++) {
    const item = record(rows[index], `${label}[${index}]`);
    const timestamp = number(
      item.timestamp_seconds,
      `${label}[${index}].timestamp_seconds`,
      0,
      duration + 1.5,
    );
    const artifact = await inspector(
      text(item.source_frame_path, `${label}[${index}].source_frame_path`, 2_000),
      {
        label: `${label}[${index}].source_frame_path`,
        extensions: [".jpg", ".jpeg", ".png", ".webp"],
        minBytes: MIN_FRAME_BYTES,
        maxBytes: MAX_FRAME_BYTES,
      },
    );
    moments.push({
      frame_number: index + 1,
      timestamp_seconds: timestamp,
      file_path: artifact.path,
      source_local_path: artifact.path,
      frame_hash: artifact.sha256,
      frame_role: index === 0 ? "opening" : index === rows.length - 1 ? "ending" : "manual_observation",
      scene_change_flag: index > 0,
      visual_intensity_score: integer(item.intensity_score, `${label}[${index}].intensity_score`, 0, 100),
      description: text(item.description, `${label}[${index}].description`, 4_000),
      action: text(item.action, `${label}[${index}].action`, 1_000),
      objects: stringArray(item.objects, `${label}[${index}].objects`, { min: 1, max: 40 }),
      human_presence: boolean(item.human_presence, `${label}[${index}].human_presence`),
      animal_presence: boolean(item.animal_presence, `${label}[${index}].animal_presence`),
      text_on_screen_presence: boolean(item.text_on_screen, `${label}[${index}].text_on_screen`),
      emotion: text(item.emotion, `${label}[${index}].emotion`, 80),
      surprise_score: integer(item.surprise_score, `${label}[${index}].surprise_score`, 0, 100),
    });
  }
  moments.sort((left, right) => left.timestamp_seconds - right.timestamp_seconds);
  moments.forEach((moment, index) => {
    moment.frame_number = index + 1;
  });
  if (moments[0].timestamp_seconds > Math.max(2, duration * 0.1)) {
    throw new Error(`${label} does not contain opening evidence`);
  }
  if (moments.at(-1)!.timestamp_seconds < duration * 0.95) {
    throw new Error(`${label} does not contain ending evidence`);
  }
  // 30 independently verified moments plus dense opening coverage are the
  // invariant. A bounded eight-second ceiling accommodates two longer Shorts
  // whose source edits contain a brief static/narrated stretch without
  // weakening start/end or per-block evidence requirements.
  const maxGap = Math.max(8, duration / 20);
  for (let index = 1; index < moments.length; index++) {
    if (moments[index].timestamp_seconds <= moments[index - 1].timestamp_seconds) {
      throw new Error(`${label} timestamps must be unique and increasing`);
    }
    if (moments[index].timestamp_seconds - moments[index - 1].timestamp_seconds > maxGap) {
      throw new Error(`${label} is too sparse at moment ${index + 1}`);
    }
  }
  if (new Set(moments.map((moment) => moment.frame_hash)).size !== moments.length) {
    throw new Error(`${label} contains duplicate frame hashes`);
  }
  return moments;
}

function validateBlocks(
  rawBlocks: unknown,
  duration: number,
  transcript: CanonicalTranscriptSegment[],
  moments: CanonicalVisualMoment[],
  label: string,
): CanonicalManualBlock[] {
  const rows = array(rawBlocks, label);
  if (rows.length < MIN_MANUAL_BLOCKS || rows.length > MAX_MANUAL_BLOCKS) {
    throw new Error(`${label} must contain ${MIN_MANUAL_BLOCKS}-${MAX_MANUAL_BLOCKS} blocks`);
  }
  const momentByPath = new Map(moments.map((moment) => [path.normalize(moment.file_path), moment]));
  const blocks = rows.map((raw, sourceIndex) => {
    const item = record(raw, `${label}[${sourceIndex}]`);
    const rawIndex = integer(item.index, `${label}[${sourceIndex}].index`, 0, rows.length - 1);
    if (rawIndex !== sourceIndex) throw new Error(`${label} indexes must be contiguous from zero`);
    const type = text(item.type, `${label}[${sourceIndex}].type`, 80).toLowerCase();
    if (!ALLOWED_BLOCK_TYPES.has(type)) throw new Error(`${label}[${sourceIndex}].type is invalid`);
    const emotion = normalizeEmotion(item.emotion, `${label}[${sourceIndex}].emotion`);
    const start = number(item.start, `${label}[${sourceIndex}].start`, 0, duration + 1.5);
    const end = number(item.end, `${label}[${sourceIndex}].end`, 0, duration + 1.5);
    const transcriptIndexes = rawIndexArray(
      item.transcript_segment_indexes,
      `${label}[${sourceIndex}].transcript_segment_indexes`,
      transcript.length - 1,
    );
    const representativeTimestamp = number(
      item.visual_moment_timestamp,
      `${label}[${sourceIndex}].visual_moment_timestamp`,
      0,
      duration + 1.5,
    );
    const declaredFramePath = path.normalize(
      path.resolve(text(item.source_frame_path, `${label}[${sourceIndex}].source_frame_path`, 2_000)),
    );
    const representativeMoment = momentByPath.get(declaredFramePath) || moments.find((moment) =>
      Math.abs(moment.timestamp_seconds - representativeTimestamp) <= 0.05
    );
    if (!representativeMoment ||
      Math.abs(representativeMoment.timestamp_seconds - representativeTimestamp) > 0.05) {
      throw new Error(`${label}[${sourceIndex}] does not reference a verified visual moment`);
    }
    const evidence = moments.filter((moment) =>
      moment.timestamp_seconds >= start - 1.5 && moment.timestamp_seconds <= end + 1.5
    );
    if (!evidence.some((moment) => moment.frame_number === representativeMoment.frame_number)) {
      evidence.push(representativeMoment);
    }
    if (!evidence.length) throw new Error(`${label}[${sourceIndex}] has no real visual evidence`);
    const visualObjects = stringArray(item.visual_objects, `${label}[${sourceIndex}].visual_objects`, {
      min: 1,
      max: 40,
    });
    const blockText = text(item.text, `${label}[${sourceIndex}].text`, 20_000);
    const evidenceScope = text(
      item.evidence_scope,
      `${label}[${sourceIndex}].evidence_scope`,
      40,
    ) as CanonicalManualBlock["evidence_scope"];
    if (!["visual_confirmed", "mixed", "narration_only"].includes(evidenceScope)) {
      throw new Error(`${label}[${sourceIndex}].evidence_scope is invalid`);
    }
    const visualDescription = text(
      item.visual_description,
      `${label}[${sourceIndex}].visual_description`,
      4_000,
    );
    const visualAction = text(item.visual_action, `${label}[${sourceIndex}].visual_action`, 1_000);
    const blockWords = words(blockText);
    const keywords = directKeywords(blockText);
    if (!keywords.length) throw new Error(`${label}[${sourceIndex}] has no spoken-text keywords`);
    const intensity = representativeMoment.visual_intensity_score;
    const durationSeconds = Math.max(0.1, end - start);
    // A verified frame proves provenance, not that every narrated claim is
    // visible. Scope-specific conservative scores prevent narration-only or
    // mixed blocks from being fabricated into perfect text/visual alignment.
    const scopeScores = evidenceScope === "visual_confirmed"
      ? { alignment: 84, action: 86, emotion: 76, intensity: 78, coherence: 86, compatibility: 84 }
      : evidenceScope === "mixed"
      ? { alignment: 58, action: 52, emotion: 62, intensity: 58, coherence: 64, compatibility: 60 }
      : { alignment: 24, action: 12, emotion: 34, intensity: 28, coherence: 36, compatibility: 28 };
    const needsVisualBoost = evidenceScope !== "visual_confirmed";
    return {
      index: sourceIndex + 1,
      start,
      end,
      type,
      emotion: emotion.original,
      schema_emotion: emotion.schema,
      narrative_function: text(item.function, `${label}[${sourceIndex}].function`, 2_000),
      text: blockText,
      evidence_scope: evidenceScope,
      transcript_segment_indexes: transcriptIndexes,
      evidence_frame_numbers: [...new Set(evidence.map((moment) => moment.frame_number))].sort((a, b) => a - b),
      representative_frame_number: representativeMoment.frame_number,
      representative_frame_path: representativeMoment.file_path,
      representative_source_local_path: representativeMoment.source_local_path,
      representative_timestamp: representativeMoment.timestamp_seconds,
      visual: {
        scene_description: visualDescription,
        main_action: visualAction,
        main_objects: visualObjects,
        human_presence: representativeMoment.human_presence,
        animal_presence: representativeMoment.animal_presence,
        text_on_screen_presence: representativeMoment.text_on_screen_presence,
        visual_emotion: representativeMoment.emotion,
        visual_intensity_level: intensity >= 70 ? "alta" : intensity >= 40 ? "media" : "baixa",
        avg_visual_intensity_score: intensity,
        scene_change_detected: evidence.some((moment) => moment.scene_change_flag),
        scene_change_count: evidence.filter((moment) => moment.scene_change_flag).length,
        confidence_score: 100,
        evidence_scope: evidenceScope,
      },
      semantic: {
        keywords,
        keyword_frequencies: Object.fromEntries(keywords.map((keyword) => [
          keyword,
          Math.max(1, blockWords.filter((word) => word === keyword).length),
        ])),
        emotional_words: keywords.filter((keyword) => words(emotion.original).includes(keyword)),
        repeated_words: keywords.filter((keyword) => blockWords.filter((word) => word === keyword).length > 1),
        strong_phrases: [spokenPhrasePattern(blockText)],
        emotional_type: emotion.original,
        emotional_intensity: intensity,
        verbal_tone: emotion.original,
        rare_words: keywords,
        dominant_words: keywords.slice(0, 5),
        weighted_word_score: intensity,
        weighted_phrase_score: Math.max(intensity, representativeMoment.surprise_score),
      },
      verbal: {
        word_count: blockWords.length,
        phrase_count: Math.max(1, blockText.split(/[.!?]+/).filter((part) => part.trim()).length),
        phrase_pattern: type === "hook" ? "afirmacao" : type === "payoff" ? "revelacao" : "progressao",
        tone: emotion.original,
        trigger_words: keywords,
        linguistic_density: blockWords.length / durationSeconds,
        emotional_intensity: intensity,
        semantic_pressure_score: Math.max(intensity, representativeMoment.surprise_score),
        confidence_score: 100,
        evidence_scope: evidenceScope,
      },
      alignment: {
        text_action: blockText.slice(0, 500),
        visual_action: visualAction,
        text_emotion: emotion.original,
        visual_emotion: representativeMoment.emotion,
        evidence_scope: evidenceScope,
        alignment_score: scopeScores.alignment,
        action_alignment_score: scopeScores.action,
        emotion_alignment_score: scopeScores.emotion,
        intensity_alignment_score: scopeScores.intensity,
        confidence_score: 100,
      },
      compatibility: {
        evidence_scope: evidenceScope,
        semantic_coherence_score: scopeScores.coherence,
        contradiction_detected: false,
        visual_overload_detected: false,
        confidence_score: 100,
        block_type: type,
        text_intensity_score: intensity,
        visual_intensity_score_calc: intensity,
        intensity_gap: 0,
        text_requires_visual_boost: needsVisualBoost,
        visual_underpowered: needsVisualBoost,
        visual_overpowered: false,
        emotional_match_score: scopeScores.emotion,
        action_match_score: scopeScores.action,
        curiosity_match_score: type === "hook" ? scopeScores.compatibility : Math.max(20, scopeScores.compatibility - 8),
        reveal_match_score: type === "payoff" || type === "revelacao" ? scopeScores.compatibility : Math.max(20, scopeScores.compatibility - 8),
        compatibility_score: scopeScores.compatibility,
        compatibility_label: `manual_${evidenceScope}`,
        compatibility_reason: evidenceScope === "visual_confirmed"
          ? "Reviewed frames directly confirm the principal narrated action, with conservative non-perfect scoring."
          : evidenceScope === "mixed"
          ? "Reviewed frames confirm only part of the narrated block; additional visual support is recommended."
          : "The narrative claim is caption-grounded but not visibly confirmed by the representative frame.",
        recommended_visual_direction: visualDescription,
      },
    } satisfies CanonicalManualBlock;
  });

  const timelineBlocks: NarrativeBlock[] = blocks.map((block) => ({
    bloco_id: block.index,
    tipo_bloco: block.type,
    tempo_inicio: block.start,
    tempo_fim: block.end,
    texto: block.text,
  }));
  const violations = narrativeBlockContractViolations(timelineBlocks, duration);
  if (violations.length) throw new Error(`${label} timeline invalid: ${violations.join(",")}`);

  const transcriptUse = new Map<number, number>();
  for (const block of blocks) {
    const sortedIndexes = [...block.transcript_segment_indexes].sort((a, b) => a - b);
    if (sortedIndexes.some((value, index) => value !== block.transcript_segment_indexes[index])) {
      throw new Error(`${label}[${block.index - 1}] transcript indexes are not chronological`);
    }
    const exactTranscriptText = block.transcript_segment_indexes
      .map((index) => transcript[index].text.trim())
      .join(" ")
      .trim();
    if (block.text !== exactTranscriptText) {
      throw new Error(`${label}[${block.index - 1}].text is not the exact referenced transcript speech`);
    }
    for (const index of block.transcript_segment_indexes) {
      transcriptUse.set(index, (transcriptUse.get(index) || 0) + 1);
      const segment = transcript[index];
      // Caption providers can trail the ffprobe container duration by a few
      // hundred milliseconds on the final token. Keep that bounded tolerance
      // consistent with the persisted SQL contract; it never permits an
      // unrelated later sentence into the block.
      const boundaryTolerance = Math.max(0.5, duration * 0.01);
      if (segment.start < block.start - boundaryTolerance || segment.end > block.end + boundaryTolerance) {
        throw new Error(`${label}[${block.index - 1}] does not contain transcript segment ${index}`);
      }
    }
  }
  for (const segment of transcript) {
    if (transcriptUse.get(segment.index) !== 1) {
      throw new Error(`${label} must cover transcript segment ${segment.index} exactly once`);
    }
  }
  return blocks;
}

export async function prepareCodexAuditManifest(
  rawManifest: unknown,
  options: PrepareManifestOptions,
): Promise<CanonicalCodexAuditManifest> {
  const manifest = record(rawManifest, "manifest");
  if (integer(manifest.schema_version, "manifest.schema_version", 1, 1) !== 1) {
    throw new Error("unsupported manifest schema");
  }
  const rawVideos = array(manifest.videos, "manifest.videos");
  const ids = rawVideos.map((raw, index) =>
    text(record(raw, `manifest.videos[${index}]`).youtube_id, `manifest.videos[${index}].youtube_id`, 11)
  );
  assertExactManualAuditIds(ids);
  const manifestValidation = record(manifest.validation, "manifest.validation");
  if (manifestValidation.valid !== true || array(manifestValidation.errors, "manifest.validation.errors").length) {
    throw new Error("manifest self-validation did not pass");
  }

  const auditRoots = [...new Set([
    path.dirname(path.resolve(options.manifestPath)),
    ...(options.auditRoots || []).map((root) => path.resolve(root)),
  ])];
  const videos: CanonicalCodexAuditVideo[] = [];
  for (const raw of rawVideos) {
    const item = record(raw, "manifest video");
    const id = text(item.youtube_id, "video.youtube_id", 11);
    const sourceUrl = text(item.source_url, `${id}.source_url`, 500);
    if (youtubeIdFromSourceUrl(sourceUrl) !== id) {
      throw new Error(`${id}.source_url does not canonicalize to its youtube_id`);
    }
    const mediaDuration = number(item.media_duration_seconds, `${id}.media_duration_seconds`, 1, 600);
    const declaredDuration = number(item.duration_seconds, `${id}.duration_seconds`, 1, 600);
    if (Math.abs(declaredDuration - mediaDuration) > 1.5) {
      throw new Error(`${id} declared duration differs from media duration`);
    }
    const candidates = artifactCandidates(options.projectRoot, auditRoots, id);
    const videoArtifact = await firstVerified(candidates.video, options.inspectArtifact, {
      label: `${id}.video`,
      extensions: [".mp4"],
      minBytes: 1_024,
      maxBytes: MAX_VIDEO_BYTES,
    });
    const probedDuration = await options.probeMediaDuration(videoArtifact.path);
    if (!Number.isFinite(probedDuration) || Math.abs(probedDuration - mediaDuration) > 0.75) {
      throw new Error(`${id} ffprobe duration does not match the audited media duration`);
    }
    const duration = mediaDuration;
    const [captionsJson3, captionsVtt, transcriptArtifact, auditNotes] = await Promise.all([
      firstVerified(candidates.captionsJson3, options.inspectArtifact, {
        label: `${id}.captions_json3`, extensions: [".json3"], minBytes: 64, maxBytes: MAX_CAPTION_BYTES,
      }),
      firstVerified(candidates.captionsVtt, options.inspectArtifact, {
        label: `${id}.captions_vtt`, extensions: [".vtt"], minBytes: 64, maxBytes: MAX_CAPTION_BYTES,
      }),
      firstVerified(candidates.transcript, options.inspectArtifact, {
        label: `${id}.transcript`, extensions: [".json"], minBytes: 64, maxBytes: MAX_TRANSCRIPT_BYTES,
      }),
      firstVerified(candidates.notes, options.inspectArtifact, {
        label: `${id}.audit_notes`, extensions: [".md"], minBytes: 64, maxBytes: MAX_AUDIT_BYTES,
      }),
    ]);
    const transcriptLanguage = text(item.transcript_language, `${id}.transcript_language`, 20).toLowerCase();
    if (!/^pt(?:-orig|-br)?$/.test(transcriptLanguage)) {
      throw new Error(`${id} transcript must be original Portuguese captions`);
    }
    const transcript = validateTranscript(item.transcript_segments, duration, `${id}.transcript_segments`);
    await assertTranscriptArtifactMatchesManifest(
      transcriptArtifact,
      id,
      sourceUrl,
      duration,
      transcript,
      options.readArtifactText || ((absolutePath) => readFile(absolutePath, "utf8")),
    );
    const visualMoments = await validateVisualMoments(
      item.visual_moments,
      duration,
      options.inspectArtifact,
      `${id}.visual_moments`,
    );
    const blocks = validateBlocks(
      item.narrative_blocks,
      duration,
      transcript,
      visualMoments,
      `${id}.narrative_blocks`,
    );
    const hook = blocks[0];
    const payoff = [...blocks].reverse().find((block) => block.type === "payoff")!;
    const summary: JsonRecord = {
      hook_text: hook.text,
      hook_type: hook.evidence_scope === "visual_confirmed" ? "visual" : "texto",
      hook_evidence_scope: hook.evidence_scope,
      hook_emotion: hook.schema_emotion,
      hook_duration: hook.end - hook.start,
      payoff_text: payoff.text,
      payoff_emotion: payoff.schema_emotion,
      dominant_emotion: blocks
        .map((block) => block.schema_emotion)
        .sort((left, right) =>
          blocks.filter((block) => block.schema_emotion === right).length -
          blocks.filter((block) => block.schema_emotion === left).length
        )[0],
      avg_alignment_score: blocks.reduce((sum, block) =>
        sum + Number(block.alignment.alignment_score || 0), 0) / blocks.length,
    };
    const canonicalWithoutHash = {
      youtube_id: id,
      source_url: sourceUrl,
      title: text(item.title, `${id}.title`, 500),
      channel: text(item.channel, `${id}.channel`, 300),
      duration_seconds: duration,
      language: "pt" as const,
      source_type: CODEX_MANUAL_VISUAL_SOURCE as typeof CODEX_MANUAL_VISUAL_SOURCE,
      analysis_source: CODEX_MANUAL_ANALYSIS_SOURCE as typeof CODEX_MANUAL_ANALYSIS_SOURCE,
      source: {
        video: videoArtifact,
        captions_json3: captionsJson3,
        captions_vtt: captionsVtt,
        transcript: transcriptArtifact,
        audit_notes: auditNotes,
      },
      transcript,
      visual_moments: visualMoments,
      blocks,
      summary,
    };
    videos.push({
      ...canonicalWithoutHash,
      video_payload_sha256: canonicalCodexVideoPayloadHash(canonicalWithoutHash as Omit<CanonicalCodexAuditVideo, "video_payload_sha256">),
    });
  }
  videos.sort((left, right) =>
    EXPECTED_CODEX_MANUAL_AUDIT_IDS.indexOf(left.youtube_id as typeof EXPECTED_CODEX_MANUAL_AUDIT_IDS[number]) -
    EXPECTED_CODEX_MANUAL_AUDIT_IDS.indexOf(right.youtube_id as typeof EXPECTED_CODEX_MANUAL_AUDIT_IDS[number])
  );
  return {
    schema_version: 1,
    generated_at: (() => {
      const generatedAt = text(manifest.generated_at, "manifest.generated_at", 80);
      if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("manifest.generated_at is invalid");
      return generatedAt;
    })(),
    evidence_policy: text(manifest.evidence_policy, "manifest.evidence_policy", 2_000),
    manifest_sha256: options.manifestSha256,
    videos,
  };
}

export async function createProjectArtifactInspector(projectRoot: string): Promise<ArtifactInspector> {
  const root = await realpath(path.resolve(projectRoot));
  return async (rawPath, constraints) => {
    const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(projectRoot, rawPath);
    const resolved = await realpath(candidate);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${constraints.label} must resolve inside the project root`);
    }
    const extension = path.extname(resolved).toLowerCase();
    if (!constraints.extensions.includes(extension)) {
      throw new Error(`${constraints.label} has an unsupported extension`);
    }
    const fileStat = await stat(resolved);
    if (!fileStat.isFile() || fileStat.size < constraints.minBytes || fileStat.size > constraints.maxBytes) {
      throw new Error(`${constraints.label} violates its file-size limit`);
    }
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(resolved);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    return { path: resolved, size: fileStat.size, sha256: hash.digest("hex") };
  };
}
