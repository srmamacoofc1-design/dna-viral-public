import type { EngineMode } from "@/components/script-engine/ModeSelector";

type GenerationInput = Record<string, unknown>;

function trimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Builds the exact request contract accepted by build-complete-generation-context. */
export function buildGenerationContextPayload(
  mode: EngineMode,
  input: GenerationInput,
  userId?: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { mode };
  if (userId) payload.user_id = userId;

  const language = trimmed(input.language);
  const notes = trimmed(input.notes);
  const blueprintId = trimmed(input.blueprint_id);
  const dnaPresetId = trimmed(input.dna_preset_id);
  if (language) payload.language = language;
  if (notes) payload.notes = notes;
  if (blueprintId) payload.blueprint_id = blueprintId;
  if (dnaPresetId) payload.dna_preset_id = dnaPresetId;

  if (mode === "video") {
    const referenceVideoId = trimmed(input.reference_video_id);
    if (referenceVideoId) payload.reference_video_id = referenceVideoId;
  } else if (mode === "theme") {
    const theme = trimmed(input.theme);
    const niche = trimmed(input.niche);
    const objective = trimmed(input.objective);
    if (theme) payload.theme = theme;
    if (niche) payload.niche = niche;
    if (objective) payload.objective = objective;
    if (typeof input.duration_seconds === "number" && Number.isFinite(input.duration_seconds)) {
      payload.duration_seconds = input.duration_seconds;
    }
  } else {
    const originalScript = trimmed(input.original_script);
    if (originalScript) payload.original_script = originalScript;
    payload.preserve_meaning = input.preserve_meaning !== false;
  }

  return payload;
}

export function generationInputError(mode: EngineMode, input: GenerationInput): string | null {
  if (mode === "video") {
    if (!trimmed(input.reference_video_id)) return "Envie e processe um vídeo de referência antes de gerar.";
    if (input.reference_video_ready === false) return "Aguarde a análise visual e a transcrição do vídeo terminarem.";
  }
  if (mode === "theme" && !trimmed(input.theme)) return "Informe o tema do novo roteiro.";
  if (mode === "transform" && !trimmed(input.original_script)) return "Cole o roteiro original que será transformado.";
  return null;
}

interface DnaInjectionResult {
  injected: boolean;
  reason?: string;
}

/** Presets explicitly chosen and every video-mode run are fail-closed. */
export function assertRequiredDnaInjection(
  result: DnaInjectionResult,
  mode: EngineMode,
  presetId?: string | null,
): void {
  if (result.injected) return;
  if (mode !== "video" && !presetId) return;

  const requirement = presetId
    ? "o preset DNA selecionado"
    : "o DNA visual obrigatório do vídeo";
  throw new Error(
    `Geração interrompida: ${requirement} não foi aplicado. ${result.reason || "Reprocesse a base/vídeo e tente novamente."}`,
  );
}
