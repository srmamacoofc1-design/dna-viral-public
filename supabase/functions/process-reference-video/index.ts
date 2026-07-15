import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  generateVideoJson,
  prepareVideoMedia,
  releaseVideoMedia,
} from "../_shared/gemini-video.ts";
import type { PreparedVideoMedia } from "../_shared/gemini-video.ts";
import {
  EdgeAuthError,
  requireResourceOwnerAdminOrService,
  requireUserOrService,
} from "../_shared/edge-auth.ts";
import {
  asIngestionError,
  IngestionError,
  jsonResponse,
  MAX_REFERENCE_VIDEO_BYTES,
  normalizeStoragePath,
  REFERENCE_VIDEO_BUCKET,
} from "../_shared/ingestion.ts";
import {
  assessVisualTimelineCoverage,
} from "../_shared/visual-timeline-coverage.ts";
import {
  assessReferenceVisualEvidenceContract,
  limitReferenceVisualTimelineByTimestamp,
  uniqueReferenceVisualTimestamps,
} from "../_shared/reference-visual-evidence.ts";
import { reconcileTranscriptLanguage } from "../_shared/transcript-language.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptionResult {
  language?: string;
  duration_seconds?: number;
  segments?: Segment[];
}

type ReferenceVisualSubjectRole = "reactor" | "embedded" | "unknown";

interface ReferenceVisualMoment {
  timestamp_seconds: number;
  description: string;
  scene_type: string;
  visual_elements: string[];
  main_action: string;
  emotional_tone: string;
  surprise_score: number;
  text_on_screen: string;
  /** Optional compositing metadata. Missing fields keep legacy JSON frames valid. */
  subject_role?: ReferenceVisualSubjectRole;
  layer?: ReferenceVisualSubjectRole;
  region?: string;
  subject_id?: string;
}

interface VisualResult {
  frames?: ReferenceVisualMoment[];
}

const REFERENCE_VISUAL_MAX_MOMENTS = 30;
const ACTIVE_PHASE_LEASE_MS = 10 * 60_000;
const AUDIO_PROCESSING_STATUS = "processing_audio";
const AUDIO_READY_STATUS = "awaiting_visual";
const VISUAL_PROCESSING_STATUS = "processing_visual";
const VISUAL_READY_STATUS = "ready";
const ACTIVE_PROCESSING_STATUSES = new Set([
  "processing",
  AUDIO_PROCESSING_STATUS,
  VISUAL_PROCESSING_STATUS,
]);
// Browser metadata (or a trusted local test preflight) is independent from the
// model response. Keep this generous enough for normal reference videos while
// still rejecting accidental/corrupt values before a costly Gemini request.
const MAX_REFERENCE_VIDEO_DURATION_SECONDS = 60 * 60;

const transcriptionSchema = {
  type: "object",
  properties: {
    language: { type: "string" },
    duration_seconds: { type: "number" },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          text: { type: "string" },
        },
        required: ["start", "end", "text"],
      },
    },
  },
  required: ["language", "duration_seconds", "segments"],
};

const visualSchema = {
  type: "object",
  properties: {
    frames: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp_seconds: { type: "number" },
          description: { type: "string" },
          scene_type: { type: "string" },
          visual_elements: { type: "array", items: { type: "string" } },
          main_action: { type: "string" },
          emotional_tone: { type: "string" },
          surprise_score: { type: "number" },
          text_on_screen: { type: "string" },
          subject_role: {
            type: "string",
            enum: ["reactor", "embedded", "unknown"],
            description: "Required role of the one visible subject described by this row.",
          },
          layer: {
            type: "string",
            enum: ["reactor", "embedded", "unknown"],
            description: "Required composited plane; it must equal subject_role.",
          },
          region: {
            type: "string",
            description: "Required stable screen region token, for example top, bottom, left, right or full_frame.",
          },
          subject_id: {
            type: "string",
            description: "Required opaque stable token such as reactor_1 or embedded_subject_1; never encode identity, job, relationship or judgment.",
          },
        },
        required: [
          "timestamp_seconds",
          "description",
          "scene_type",
          "visual_elements",
          "main_action",
          "emotional_tone",
          "surprise_score",
          "text_on_screen",
          "subject_role",
          "layer",
          "region",
          "subject_id",
        ],
      },
    },
  },
  required: ["frames"],
};

function sanitizeSegments(raw: unknown): Segment[] {
  return (Array.isArray(raw) ? raw : [])
    .map((value: any) => ({
      start: Number(value?.start),
      end: Number(value?.end),
      text: typeof value?.text === "string" ? value.text.trim() : "",
    }))
    .filter((value) => Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start && value.text)
    .sort((a, b) => a.start - b.start);
}

/**
 * A model may occasionally report a duration from a stale/incorrect container
 * clock even when its pixels were analyzed on the correct timeline. When we
 * have independent file metadata, preserve spoken text but keep timestamps
 * inside the real source boundary. This never invents dialogue or evidence.
 */
