export type ReferenceVisualLayerRole = "reactor" | "embedded" | "unknown";

export interface ReferenceVisualEvidenceLike {
  timestamp_seconds: number;
  description?: unknown;
  main_action?: unknown;
  visual_elements?: unknown;
  text_on_screen?: unknown;
  subject_role?: unknown;
  layer?: unknown;
  region?: unknown;
  subject_id?: unknown;
}

export interface ReferenceTranscriptEvidenceLike {
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

export interface ReferenceVisualEvidenceContract {
  passed: boolean;
  reaction_layout_detected: boolean;
  reactor_rows: number;
  embedded_rows: number;
  unique_timestamps: number;
  reasons: string[];
}

const TIMESTAMP_EPSILON_SECONDS = 0.001;

const REACTION_LAYOUT_CUES = [
  /\b(?:face\s*cam|facecam|web\s*cam|webcam|split[ -]?screen|reaction layout|reaction video|react panel)\b/u,
  /\b(?:tela|pantalla) dividida\b/u,
  /\b(?:top|bottom|upper|lower|left|right|superior|inferior)\s+(?:layer|panel|window|overlay|corner|camada|painel|janela|canto)\b.{0,120}\b(?:reacting|reacts?|reaction|reagindo|reage|reacao|reaccionando)\b/u,
  /\b(?:reacting|reacts?|reaction|reagindo|reage|reacao|reaccionando)\b.{0,120}\b(?:top|bottom|upper|lower|left|right|superior|inferior)\s+(?:layer|panel|window|overlay|corner|camada|painel|janela|canto)\b/u,
] as const;

const NON_OBSERVABLE_INFERENCE_PATTERNS = [
  {
    code: "relationship_inference",
    pattern: /\b(?:cheat(?:ing|ed)?|infidelity|affair|trai(?:cao|u|ndo)|family|familia|couple|casal|husband|wife|boyfriend|girlfriend|lover|mistress|mother|father|parents?|mom|dad|mae|pai|pais|madre|padre|son|daughter|filh[oa]|their baby|their child|bebe deles|filh[oa] deles|became a (?:mother|father)|virou (?:mae|pai)|raising the (?:baby|child)|criaram? (?:o |a |um |uma )?(?:bebe|crianca))\b/u,
  },
  {
    code: "motive_or_control_inference",
    pattern: /\b(?:orders?|ordering|ordered|commands?|commanding|ordena(?:ndo|ou)?|comforting|comforts?|consola(?:ndo|ou)?|offers? help|offering help|to help|helping|oferece(?:u|ndo)? ajuda|para (?:oferecer|dar|prestar) ajuda|ajudando|trying to|intends? to|plans? to)\b/u,
  },
  {
    code: "judgment_inference",
    pattern: /\b(?:seductive|seductively|provocative|provocatively|smug(?:ly|ness)?|cruel|evil|kind(?:ly)?|defeated|triump(?:h|hant)|resilien(?:ce|t)|confiden(?:ce|t|tly)|concerned|gentle|determined|soft|arrogant(?:ly)?|empathetic(?:ally)?|proud(?:ly)?|defiant(?:ly)?|challenging (?:look|gaze|glance)|desafiador(?:a|es|as)?|lazy|laziness|loafing|preguicos[oa]?|preguica|vagabundagem|vagabund[oa]|folgad[oa]|shameless|cara de pau|sem vergonha)\b/u,
  },
  {
    code: "uncertainty_as_fact",
    pattern: /\b(?:seemingly|apparently|presumably|supostamente|aparentemente|parece (?:estar|que))\b/u,
  },
  {
    code: "symbolic_interpretation",
    pattern: /\b(?:symboli[sz](?:es?|ing)|represents?|meaning that|simboliza(?:ndo)?|representa(?:ndo)?|significa que)\b/u,
  },
] as const;

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function finiteTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function structuredRole(value: unknown): ReferenceVisualLayerRole | null {
  const role = normalized(value);
  return role === "reactor" || role === "embedded" || role === "unknown" ? role : null;
}

function effectiveRole(frame: ReferenceVisualEvidenceLike): ReferenceVisualLayerRole | null {
  return structuredRole(frame?.subject_role) || structuredRole(frame?.layer);
}

function visualText(frame: ReferenceVisualEvidenceLike): string {
  return normalized([
    frame?.description,
    frame?.main_action,
    Array.isArray(frame?.visual_elements) ? frame.visual_elements.join(" ") : frame?.visual_elements,
  ].filter(Boolean).join(" "));
}

function hasTextualReactionLayoutCue(frame: ReferenceVisualEvidenceLike): boolean {
  const text = visualText(frame);
  return REACTION_LAYOUT_CUES.some((pattern) => pattern.test(text));
}

function regionFamily(value: unknown): "top" | "bottom" | "left" | "right" | null {
  const region = normalized(value).replace(/[_-]+/g, " ");
  if (/\b(?:top|upper|superior)\b/u.test(region)) return "top";
  if (/\b(?:bottom|lower|inferior)\b/u.test(region)) return "bottom";
  if (/\b(?:left|esquerda|izquierda)\b/u.test(region)) return "left";
  if (/\b(?:right|direita|derecha)\b/u.test(region)) return "right";
  return null;
}

function explicitRegionFamilies(frame: ReferenceVisualEvidenceLike): Set<"top" | "bottom" | "left" | "right"> {
  const text = visualText(frame);
  const regions = new Set<"top" | "bottom" | "left" | "right">();
  if (/\b(?:top|upper|superior)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("top");
  if (/\b(?:bottom|lower|inferior)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("bottom");
  if (/\b(?:left|esquerda|izquierda)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("left");
  if (/\b(?:right|direita|derecha)\s+(?:frame|layer|panel|window|screen|camada|painel|janela|tela|pantalla)\b/u.test(text)) regions.add("right");
  return regions;
}

function sameTimestamp(left: number, right: number): boolean {
  return Math.abs(left - right) <= TIMESTAMP_EPSILON_SECONDS;
}

/**
 * Returns one real observation per temporal sampling point. Extra reactor and
 * embedded rows remain in the source array and are collapsed only for density
 * measurement, never for semantic evidence.
 */
export function uniqueReferenceVisualTimestamps<T extends ReferenceVisualEvidenceLike>(moments: T[]): T[] {
  const sorted = (Array.isArray(moments) ? moments : [])
    .map((moment, sourceIndex) => ({ moment, sourceIndex, timestamp: finiteTimestamp(moment?.timestamp_seconds) }))
    .filter((entry): entry is { moment: T; sourceIndex: number; timestamp: number } => entry.timestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp || left.sourceIndex - right.sourceIndex);
  const unique: T[] = [];
  let previousTimestamp: number | null = null;
  for (const entry of sorted) {
    if (previousTimestamp === null || !sameTimestamp(previousTimestamp, entry.timestamp)) {
      unique.push(entry.moment);
      previousTimestamp = entry.timestamp;
    }
  }
  return unique;
}

function oneRowPerLayer<T extends ReferenceVisualEvidenceLike>(group: T[]): T[] {
  const embedded = group.find((frame) => effectiveRole(frame) === "embedded") || null;
  const reactor = group.find((frame) => effectiveRole(frame) === "reactor") || null;
  if (embedded || reactor) return [embedded, reactor].filter((frame): frame is T => frame !== null);
  return group.length > 0 ? [group[0]] : [];
}

/**
 * Limits temporal samples rather than physical evidence rows. Each selected
 * timestamp keeps at most one embedded row and one reactor row. Opening
 * samples plus the first reactor baseline are pinned before even sampling.
 */
export function limitReferenceVisualTimelineByTimestamp<T extends ReferenceVisualEvidenceLike>(
  moments: T[],
  maxTemporalMoments: number,
): T[] {
  const limit = Math.max(1, Math.trunc(Number(maxTemporalMoments) || 1));
  const sorted = (Array.isArray(moments) ? moments : [])
    .map((moment, sourceIndex) => ({ moment, sourceIndex, timestamp: finiteTimestamp(moment?.timestamp_seconds) }))
    .filter((entry): entry is { moment: T; sourceIndex: number; timestamp: number } => entry.timestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp || left.sourceIndex - right.sourceIndex);
  const groups: Array<{ timestamp: number; rows: T[] }> = [];
  for (const entry of sorted) {
    const previous = groups.at(-1);
    if (!previous || !sameTimestamp(previous.timestamp, entry.timestamp)) {
      groups.push({ timestamp: entry.timestamp, rows: [entry.moment] });
    } else {
      previous.rows.push(entry.moment);
    }
  }
  if (groups.length === 0) return [];

  const selectedIndexes = new Set<number>();
  const pin = (index: number) => {
    if (index >= 0 && index < groups.length && selectedIndexes.size < limit) selectedIndexes.add(index);
  };
  pin(0);
  for (let index = 1; index < groups.length && groups[index].timestamp <= 5; index++) pin(index);
  pin(groups.findIndex((group) => group.rows.some((frame) => effectiveRole(frame) === "reactor")));
  pin(groups.length - 1);
  for (let position = 0; selectedIndexes.size < Math.min(limit, groups.length) && position < limit; position++) {
    pin(Math.round((position * (groups.length - 1)) / Math.max(1, limit - 1)));
  }
  for (let index = 0; selectedIndexes.size < Math.min(limit, groups.length) && index < groups.length; index++) pin(index);

  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .flatMap((index) => oneRowPerLayer(groups[index].rows));
}

function localExplicitEvidence(
  frame: ReferenceVisualEvidenceLike,
  segments: ReferenceTranscriptEvidenceLike[],
): string {
  const timestamp = finiteTimestamp(frame?.timestamp_seconds);
  const localSpeech = timestamp === null ? [] : segments.filter((segment) => {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    return Number.isFinite(start) && Number.isFinite(end)
      && start <= timestamp + 1.5
      && end >= timestamp - 1.5;
  }).map((segment) => segment?.text);
  return normalized([frame?.text_on_screen, ...localSpeech].filter(Boolean).join(" "));
}

/**
 * Fail-closed contract for newly generated pixel evidence and reaction-layer
 * reuse. Legacy direct/full-screen rows may omit optional metadata, but a
 * detected reaction layout must always have separately attributable planes.
 */
export function assessReferenceVisualEvidenceContract(
  moments: ReferenceVisualEvidenceLike[],
  options: {
    requireStructuredMetadata?: boolean;
    enforceObservableLanguage?: boolean;
    transcriptionSegments?: ReferenceTranscriptEvidenceLike[];
  } = {},
): ReferenceVisualEvidenceContract {
  const frames = Array.isArray(moments) ? moments : [];
  const segments = Array.isArray(options.transcriptionSegments) ? options.transcriptionSegments : [];
  const reactorRows = frames.filter((frame) => effectiveRole(frame) === "reactor");
  const embeddedRows = frames.filter((frame) => effectiveRole(frame) === "embedded");
  const reactionLayoutDetected = reactorRows.length > 0 || frames.some(hasTextualReactionLayoutCue);
  const reasons: string[] = [];

  if (options.requireStructuredMetadata === true) {
    frames.forEach((frame, index) => {
      const subjectRole = structuredRole(frame?.subject_role);
      const layer = structuredRole(frame?.layer);
      if (!subjectRole || !layer || !normalized(frame?.region) || !normalized(frame?.subject_id)) {
        reasons.push(`frame_${index}_structured_metadata_missing`);
      } else if (subjectRole !== layer) {
        reasons.push(`frame_${index}_subject_role_layer_mismatch`);
      }
    });
  }

  if (reactionLayoutDetected) {
    if (reactorRows.length === 0) reasons.push("reaction_reactor_row_missing");
    if (embeddedRows.length === 0) reasons.push("reaction_embedded_row_missing");
    if (!reactorRows.some((frame) => {
      const timestamp = finiteTimestamp(frame?.timestamp_seconds);
      return timestamp !== null && timestamp <= 5;
    })) reasons.push("reaction_opening_reactor_baseline_missing");
    frames.forEach((frame, index) => {
      const subjectRole = structuredRole(frame?.subject_role);
      const layer = structuredRole(frame?.layer);
      if (!subjectRole || !layer || subjectRole !== layer) {
        reasons.push(`reaction_frame_${index}_layer_identity_invalid`);
      }
      if (hasTextualReactionLayoutCue(frame) && effectiveRole(frame) !== "reactor") {
        reasons.push(`reaction_frame_${index}_mixed_layers_in_single_row`);
      }
      const ownRegion = regionFamily(frame?.region);
      const mentionedRegions = explicitRegionFamilies(frame);
      if (ownRegion && [...mentionedRegions].some((region) => region !== ownRegion)) {
        reasons.push(`reaction_frame_${index}_opposing_region_in_single_row`);
      }
    });
  }

  if (options.enforceObservableLanguage === true) {
    frames.forEach((frame, index) => {
      const proposition = normalized(`${frame?.description ?? ""} ${frame?.main_action ?? ""}`);
      const explicitEvidence = localExplicitEvidence(frame, segments);
      for (const rule of NON_OBSERVABLE_INFERENCE_PATTERNS) {
        if (rule.pattern.test(proposition) && !rule.pattern.test(explicitEvidence)) {
          reasons.push(`frame_${index}_${rule.code}`);
        }
      }
    });
  }

  return {
    passed: reasons.length === 0,
    reaction_layout_detected: reactionLayoutDetected,
    reactor_rows: reactorRows.length,
    embedded_rows: embeddedRows.length,
    unique_timestamps: uniqueReferenceVisualTimestamps(frames).length,
    reasons: [...new Set(reasons)],
  };
}
