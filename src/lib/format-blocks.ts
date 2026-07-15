/**
 * Visual formatting for block names and sequences.
 * Does NOT alter persisted data — display-only.
 */

const BLOCK_DISPLAY_NAMES: Record<string, string> = {
  hook: "Hook",
  setup: "Setup",
  tensao: "Tensão",
  desenvolvimento: "Desenvolvimento",
  revelacao: "Revelação",
  payoff: "Payoff",
  transicao: "Transição",
  loop: "Loop",
};

const ABBREV_TO_FULL: Record<string, string> = {
  HOO: "Hook",
  SET: "Setup",
  TEN: "Tensão",
  DES: "Desenvolvimento",
  REV: "Revelação",
  PAY: "Payoff",
  TRA: "Transição",
  LOO: "Loop",
};

/** Format a raw block type for display: "tensao" → "Tensão" */
export function formatBlockName(raw: string): string {
  return BLOCK_DISPLAY_NAMES[raw.toLowerCase()] ?? raw;
}

/** Format an abbreviated sequence for display:
 *  "HOO → SET → DES" → "Hook → Setup → Desenvolvimento"
 */
export function formatSequence(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .split(/\s*→\s*/)
    .map((part) => {
      const trimmed = part.trim();
      return ABBREV_TO_FULL[trimmed.toUpperCase()] ?? BLOCK_DISPLAY_NAMES[trimmed.toLowerCase()] ?? trimmed;
    })
    .join(" → ");
}

/** Derive missing_fields list from a DNA object for status explanation */
export function deriveMissingFields(obj: {
  dominant_sequence: string | null;
  dominant_emotion: string | null;
  avg_engagement_rate: number | null;
  required_blocks: string[];
  total_videos_used: number;
  avg_hook_time_pct?: number | null;
  avg_payoff_time_pct?: number | null;
  status: string;
}): string[] {
  if (obj.status === "no_data") return ["Sem dados suficientes"];
  if (obj.status === "ready") return [];

  const missing: string[] = [];
  if (!obj.dominant_sequence) missing.push("Sequência dominante");
  if (!obj.dominant_emotion) missing.push("Emoção dominante");
  if (obj.avg_engagement_rate == null) missing.push("Engagement rate");
  if (!obj.required_blocks || obj.required_blocks.length === 0) missing.push("Blocos obrigatórios");
  if (obj.total_videos_used === 0) missing.push("Vídeos processados");
  return missing;
}

/** Generate a descriptive template name from dominant sequence */
export function generateTemplateName(dominantSequence: string | null): string {
  if (!dominantSequence) return "Template V1";
  const formatted = formatSequence(dominantSequence);
  return `Template ${formatted}`;
}