function clampSegmentsToDuration(segments: Segment[], duration: number | undefined): Segment[] {
  if (!duration) return segments;
  return segments
    .map((segment) => ({
      ...segment,
      start: Math.max(0, Math.min(segment.start, duration)),
      end: Math.max(0, Math.min(segment.end, duration)),
    }))
    .filter((segment) => segment.end > segment.start);
}

function parseIndependentSourceDuration(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_REFERENCE_VIDEO_DURATION_SECONDS) {
    throw new IngestionError(
      "INVALID_VIDEO_DURATION",
      `video_duration deve estar entre 0 e ${MAX_REFERENCE_VIDEO_DURATION_SECONDS} segundos.`,
      422,
      false,
      { max_duration_seconds: MAX_REFERENCE_VIDEO_DURATION_SECONDS },
    );
  }
  return duration;
}

function storedSourceDuration(value: unknown): number | undefined {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 && duration <= MAX_REFERENCE_VIDEO_DURATION_SECONDS
    ? duration
    : undefined;
}

function sanitizeVisualSubjectRole(value: unknown): ReferenceVisualSubjectRole | undefined {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return role === "reactor" || role === "embedded" || role === "unknown" ? role : undefined;
}

function sanitizeOpaqueFrameToken(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
  return label || undefined;
}

// Visual evidence must retain observable nouns/actions, not the model's
// editorial opinion about them. These modifiers carry no temporal or physical
// information, so removing them is safer than rejecting an otherwise complete
// full-video timeline. Relationship, motive and control inferences remain
// fail-closed in assessReferenceVisualEvidenceContract below.
const UNSUPPORTED_VISUAL_JUDGMENT_MODIFIER = /\b(?:seductive(?:ly)?|provocative(?:ly)?|smug(?:ly|ness)?|cruel(?:ly)?|evil|kind(?:ly)?|defeated|triumphant(?:ly)?|resilien(?:ce|t)|confiden(?:ce|t|tly)|concerned|gentle|determined|soft|arrogant(?:ly)?|empathetic(?:ally)?|proud(?:ly)?|defiant(?:ly)?|challenging\s+(?:look|gaze|glance)|desafiador(?:a|es|as)?|lazy|laziness|loafing|shameless|pregui[cç]a|pregui[cç]os[oa]?|vagabundagem|vagabund[oa]|folgad[oa]|cara\s+de\s+pau|sem[- ]?vergonha|sedutor(?:a|amente)?|provocante|presun[cç]oso(?:a|amente)?|cruelmente|malvado(?:a)?|bondoso(?:a|amente)?|derrotado(?:a)?|triunfante|resilien(?:cia|te)|confian[cç]a|confiante|preocupado(?:a)?|gentil|determinado(?:a)?|suave|arrogante|emp[aá]tico(?:a|amente)?|orgulhoso(?:a|amente)?)\b/giu;
const UNSUPPORTED_VISUAL_INFERENCE_CLAUSE = /\b(?:ordering|ordered|orders?|commanding|commands?|comforting|comforts?|offers?\s+help|offering\s+help|to\s+help|helping|oferece(?:u|ndo)?\s+ajuda|para\s+(?:oferecer|dar|prestar)\s+ajuda|ajudando|trying\s+to|intends?\s+to|plans?\s+to|raising\s+(?:the\s+)?(?:baby|child)|became\s+(?:a\s+)?(?:mother|father)|ordena(?:ndo|ou)?|manda(?:ndo|ou)?|tentando\s+(?:consolar|fazer)|pretende(?:ndo)?|planeja(?:ndo)?|assumiu\s+(?:o|a|essa|esse)?\s*(?:bebe|crianca)|criaram?\s+(?:o|a|um|uma)?\s*(?:bebe|crianca)|virou\s+(?:mae|pai)|symboli[sz](?:es?|ing)|represents?|meaning\s+that|simboliza(?:ndo)?|representa(?:ndo)?|significa\s+que)\b/iu;

function neutralizeUnsupportedRelationshipLabels(value: string): string {
  return value
    .replace(/\b(?:cheating|unfaithful|infidelity|affair|traindo|trai[cç][aã]o|infidelidade)\b/giu, " ")
    .replace(/\b(?:husband|boyfriend|marido|namorado|esposo|novio)\b/giu, "man")
    .replace(/\b(?:wife|girlfriend|mistress|esposa|namorada|novia)\b/giu, "woman")
    .replace(/\b(?:lover|amante)\b/giu, "person")
    .replace(/\b(?:their baby|their child|bebe deles|filh[oa] deles)\b/giu, "baby")
    .replace(/\b(?:mother|mom|mae|mamae|madre|mama)\b/giu, "woman")
    .replace(/\b(?:father|dad|pai|papai|padre|papa)\b/giu, "man")
    .replace(/\b(?:parents?|pais)\b/giu, "adults")
    .replace(/\b(?:son|daughter|filh[oa])\b/giu, "child")
    .replace(/\b(?:family|fam[ií]lia)\b/giu, "people")
    .replace(/\b(?:couple|casal|pareja)\b/giu, "two people");
}

