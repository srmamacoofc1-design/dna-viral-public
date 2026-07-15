import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as tus from "tus-js-client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { listDnaPresets, type DnaPreset } from "@/lib/dna-presets";
import {
  ACTIVE_DNA_PRESET_STORAGE_KEY,
  DNA_PRESET_SELECTION_EVENT,
  readActiveDnaPresetId,
  setActiveDnaPresetId,
} from "@/services/dna-preset-selection";
import { Upload, CheckCircle, AlertCircle, Loader2, Film, Dna, Flame, RefreshCw, Link2, ListVideo, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { EngineMode } from "./ModeSelector";
import {
  BULK_VIDEO_LINK_CHUNK_SIZE,
  parseBulkVideoLinks,
  REFERENCE_VIDEO_BUCKET,
  type BulkVideoLinkItem,
} from "../../../supabase/functions/_shared/ingestion";
import {
  mapWithConcurrency,
  MAX_REFERENCE_VIDEO_BYTES,
  REFERENCE_LINK_CONCURRENCY,
  referenceLinkQueueStorageKey,
  referenceLinkFileName,
  referenceVideoValidationError,
  referenceQueueEntriesToResume,
  restoreReferenceLinkQueue,
  serializeReferenceLinkQueue,
  type ReferenceLinkQueueEntry,
  type ReferenceVideoRow,
  updateReferenceQueueEntry,
  withReferenceRetry,
} from "@/lib/reference-link-queue";

interface ScriptInputData extends Record<string, unknown> {
  reference_video_id?: string;
  reference_video_ready?: boolean;
  dna_preset_id?: string;
  hook_apelao?: boolean;
  theme?: string;
  niche?: string;
  objective?: string;
  original_script?: string;
  preserve_meaning?: boolean;
  language?: string;
  notes?: string;
}

interface Props {
  mode: EngineMode;
  inputData: ScriptInputData;
  onChange: (data: ScriptInputData) => void;
  onReferenceQueueChange?: (entries: ReferenceLinkQueueEntry[]) => void;
}

interface LocalReferenceDownload {
  storagePath: string;
  fileName: string;
  referenceVideoId?: string;
  referenceVideo?: ReferenceVideoRow;
}

interface ImportReferenceResponse {
  error?: string;
  retryable?: boolean;
  reference_video_id?: string;
}

interface LocalReferenceUploadResponse {
  success?: boolean;
  error?: string;
  reference_video_id?: string;
  reference_video?: ReferenceVideoRow;
  storage_bucket?: string;
  storage_path?: string;
  file_name?: string;
  duration_seconds?: number;
  size_bytes?: number;
  source_size_bytes?: number;
  content_type?: string;
  normalized?: boolean;
}

type UploadStatus = "idle" | "uploading" | "processing" | "ready" | "error";

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const REFERENCE_VIDEO_INITIAL_STATUS = "pending" as const;
export const LOCAL_REFERENCE_UPLOAD_THRESHOLD_BYTES = 45 * 1024 * 1024;

const ACTIVE_REFERENCE_PROCESSING_STATUSES = new Set([
  "pending",
  "processing",
  "processing_audio",
  "awaiting_visual",
  "processing_visual",
]);

function referenceProcessingMessage(status?: string | null): string {
  if (status === "processing_audio") return "Transcrevendo o áudio e entendendo o que é falado.";
  if (status === "awaiting_visual") return "Transcrição pronta. Iniciando automaticamente a análise visual.";
  if (status === "processing_visual") return "Analisando os frames e reconstruindo a história visual.";
  return "Transcrevendo áudio e analisando frames visuais. Isso pode levar alguns minutos.";
}

function safeVideoExtension(file: Pick<File, "name" | "type">): string {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && /^(mp4|mov|webm|avi|mpeg|mpg|m4v|3gp)$/.test(extension)) return extension;
  if (file.type === "video/webm") return "webm";
  if (file.type === "video/quicktime") return "mov";
  return "mp4";
}

function safeVideoContentType(file: Pick<File, "name" | "type">): string {
  if (file.type.startsWith("video/")) return file.type;
  const byExtension: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    "3gp": "video/3gpp",
  };
  return byExtension[safeVideoExtension(file)] ?? "video/mp4";
}

/**
 * Browser-decoded container metadata is independent from the multimodal model.
 * It is best-effort so unsupported files still reach the server, while known
 * durations protect the visual-timeline validation from a bad model clock.
 */
async function readIndependentVideoDuration(file: File): Promise<number | undefined> {
  if (typeof document === "undefined" || typeof URL === "undefined") return undefined;
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(duration) && (duration ?? 0) > 0 ? duration : undefined);
    };
    const timeout = window.setTimeout(() => finish(), 10_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish();
    video.src = objectUrl;
  });
}

async function durableReferenceUploadPath(userId: string, file: File, forcedExtension?: string): Promise<string> {
  const metadata = new TextEncoder().encode(`${file.name}\0${file.size}\0${file.lastModified}\0${file.type}`);
  const prefix = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
  const fingerprintBytes = new Uint8Array(metadata.length + prefix.length);
  fingerprintBytes.set(metadata);
  fingerprintBytes.set(prefix, metadata.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fingerprintBytes));
  const fingerprint = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 40);
  return `reference/${userId}/upload-${fingerprint}.${forcedExtension ?? safeVideoExtension(file)}`;
}

function functionErrorHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("context" in error)) return undefined;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object" || !("status" in context)) return undefined;
  const status = Number((context as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

function tusUploadHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const originalResponse = (error as { originalResponse?: { getStatus?: () => unknown } }).originalResponse;
  const status = Number(originalResponse?.getStatus?.());
  return Number.isFinite(status) ? status : undefined;
}

function readableReferenceUploadError(error: unknown): string {
  const fallback = error instanceof Error ? error.message : "Falha desconhecida no upload";
  const status = tusUploadHttpStatus(error);
  if (status === 413 || /maximum size exceeded|payload too large|file size/i.test(fallback)) {
    return "O Storage recusou o tamanho do arquivo (HTTP 413). O app aceita até 300 MB, mas o limite global deste projeto Supabase precisa permitir esse tamanho; no plano gratuito o teto é 50 MB.";
  }
  return fallback;
}

export function InputPanel({ mode, inputData, onChange, onReferenceQueueChange }: Props) {
  const { user, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [usesLocalNormalizer, setUsesLocalNormalizer] = useState(false);
  const [referenceVideo, setReferenceVideo] = useState<ReferenceVideoRow | null>(null);
  const [referenceInputMode, setReferenceInputMode] = useState<"upload" | "links">("upload");
  const [referenceLinksText, setReferenceLinksText] = useState("");
  const [referenceLinkQueue, setReferenceLinkQueue] = useState<ReferenceLinkQueueEntry[]>([]);
  const [referenceLinksRunning, setReferenceLinksRunning] = useState(false);
  const [referenceQueueRestoredFor, setReferenceQueueRestoredFor] = useState<string | null>(null);
  const [presets, setPresets] = useState<DnaPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tusUploadRef = useRef<tus.Upload | null>(null);
  const uploadAttemptRef = useRef(0);
  const referenceLinkBatchRef = useRef(0);
  const referenceQueueResumeRef = useRef<string | null>(null);
  const referenceQueueRef = useRef<ReferenceLinkQueueEntry[]>([]);
  const referenceStaleRecoveryRef = useRef(new Set<string>());
  const referenceVisualPhaseDispatchRef = useRef(new Set<string>());
  const inputDataRef = useRef(inputData);
  const onChangeRef = useRef(onChange);
  const localReferenceUploadRef = useRef<XMLHttpRequest | null>(null);

  const referenceLinksPreview = useMemo(
    () => parseBulkVideoLinks(referenceLinksText),
    [referenceLinksText],
  );

  inputDataRef.current = inputData;
  onChangeRef.current = onChange;
  referenceQueueRef.current = referenceLinkQueue;

  useEffect(() => {
    onReferenceQueueChange?.(referenceLinkQueue);
  }, [onReferenceQueueChange, referenceLinkQueue]);

  const patchInput = useCallback((patch: Partial<ScriptInputData>) => {
    onChangeRef.current({ ...inputDataRef.current, ...patch });
  }, []);

  const set = (key: keyof ScriptInputData, value: unknown) => patchInput({ [key]: value });

  /**
   * Audio and visual analysis run as separate resumable Edge invocations. The
   * database status is the durable hand-off between them; this per-component
   * guard prevents the upload poller and the link-queue poller from dispatching
   * the same visual phase on every tick.
   */
  const dispatchAwaitingVisualPhase = useCallback(async (row: ReferenceVideoRow): Promise<void> => {
    if (row.status !== "awaiting_visual") return;
    if (!user?.id || row.user_id !== user.id || !row.storage_path) {
      console.warn("A fase visual não foi iniciada porque a referência não pertence à sessão atual ou está sem arquivo.");
      return;
    }

    const dispatchKey = `${row.id}:visual`;
    if (referenceVisualPhaseDispatchRef.current.has(dispatchKey)) return;
    referenceVisualPhaseDispatchRef.current.add(dispatchKey);

    let invocationError: string | null = null;
    try {
      const { error } = await supabase.functions.invoke("process-reference-video", {
        body: {
          reference_video_id: row.id,
          storage_path: row.storage_path,
          file_name: row.file_name,
          user_id: user.id,
          ...(Number.isFinite(Number(row.duration_seconds)) && Number(row.duration_seconds) > 0
            ? { video_duration: Number(row.duration_seconds) }
            : {}),
        },
      });
      invocationError = error?.message ?? null;
    } catch (error) {
      invocationError = error instanceof Error ? error.message : "Falha de conexão ao iniciar a análise visual.";
    }
    if (!invocationError) return;

    // A browser/gateway timeout does not mean the Edge Function stopped. Read
    // the durable row before showing an error and keep polling either way.
    const { data: latest } = await supabase
      .from("reference_videos")
      .select("*")
      .eq("id", row.id)
      .maybeSingle();
    if (latest) setReferenceVideo((current) => current?.id === latest.id ? latest : current);
    if (latest?.status === "error" && inputDataRef.current.reference_video_id === row.id) {
      setUploadStatus("error");
      setUploadError(latest.error_message || invocationError);
      patchInput({ reference_video_ready: false });
      return;
    }
    if (inputDataRef.current.reference_video_id === row.id) {
      setUploadError("A análise visual continua no servidor; esta página seguirá acompanhando o status.");
    }
    console.warn("A chamada da fase visual perdeu a conexão; polling mantido:", invocationError);
  }, [patchInput, user?.id]);

  // Presets DNA salvos (bases nomeadas — ver dna-presets.ts)
  const loadPresets = useCallback(async (selectionOverride?: { presetId: string | null }) => {
    setPresetsLoading(true);
    setPresetsError(null);
    try {
      const savedPresets = (await listDnaPresets()).filter((preset) => preset.active);
      setPresets(savedPresets);

      const requestedId = selectionOverride
        ? selectionOverride.presetId
        : searchParams.get("preset") || inputDataRef.current.dna_preset_id || readActiveDnaPresetId();
      if (!requestedId) {
        if (selectionOverride) {
          patchInput({ dna_preset_id: undefined });
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("preset");
          setSearchParams(nextParams, { replace: true });
        }
        return;
      }

      if (savedPresets.some((preset) => preset.id === requestedId)) {
        setActiveDnaPresetId(requestedId);
        if (inputDataRef.current.dna_preset_id !== requestedId) {
          patchInput({ dna_preset_id: requestedId });
        }
      } else {
        setActiveDnaPresetId(null);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("preset");
        setSearchParams(nextParams, { replace: true });
        if (inputDataRef.current.dna_preset_id) patchInput({ dna_preset_id: undefined });
        toast.warning("O preset DNA selecionado não existe mais. A Base Global foi ativada.");
      }
    } catch (error: unknown) {
      setPresetsError(error instanceof Error ? error.message : "Não foi possível carregar os presets DNA");
      console.warn("Falha ao listar presets DNA:", error);
    } finally {
      setPresetsLoading(false);
    }
  }, [patchInput, searchParams, setSearchParams]);

  const handlePresetChange = useCallback((value: string) => {
    const presetId = value === "global" ? null : value;
    setActiveDnaPresetId(presetId);
    patchInput({ dna_preset_id: presetId ?? undefined });

    const nextParams = new URLSearchParams(searchParams);
    if (presetId) nextParams.set("preset", presetId);
    else nextParams.delete("preset");
    setSearchParams(nextParams, { replace: true });
  }, [patchInput, searchParams, setSearchParams]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    const handleSelection = (event: Event) => {
      const presetId = (event as CustomEvent<{ presetId?: string | null }>).detail?.presetId ?? null;
      if (presetId && !presets.some((preset) => preset.id === presetId)) {
        void loadPresets({ presetId });
        return;
      }
      patchInput({ dna_preset_id: presetId ?? undefined });
      const nextParams = new URLSearchParams(searchParams);
      if (presetId) nextParams.set("preset", presetId);
      else nextParams.delete("preset");
      setSearchParams(nextParams, { replace: true });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ACTIVE_DNA_PRESET_STORAGE_KEY) {
        void loadPresets({ presetId: event.newValue?.trim() || null });
      }
    };
    window.addEventListener(DNA_PRESET_SELECTION_EVENT, handleSelection);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(DNA_PRESET_SELECTION_EVENT, handleSelection);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadPresets, patchInput, presets, searchParams, setSearchParams]);

  useEffect(() => () => {
    uploadAttemptRef.current += 1;
    referenceLinkBatchRef.current += 1;
    if (tusUploadRef.current) void tusUploadRef.current.abort();
    localReferenceUploadRef.current?.abort();
  }, []);

  // Poll reference_videos status when processing
  useEffect(() => {
    if (uploadStatus !== "processing" || !inputData.reference_video_id) return;
    let cancelled = false;

    const poll = async () => {
      const { data, error } = await supabase
        .from("reference_videos")
        .select("*")
        .eq("id", inputData.reference_video_id)
        .single();
      if (cancelled) return;
      if (error) {
        console.warn("Falha temporária ao consultar vídeo de referência:", error.message);
        return;
      }
      if (!data) return;

      setReferenceVideo(data);
      if (data.status === "awaiting_visual") {
        setUploadStatus("processing");
        patchInput({ reference_video_ready: false });
        void dispatchAwaitingVisualPhase(data);
      } else if (data.status === "ready") {
        setUploadStatus("ready");
        setUploadProgress(100);
        patchInput({ reference_video_ready: true });
        const segCount = Array.isArray(data.transcription_segments) ? data.transcription_segments.length : 0;
        const frameCount = Array.isArray(data.frames) ? data.frames.length : 0;
        toast.success(`Vídeo processado: ${segCount} segmentos de transcrição, ${frameCount} frames visuais`);
        clearInterval(interval);
      } else if (data.status === "error") {
        setUploadStatus("error");
        setUploadError(data.error_message ?? "Erro no processamento");
        patchInput({ reference_video_ready: false });
        clearInterval(interval);
      }
    };

    const interval = setInterval(() => void poll(), 3000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dispatchAwaitingVisualPhase, patchInput, uploadStatus, inputData.reference_video_id]);

  function uploadWithTus(file: File, initialStoragePath: string, attempt: number): Promise<string> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const accessToken = session?.access_token;
    if (!supabaseUrl || !publishableKey) throw new Error("Supabase Storage não está configurado.");
    if (!accessToken || !user?.id) throw new Error("Sua sessão expirou. Entre novamente para enviar o vídeo.");

    let resolvedStoragePath = initialStoragePath;
    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${accessToken}`,
          apikey: publishableKey,
          // The object name is a content-derived, user-scoped idempotency key.
          // Upsert lets a retry repair a completed-but-not-dispatched upload
          // instead of failing forever with Storage HTTP 409.
          "x-upsert": "true",
        },
        metadata: {
          bucketName: REFERENCE_VIDEO_BUCKET,
          objectName: initialStoragePath,
          contentType: safeVideoContentType(file),
          cacheControl: "3600",
        },
        chunkSize: TUS_CHUNK_SIZE,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        onError: (error) => reject(error),
        onProgress: (uploaded, total) => {
          if (attempt !== uploadAttemptRef.current) return;
          setUploadProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0);
        },
        onSuccess: () => resolve(resolvedStoragePath),
      });
      tusUploadRef.current = upload;

      void upload.findPreviousUploads()
        .then((previousUploads) => {
          const resumable = previousUploads.find((previous) => {
            const objectName = previous.metadata?.objectName;
            return previous.metadata?.bucketName === REFERENCE_VIDEO_BUCKET
              && objectName === initialStoragePath;
          });
          if (resumable) {
            resolvedStoragePath = resumable.metadata.objectName;
            upload.resumeFromPreviousUpload(resumable);
          }
        })
        .catch((error) => console.warn("Não foi possível localizar upload resumível:", error))
        .finally(() => {
          if (attempt !== uploadAttemptRef.current) {
            reject(new DOMException("Upload cancelado", "AbortError"));
            return;
          }
          upload.start();
        });
    });
  }

  function uploadWithLocalNormalizer(
    file: File,
    referenceVideoId: string,
    storagePath: string,
    attempt: number,
  ): Promise<LocalReferenceUploadResponse> {
    const accessToken = session?.access_token;
    if (!accessToken || !user?.id) throw new Error("Sua sessão expirou. Entre novamente para enviar o vídeo.");

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      localReferenceUploadRef.current = request;
      request.open("POST", "/api/local-reference-upload");
      request.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      request.setRequestHeader("Content-Type", safeVideoContentType(file));
      request.setRequestHeader("X-Reference-Video-Id", referenceVideoId);
      request.setRequestHeader("X-Storage-Path", storagePath);
      request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      request.upload.onprogress = (event) => {
        if (attempt !== uploadAttemptRef.current || !event.lengthComputable) return;
        setUploadProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      };
      request.onerror = () => {
        const failure = new Error("Não foi possível conectar ao normalizador local de vídeos.") as Error & { status?: number };
        failure.status = request.status || undefined;
        reject(failure);
      };
      request.onabort = () => reject(new DOMException("Upload cancelado", "AbortError"));
      request.onload = () => {
        let response: LocalReferenceUploadResponse = {};
        try {
          response = JSON.parse(request.responseText || "{}") as LocalReferenceUploadResponse;
        } catch {
          response = {};
        }
        if (request.status < 200 || request.status >= 300 || response.error) {
          const endpointMissing = request.status === 404 || request.status === 405;
          const failure = new Error(
            response.error
              || (endpointMissing
                ? "Arquivos acima de 45 MB precisam do normalizador local ativo. Abra o app pelo endereço localhost e tente novamente."
                : `O normalizador local falhou (HTTP ${request.status}).`),
          ) as Error & { status?: number };
          failure.status = request.status;
          reject(failure);
          return;
        }
        resolve(response);
      };
      request.onloadend = () => {
        if (localReferenceUploadRef.current === request) localReferenceUploadRef.current = null;
      };

      // Raw File bytes let the local middleware stream directly to disk
      // without buffering a 300 MB multipart body in memory.
      request.send(file);
    });
  }

  async function handleVideoUpload(file: File) {
    const validationError = referenceVideoValidationError(file);
    if (validationError) {
      toast.error(validationError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const requiresLocalNormalization = file.size > LOCAL_REFERENCE_UPLOAD_THRESHOLD_BYTES;
    const independentDuration = await readIndependentVideoDuration(file);

    const attempt = uploadAttemptRef.current + 1;
    uploadAttemptRef.current = attempt;
    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadError(null);
    setUsesLocalNormalizer(requiresLocalNormalization);
    setReferenceVideo(null);
    patchInput({ reference_video_id: undefined, reference_video_ready: false });

    let reservedReferenceId: string | null = null;
    let reservedStoragePath: string | null = null;
    let uploadCompleted = false;
    let shouldDispatchAudioPhase = false;
    try {
      if (!user?.id) throw new Error("Faça login novamente para enviar o vídeo.");
      const initialPath = await durableReferenceUploadPath(user.id, file, requiresLocalNormalization ? "mp4" : undefined);
      reservedStoragePath = initialPath;
      const { data: existingReferenceRow, error: lookupError } = await supabase.from("reference_videos")
        .select("*").eq("user_id", user.id).eq("storage_bucket", REFERENCE_VIDEO_BUCKET)
        .eq("storage_path", initialPath).maybeSingle();
      let referenceRow = existingReferenceRow;
      if (lookupError) throw lookupError;
      if (!referenceRow) {
        const created = await supabase.from("reference_videos").insert({
          file_name: file.name,
          storage_path: initialPath,
          storage_bucket: REFERENCE_VIDEO_BUCKET,
          status: "uploading",
          user_id: user.id,
          ...(independentDuration ? { duration_seconds: independentDuration } : {}),
        }).select("*").maybeSingle();
        referenceRow = created.data;
        if (created.error || !referenceRow) {
          const winner = await supabase.from("reference_videos").select("*")
            .eq("user_id", user.id).eq("storage_bucket", REFERENCE_VIDEO_BUCKET)
            .eq("storage_path", initialPath).maybeSingle();
          referenceRow = winner.data;
          if (!referenceRow) throw new Error(created.error?.message || "Não foi possível reservar o upload.");
        }
      }
      if (independentDuration) {
        const { data: durationUpdated, error: durationUpdateError } = await supabase
          .from("reference_videos")
          .update({ duration_seconds: independentDuration })
          .eq("id", referenceRow.id)
          .eq("user_id", user.id)
          .select("*")
          .maybeSingle();
        if (durationUpdateError) console.warn("Could not save independent video duration:", durationUpdateError.message);
        if (durationUpdated) referenceRow = durationUpdated;
      }
      reservedReferenceId = referenceRow.id;
      setReferenceVideo(referenceRow);
      patchInput({ reference_video_id: referenceRow.id, reference_video_ready: referenceRow.status === "ready" });
      if (referenceRow.status === "ready") {
        setUploadStatus("ready");
        setUploadProgress(100);
        return;
      }

      if (ACTIVE_REFERENCE_PROCESSING_STATUSES.has(referenceRow.status)) {
        setUploadStatus("processing");
        setUploadProgress(100);
        shouldDispatchAudioPhase = referenceRow.status === "pending";
      } else {
        referenceVisualPhaseDispatchRef.current.delete(`${referenceRow.id}:visual`);
        await supabase.from("reference_videos").update({ status: "uploading", error_message: null })
          .eq("id", referenceRow.id).eq("user_id", user.id);
        if (requiresLocalNormalization) {
          const normalized = await uploadWithLocalNormalizer(file, referenceRow.id, initialPath, attempt);
          uploadCompleted = true;
          if (attempt !== uploadAttemptRef.current) return;
          if (normalized.reference_video_id !== referenceRow.id || normalized.storage_path !== initialPath) {
            throw new Error("O normalizador local retornou uma referência diferente da reserva autenticada.");
          }
          const normalizedSize = Number(normalized.size_bytes);
          if (!Number.isFinite(normalizedSize) || normalizedSize <= 0 || normalizedSize > LOCAL_REFERENCE_UPLOAD_THRESHOLD_BYTES) {
            throw new Error("O normalizador local não conseguiu deixar o vídeo dentro do limite seguro de 45 MB.");
          }
          const durableRow = normalized.reference_video
            ?? (await supabase.from("reference_videos").select("*").eq("id", referenceRow.id).maybeSingle()).data;
          if (!durableRow
            || durableRow.user_id !== user.id
            || durableRow.storage_bucket !== REFERENCE_VIDEO_BUCKET
            || durableRow.storage_path !== initialPath) {
            throw new Error("O vídeo normalizado não foi confirmado no banco de dados.");
          }
          referenceRow = durableRow;
        } else {
          const storagePath = await uploadWithTus(file, initialPath, attempt);
          uploadCompleted = true;
          if (storagePath !== initialPath) throw new Error("O upload retomável resolveu um caminho inesperado.");
          if (attempt !== uploadAttemptRef.current) return;

          const updated = await supabase.from("reference_videos").update({
            file_name: file.name,
            storage_path: storagePath,
            storage_bucket: REFERENCE_VIDEO_BUCKET,
            status: REFERENCE_VIDEO_INITIAL_STATUS,
            error_message: null,
            ...(independentDuration ? { duration_seconds: independentDuration } : {}),
          }).eq("id", referenceRow.id).eq("user_id", user.id).select("*").maybeSingle();
          referenceRow = updated.data ?? { ...referenceRow, status: REFERENCE_VIDEO_INITIAL_STATUS };
          if (updated.error) console.warn("Upload concluído; o processador reconciliará a reserva:", updated.error.message);
        }
        setReferenceVideo(referenceRow);
        if (referenceRow.status === "ready") {
          setUploadStatus("ready");
          setUploadProgress(100);
          patchInput({ reference_video_id: referenceRow.id, reference_video_ready: true });
          return;
        }
        if (referenceRow.status === "error") {
          throw new Error(referenceRow.error_message || "O vídeo normalizado não pôde ser processado.");
        }
        setUploadStatus("processing");
        setUploadProgress(100);
        shouldDispatchAudioPhase = referenceRow.status === REFERENCE_VIDEO_INITIAL_STATUS;
      }
      if (attempt !== uploadAttemptRef.current) return;

      if (referenceRow.status === "awaiting_visual") {
        void dispatchAwaitingVisualPhase(referenceRow);
        return;
      }
      if (!shouldDispatchAudioPhase) return;

      // The row is created before invoking the processor so polling survives a
      // long-running function or a client-side timeout.
      void supabase.functions.invoke("process-reference-video", {
        body: {
          reference_video_id: referenceRow.id,
          storage_path: referenceRow.storage_path,
          file_name: referenceRow.file_name,
          user_id: user.id,
          ...(Number.isFinite(Number(referenceRow.duration_seconds)) && Number(referenceRow.duration_seconds) > 0
            ? { video_duration: Number(referenceRow.duration_seconds) }
            : {}),
        },
      }).then(async ({ data: processed, error }) => {
        if (attempt !== uploadAttemptRef.current) return;
        if (!error) {
          if (processed?.status === "awaiting_visual") {
            const { data: latest } = await supabase
              .from("reference_videos")
              .select("*")
              .eq("id", referenceRow.id)
              .maybeSingle();
            if (latest?.status === "awaiting_visual") void dispatchAwaitingVisualPhase(latest);
          }
          return;
        }
        const { data: latest } = await supabase
          .from("reference_videos")
          .select("status, error_message")
          .eq("id", referenceRow.id)
          .maybeSingle();
        if (attempt !== uploadAttemptRef.current) return;
        if (latest?.status === "error") {
          setUploadStatus("error");
          setUploadError(latest.error_message || error.message);
          patchInput({ reference_video_ready: false });
        } else {
          setUploadError("O processamento continua no servidor; esta página seguirá acompanhando o status.");
          console.warn("A chamada de processamento perdeu a conexão; polling mantido:", error.message);
        }
      }).catch((error) => {
        if (attempt !== uploadAttemptRef.current) return;
        setUploadError("O processamento continua no servidor; aguardando atualização de status.");
        console.warn("Falha de conexão ao iniciar processamento; polling mantido:", error);
      });
    } catch (err: unknown) {
      if (attempt !== uploadAttemptRef.current) return;
      const message = readableReferenceUploadError(err);
      if (reservedReferenceId) {
        await supabase.from("reference_videos").update({ status: "error", error_message: message })
          .eq("id", reservedReferenceId).eq("user_id", user?.id ?? "");
      } else if (uploadCompleted && reservedStoragePath) {
        // Defensive only: reservation happens before TUS, so completed bytes
        // should never be rowless. Remove only when no durable owner exists.
        await supabase.storage.from(REFERENCE_VIDEO_BUCKET).remove([reservedStoragePath]);
      }
      setUploadStatus("error");
      setUploadError(message);
      patchInput({ reference_video_ready: false });
      toast.error(message);
    }
  }

  const patchReferenceQueueEntry = useCallback((
    clientId: string,
    patch: Partial<ReferenceLinkQueueEntry>,
  ) => {
    setReferenceLinkQueue((entries) => updateReferenceQueueEntry(entries, clientId, patch));
  }, []);

  const selectReferenceQueueEntry = useCallback((entry: ReferenceLinkQueueEntry) => {
    if (!entry.referenceVideoId) return;
    setReferenceVideo(entry.referenceVideo ?? null);
    patchInput({
      reference_video_id: entry.referenceVideoId,
      reference_video_ready: entry.status === "ready",
    });
  }, [patchInput]);

  const analyzeReferenceRow = useCallback(async (
    referenceRow: ReferenceVideoRow,
    updateIfMounted: (patch: Partial<ReferenceLinkQueueEntry>) => void,
    force = false,
  ): Promise<string> => {
    if (!user?.id || !referenceRow.storage_path) throw new Error("A referência ainda não possui um arquivo processável.");
    if (referenceRow.user_id !== user.id || !referenceRow.storage_path.startsWith(`reference/${user.id}/`)) {
      throw new Error("A referência não pertence à sua sessão.");
    }
    if (referenceRow.storage_bucket !== REFERENCE_VIDEO_BUCKET && referenceRow.storage_bucket !== "videos") {
      throw new Error("A referência está em um bucket desconhecido.");
    }

    const referenceVideoId = referenceRow.id;
    updateIfMounted({ status: referenceRow.status === "ready" ? "ready" : "processing", referenceVideoId, referenceVideo: referenceRow, error: undefined });
    if (!inputDataRef.current.reference_video_id) {
      setReferenceVideo(referenceRow);
      patchInput({ reference_video_id: referenceVideoId, reference_video_ready: referenceRow.status === "ready" });
    }
    if (referenceRow.status === "ready" && !force) return referenceVideoId;
    if (!force && ["processing", "processing_audio", "processing_visual"].includes(referenceRow.status)) {
      updateIfMounted({ status: "processing", referenceVideo: referenceRow, error: undefined });
      return referenceVideoId;
    }
    if (force) referenceVisualPhaseDispatchRef.current.delete(`${referenceVideoId}:visual`);

    if (referenceRow.status === "awaiting_visual" && !force) {
      await dispatchAwaitingVisualPhase(referenceRow);
      const { data: latestVisual } = await supabase.from("reference_videos").select("*").eq("id", referenceVideoId).maybeSingle();
      if (latestVisual?.status === "ready") {
        updateIfMounted({ status: "ready", referenceVideo: latestVisual, error: undefined });
        if (inputDataRef.current.reference_video_id === referenceVideoId) {
          setReferenceVideo(latestVisual);
          patchInput({ reference_video_id: referenceVideoId, reference_video_ready: true });
        }
      } else if (latestVisual?.status === "error") {
        updateIfMounted({
          status: "error",
          referenceVideo: latestVisual,
          error: latestVisual.error_message || "Falha na analise visual.",
        });
      } else {
        updateIfMounted({ status: "processing", referenceVideo: latestVisual ?? referenceRow, error: undefined });
      }
      return referenceVideoId;
    }

    const { data: processed, error: processError } = await supabase.functions.invoke("process-reference-video", {
      body: {
        reference_video_id: referenceVideoId,
        storage_path: referenceRow.storage_path,
        file_name: referenceRow.file_name,
        user_id: user.id,
        force,
        ...(Number.isFinite(Number(referenceRow.duration_seconds)) && Number(referenceRow.duration_seconds) > 0
          ? { video_duration: Number(referenceRow.duration_seconds) }
        : {}),
      },
    });
    let { data: latest } = await supabase.from("reference_videos").select("*").eq("id", referenceVideoId).maybeSingle();
    if (latest?.status === "awaiting_visual") {
      await dispatchAwaitingVisualPhase(latest);
      const refreshed = await supabase.from("reference_videos").select("*").eq("id", referenceVideoId).maybeSingle();
      latest = refreshed.data ?? latest;
    }
    if (latest?.status === "ready") {
      updateIfMounted({ status: "ready", referenceVideo: latest, error: undefined });
      if (inputDataRef.current.reference_video_id === referenceVideoId) {
        setReferenceVideo(latest);
        patchInput({ reference_video_id: referenceVideoId, reference_video_ready: true });
      }
      return referenceVideoId;
    }
    if (latest?.status === "error") {
      const message = latest.error_message || processed?.error || processError?.message || "Falha na análise visual.";
      updateIfMounted({ status: "error", referenceVideo: latest, error: message });
      return referenceVideoId;
    }
    updateIfMounted({
      status: "processing",
      referenceVideo: latest ?? referenceRow,
      error: processError || processed?.error
        ? "A análise continua no servidor; acompanhando o resultado automaticamente."
        : undefined,
    });
    return referenceVideoId;
  }, [dispatchAwaitingVisualPhase, patchInput, user?.id]);

  const createAndAnalyzeReference = useCallback(async (
    storagePath: string,
    fileName: string,
    updateIfMounted: (patch: Partial<ReferenceLinkQueueEntry>) => void,
  ): Promise<string> => {
    if (!user?.id) throw new Error("Sua sessão expirou. Entre novamente para analisar o vídeo.");
    let { data: referenceRow } = await supabase
      .from("reference_videos")
      .select("*")
      .eq("user_id", user.id)
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (!referenceRow) {
      const created = await supabase.from("reference_videos").insert({
        file_name: fileName,
        storage_path: storagePath,
        storage_bucket: REFERENCE_VIDEO_BUCKET,
        status: REFERENCE_VIDEO_INITIAL_STATUS,
        user_id: user.id,
      }).select("*").maybeSingle();
      referenceRow = created.data;
      if (created.error || !referenceRow?.id) {
        // A lost response can hide a committed INSERT. Reconcile by the unique
        // storage path before any rollback so no row points to a removed file.
        const reconciled = await supabase.from("reference_videos").select("*")
          .eq("user_id", user.id).eq("storage_path", storagePath).maybeSingle();
        referenceRow = reconciled.data;
        if (!referenceRow?.id) throw new Error(created.error?.message || "Não foi possível criar a análise de referência.");
      }
    }
    return analyzeReferenceRow(referenceRow, updateIfMounted);
  }, [analyzeReferenceRow, user?.id]);

  const downloadReferenceWithLocalYtDlp = useCallback(async (
    item: BulkVideoLinkItem,
  ): Promise<LocalReferenceDownload> => {
    if (!user?.id || !session?.access_token) throw new Error("Sua sessão expirou. Entre novamente.");
    return withReferenceRetry(async () => {
      const response = await fetch("/api/local-ytdlp", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url: item.source.url,
          canonical_url: item.canonicalUrl,
          idempotency_key: item.idempotencyKey,
        }),
      });
      const downloaded = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = new Error(downloaded?.error || `O yt-dlp local falhou (HTTP ${response.status}).`) as Error & { status?: number; retryable?: boolean };
        failure.status = response.status;
        failure.retryable = downloaded?.retryable === true || response.status === 429 || response.status >= 500;
        throw failure;
      }
      const storagePath = typeof downloaded?.storage_path === "string" ? downloaded.storage_path : "";
      const fileName = typeof downloaded?.file_name === "string"
        ? downloaded.file_name.replace(/[^A-Za-z0-9._-]/g, "_")
        : referenceLinkFileName(item.canonicalUrl);
      const sizeBytes = Number(downloaded?.size_bytes);
      const referenceVideoId = typeof downloaded?.reference_video_id === "string" ? downloaded.reference_video_id : undefined;
      if (storagePath && !storagePath.startsWith(`reference/${user.id}/`)) throw new Error("O yt-dlp local não retornou um caminho seguro.");
      if (!storagePath && !referenceVideoId) throw new Error("O yt-dlp local não retornou arquivo nem referência persistida.");
      if ((!referenceVideoId || Number.isFinite(sizeBytes)) && (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_REFERENCE_VIDEO_BYTES)) {
        throw new Error(sizeBytes > MAX_REFERENCE_VIDEO_BYTES ? "O vídeo excede o limite de 300 MB." : "O yt-dlp retornou um arquivo vazio.");
      }
      return {
        storagePath,
        fileName,
        referenceVideoId,
        referenceVideo: downloaded?.reference_video && typeof downloaded.reference_video === "object"
          ? downloaded.reference_video as ReferenceVideoRow
          : undefined,
      };
    });
  }, [session?.access_token, user?.id]);

  const importReferenceWithEdge = useCallback(async (
    item: BulkVideoLinkItem,
  ): Promise<ImportReferenceResponse> => {
    return withReferenceRetry(async () => {
      const { data: rawData, error } = await supabase.functions.invoke("import-reference-video", {
        body: { url: item.source.url },
      });
      const data = rawData && typeof rawData === "object"
        ? rawData as ImportReferenceResponse
        : null;
      if (error || data?.error) {
        const contextStatus = functionErrorHttpStatus(error);
        const failure = new Error(data?.error || error?.message || "O vídeo não pôde ser importado.") as Error & { status?: number; retryable?: boolean };
        failure.status = contextStatus;
        failure.retryable = data?.retryable === true || failure.status === 429 || Number(failure.status) >= 500;
        throw failure;
      }
      return data ?? {};
    });
  }, []);

  const processReferenceLink = useCallback(async function processReferenceLink(
    item: BulkVideoLinkItem,
    clientId: string,
    batchAttempt: number,
    knownReferenceVideoId?: string,
  ) {
    let downloadedStoragePath: string | null = null;
    let referenceVideoId: string | null = knownReferenceVideoId ?? null;
    const updateIfMounted = (patch: Partial<ReferenceLinkQueueEntry>) => {
      if (batchAttempt === referenceLinkBatchRef.current) patchReferenceQueueEntry(clientId, patch);
    };

    try {
      if (!user?.id) throw new Error("Sua sessão expirou. Entre novamente para adicionar os links.");
      if (referenceVideoId) {
        const { data: existing } = await supabase.from("reference_videos").select("*").eq("id", referenceVideoId).maybeSingle();
        if (existing?.storage_path) {
          await analyzeReferenceRow(existing, updateIfMounted, existing.status === "error");
          return;
        }
        const updatedAt = Date.parse(existing?.updated_at ?? "");
        const activeServerLease = [
          "uploading",
          "pending",
          "processing",
          "processing_audio",
          "awaiting_visual",
          "processing_visual",
        ].includes(existing?.status ?? "")
          && Number.isFinite(updatedAt)
          && Date.now() - updatedAt < 20 * 60_000;
        if (activeServerLease) {
          updateIfMounted({ status: existing.status === "uploading" ? "downloading" : "processing", referenceVideo: existing });
          return;
        }
      }
      updateIfMounted({ status: "downloading", error: undefined });

      if (import.meta.env.DEV) {
        const localDownload = await downloadReferenceWithLocalYtDlp(item);
        downloadedStoragePath = localDownload.storagePath;
        referenceVideoId = localDownload.referenceVideoId ?? null;
        if (referenceVideoId) {
          const atomicRow = localDownload.referenceVideo
            ?? (await supabase.from("reference_videos").select("*").eq("id", referenceVideoId).maybeSingle()).data;
          if (!atomicRow) throw new Error("O download local não retornou uma referência persistida.");
          if (atomicRow.storage_path) await analyzeReferenceRow(atomicRow, updateIfMounted);
          else updateIfMounted({ status: "downloading", referenceVideoId, referenceVideo: atomicRow });
        } else {
          // Compatibility only for a pre-hardening local middleware response.
          referenceVideoId = await createAndAnalyzeReference(localDownload.storagePath, localDownload.fileName, updateIfMounted);
        }
        return;
      }

      const imported = await importReferenceWithEdge(item);
      referenceVideoId = typeof imported?.reference_video_id === "string" ? imported.reference_video_id : null;
      if (!referenceVideoId) throw new Error("A importação terminou sem criar a referência.");
      const { data: referenceRow } = await supabase.from("reference_videos").select("*").eq("id", referenceVideoId).maybeSingle();
      if (!referenceRow) throw new Error("A referência importada não foi encontrada.");
      updateIfMounted({ referenceVideoId, referenceVideo: referenceRow });
      if (!referenceRow.storage_path) {
        updateIfMounted({ status: referenceRow.status === "error" ? "error" : "downloading", error: referenceRow.error_message ?? undefined });
        return;
      }
      await analyzeReferenceRow(referenceRow, updateIfMounted, referenceRow.status === "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao processar o link.";
      // If an INSERT response was lost, discover the row before deciding if a
      // private object is orphaned. Never remove bytes referenced by a row.
      if (!referenceVideoId && downloadedStoragePath) {
        const { data: reconciled } = await supabase.from("reference_videos").select("*")
          .eq("user_id", user?.id ?? "").eq("storage_path", downloadedStoragePath).maybeSingle();
        referenceVideoId = reconciled?.id ?? null;
      }
      updateIfMounted({ status: "error", error: message, referenceVideoId: referenceVideoId ?? undefined });
      if (!referenceVideoId && downloadedStoragePath) {
        await supabase.storage.from(REFERENCE_VIDEO_BUCKET).remove([downloadedStoragePath]);
      }
      if (referenceVideoId && inputDataRef.current.reference_video_id === referenceVideoId) patchInput({ reference_video_ready: false });
    }
  }, [
    analyzeReferenceRow,
    createAndAnalyzeReference,
    downloadReferenceWithLocalYtDlp,
    importReferenceWithEdge,
    patchInput,
    patchReferenceQueueEntry,
    user?.id,
  ]);

  useEffect(() => {
    referenceLinkBatchRef.current += 1;
    referenceQueueResumeRef.current = null;
    if (!user?.id) {
      setReferenceLinkQueue([]);
      setReferenceQueueRestoredFor(null);
      setReferenceLinksRunning(false);
      return;
    }
    let restored: ReferenceLinkQueueEntry[] = [];
    try {
      restored = restoreReferenceLinkQueue(localStorage.getItem(referenceLinkQueueStorageKey(user.id)));
    } catch (error) {
      console.warn("Não foi possível restaurar a fila de referências:", error);
    }
    setReferenceLinkQueue(restored);
    if (restored.length > 0) setReferenceInputMode("links");
    setReferenceQueueRestoredFor(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || referenceQueueRestoredFor !== user.id) return;
    try {
      localStorage.setItem(referenceLinkQueueStorageKey(user.id), serializeReferenceLinkQueue(referenceLinkQueue));
    } catch (error) {
      console.warn("Não foi possível salvar a fila de referências no navegador:", error);
    }
  }, [referenceLinkQueue, referenceQueueRestoredFor, user?.id]);

  useEffect(() => {
    if (!user?.id || referenceQueueRestoredFor !== user.id || referenceQueueResumeRef.current === user.id) return;
    referenceQueueResumeRef.current = user.id;
    const resumable = referenceQueueEntriesToResume(referenceLinkQueue);
    if (resumable.length === 0) return;
    const batchAttempt = referenceLinkBatchRef.current + 1;
    referenceLinkBatchRef.current = batchAttempt;
    setReferenceLinksRunning(true);
    void mapWithConcurrency(resumable, REFERENCE_LINK_CONCURRENCY, async (entry) => {
      const parsed = parseBulkVideoLinks(entry.sourceUrl);
      const item = parsed.accepted[0];
      if (!item) {
        patchReferenceQueueEntry(entry.clientId, { status: "error", error: parsed.rejected[0]?.message || "Link salvo inválido." });
        return;
      }
      await processReferenceLink(item, entry.clientId, batchAttempt, entry.referenceVideoId);
    }).finally(() => {
      if (batchAttempt === referenceLinkBatchRef.current) setReferenceLinksRunning(false);
    });
  }, [
    patchReferenceQueueEntry,
    processReferenceLink,
    referenceLinkQueue,
    referenceQueueRestoredFor,
    user?.id,
  ]);

  useEffect(() => {
    if (!user?.id || referenceQueueRestoredFor !== user.id) return;
    const poll = async () => {
      const active = referenceQueueRef.current.filter((entry) =>
        entry.referenceVideoId && (entry.status === "processing" || entry.status === "downloading"),
      );
      for (let offset = 0; offset < active.length; offset += 50) {
        const chunk = active.slice(offset, offset + 50);
        const ids = chunk.map((entry) => entry.referenceVideoId!);
        const { data } = await supabase.from("reference_videos").select("*").in("id", ids);
        for (const row of data ?? []) {
          const entry = chunk.find((candidate) => candidate.referenceVideoId === row.id);
          if (!entry) continue;
          const updatedAt = Date.parse(row.updated_at ?? "");
          const staleWithoutFile = !row.storage_path
            && ["uploading", "pending", "processing", "processing_audio", "awaiting_visual", "processing_visual"].includes(row.status)
            && Number.isFinite(updatedAt)
            && Date.now() - updatedAt >= 20 * 60_000;
          if (staleWithoutFile && !referenceStaleRecoveryRef.current.has(row.id)) {
            const parsed = parseBulkVideoLinks(entry.sourceUrl);
            const item = parsed.accepted[0];
            if (item) {
              referenceStaleRecoveryRef.current.add(row.id);
              void processReferenceLink(item, entry.clientId, referenceLinkBatchRef.current, row.id)
                .finally(() => referenceStaleRecoveryRef.current.delete(row.id));
            }
          }
          if (row.status === "ready") {
            patchReferenceQueueEntry(entry.clientId, { status: "ready", referenceVideo: row, error: undefined });
            if (inputDataRef.current.reference_video_id === row.id) {
              setReferenceVideo(row);
              patchInput({ reference_video_id: row.id, reference_video_ready: true });
            }
          } else if (row.status === "error") {
            patchReferenceQueueEntry(entry.clientId, { status: "error", referenceVideo: row, error: row.error_message ?? "Falha na análise." });
          } else {
            patchReferenceQueueEntry(entry.clientId, {
              status: row.status === "uploading" ? "downloading" : "processing",
              referenceVideo: row,
            });
            if (row.status === "awaiting_visual") void dispatchAwaitingVisualPhase(row);
          }
        }
      }
    };
    const interval = setInterval(() => void poll(), 4_000);
    void poll();
    return () => clearInterval(interval);
  }, [dispatchAwaitingVisualPhase, patchInput, patchReferenceQueueEntry, processReferenceLink, referenceQueueRestoredFor, user?.id]);

  async function handleAddReferenceLinks() {
    const parsed = parseBulkVideoLinks(referenceLinksText);
    if (parsed.inputCount === 0) {
      toast.error("Cole pelo menos um link de vídeo, um por linha.");
      return;
    }
    if (parsed.accepted.length === 0) {
      toast.error(parsed.rejected[0]?.message || "Nenhum link de vídeo válido foi encontrado.");
      return;
    }

    const existingKeys = new Set(referenceLinkQueue.map((entry) => entry.idempotencyKey));
    const accepted = parsed.accepted.filter((item) => !existingKeys.has(item.idempotencyKey));
    if (accepted.length === 0) {
      toast.info("Todos esses vídeos já estão na fila de referências.");
      return;
    }

    const queued = accepted.map((item): ReferenceLinkQueueEntry => ({
      clientId: crypto.randomUUID(),
      rawUrl: item.rawUrl,
      sourceUrl: item.source.url,
      canonicalUrl: item.canonicalUrl,
      idempotencyKey: item.idempotencyKey,
      status: "queued",
    }));
    const clientIdByKey = new Map(queued.map((entry) => [entry.idempotencyKey, entry.clientId]));
    setReferenceLinkQueue((entries) => [...entries, ...queued]);
    setReferenceLinksText(parsed.rejected.map((issue) => issue.rawUrl).join("\n"));

    const ignoredCount = parsed.duplicates.length + (parsed.accepted.length - accepted.length);
    toast.info(
      `${accepted.length} vídeo${accepted.length === 1 ? "" : "s"} adicionado${accepted.length === 1 ? "" : "s"} à fila`
      + (ignoredCount ? ` • ${ignoredCount} repetido${ignoredCount === 1 ? "" : "s"}` : "")
      + (parsed.rejected.length ? ` • ${parsed.rejected.length} link${parsed.rejected.length === 1 ? "" : "s"} para corrigir` : ""),
    );

    const batchAttempt = referenceLinkBatchRef.current + 1;
    referenceLinkBatchRef.current = batchAttempt;
    setReferenceLinksRunning(true);
    try {
      for (let offset = 0; offset < accepted.length; offset += BULK_VIDEO_LINK_CHUNK_SIZE) {
        const chunk = accepted.slice(offset, offset + BULK_VIDEO_LINK_CHUNK_SIZE);
        await mapWithConcurrency(chunk, REFERENCE_LINK_CONCURRENCY, async (item) => {
          const clientId = clientIdByKey.get(item.idempotencyKey);
          if (clientId) await processReferenceLink(item, clientId, batchAttempt);
        });
      }
    } finally {
      if (batchAttempt === referenceLinkBatchRef.current) setReferenceLinksRunning(false);
    }
  }

  function removeReferenceQueueEntry(entry: ReferenceLinkQueueEntry) {
    setReferenceLinkQueue((entries) => entries.filter((candidate) => candidate.clientId !== entry.clientId));
    if (entry.referenceVideoId && inputDataRef.current.reference_video_id === entry.referenceVideoId) {
      setReferenceVideo(null);
      patchInput({ reference_video_id: undefined, reference_video_ready: undefined });
    }
  }

  function handleReset() {
    uploadAttemptRef.current += 1;
    if (tusUploadRef.current) void tusUploadRef.current.abort();
    tusUploadRef.current = null;
    localReferenceUploadRef.current?.abort();
    localReferenceUploadRef.current = null;
    setUploadStatus("idle");
    setUploadProgress(0);
    setUploadError(null);
    setUsesLocalNormalizer(false);
    setReferenceVideo(null);
    patchInput({ reference_video_id: undefined, reference_video_ready: undefined });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Configuração de Entrada</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "video" && (
          <div className="space-y-3">
            <Label>Vídeo de Referência</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={referenceInputMode === "upload" ? "default" : "outline"}
                className="gap-2"
                onClick={() => setReferenceInputMode("upload")}
              >
                <Upload className="h-4 w-4" /> Enviar arquivo
              </Button>
              <Button
                type="button"
                variant={referenceInputMode === "links" ? "default" : "outline"}
                className="gap-2"
                onClick={() => setReferenceInputMode("links")}
              >
                <Link2 className="h-4 w-4" /> Colar vários links
              </Button>
            </div>

            {referenceInputMode === "upload" && uploadStatus === "idle" && (
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium text-foreground">Clique para enviar um vídeo</p>
                <p className="text-xs text-muted-foreground mt-1">
                  MP4, MOV, WebM, AVI — até 300 MB
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Até 45 MB: upload retomável. De 45 a 300 MB: preparação local automática antes do envio.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Arquivos acima de 45 MB precisam que este app esteja aberto pelo localhost.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  O sistema transcreverá o áudio e analisará os frames visuais para gerar um roteiro sincronizado.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleVideoUpload(file);
                  }}
                />
              </div>
            )}

            {referenceInputMode === "upload" && uploadStatus === "uploading" && (
              <div className="border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm font-medium">
                      {usesLocalNormalizer ? "Enviando e preparando o vídeo grande" : "Enviando vídeo"}... {uploadProgress}%
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleReset}>Cancelar</Button>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {usesLocalNormalizer
                    ? "Após o envio, o app reduz o arquivo localmente sem cortar o conteúdo. Você pode cancelar enquanto aguarda."
                    : "Se a conexão cair, o envio poderá continuar do último bloco concluído."}
                </p>
              </div>
            )}

            {referenceInputMode === "upload" && uploadStatus === "processing" && (
              <div className="border border-primary/30 bg-primary/5 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm font-medium text-primary">Processando vídeo...</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {referenceProcessingMessage(referenceVideo?.status)}
                </p>
                {uploadError && <p className="text-xs text-amber-600 dark:text-amber-400">{uploadError}</p>}
              </div>
            )}

            {referenceInputMode === "upload" && uploadStatus === "ready" && referenceVideo && (
              <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">
                      Vídeo processado
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleReset}>
                    Trocar vídeo
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-background rounded p-2">
                    <p className="text-muted-foreground">Arquivo</p>
                    <p className="font-medium truncate">{referenceVideo.file_name}</p>
                  </div>
                  <div className="bg-background rounded p-2">
                    <p className="text-muted-foreground">Transcrição</p>
                    <p className="font-medium">
                      {Array.isArray(referenceVideo.transcription_segments) ? referenceVideo.transcription_segments.length : 0} segmentos
                    </p>
                  </div>
                  <div className="bg-background rounded p-2">
                    <p className="text-muted-foreground">Frames Visuais</p>
                    <p className="font-medium">
                      {Array.isArray(referenceVideo.frames) ? referenceVideo.frames.length : 0} momentos
                    </p>
                  </div>
                </div>
                {referenceVideo.duration_seconds && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Film className="h-3 w-3" />
                    <span>Duração estimada: {Math.round(referenceVideo.duration_seconds)}s</span>
                  </div>
                )}
              </div>
            )}

            {referenceInputMode === "upload" && uploadStatus === "error" && (
              <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">Erro no processamento</span>
                </div>
                <p className="text-xs text-muted-foreground">{uploadError}</p>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  Tentar novamente
                </Button>
              </div>
            )}

            {referenceInputMode === "links" && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ListVideo className="h-4 w-4 text-primary" /> Fila de vídeos para análise
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cole um link de vídeo por linha. Cada vídeo é baixado, transcrito e analisado visualmente; depois você escolhe qual deles usará para gerar um roteiro separado.
                  </p>
                </div>
                <Textarea
                  value={referenceLinksText}
                  onChange={(event) => setReferenceLinksText(event.target.value)}
                  placeholder={"https://youtube.com/shorts/...\nhttps://youtu.be/...\nhttps://tiktok.com/..."}
                  className="min-h-[130px] font-mono text-xs"
                  disabled={referenceLinksRunning}
                />

                {referenceLinksPreview.inputCount > 0 && (
                  <div className={`rounded-md border px-3 py-2 text-xs ${
                    referenceLinksPreview.accepted.length > 0
                      ? "border-primary/25 bg-primary/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}>
                    <p className="font-medium">
                      {referenceLinksPreview.accepted.length} vídeo{referenceLinksPreview.accepted.length === 1 ? "" : "s"} válido{referenceLinksPreview.accepted.length === 1 ? "" : "s"}
                      {referenceLinksPreview.duplicates.length > 0 && ` • ${referenceLinksPreview.duplicates.length} repetido${referenceLinksPreview.duplicates.length === 1 ? "" : "s"}`}
                      {referenceLinksPreview.rejected.length > 0 && ` • ${referenceLinksPreview.rejected.length} para corrigir`}
                    </p>
                    {referenceLinksPreview.rejected.slice(0, 3).map((issue) => (
                      <p key={`${issue.line}-${issue.rawUrl}`} className="mt-1 text-destructive">
                        Linha {issue.line}: {issue.message}
                      </p>
                    ))}
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={() => void handleAddReferenceLinks()}
                  disabled={referenceLinksRunning || referenceLinksPreview.accepted.length === 0}
                >
                  {referenceLinksRunning
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Organizando e analisando a fila...</>
                    : <><Link2 className="h-4 w-4" /> Adicionar vídeos à fila</>}
                </Button>

                {referenceLinkQueue.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{referenceLinkQueue.length} vídeo{referenceLinkQueue.length === 1 ? "" : "s"} na fila</span>
                      <span className="text-muted-foreground">
                        {referenceLinkQueue.filter((entry) => entry.status === "ready").length} pronto{referenceLinkQueue.filter((entry) => entry.status === "ready").length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                      {referenceLinkQueue.map((entry, index) => {
                        const selected = entry.referenceVideoId === inputData.reference_video_id;
                        const frameCount = Array.isArray(entry.referenceVideo?.frames) ? entry.referenceVideo.frames.length : 0;
                        const segmentCount = Array.isArray(entry.referenceVideo?.transcription_segments)
                          ? entry.referenceVideo.transcription_segments.length
                          : 0;
                        return (
                          <div
                            key={entry.clientId}
                            className={`rounded-md border p-3 ${selected ? "border-primary bg-primary/5" : "border-border"}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5">
                                {entry.status === "ready" && <CheckCircle className="h-4 w-4 text-green-500" />}
                                {(entry.status === "queued" || entry.status === "downloading" || entry.status === "processing") && (
                                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                )}
                                {entry.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">{index + 1}. {entry.canonicalUrl}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {entry.status === "queued" && "Aguardando download"}
                                  {entry.status === "downloading" && "Baixando o vídeo com segurança"}
                                  {entry.status === "processing" && referenceProcessingMessage(entry.referenceVideo?.status)}
                                  {entry.status === "ready" && `Análise pronta • ${segmentCount} segmentos • ${frameCount} momentos visuais`}
                                  {entry.status === "error" && (entry.error || "Falha no processamento")}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {entry.status === "ready" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={selected ? "default" : "outline"}
                                    onClick={() => selectReferenceQueueEntry(entry)}
                                  >
                                    {selected ? "Selecionado" : "Usar neste roteiro"}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label="Remover da fila"
                                  onClick={() => removeReferenceQueueEntry(entry)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              O vídeo é usado apenas como referência para gerar o roteiro. Ele <strong>não</strong> entra na base de dados principal.
            </p>
          </div>
        )}

        {mode === "theme" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tema *</Label>
                <Input
                  placeholder="Ex: mistério, curiosidade 3D, história surpreendente"
                  value={inputData.theme ?? ""}
                  onChange={(e) => set("theme", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Nicho</Label>
                <Input
                  placeholder="Ex: futebol, tecnologia"
                  value={inputData.niche ?? ""}
                  onChange={(e) => set("niche", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Objetivo (opcional)</Label>
              <Input
                placeholder="Ex: gerar curiosidade e retenção alta"
                value={inputData.objective ?? ""}
                onChange={(e) => set("objective", e.target.value)}
              />
            </div>
          </>
        )}

        {mode === "transform" && (
          <>
            <div className="space-y-2">
              <Label>Roteiro Original *</Label>
              <Textarea
                placeholder="Cole o roteiro original aqui..."
                className="min-h-[160px] font-mono text-sm"
                value={inputData.original_script ?? ""}
                onChange={(e) => set("original_script", e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={inputData.preserve_meaning ?? true}
                onCheckedChange={(v) => set("preserve_meaning", v)}
              />
              <Label className="text-sm">Preservar significado original</Label>
            </div>
          </>
        )}

        {/* DNA Preset + Gancho Apelão */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/40">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Dna className="h-3.5 w-3.5 text-primary" /> Base DNA (Preset)
            </Label>
            <Select
              value={inputData.dna_preset_id ?? "global"}
              onValueChange={handlePresetChange}
              disabled={presetsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Base Global" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">🌐 Base Global (vídeos aprovados)</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    🧬 {p.name} ({p.video_count} vídeos)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {presetsError ? (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <span>{presetsError}</span>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => void loadPresets()}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {presetsLoading ? "Carregando presets DNA..." : (
                  <>Crie presets na <Link to="/library" className="text-primary hover:underline">Biblioteca</Link>: selecione vídeos → "Criar Preset DNA".</>
                )}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-orange-500" /> Gancho Apelão
            </Label>
            <div className="flex items-center gap-3 h-10">
              <Switch
                checked={inputData.hook_apelao ?? true}
                onCheckedChange={(v) => set("hook_apelao", v)}
              />
              <span className="text-sm text-muted-foreground">
                {(inputData.hook_apelao ?? true) ? "Máximo impacto — sem suavizar" : "Gancho padrão da base"}
              </span>
            </div>
          </div>
        </div>

        {/* Common fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/40">
          <div className="space-y-2">
            <Label>Idioma (opcional)</Label>
            <Input
              placeholder="Ex: pt-BR"
              value={inputData.language ?? ""}
              onChange={(e) => set("language", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <Input
              placeholder="Instruções adicionais"
              value={inputData.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
