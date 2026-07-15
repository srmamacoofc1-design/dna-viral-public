export const ACTIVE_DNA_PRESET_STORAGE_KEY = "viral-dna.active-preset-id";
export const DNA_PRESET_SELECTION_EVENT = "viral-dna:preset-selection-changed";

function normalizePresetId(presetId: string | null | undefined): string | null {
  const normalized = presetId?.trim();
  return normalized && normalized !== "global" ? normalized : null;
}

export function readActiveDnaPresetId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizePresetId(window.localStorage.getItem(ACTIVE_DNA_PRESET_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Persists one shared selection for /library, /app and Script Engine.
 * The custom event keeps components in the same tab synchronized; the native
 * storage event covers other tabs.
 */
export function setActiveDnaPresetId(presetId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const normalized = normalizePresetId(presetId);
  try {
    const previous = normalizePresetId(window.localStorage.getItem(ACTIVE_DNA_PRESET_STORAGE_KEY));
    if (normalized) window.localStorage.setItem(ACTIVE_DNA_PRESET_STORAGE_KEY, normalized);
    else window.localStorage.removeItem(ACTIVE_DNA_PRESET_STORAGE_KEY);

    if (previous !== normalized) {
      window.dispatchEvent(new CustomEvent(DNA_PRESET_SELECTION_EVENT, {
        detail: { presetId: normalized },
      }));
    }
  } catch {
    // Storage can be unavailable in private/locked-down browser contexts.
  }
}

export function presetGenerationUrl(basePath: "/app" | "/dashboard/script-engine", presetId?: string | null): string {
  const normalized = normalizePresetId(presetId);
  return normalized ? `${basePath}?preset=${encodeURIComponent(normalized)}` : basePath;
}