function removeUnsupportedInferenceClauses(value: string): string {
  if (!UNSUPPORTED_VISUAL_INFERENCE_CLAUSE.test(value)) return value;
  return (value.match(/[^.!?]+[.!?]?/gu) ?? [value])
    .map((sentence) => {
      const terminal = sentence.match(/[.!?]$/u)?.[0] ?? "";
      const body = terminal ? sentence.slice(0, -1) : sentence;
      const kept = body
        .split(/\s*(?:[,;]|\b(?:and|e|y)\b)\s*/iu)
        .filter((clause) => clause.trim() && !UNSUPPORTED_VISUAL_INFERENCE_CLAUSE.test(clause));
      return kept.length > 0 ? `${kept.join(", ")}${terminal}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

function sanitizeObjectiveVisualText(value: unknown, maxLength: number): string {
  // Remove inferred outcome/intent clauses before neutralizing role labels;
  // otherwise "became a mother" would degrade into the still-false phrase
  // "became a woman". Physical clauses joined by "and/e/y" remain intact.
  const inferenceNeutral = removeUnsupportedInferenceClauses(String(value ?? ""));
  const relationshipNeutral = neutralizeUnsupportedRelationshipLabels(inferenceNeutral);
  return relationshipNeutral
    .replace(/\b(?:seemingly|apparently|presumably|supostamente|aparentemente)\b/giu, " ")
    .replace(UNSUPPORTED_VISUAL_JUDGMENT_MODIFIER, " ")
    .replace(/\b(?:receiving|accepting)\s+help\b/giu, " ")
    .replace(/\b(?:looking|looks|looked)\s+(?:and\s+)?(?:slightly\s*)?(?=[,.;:!?]|$)/giu, "looking")
    .replace(/\bexpressing\s*(?=[,.;:!?]|$)/giu, " ")
    .replace(/,?\s*with\s+(?:an?|the)\s+expression\b/giu, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*(?=[,.;:!?]|$)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

type VisualScreenRegion = "top" | "bottom" | "left" | "right" | "full" | "unknown";

function visualScreenRegion(value: unknown): VisualScreenRegion {
  const region = String(value ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(?:top|upper|superior)\b/u.test(region)) return "top";
  if (/\b(?:bottom|lower|inferior)\b/u.test(region)) return "bottom";
  if (/\b(?:left|esquerda|izquierda)\b/u.test(region)) return "left";
  if (/\b(?:right|direita|derecha)\b/u.test(region)) return "right";
  if (/\b(?:full|frame|screen|tela|pantalla)\b/u.test(region)) return "full";
  return "unknown";
}

function explicitScreenRegions(value: string): Set<VisualScreenRegion> {
  const text = value.toLowerCase();
  const regions = new Set<VisualScreenRegion>();
  if (/\b(?:top|upper|superior)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("top");
  if (/\b(?:bottom|lower|inferior)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("bottom");
  if (/\b(?:left|esquerda|izquierda)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("left");
  if (/\b(?:right|direita|derecha)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("right");
  return regions;
}

function sanitizeLayerScopedDescription(value: unknown, regionValue: unknown, maxLength: number): string {
  const objective = sanitizeObjectiveVisualText(value, maxLength * 2);
  const ownRegion = visualScreenRegion(regionValue);
  if (!objective || ownRegion === "unknown" || ownRegion === "full") return objective.slice(0, maxLength);
  const sentences = objective.match(/[^.!?]+[.!?]?/gu) ?? [objective];
  const kept = sentences.filter((sentence) => {
    const mentioned = explicitScreenRegions(sentence);
    return mentioned.size === 0 || (mentioned.size === 1 && mentioned.has(ownRegion));
  });
  return kept.join(" ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeFrames(raw: unknown, duration?: number): ReferenceVisualMoment[] {
  const seen = new Set<string>();
  const neutralSubjectIds = new Map<string, string>();
  const subjectCounters: Record<ReferenceVisualSubjectRole, number> = {
    reactor: 0,
    embedded: 0,
    unknown: 0,
  };
  const neutralSubjectId = (rawId: unknown, role: ReferenceVisualSubjectRole): string | undefined => {
    const sanitizedRawId = sanitizeOpaqueFrameToken(rawId, 120);
    if (!sanitizedRawId) return undefined;
    const key = `${role}:${sanitizedRawId}`;
    const existing = neutralSubjectIds.get(key);
    if (existing) return existing;
    subjectCounters[role] += 1;
    const prefix = role === "embedded" ? "embedded_subject" : role === "reactor" ? "reactor" : "unknown_subject";
    const neutral = `${prefix}_${subjectCounters[role]}`;
    neutralSubjectIds.set(key, neutral);
    return neutral;
  };
  return (Array.isArray(raw) ? raw : [])
    .map((value: any): ReferenceVisualMoment | null => {
      const timestamp = Number(value?.timestamp_seconds);
      const subjectRole = sanitizeVisualSubjectRole(value?.subject_role);
      const layer = sanitizeVisualSubjectRole(value?.layer);
      const effectiveRole = subjectRole || layer || "unknown";
      const region = sanitizeOpaqueFrameToken(value?.region, 80);
      const subjectId = neutralSubjectId(value?.subject_id, effectiveRole);
      const description = sanitizeLayerScopedDescription(value?.description, region, 1200);
      if (!Number.isFinite(timestamp) || timestamp < 0 || !description) return null;
      const isReactionPlane = effectiveRole === "reactor" || effectiveRole === "embedded";
      return {
        timestamp_seconds: duration ? Math.min(timestamp, duration) : timestamp,
        description,
        scene_type: effectiveRole === "reactor"
          ? "reactor_view"
          : effectiveRole === "embedded"
          ? "embedded_scene"
          : sanitizeObjectiveVisualText(value?.scene_type ?? "other", 80) || "other",
        visual_elements: !isReactionPlane && Array.isArray(value?.visual_elements)
          ? value.visual_elements
            .map((item: unknown) => sanitizeObjectiveVisualText(item, 120))
            .filter(Boolean)
            .slice(0, 24)
          : [],
        main_action: effectiveRole === "reactor" ? "" : sanitizeObjectiveVisualText(value?.main_action, 300),
        emotional_tone: isReactionPlane
          ? "neutral"
          : sanitizeObjectiveVisualText(value?.emotional_tone ?? "neutral", 80) || "neutral",
        surprise_score: Math.max(0, Math.min(100, Math.round(Number(value?.surprise_score) || 0))),
        text_on_screen: effectiveRole === "reactor" ? "" : String(value?.text_on_screen ?? "").slice(0, 500),
        ...(subjectRole ? { subject_role: subjectRole } : {}),
        ...(layer ? { layer } : {}),
        ...(region ? { region } : {}),
        ...(subjectId ? { subject_id: subjectId } : {}),
      };
    })
    .filter((value): value is ReferenceVisualMoment => value !== null)
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
    .filter((value) => {
      const key = [
        value.timestamp_seconds.toFixed(3),
        value.subject_role || "",
        value.layer || "",
        value.region || "",
        value.subject_id || "",
        value.description.toLocaleLowerCase(),
        value.main_action.toLocaleLowerCase(),
      ].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido", code: "METHOD_NOT_ALLOWED" }, 405, {
      ...corsHeaders,
      Allow: "POST, OPTIONS",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let referenceVideoId: string | null = null;
  let authorizedReference: { id: string; ownerId: string } | null = null;
  let media: PreparedVideoMedia | null = null;
  let activePhase: "audio" | "visual" | null = null;

  try {
    const actor = await requireUserOrService({ req, supabaseUrl, serviceRoleKey });
    const body = await req.json();
    const requestedSourceDuration = parseIndependentSourceDuration(body?.video_duration);
    const requestedReferenceVideoId = typeof body?.reference_video_id === "string" && body.reference_video_id.trim()
      ? body.reference_video_id.trim()
      : null;
    let ownerId: string;
    let storagePath = "";
    let fileName = typeof body?.file_name === "string" && body.file_name.trim()
      ? body.file_name.trim().slice(0, 255)
      : "video-referencia";
    let storageBucket = REFERENCE_VIDEO_BUCKET;
    const force = body?.force === true;
    let durableSourceDuration: number | undefined;

    if (requestedReferenceVideoId) {
      const { data: existing, error } = await supabase
        .from("reference_videos")
        .select("id, user_id, file_name, storage_path, storage_bucket, status, transcription, transcription_segments, frames, duration_seconds, updated_at")
        .eq("id", requestedReferenceVideoId)
        .maybeSingle();
      if (error || !existing) throw new IngestionError("REFERENCE_VIDEO_NOT_FOUND", "Vídeo de referência não encontrado.", 404);
      if (!existing.user_id) {
        throw new IngestionError("REFERENCE_OWNER_MISSING", "A referência não possui um proprietário válido.", 409);
      }
      await requireResourceOwnerAdminOrService({
        actor,
        ownerId: existing.user_id,
        supabaseUrl,
        serviceRoleKey,
      });
      // Only an ID that passed owner/admin/service authorization is ever used
      // by success or failure mutations below. The caller-provided ID remains
      // quarantined in requestedReferenceVideoId until this point.
      ownerId = existing.user_id;
      referenceVideoId = existing.id;
      authorizedReference = { id: existing.id, ownerId };
      if (!existing.storage_path) {
        throw new IngestionError("REFERENCE_STORAGE_MISSING", "A importação da referência ainda não terminou.", 409, true);
      }
      // Ownership comes from the durable row, never from a caller-selected
      // bucket. `videos` is accepted only for rows migrated from the old public
      // bucket; every new row is explicitly written to reference-videos.
      storagePath = normalizeStoragePath(existing.storage_path);
      storageBucket = existing.storage_bucket === "videos" ? "videos" : REFERENCE_VIDEO_BUCKET;
      fileName = existing.file_name || fileName;
      durableSourceDuration = storedSourceDuration(existing.duration_seconds);
      if (!storagePath.startsWith(`reference/${ownerId}/`)) {
        throw new IngestionError("REFERENCE_STORAGE_FORBIDDEN", "A referência persistida não pertence à sua sessão.", 403);
      }
      if (!force && existing.status === "ready" && existing.storage_path === storagePath) {
        const reusableSegments = Array.isArray(existing.transcription_segments)
          ? existing.transcription_segments
          : [];
        const reusableFrames = Array.isArray(existing.frames)
          ? existing.frames as ReferenceVisualMoment[]
          : [];
        const reusableCoverageFrames = uniqueReferenceVisualTimestamps(reusableFrames);
        const reusableCoverage = assessVisualTimelineCoverage(
          reusableCoverageFrames,
          requestedSourceDuration ?? durableSourceDuration ?? Number(existing.duration_seconds),
          {
            maxMoments: REFERENCE_VISUAL_MAX_MOMENTS,
            secondsPerMoment: 3,
            minMoments: 3,
          },
        );
        const reusableLayerContract = assessReferenceVisualEvidenceContract(reusableFrames, {
          transcriptionSegments: reusableSegments,
          enforceObservableLanguage: true,
        });
        if (reusableCoverage.passed && reusableLayerContract.passed) {
          return jsonResponse({
            status: "ready",
            reused: true,
            reference_video_id: existing.id,
            transcription_segments: reusableSegments.length,
            visual_frames: reusableFrames.length,
          }, 200, corsHeaders);
        }
        // A legacy `ready` flag is not evidence of complete visual coverage.
        // Continue into the normal compare-and-set claim and rebuild it.
      }
      const updatedAt = Date.parse(existing.updated_at ?? "");
      if (
        !force
        && ACTIVE_PROCESSING_STATUSES.has(existing.status)
        && Number.isFinite(updatedAt)
        && Date.now() - updatedAt < ACTIVE_PHASE_LEASE_MS
      ) {
        return jsonResponse({ status: existing.status, reused: true, reference_video_id: existing.id }, 202, corsHeaders);
      }

      // A normal retry resumes the durable phase boundary. `force` explicitly
      // restarts the evidence pipeline from the real audio track.
      activePhase = !force && (
          existing.status === AUDIO_READY_STATUS
          || existing.status === VISUAL_PROCESSING_STATUS
          || (existing.status === "ready" && Array.isArray(existing.transcription_segments))
        )
        ? "visual"
        : "audio";
      const claimedStatus = activePhase === "audio" ? AUDIO_PROCESSING_STATUS : VISUAL_PROCESSING_STATUS;
      let claimQuery = supabase.from("reference_videos").update({
        file_name: fileName,
        storage_path: storagePath,
        storage_bucket: storageBucket,
        status: claimedStatus,
        error_message: null,
      }).eq("id", authorizedReference.id).eq("user_id", authorizedReference.ownerId);
      // Compare-and-set prevents two browser retries from paying for the same
      // Gemini upload/analysis concurrently. updated_at changes on a claim.
      if (!force) claimQuery = claimQuery.eq("updated_at", existing.updated_at);
      const { data: claimed, error: processingUpdateError } = await claimQuery.select("id");
      if (processingUpdateError) throw processingUpdateError;
      if (!force && !claimed?.length) {
        return jsonResponse({ status: claimedStatus, reused: true, reference_video_id: existing.id }, 202, corsHeaders);
      }
    } else {
      if (actor.kind !== "user" || !actor.userId) {
        throw new IngestionError(
          "REFERENCE_VIDEO_ID_REQUIRED",
          "Chamadas internas precisam informar uma referência durável existente.",
          400,
        );
      }
      ownerId = actor.userId;
      storagePath = normalizeStoragePath(body?.storage_path ?? "");
      if (!storagePath.startsWith(`reference/${ownerId}/`)) {
        throw new IngestionError(
          "REFERENCE_STORAGE_FORBIDDEN",
          "O arquivo de referência não pertence à sua sessão.",
          403,
        );
      }
      if (fileName === "video-referencia") fileName = storagePath.split("/").pop()!;
      const { data: inserted, error } = await supabase.from("reference_videos").insert({
        user_id: ownerId,
        file_name: fileName,
        storage_path: storagePath,
        storage_bucket: REFERENCE_VIDEO_BUCKET,
        status: AUDIO_PROCESSING_STATUS,
      }).select("id").single();
      if (error) throw error;
      referenceVideoId = inserted.id;
      authorizedReference = { id: inserted.id, ownerId };
      activePhase = "audio";
    }
    if (!authorizedReference) {
      throw new IngestionError("REFERENCE_AUTHORIZATION_MISSING", "A referência não foi autorizada para processamento.", 403);
    }
    if (!activePhase) activePhase = "audio";

    // Prefer fresh browser/local preflight metadata. A resumed job can use the
    // durable row, which the uploader records before analysis begins.
    const sourceDuration = requestedSourceDuration ?? durableSourceDuration;

    media = await prepareVideoMedia({
      supabaseUrl,
      serviceRoleKey,
      storageBucket,
      storagePath,
      // O nome original pode conter o título de publicação. O provedor recebe
      // um identificador neutro para que a análise use apenas áudio e pixels.
      displayName: "reference-video",
      maxBytes: MAX_REFERENCE_VIDEO_BYTES,
    });

    if (activePhase === "audio") {
      const transcriptionResult = await generateVideoJson<TranscriptionResult>({
        media,
        systemPrompt: `AUDIO EVIDENCE — You are a forensic audio transcriber. Listen to the ACTUAL audio of the complete source and return only audio evidence.

- Transcribe every intelligible spoken word without paraphrasing, rewriting, translating, or correcting it.
- Song lyrics, singing and vocalized music are not spoken narration: never place them in segments, even when the words are intelligible. If a person speaks over music, transcribe only the spoken commentary/dialogue.
- If there is music or singing but no intelligible spoken commentary/dialogue, return an empty segments array. Never invent narration from images, titles, captions, or context.
- Use natural 2-8 second segments with accurate decimal timestamps in the original language.
- Cover every spoken passage through the absolute end of the source.
- Never infer dialogue, names, causes, actions, or spoken facts from pixels.
- Report the complete source duration even when the segments array is empty.`,
        userPrompt: `Transcribe only the real audio track. The independently measured file duration is ${
          sourceDuration ? `${sourceDuration.toFixed(3)} seconds` : "unknown; measure it from the source"
        }. When supplied, this duration is the authoritative boundary and every timestamp must stay inside it.`,
        jsonSchema: transcriptionSchema,
        toolName: "save_reference_transcription",
        maxOutputTokens: 12288,
      });
      const rawSegments = sanitizeSegments(transcriptionResult.segments);
      const segments = clampSegmentsToDuration(rawSegments, sourceDuration);
      const reportedDuration = Number(transcriptionResult.duration_seconds) || 0;
      const inferredDuration = segments.reduce(
        (maximum, segment) => Math.max(maximum, segment.end),
        reportedDuration,
      );
      const duration = sourceDuration ?? inferredDuration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("Unable to determine a real video duration from the source audio phase.");
      }
      if (
        sourceDuration
        && reportedDuration > 0
        && Math.abs(reportedDuration - sourceDuration) > Math.max(3, sourceDuration * 0.1)
      ) {
        console.warn("process-reference-video: model duration differs from independent metadata", {
          reference_video_id: authorizedReference.id,
          source_duration_seconds: sourceDuration,
          model_duration_seconds: reportedDuration,
        });
      }
      const transcription = segments.map((segment) => segment.text).join(" ");
      const languageDecision = reconcileTranscriptLanguage(
        transcription,
        transcriptionResult.language,
      );
      const language = languageDecision.language;
      if (
        languageDecision.source === "lexical_evidence"
        && languageDecision.model_language !== "unknown"
        && languageDecision.model_language !== language
      ) {
        console.warn("process-reference-video: transcript language reconciled from lexical evidence", {
          reference_video_id: authorizedReference.id,
          model_language: languageDecision.model_language,
          reconciled_language: language,
          lexical_scores: languageDecision.scores,
        });
      }

      const { data: audioCompletedReference, error: audioUpdateError } = await supabase
        .from("reference_videos")
        .update({
          transcription,
          transcription_segments: segments,
          duration_seconds: duration,
          status: AUDIO_READY_STATUS,
          error_message: null,
        })
        .eq("id", authorizedReference.id)
        .eq("user_id", authorizedReference.ownerId)
        .eq("status", AUDIO_PROCESSING_STATUS)
        .select("id")
        .maybeSingle();
      if (audioUpdateError || !audioCompletedReference) {
        throw audioUpdateError || new IngestionError(
          "REFERENCE_PHASE_CHANGED",
          "A fase de transcrição mudou durante o processamento.",
          409,
          true,
        );
      }

      const { error: transcriptSaveError } = await supabase.from("reference_video_transcripts").upsert({
        reference_video_id: authorizedReference.id,
        transcript_text: transcription,
        transcript_segments: segments,
        detected_language: language,
        segment_count: segments.length,
        transcript_provider: "gemini_files",
        transcript_status: "ready",
      }, { onConflict: "reference_video_id" });
      if (transcriptSaveError) throw transcriptSaveError;

      return jsonResponse({
        status: AUDIO_READY_STATUS,
        next_phase: "visual",
        reused: false,
        reference_video_id: authorizedReference.id,
        transcription_segments: segments.length,
        duration_seconds: duration,
        language,
        media_transport: media.kind,
      }, 202, corsHeaders);
    }

    if (activePhase !== "visual") {
      throw new IngestionError("REFERENCE_PHASE_INVALID", "Fase de processamento inválida.", 409, true);
    }
    const visualResult = await generateVideoJson<VisualResult>({
      media,
      systemPrompt: `PIXEL EVIDENCE — You are a forensic visual analyst. Observe only the ACTUAL PIXELS of the complete source and return an independent visual evidence timeline.

- Ignore narration as proof. Never claim an object, action, reaction, relationship, intention, or on-screen text unless it is visibly supported.
- Reconstruct the full visible sequence with approximately one distinct TIMESTAMP every 3 seconds, never more than 30 distinct timestamps. Layer rows at the same timestamp do not consume another temporal sample.
- The 3-second cadence is only a budget guideline. Whenever a short visible chain contains an initiating action/object interaction, a physical aftermath or reaction, and a later conflict/reveal/consequence, keep every material transition even when adjacent timestamps are less than 3 seconds apart. Remove static poses or repeated frames first.
- Track concrete objects across adjacent moments. Re-check shape, color, location and the actor touching it before naming it; the same visible object may not become an unrelated object in the next row. If identity is uncertain, use one stable conservative description such as "small white object/animal" instead of guessing different labels.
- A frame that begins an interaction (for example, a directed lunge, capture, consumption, handoff or concealment) and a frame that exposes its physical trace are separate material events when they explain the next visible reaction. Never collapse them into a broad later result such as "they started acting" or "a conflict happened".
- Include cuts, physical actions, facial reactions, layout changes, text overlays, the opening visual hook, reveals, and the final payoff.
- Include at least two distinct visual moments inside the first 5 seconds so both the opening action and its immediate change are evidenced.
- The final timestamp must be at or after 90% of the real duration. Never stop early, even when the action appears resolved.
- For reaction/split-screen videos, describe the reactor and the embedded source as separate visual layers. Do not merge their identities or actions.
- When one sampled instant visibly contains both layers, emit at most two separate rows at that same timestamp: one embedded row and one reactor row. Every row describes exactly one layer and one subject. Never put both planes in one description.
- For every reaction layout, ALWAYS emit a separate reactor baseline row inside 0-5 seconds even when the reactor stays neutral or static. After that baseline, add reactor rows only when its visible expression/action materially changes. Keep the embedded story sampled across the complete timeline.
- Structured metadata is REQUIRED on every returned row: subject_role and layer must match (reactor, embedded, or unknown), region is a stable screen token, and subject_id is a stable OPAQUE token. IDs must be neutral tokens such as reactor_1, embedded_subject_1, unknown_subject_1; never encode a name, job, relationship, motive, insult, or judgment in an ID. Use unknown instead of guessing for direct/full-screen footage.
- description and main_action may state only a visibly observable actor, physical action, object, direction, screen region, facial expression, or physical state. Never infer relationships, parenthood, help intent, motive, morality, judgment, symbolism, outcome, or story labels. Forbidden unsupported labels include cheating/infidelity, family/couple/mother/father/son/daughter, ordering/commanding, offering help from an extended hand, comforting, seductive, smug, defiant/challenging, cruel, lazy/preguicoso/vagabundagem/cara de pau, kind, defeated, triumph and resilience. Literal on-screen text may be transcribed in text_on_screen, but do not turn it into a broader inferred claim.
- Preserve material chronological OCR exactly in text_on_screen (for example, elapsed-time cards equivalent to "ONE YEAR LATER"). A time card is a narrative state change, not decorative text. A sad face, blue glow or distressed pose is not "crying" unless tears, wiping tears or the physical act of crying is visibly present.
- If the source is music-only, still reconstruct the visible story; never invent spoken dialogue.
- surprise_score is an integer from 0 to 100.`,
      userPrompt: `Analyze only the real pixels across the complete reference video. The authoritative source duration is ${
        sourceDuration ? `${sourceDuration.toFixed(3)} seconds` : "not independently supplied; cover the complete media timeline"
      }. Return about one evidenced timestamp per 3 seconds (maximum 30 distinct timestamps), at least two distinct timestamps inside 0-5 seconds, and evidence at or beyond 90% of the duration. In a reaction layout include a separate reactor baseline row in 0-5 seconds and never merge it with the embedded row.`,
      jsonSchema: visualSchema,
      toolName: "save_reference_visual_analysis",
      maxOutputTokens: 16384,
    });
    const tentativeFrames = sanitizeFrames(visualResult.frames, sourceDuration);
    const inferredVisualDuration = tentativeFrames.reduce(
      (maximum, frame) => Math.max(maximum, frame.timestamp_seconds),
      0,
    );
    const duration = sourceDuration ?? inferredVisualDuration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Unable to determine a real video duration for the visual phase.");
    }
    const rawVisualContract = assessReferenceVisualEvidenceContract(tentativeFrames, {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    if (!rawVisualContract.passed) {
      throw new IngestionError(
        "REFERENCE_VISUAL_EVIDENCE_INVALID",
        `A análise visual misturou camadas ou inferiu fatos não observáveis (${rawVisualContract.reasons.join(",")}).`,
        422,
        true,
        { ...rawVisualContract },
      );
    }
    // The 30-item cap belongs to temporal sampling, not physical layer rows.
    // At a selected timestamp preserve at most one embedded observation and
    // one reactor observation so neither plane can erase the other.
    const frames = limitReferenceVisualTimelineByTimestamp(
      tentativeFrames,
      REFERENCE_VISUAL_MAX_MOMENTS,
    );
    const finalVisualContract = assessReferenceVisualEvidenceContract(frames, {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    if (!finalVisualContract.passed) {
      throw new IngestionError(
        "REFERENCE_VISUAL_LAYER_LIMIT_INVALID",
        `A redução temporal removeu evidência obrigatória (${finalVisualContract.reasons.join(",")}).`,
        422,
        true,
        { ...finalVisualContract },
      );
    }
    // A reaction layout can legitimately produce two evidence rows at the
    // same instant. Preserve both rows for semantics, but count that timestamp
    // exactly once in both fresh processing and ready-reference reuse.
    const coverageFrames = uniqueReferenceVisualTimestamps(frames);
    const visualCoverage = assessVisualTimelineCoverage(coverageFrames, duration, {
      maxMoments: REFERENCE_VISUAL_MAX_MOMENTS,
      secondsPerMoment: 3,
      minMoments: 3,
    });
    if (!visualCoverage.passed) {
      throw new Error(
        `A análise visual não cobriu o vídeo inteiro com densidade suficiente `
        + `(momentos=${visualCoverage.observed_moments}/${visualCoverage.required_moments}, `
        + `primeiro=${visualCoverage.first_timestamp_seconds ?? "ausente"}s, `
        + `último=${visualCoverage.last_timestamp_seconds ?? "ausente"}s, `
        + `fim_mínimo=${visualCoverage.ending_floor_seconds.toFixed(2)}s, `
        + `motivos=${visualCoverage.reasons.join(",")}).`,
      );
    }

    const { data: completedReference, error: updateError } = await supabase.from("reference_videos").update({
      frames,
      duration_seconds: duration,
      status: VISUAL_READY_STATUS,
      error_message: null,
    })
      .eq("id", authorizedReference.id)
      .eq("user_id", authorizedReference.ownerId)
      .eq("status", VISUAL_PROCESSING_STATUS)
      .select("id")
      .maybeSingle();
    if (updateError || !completedReference) {
      throw updateError || new IngestionError(
        "REFERENCE_PHASE_CHANGED",
        "A fase visual mudou durante o processamento.",
        409,
        true,
      );
    }

    const { error: staleTopicDeleteError } = await supabase
      .from("reference_video_topics")
      .delete()
      .eq("reference_video_id", authorizedReference.id);
    if (staleTopicDeleteError) throw staleTopicDeleteError;

    const { error: oldFramesDeleteError } = await supabase
      .from("reference_video_frames")
      .delete()
      .eq("reference_video_id", authorizedReference.id);
    if (oldFramesDeleteError) throw oldFramesDeleteError;
    const frameReferenceId = authorizedReference.id;
    const { error: framesSaveError } = await supabase.from("reference_video_frames").insert(frames.map((frame, index) => ({
      reference_video_id: frameReferenceId,
      timestamp_seconds: frame.timestamp_seconds,
      description: `${frame.description}${frame.main_action ? ` Ação: ${frame.main_action}` : ""}${frame.text_on_screen ? ` Texto na tela: ${frame.text_on_screen}` : ""}`,
      scene_type: frame.scene_type,
      visual_elements: frame.visual_elements,
      emotional_tone: frame.emotional_tone,
      frame_order: index + 1,
    })));
    if (framesSaveError) throw framesSaveError;

    return jsonResponse({
      status: "ready",
      reused: false,
      reference_video_id: authorizedReference.id,
      visual_frames: frames.length,
      duration_seconds: duration,
      media_transport: media.kind,
    }, 200, corsHeaders);
  } catch (error) {
    const failure = error instanceof EdgeAuthError
      ? new IngestionError(error.code, error.message, error.status)
      : asIngestionError(error);
    console.error("process-reference-video error:", failure);
    if (authorizedReference) {
      await supabase.from("reference_videos").update({
        status: "error",
        error_message: `[${failure.code}] ${failure.message}`,
      })
        .eq("id", authorizedReference.id)
        .eq("user_id", authorizedReference.ownerId);
    }
    return jsonResponse({
      error: failure.message,
      code: failure.code,
      retryable: failure.retryable,
      details: failure.details,
      reference_video_id: referenceVideoId,
    }, failure.status, corsHeaders);
  } finally {
    if (media) await releaseVideoMedia(media);
  }
});
