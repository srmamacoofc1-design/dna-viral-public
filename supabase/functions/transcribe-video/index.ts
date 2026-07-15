import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  generateVideoJson,
  prepareVideoMedia,
  releaseVideoMedia,
} from "../_shared/gemini-video.ts";
import type { PreparedVideoMedia } from "../_shared/gemini-video.ts";
import { requireLibraryAdminOrService } from "../_shared/edge-auth.ts";
import {
  asIngestionError,
  IngestionError,
  jsonResponse,
  MAX_LIBRARY_VIDEO_BYTES,
  normalizeStoragePath,
} from "../_shared/ingestion.ts";
import {
  assessVisualTimelineCoverage,
  limitVisualTimeline,
} from "../_shared/visual-timeline-coverage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// A single Gemini request must cover the complete source. Durations above one
// hour do not belong in this synchronous short-form analysis path.
export const MAX_MULTIMODAL_DURATION_SECONDS = 60 * 60;
const MULTIMODAL_CLAIM_LEASE_SECONDS = 8 * 60;
const LIBRARY_VISUAL_MAX_MOMENTS = 40;

interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface VisualMoment {
  timestamp_seconds: number;
  description: string;
  scene_type: string;
  main_action: string;
  main_objects: string[];
  text_on_screen: boolean;
  text_on_screen_content: string;
  human_presence: boolean;
  animal_presence: boolean;
  emotional_tone: string;
  intensity_score: number;
  surprise_score: number;
  is_scene_change: boolean;
}

interface MultimodalAnalysisResult {
  language?: string;
  duration_seconds?: number;
  segments?: Segment[];
  moments?: VisualMoment[];
}

const segmentSchema = {
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
};

const momentSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      timestamp_seconds: { type: "number" },
      description: { type: "string" },
      scene_type: { type: "string" },
      main_action: { type: "string" },
      main_objects: { type: "array", items: { type: "string" } },
      text_on_screen: { type: "boolean" },
      text_on_screen_content: { type: "string" },
      human_presence: { type: "boolean" },
      animal_presence: { type: "boolean" },
      emotional_tone: { type: "string" },
      intensity_score: { type: "number" },
      surprise_score: { type: "number" },
      is_scene_change: { type: "boolean" },
    },
    required: [
      "timestamp_seconds",
      "description",
      "scene_type",
      "main_action",
      "main_objects",
      "text_on_screen",
      "text_on_screen_content",
      "human_presence",
      "animal_presence",
      "emotional_tone",
      "intensity_score",
      "surprise_score",
      "is_scene_change",
    ],
  },
};

const multimodalAnalysisSchema = {
  type: "object",
  properties: {
    language: { type: "string" },
    duration_seconds: { type: "number" },
    segments: segmentSchema,
    moments: momentSchema,
  },
  required: ["language", "duration_seconds", "segments", "moments"],
};

const multimodalSystemPrompt = `You are a forensic multimodal analyst for short-form video.
Analyze the COMPLETE source exactly once, listening to its audio and observing its actual pixels.

AUDIO OUTPUT:
- Transcribe every spoken word without paraphrasing or inferring dialogue from visuals.
- Use natural 2-8 second segments with accurate ABSOLUTE timestamps.
- Preserve the original spoken language and cover the video through its real end.

VISUAL OUTPUT:
- Independently report every meaningful cut, action change, reveal, surprising image, text overlay, reaction and payoff.
- Reconstruct the complete visible story with approximately one distinct temporal moment every 3 seconds, never more than 40.
- Include at least two distinct visual moments inside the first 5 seconds so the opening action and its immediate change are both evidenced.
- The final visual timestamp must be at or after 90% of the real duration. Do not stop early, even if the apparent payoff occurs sooner.
- Descriptions must be concrete and factual; never infer a visual from speech.
- intensity_score and surprise_score are integers from 0 to 100.
- Give special precision to the opening visual hook and highest-surprise visible action.

Return both the audio segments and visual moments in the single requested JSON object. Both timelines must reach the absolute end of the source.`;

function clampScore(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function sanitizeSegments(raw: unknown): Segment[] {
  const values = Array.isArray(raw) ? raw : [];
  return values
    .map((value: any) => ({
      start: Number(value?.start),
      end: Number(value?.end),
      text: typeof value?.text === "string" ? value.text.trim() : "",
    }))
    .filter((value) =>
      Number.isFinite(value.start) &&
      Number.isFinite(value.end) &&
      value.start >= 0 &&
      value.end > value.start &&
      value.end <= MAX_MULTIMODAL_DURATION_SECONDS + 1 &&
      value.text
    )
    .sort((a, b) => a.start - b.start);
}

function textSimilarity(a: string, b: string): number {
  const left = new Set(a.toLocaleLowerCase().split(/\s+/).filter(Boolean));
  const right = new Set(b.toLocaleLowerCase().split(/\s+/).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const word of left) if (right.has(word)) common++;
  return common / Math.max(left.size, right.size);
}

function deduplicateSegments(values: Segment[]): Segment[] {
  const result: Segment[] = [];
  for (const segment of values) {
    const previous = result[result.length - 1];
    if (previous && segment.start < previous.end && textSimilarity(previous.text, segment.text) >= 0.72) continue;
    if (previous && segment.start < previous.end && previous.end - segment.start < 1.5) {
      segment.start = previous.end;
    }
    if (segment.end > segment.start) result.push(segment);
  }
  return result;
}

function sanitizeVisualMoments(raw: unknown, maxDuration: number): VisualMoment[] {
  const values = Array.isArray(raw) ? raw : [];
  const moments = values.map((value: any): VisualMoment | null => {
    const timestamp = Number(value?.timestamp_seconds);
    const description = typeof value?.description === "string" ? value.description.trim() : "";
    if (!Number.isFinite(timestamp) || timestamp < 0 || !description) return null;
    return {
      timestamp_seconds: Math.min(timestamp, maxDuration),
      description,
      scene_type: String(value?.scene_type ?? "other").slice(0, 80),
      main_action: String(value?.main_action ?? "").slice(0, 240),
      main_objects: Array.isArray(value?.main_objects)
        ? value.main_objects.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 20)
        : [],
      text_on_screen: value?.text_on_screen === true,
      text_on_screen_content: String(value?.text_on_screen_content ?? "").slice(0, 500),
      human_presence: value?.human_presence === true,
      animal_presence: value?.animal_presence === true,
      emotional_tone: String(value?.emotional_tone ?? "neutral").slice(0, 80),
      intensity_score: clampScore(value?.intensity_score),
      surprise_score: clampScore(value?.surprise_score),
      is_scene_change: value?.is_scene_change === true,
    };
  }).filter((value): value is VisualMoment => value !== null);

  const seen = new Set<string>();
  return moments
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
    .filter((moment) => {
      const key = `${moment.timestamp_seconds.toFixed(2)}:${moment.description.toLocaleLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeLanguage(value: unknown): string {
  const language = String(value || "pt").trim().toLowerCase().split(/[-_]/, 1)[0];
  return /^[a-z]{2,3}$/.test(language) ? language : "pt";
}

function parseExpectedDuration(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MULTIMODAL_DURATION_SECONDS) {
    throw new IngestionError(
      "INVALID_VIDEO_DURATION",
      `video_duration deve estar entre 0 e ${MAX_MULTIMODAL_DURATION_SECONDS} segundos.`,
      422,
      false,
      { max_duration_seconds: MAX_MULTIMODAL_DURATION_SECONDS },
    );
  }
  return duration;
}

async function hashMoment(moment: VisualMoment): Promise<string> {
  const bytes = new TextEncoder().encode(`${moment.timestamp_seconds}|${moment.description}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido", code: "METHOD_NOT_ALLOWED" }, 405, {
      ...corsHeaders,
      Allow: "POST, OPTIONS",
    });
  }

  let media: PreparedVideoMedia | null = null;
  let videoId: string | null = null;
  let claimToken: string | null = null;
  let claimHeld = false;
  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await requireLibraryAdminOrService({ req, supabaseUrl, serviceRoleKey });
    const body = await req.json();
    videoId = typeof body?.video_id === "string" ? body.video_id : null;
    const filePath = normalizeStoragePath(body?.file_path ?? "");
    const force = body?.force === true;
    const expectedDuration = parseExpectedDuration(body?.video_duration);
    if (!videoId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(videoId)) {
      return jsonResponse({ error: "video_id inválido", code: "INVALID_VIDEO_ID" }, 422, corsHeaders);
    }

    supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id, duracao")
      .eq("id", videoId)
      .maybeSingle();
    if (videoError) throw videoError;
    if (!video) return jsonResponse({ error: "Vídeo não encontrado", code: "VIDEO_NOT_FOUND" }, 404, corsHeaders);
    const log = async (message: string, status = "success") => {
      await supabase!.from("video_logs").insert({ video_id: videoId, etapa: "Transcrição Multimodal", status, mensagem: message });
    };

    const [{ count: transcriptCount }, { data: visualMetadata }] = await Promise.all([
      supabase.from("video_transcripts").select("*", { head: true, count: "exact" }).eq("video_id", videoId),
      supabase.from("video_metadata").select("valor").eq("video_id", videoId).eq("chave", "multimodal_visual_analysis").maybeSingle(),
    ]);
    if (!force && (transcriptCount ?? 0) > 0 && visualMetadata?.valor) {
      let existing: unknown = null;
      try {
        existing = typeof visualMetadata.valor === "string"
          ? JSON.parse(visualMetadata.valor)
          : visualMetadata.valor;
      } catch {
        await log("Metadado visual anterior estava corrompido; refazendo análise multimodal.", "warning");
      }
      const durableDuration = expectedDuration ?? Number(video.duracao);
      const existingCoverage = Array.isArray(existing) && Number.isFinite(durableDuration) && durableDuration > 0
        ? assessVisualTimelineCoverage(existing as Array<{ timestamp_seconds: number }>, durableDuration, {
            maxMoments: LIBRARY_VISUAL_MAX_MOMENTS,
            secondsPerMoment: 3,
            minMoments: 3,
          })
        : null;
      if (existingCoverage?.passed) {
        await log("Resultado multimodal existente reutilizado (idempotência).");
        return jsonResponse({
          success: true,
          reused: true,
          segments_count: transcriptCount,
          visual_moments: (existing as unknown[]).length,
        }, 200, corsHeaders);
      }
      if (Array.isArray(existing)) {
        await log(
          `Resultado multimodal anterior não cobre a duração completa; refazendo `
          + `(motivos=${existingCoverage?.reasons.join(",") || "duracao_indisponivel"}).`,
          "warning",
        );
      }
    }

    claimToken = crypto.randomUUID();
    const { data: acquired, error: claimError } = await supabase.rpc("claim_video_multimodal_analysis", {
      _video_id: videoId,
      _claim_token: claimToken,
      _lease_seconds: MULTIMODAL_CLAIM_LEASE_SECONDS,
    });
    if (claimError) throw new Error(`Falha ao adquirir claim multimodal: ${claimError.message}`);
    if (acquired !== true) {
      return jsonResponse({
        error: "Este vídeo já possui uma análise multimodal em andamento.",
        code: "MULTIMODAL_ALREADY_PROCESSING",
        retryable: true,
        video_id: videoId,
      }, 409, corsHeaders);
    }
    claimHeld = true;

    await log("Preparando o vídeo para uma única leitura multimodal de áudio e pixels...");
    media = await prepareVideoMedia({
      supabaseUrl,
      serviceRoleKey,
      storagePath: filePath,
      displayName: filePath.split("/").pop(),
      maxBytes: MAX_LIBRARY_VIDEO_BYTES,
      onLog: (message) => log(message),
    });

    const result = await generateVideoJson<MultimodalAnalysisResult>({
      media,
      systemPrompt: multimodalSystemPrompt,
      userPrompt: `Analyze the complete video in one pass. The independently supplied duration is ${
        expectedDuration ? `${expectedDuration.toFixed(3)} seconds` : "unknown; measure it from the source"
      }. Return the full verbatim transcript and the complete visible-story timeline together at about one moment per 3 seconds (maximum 40). The final visual timestamp must reach at least 90% of that duration; never stop early.`,
      jsonSchema: multimodalAnalysisSchema,
      toolName: "save_multimodal_analysis",
      maxOutputTokens: 32768,
    });

    const segments = deduplicateSegments(sanitizeSegments(result.segments));
    if (segments.length === 0) {
      throw new Error("A IA não encontrou fala no vídeo. O DNA exige transcrição real para modelar a estratégia verbal.");
    }
    const segmentDuration = Math.max(...segments.map((segment) => segment.end));
    const reportedDuration = Number(result.duration_seconds);
    const measuredDuration = Math.max(
      segmentDuration,
      Number.isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : 0,
    );
    if (measuredDuration > MAX_MULTIMODAL_DURATION_SECONDS) {
      throw new IngestionError(
        "VIDEO_DURATION_TOO_LONG",
        `A duração detectada excede ${MAX_MULTIMODAL_DURATION_SECONDS} segundos.`,
        422,
      );
    }
    const duration = expectedDuration ?? measuredDuration;
    const language = normalizeLanguage(result.language);
    const visualMoments = limitVisualTimeline(
      sanitizeVisualMoments(result.moments, duration),
      LIBRARY_VISUAL_MAX_MOMENTS,
    );
    const visualCoverage = assessVisualTimelineCoverage(visualMoments, duration, {
      maxMoments: LIBRARY_VISUAL_MAX_MOMENTS,
      secondsPerMoment: 3,
      minMoments: 3,
    });
    if (!visualCoverage.passed) {
      throw new IngestionError(
        "MULTIMODAL_VISUAL_COVERAGE_INCOMPLETE",
        `A análise visual não cobriu o vídeo inteiro `
          + `(momentos=${visualCoverage.observed_moments}/${visualCoverage.required_moments}, `
          + `último=${visualCoverage.last_timestamp_seconds ?? "ausente"}s, `
          + `fim_mínimo=${visualCoverage.ending_floor_seconds.toFixed(2)}s).`,
        422,
        true,
        { ...visualCoverage },
      );
    }

    const transcriptRows = segments.map((segment) => ({
      tempo_inicio: Math.round(segment.start * 1000) / 1000,
      tempo_fim: Math.round(segment.end * 1000) / 1000,
      duracao: Math.round((segment.end - segment.start) * 1000) / 1000,
      texto: segment.text,
      language_code: language,
    }));
    const frameRows = await Promise.all(visualMoments.map(async (moment, index) => ({
      frame_number: index + 1,
      timestamp_seconds: Math.round(moment.timestamp_seconds * 1000) / 1000,
      file_path: null,
      frame_hash: await hashMoment(moment),
      frame_role: index === 0 ? "opening" : "visual_moment",
      source_method: "gemini_video_understanding",
      scene_change_flag: moment.is_scene_change,
      visual_intensity_score: moment.intensity_score,
    })));

    const { data: committed, error: commitError } = await supabase.rpc("commit_video_multimodal_analysis", {
      _video_id: videoId,
      _claim_token: claimToken,
      _transcripts: transcriptRows,
      _frames: frameRows,
      _visual_analysis: visualMoments,
      _language: language,
      _duration: duration,
    });
    if (commitError) throw new Error(`Falha ao salvar análise multimodal: ${commitError.message}`);
    claimHeld = false;

    await log(`Análise única concluída: ${segments.length} segmentos e ${visualMoments.length} momentos visuais em ${language}.`);
    return jsonResponse({
      success: true,
      reused: false,
      segments_count: Number((committed as any)?.segments_count) || segments.length,
      visual_moments: Number((committed as any)?.visual_moments) || visualMoments.length,
      language,
      duration_seconds: duration,
      media_transport: media.kind,
      ai_calls: 1,
    }, 200, corsHeaders);
  } catch (error) {
    const failure = asIngestionError(error);
    console.error("transcribe-video error:", failure);
    return jsonResponse({
      error: failure.message,
      code: failure.code,
      retryable: failure.retryable,
      details: failure.details,
      video_id: videoId,
    }, failure.status, corsHeaders);
  } finally {
    if (media) await releaseVideoMedia(media);
    if (claimHeld && supabase && videoId && claimToken) {
      await supabase.rpc("release_video_multimodal_analysis_claim", {
        _video_id: videoId,
        _claim_token: claimToken,
      });
    }
  }
});
