import {
  HOOK_OPENING_END_SECONDS,
  normalizeGuardWords,
  selectTranscriptSupportForRange,
} from "./dna-guards.ts";
import {
  isMaterialTemporalTransitionText,
  materialVisualActionRuleIds,
  missingExplicitMaterialVisualAction,
} from "./visual-material-guards.ts";

export type NarrativeEventCoverage = "covered" | "omitted" | "distorted";
export type NarrativeCausalRelation = "preserved" | "altered" | "unsupported" | "not_applicable";

export interface IndependentNarrativeEvent {
  event_id: string;
  script_slot_index: number;
  slot_type: string;
  evidence_kind: "transcript" | "visual_frame";
  start_seconds: number;
  end_seconds: number;
  evidence_text: string;
  /**
   * Exact clause the Writer claimed as support for this event. It is extracted
   * only from the persisted narrative_event_checklist, never inferred from the
   * surrounding generated text. A null value is allowed while constructing the
   * pre-Writer plan, but the independent audit rejects a final draft when any
   * authoritative event still lacks a valid exact clause.
   */
  claimed_text_excerpt: string | null;
}

export interface IndependentNarrativeAuditSlot {
  script_slot_index: number;
  slot_type: string;
  generated_text: string;
  time_range: { start: number; end: number } | null;
  visual_context: Array<{
    frame_id: string;
    timestamp_seconds: number;
    evidence_text: string;
  }>;
  /**
   * Frames with a stable, non-duplicate action signature. When speech exists,
   * these remain candidates until the independent semantic auditor decides
   * whether the visible proposition is already carried by local speech. This
   * avoids both transcript-only blind spots and treating every sampled frame
   * as a mandatory narration event.
   */
  visual_event_candidates: IndependentNarrativeEvent[];
  events: IndependentNarrativeEvent[];
}

export interface IndependentNarrativeAuditPlan {
  contract_version: 2;
  slots: IndependentNarrativeAuditSlot[];
  total_events: number;
  total_visual_event_candidates: number;
}

export interface IndependentNarrativeEventResult {
  event_id: string;
  coverage: NarrativeEventCoverage;
  causal_relation: NarrativeCausalRelation;
  reason: string;
  /**
   * Deterministic semantic modifiers present in the source evidence but absent
   * from the Writer's exact claimed clause. This field is produced locally
   * after model parsing; it is never accepted as part of untrusted model JSON.
   */
  deterministic_missing_qualifiers?: DeterministicNarrativeQualifier[];
}

export type DeterministicNarrativeQualifier =
  | "accidental_mode"
  | "surprise"
  | "immediacy"
  | "graduality"
  | "nightly_frequency"
  | "raw_meat_craving"
  | "days_later_delay"
  | "unable_to_contain"
  | "purpose"
  | "concealment_purpose"
  | "boss_impressed_by_effort"
  | "fear"
  | "desperation"
  | "in_front_of_everyone"
  | "true_appearance"
  | "complete_intensity"
  | "full_speed"
  | "forest_destination"
  | "one_day"
  | "opening_hunger"
  | "explicit_abandoned_condition"
  | "opening_intrigued"
  | "wear_action"
  | "large_company"
  | "job_interview"
  | "gift_explanation"
  | "work_meeting"
  | "mansion_specificity"
  | "wife_and_daughter";

export interface IndependentNarrativeClaimIssue {
  claim: string;
  reason: string;
}

export interface IndependentNarrativeSlotResult {
  script_slot_index: number;
  event_results: IndependentNarrativeEventResult[];
  visual_event_results: Array<{
    event_id: string;
    materiality: "required" | "redundant";
    coverage: NarrativeEventCoverage | "not_required";
    causal_relation: NarrativeCausalRelation;
    reason: string;
  }>;
  unsupported_claims: IndependentNarrativeClaimIssue[];
  cross_boundary_claims: IndependentNarrativeClaimIssue[];
}

export interface IndependentNarrativeAuditResult {
  slot_audits: IndependentNarrativeSlotResult[];
}

export interface WriterNarrativeChecklistIssue {
  script_slot_index: number | null;
  type:
    | "writer_checklist_block_missing_or_duplicate"
    | "writer_checklist_ids_missing"
    | "writer_checklist_ids_duplicate"
    | "writer_checklist_ids_unknown"
    | "writer_checklist_text_evidence_invalid"
    | "writer_checklist_material_visual_action_missing"
    | "writer_checklist_qualifiers_missing";
  event_ids: string[];
  details?: string[];
}

export interface WriterNarrativeChecklistAssessment {
  passed: boolean;
  issues: WriterNarrativeChecklistIssue[];
}

export interface WriterRevisionNarrativeEvent extends IndependentNarrativeEvent {
  prior_coverage: NarrativeEventCoverage | "not_yet_audited";
  prior_causal_relation: NarrativeCausalRelation | "not_yet_audited";
  prior_reason: string;
  revision_duty: "MUST_PRESERVE" | "MUST_RESTORE_COMPLETELY";
  required_deterministic_qualifiers: DeterministicNarrativeQualifier[];
}

export interface WriterRevisionNarrativeSlot {
  script_slot_index: number;
  slot_type: string;
  time_range: { start: number; end: number } | null;
  current_generated_text: string;
  events: WriterRevisionNarrativeEvent[];
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedText(value: unknown, limit: number): string {
  return String(value || "").trim().slice(0, limit);
}

function claimedWriterExcerptByEventId(block: any): Map<string, string> {
  const generatedText = boundedText(block?.generated_text, 3000);
  const normalizedGeneratedText = generatedText.toLocaleLowerCase();
  const rows = Array.isArray(block?.narrative_event_checklist?.event_text_evidence)
    ? block.narrative_event_checklist.event_text_evidence
    : [];
  const grouped = new Map<string, Array<{ excerpt: string; valid: boolean }>>();
  for (const row of rows) {
    const keys = row && typeof row === "object" && !Array.isArray(row)
      ? Object.keys(row).sort().join("|")
      : "";
    const eventId = boundedText(row?.event_id, 240);
    const excerpt = boundedText(row?.text_excerpt, 1200);
    if (!eventId) continue;
    const canonicalNormalizedClause = excerpt
      && !normalizedGeneratedText.includes(excerpt.toLocaleLowerCase())
      ? uniqueNormalizedWriterEvidenceClause(generatedText, excerpt)
      : null;
    grouped.set(eventId, [
      ...(grouped.get(eventId) || []),
      {
        excerpt: canonicalNormalizedClause || excerpt,
        valid: keys === "event_id|text_excerpt"
          && Boolean(excerpt)
          && (
            normalizedGeneratedText.includes(excerpt.toLocaleLowerCase())
            || Boolean(canonicalNormalizedClause)
          ),
      },
    ]);
  }
  const result = new Map<string, string>();
  for (const [eventId, matches] of grouped) {
    if (matches.length === 1 && matches[0].valid) result.set(eventId, matches[0].excerpt);
  }
  return result;
}

function exactKeys(value: unknown, expected: readonly string[], errorCode: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(errorCode);
  }
}

function visualEvidenceText(frame: any): string {
  const structuredLayer = [
    ["subject_role", frame?.subject_role],
    ["layer", frame?.layer],
    ["region", frame?.region],
    ["subject_id", frame?.subject_id],
  ].flatMap(([key, raw]) => {
    const value = boundedText(raw, 80);
    return value ? [`${key}=${value}`] : [];
  }).join(" ");
  return [
    structuredLayer,
    boundedText(frame?.description, 500),
    boundedText(frame?.main_action, 300),
    boundedText(frame?.text_on_screen, 220),
  ].filter(Boolean).join(" | ").slice(0, 900);
}

/**
 * Candidate materiality is about what the pixels add to the narration. OCR is
 * intentionally excluded whenever a visual description/action exists because
 * subtitle text frequently repeats the transcript and must not disguise a
 * distinct silent action (or manufacture one from the subtitle alone).
 */
function visualActionEvidenceText(frame: any): string {
  const structuredLayer = [
    ["subject_role", frame?.subject_role],
    ["layer", frame?.layer],
    ["region", frame?.region],
    ["subject_id", frame?.subject_id],
  ].flatMap(([key, raw]) => {
    const value = boundedText(raw, 80);
    return value ? [`${key}=${value}`] : [];
  }).join(" ");
  const temporalOcr = isMaterialTemporalTransitionText(frame?.text_on_screen)
    ? boundedText(frame?.text_on_screen, 220)
    : "";
  const visual = [
    structuredLayer,
    boundedText(frame?.main_action, 300),
    boundedText(frame?.description, 500),
    temporalOcr ? `material_temporal_ocr=${temporalOcr}` : "",
  ].filter(Boolean).join(" | ").slice(0, 900);
  return visual || boundedText(frame?.text_on_screen, 220);
}

const VISUAL_ACTION_NOISE = new Set([
  "a", "an", "and", "as", "at", "da", "das", "de", "del", "do", "dos", "el", "en", "e", "em",
  "for", "from", "his", "her", "in", "inside", "la", "las", "los", "na", "nas", "no", "nos", "of",
  "on", "o", "os", "para", "por", "se", "shown", "the", "their", "to", "um", "uma", "un", "una",
  "with", "y",
]);

function normalizedVisualActionTokens(frame: any): string[] {
  const primary = boundedText(frame?.main_action, 500) || boundedText(frame?.description, 700);
  return [...new Set(primary
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !VISUAL_ACTION_NOISE.has(token)))]
    .sort();
}

function visualActionsAreRedundant(left: any, right: any): boolean {
  const leftTokens = normalizedVisualActionTokens(left);
  const rightTokens = normalizedVisualActionTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  if (leftTokens.join("|") === rightTokens.join("|")) return true;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection++;
  const union = new Set([...leftSet, ...rightSet]).size;
  // Deliberately conservative: only near-identical action descriptions are
  // collapsed in code. Cross-language/paraphrase redundancy is decided by the
  // strict semantic auditor, not guessed with an English-only token heuristic.
  return intersection >= 2 && union > 0 && intersection / union >= 0.86;
}

function deduplicateVisualActionFrames(frames: any[]): any[] {
  const kept: any[] = [];
  for (const frame of frames) {
    if (!visualActionEvidenceText(frame)) continue;
    const previous = kept.at(-1);
    const previousTimestamp = finiteNumber(previous?.timestamp_seconds);
    const timestamp = finiteNumber(frame?.timestamp_seconds);
    const adjacentSample = previousTimestamp !== null && timestamp !== null
      && timestamp >= previousTimestamp
      && timestamp - previousTimestamp <= 3.25;
    // Collapse only adjacent near-identical samples. The same action recurring
    // later can be a separate narrative event and is deliberately preserved.
    if (previous && adjacentSample && visualActionsAreRedundant(previous, frame)) continue;
    kept.push(frame);
  }
  return kept;
}

type StructuredVisualPlane = "reactor" | "embedded" | "unknown";

function structuredVisualPlane(frame: any): StructuredVisualPlane {
  const role = boundedText(frame?.subject_role, 80).toLocaleLowerCase();
  if (role === "reactor" || role === "embedded") return role;
  const layer = boundedText(frame?.layer, 80).toLocaleLowerCase();
  if (layer === "reactor" || layer === "embedded") return layer;
  return "unknown";
}

const CONCRETE_OPENING_ACTION = /\b(?:abr\p{L}*|andar\p{L}*|apont\p{L}*|arrast\p{L}*|break\p{L}*|carry\p{L}*|close\p{L}*|correr\p{L}*|cort\p{L}*|dar\p{L}*|deix\p{L}*|drop\p{L}*|entr\p{L}*|entreg\p{L}*|ergu\p{L}*|fall\p{L}*|fech\p{L}*|give\p{L}*|grab\p{L}*|hand\p{L}*|hold\p{L}*|levantar\p{L}*|lift\p{L}*|mostr\p{L}*|open\p{L}*|peg\p{L}*|point\p{L}*|pull\p{L}*|push\p{L}*|put\p{L}*|raise\p{L}*|run\p{L}*|sair\p{L}*|segur\p{L}*|show\p{L}*|take\p{L}*|tir\p{L}*|walk\p{L}*|wear\p{L}*)\b/u;
const PASSIVE_REACTION_STATE = /\b(?:angry|assiste\p{L}*|chocad\p{L}*|chor\p{L}*|confus\p{L}*|distress\p{L}*|encar\p{L}*|expression\p{L}*|face|franz\p{L}*|look\p{L}*|neutral\p{L}*|observ\p{L}*|olh\p{L}*|parec\p{L}*|react\p{L}*|reag\p{L}*|sad|silently|sorr\p{L}*|stare\p{L}*|surpres\p{L}*|watch\p{L}*)\b/u;

function reactionMusicOpeningSalience(frame: any): number {
  const action = normalizeGuardWords(boundedText(frame?.main_action, 500)).join(" ");
  const evidence = normalizeGuardWords([
    boundedText(frame?.main_action, 500),
    boundedText(frame?.description, 700),
  ].filter(Boolean).join(" ")).join(" ");
  let score = action ? 6 : 0;
  if (CONCRETE_OPENING_ACTION.test(evidence)) score += 20;
  if (PASSIVE_REACTION_STATE.test(evidence) && !CONCRETE_OPENING_ACTION.test(evidence)) score -= 12;
  // A more explicit action is a better hook anchor than a bare sampled pose.
  score += Math.min(6, normalizeGuardWords(action).length);
  return score;
}

/**
 * A silent reaction layout contains many sampled poses that are useful as
 * grounding context but cannot all become mandatory words in a 3-5s hook.
 * Keep the complete opening in `visual_context`, while the auditable event
 * contract selects the strongest concrete event from the embedded story.
 * Reactor baselines remain available to catch identity merges/unsupported
 * claims, but a neutral face is never itself a mandatory narration beat.
 */
function selectReactionMusicHookEvents(frames: any[], openingHook: boolean, hasLocalSpeech: boolean): any[] {
  const distinct = deduplicateVisualActionFrames(frames);
  if (!openingHook || hasLocalSpeech) return distinct;
  const planes = new Set(frames.map(structuredVisualPlane));
  if (!planes.has("reactor") || !planes.has("embedded")) return distinct;

  const embedded = distinct.filter((frame) => structuredVisualPlane(frame) === "embedded");
  if (embedded.length === 0) return distinct;
  return [...embedded]
    .sort((left, right) => {
      const scoreDelta = reactionMusicOpeningSalience(right) - reactionMusicOpeningSalience(left);
      if (scoreDelta !== 0) return scoreDelta;
      const timeDelta = (finiteNumber(left?.timestamp_seconds) ?? Number.POSITIVE_INFINITY)
        - (finiteNumber(right?.timestamp_seconds) ?? Number.POSITIVE_INFINITY);
      if (timeDelta !== 0) return timeDelta;
      return Number(left?.__narrative_source_index || 0) - Number(right?.__narrative_source_index || 0);
    })
    .slice(0, 1);
}

function canonicalFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalFingerprintValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalFingerprintValue(item)]),
    );
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
  return value === undefined ? null : String(value);
}

/** Stable identifier for the exact evidence contract sent to the auditor. */
export function independentNarrativePlanFingerprint(plan: IndependentNarrativeAuditPlan): string {
  const serialized = JSON.stringify(canonicalFingerprintValue(plan));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Builds a title-free, local evidence contract. Every valid transcript segment
 * is owned by exactly one slot using the same midpoint/opening rules as the
 * writer. When a slot has no spoken segment, each distinct analysed visual
 * action in its range becomes an auditable event instead.
 */
export function buildIndependentNarrativeAuditPlan(options: {
  blocks: any[];
  slots: any[];
  transcriptionSegments: any[];
  visualFrames: any[];
}): IndependentNarrativeAuditPlan {
  const blocks = Array.isArray(options.blocks) ? options.blocks : [];
  const slots = Array.isArray(options.slots) ? options.slots : [];
  const transcript = (Array.isArray(options.transcriptionSegments) ? options.transcriptionSegments : [])
    .map((segment, sourceIndex) => ({ ...segment, __narrative_source_index: sourceIndex }));
  const visualFrames = (Array.isArray(options.visualFrames) ? options.visualFrames : [])
    .map((frame, sourceIndex) => ({ ...frame, __narrative_source_index: sourceIndex }));
  const slotByIndex = new Map<number, any>();
  for (const slot of slots) {
    const index = Number(slot?.index);
    if (!Number.isInteger(index)) continue;
    if (slotByIndex.has(index)) throw new Error("independent_narrative_plan_duplicate_slot_index");
    slotByIndex.set(index, slot);
  }

  const seenBlockIndexes = new Set<number>();
  const hasOpeningHookOwner = blocks.some((candidate: any) => {
    const candidateIndex = Number(candidate?.index);
    const candidateSlot = slotByIndex.get(candidateIndex) || {};
    return boundedText(candidate?.slot_type || candidateSlot?.slot_type, 100).toLocaleLowerCase() === "hook";
  });
  const planSlots: IndependentNarrativeAuditSlot[] = blocks.map((block: any, position: number) => {
    const slotIndex = Number(block?.index);
    if (!Number.isInteger(slotIndex)) throw new Error("independent_narrative_plan_invalid_block_index");
    if (seenBlockIndexes.has(slotIndex)) throw new Error("independent_narrative_plan_duplicate_block_index");
    seenBlockIndexes.add(slotIndex);
    const slot = slotByIndex.get(slotIndex) || {};
    const selection = slot?.visual_evidence_selection || {};
    const traceRange = block?.visual_evidence_trace?.time_range;
    const rawRange = selection?.time_range || traceRange || null;
    const rangeStart = finiteNumber(rawRange?.start);
    const rangeEnd = finiteNumber(rawRange?.end);
    const range = rangeStart !== null && rangeEnd !== null && rangeEnd > rangeStart
      ? { start: rangeStart, end: rangeEnd }
      : null;
    const slotType = boundedText(block?.slot_type || slot?.slot_type, 100);
    const claimedExcerptByEventId = claimedWriterExcerptByEventId(block);
    const finalSlot = position === blocks.length - 1;
    // The canonical partition assigns the exact t=5.000 frame to the hook.
    // Every later slot owns a half-open interval and therefore excludes that
    // same opening boundary. Mirror dna-guards here so the Writer checklist,
    // semantic auditor and copy/grounding guard all see identical evidence.
    const openingHook = slotType.toLocaleLowerCase() === "hook";
    const excludesOwnedHookBoundary = hasOpeningHookOwner
      && !openingHook
      && range !== null
      && Math.abs(range.start - HOOK_OPENING_END_SECONDS) <= 0.001;
    const ownedTranscript = range
      ? selectTranscriptSupportForRange(transcript, range, {
        openingHook: slotType === "hook",
        finalSlot,
        // The contract is deliberately untruncated: every owned segment must
        // receive one and only one semantic result.
        limit: Math.max(1, transcript.length),
      })
      : [];

    const framesInRange = range
      ? visualFrames.filter((frame: any) => {
        const timestamp = finiteNumber(frame?.timestamp_seconds);
        return timestamp !== null
          && (excludesOwnedHookBoundary
            ? timestamp > range.start + 0.001
            : timestamp >= range.start - 0.001)
          && (openingHook || finalSlot
            ? timestamp <= range.end + 0.001
            : timestamp < range.end - 0.001);
      })
      : Array.isArray(selection?.frames)
      ? selection.frames.map((frame: any, sourceIndex: number) => ({
        ...frame,
        __narrative_source_index: sourceIndex,
      }))
      : [];
    const visualContext = framesInRange
      .map((frame: any) => {
        const timestamp = finiteNumber(frame?.timestamp_seconds);
        const sourceIndex = Number(frame?.__narrative_source_index);
        if (timestamp === null || !Number.isInteger(sourceIndex)) return null;
        return {
          frame_id: `slot:${slotIndex}:visual-context:${sourceIndex}`,
          timestamp_seconds: timestamp,
          evidence_text: visualEvidenceText(frame),
        };
      })
      .filter((frame): frame is { frame_id: string; timestamp_seconds: number; evidence_text: string } => frame !== null);
    const distinctVisualActionFrames = selectReactionMusicHookEvents(
      framesInRange,
      openingHook,
      ownedTranscript.length > 0,
    );
    const visualEventCandidates: IndependentNarrativeEvent[] = ownedTranscript.length > 0
      ? distinctVisualActionFrames
        .map((frame: any) => {
          const timestamp = finiteNumber(frame?.timestamp_seconds);
          const sourceIndex = Number(frame?.__narrative_source_index);
          if (timestamp === null || !Number.isInteger(sourceIndex)) return null;
          const eventId = `slot:${slotIndex}:visual-candidate:${sourceIndex}`;
          return {
            event_id: eventId,
            script_slot_index: slotIndex,
            slot_type: slotType,
            evidence_kind: "visual_frame" as const,
            start_seconds: timestamp,
            end_seconds: timestamp,
            evidence_text: visualActionEvidenceText(frame),
            claimed_text_excerpt: claimedExcerptByEventId.get(eventId) || null,
          };
        })
        .filter((event: IndependentNarrativeEvent | null): event is IndependentNarrativeEvent => event !== null)
      : [];

    let events: IndependentNarrativeEvent[];
    if (ownedTranscript.length > 0) {
      events = ownedTranscript.map((segment: any) => {
        const sourceIndex = Number(segment?.__narrative_source_index);
        const start = finiteNumber(segment?.start) ?? 0;
        const end = finiteNumber(segment?.end) ?? start;
        const eventId = `slot:${slotIndex}:transcript:${sourceIndex}`;
        return {
          event_id: eventId,
          script_slot_index: slotIndex,
          slot_type: slotType,
          evidence_kind: "transcript" as const,
          start_seconds: start,
          end_seconds: Math.max(start, end),
          evidence_text: boundedText(segment?.text, 900),
          claimed_text_excerpt: claimedExcerptByEventId.get(eventId) || null,
        };
      });
    } else {
      events = distinctVisualActionFrames
        .map((frame: any) => {
          const timestamp = finiteNumber(frame?.timestamp_seconds);
          const sourceIndex = Number(frame?.__narrative_source_index);
          if (timestamp === null || !Number.isInteger(sourceIndex)) return null;
          const eventId = `slot:${slotIndex}:frame:${sourceIndex}`;
          return {
            event_id: eventId,
            script_slot_index: slotIndex,
            slot_type: slotType,
            evidence_kind: "visual_frame" as const,
            start_seconds: timestamp,
            end_seconds: timestamp,
            evidence_text: visualActionEvidenceText(frame),
            claimed_text_excerpt: claimedExcerptByEventId.get(eventId) || null,
          };
        })
        .filter((event: IndependentNarrativeEvent | null): event is IndependentNarrativeEvent => event !== null);
    }

    return {
      script_slot_index: slotIndex,
      slot_type: slotType,
      generated_text: boundedText(block?.generated_text, 3000),
      time_range: range,
      visual_context: visualContext,
      visual_event_candidates: visualEventCandidates,
      events,
    };
  });

  const eventIds = planSlots.flatMap((slot) => [
    ...slot.events.map((event) => event.event_id),
    ...slot.visual_event_candidates.map((event) => event.event_id),
  ]);
  if (new Set(eventIds).size !== eventIds.length) throw new Error("independent_narrative_plan_duplicate_event_id");
  return {
    contract_version: 2,
    slots: planSlots,
    total_events: planSlots.reduce((total, slot) => total + slot.events.length, 0),
    total_visual_event_candidates: planSlots.reduce(
      (total, slot) => total + slot.visual_event_candidates.length,
      0,
    ),
  };
}

/**
 * The exact Writer clause is an input to the semantic audit, not a declaration
 * of success. Missing, duplicated, malformed or non-literal checklist rows are
 * represented as null by the plan builder and rejected here before any model
 * can fill the gap by looking at a vaguely related sentence in the block.
 */
export function assertIndependentNarrativeClaimedExcerptContract(
  plan: IndependentNarrativeAuditPlan,
): void {
  const invalidEventIds = independentNarrativeInvalidClaimedExcerptEventIds(plan);
  if (invalidEventIds.length > 0) {
    throw new Error(
      `independent_narrative_claimed_excerpt_missing_or_invalid:${invalidEventIds.join(",").slice(0, 1200)}`,
    );
  }
}

/**
 * Returns only the authoritative transcript/frame event IDs whose Writer
 * clause is missing or stale. Callers that can continue a full audit use this
 * list to fail the exact event closed without poisoning every unrelated slot.
 */
export function independentNarrativeInvalidClaimedExcerptEventIds(
  plan: IndependentNarrativeAuditPlan,
): string[] {
  return plan.slots.flatMap((slot) => {
    const generatedText = slot.generated_text.toLocaleLowerCase();
    return slot.events
      .filter((event) => {
        const excerpt = boundedText(event.claimed_text_excerpt, 1200);
        return !excerpt || !generatedText.includes(excerpt.toLocaleLowerCase());
      })
      .map((event) => event.event_id);
  });
}

function parseClaimIssues(value: unknown, errorCode: string): IndependentNarrativeClaimIssue[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error(errorCode);
  return value.map((entry) => {
    exactKeys(entry, ["claim", "reason"], errorCode);
    const claim = boundedText(entry.claim, 700);
    const reason = boundedText(entry.reason, 700);
    if (!claim || !reason) throw new Error(errorCode);
    return { claim, reason };
  });
}

/**
 * Strict parser for untrusted model output. Exact slot and event set equality
 * is mandatory: missing, duplicate and extra IDs all fail closed.
 */
export function parseIndependentNarrativeAudit(
  raw: unknown,
  plan: IndependentNarrativeAuditPlan,
): IndependentNarrativeAuditResult {
  exactKeys(raw, ["slot_audits"], "independent_narrative_audit_shape_invalid");
  if (!Array.isArray(raw.slot_audits)) throw new Error("independent_narrative_audit_slots_invalid");
  const expectedSlots = new Map(plan.slots.map((slot) => [slot.script_slot_index, slot]));
  if (raw.slot_audits.length !== expectedSlots.size) throw new Error("independent_narrative_audit_slot_count_mismatch");
  const parsedBySlot = new Map<number, IndependentNarrativeSlotResult>();

  for (const rawSlot of raw.slot_audits) {
    exactKeys(
      rawSlot,
      ["script_slot_index", "event_results", "visual_event_results", "unsupported_claims", "cross_boundary_claims"],
      "independent_narrative_audit_slot_shape_invalid",
    );
    const slotIndex = Number(rawSlot.script_slot_index);
    if (!Number.isInteger(slotIndex) || !expectedSlots.has(slotIndex)) {
      throw new Error("independent_narrative_audit_unknown_slot");
    }
    if (parsedBySlot.has(slotIndex)) throw new Error("independent_narrative_audit_duplicate_slot");
    if (!Array.isArray(rawSlot.event_results)) throw new Error("independent_narrative_audit_events_invalid");
    const expectedEvents = new Map(expectedSlots.get(slotIndex)!.events.map((event) => [event.event_id, event]));
    if (rawSlot.event_results.length !== expectedEvents.size) {
      throw new Error("independent_narrative_audit_event_count_mismatch");
    }
    const parsedEvents = new Map<string, IndependentNarrativeEventResult>();
    for (const rawEvent of rawSlot.event_results) {
      exactKeys(
        rawEvent,
        ["event_id", "coverage", "causal_relation", "reason"],
        "independent_narrative_audit_event_shape_invalid",
      );
      const eventId = boundedText(rawEvent.event_id, 240);
      if (!expectedEvents.has(eventId)) throw new Error("independent_narrative_audit_unknown_event_id");
      if (parsedEvents.has(eventId)) throw new Error("independent_narrative_audit_duplicate_event_id");
      let coverage = String(rawEvent.coverage || "") as NarrativeEventCoverage;
      let causalRelation = String(rawEvent.causal_relation || "") as NarrativeCausalRelation;
      let reason = boundedText(rawEvent.reason, 700);
      if (!["covered", "omitted", "distorted"].includes(coverage)) {
        const invalidCoverage = boundedText(rawEvent.coverage, 80) || "missing";
        coverage = "omitted";
        reason = boundedText(`fail_closed_invalid_coverage=${invalidCoverage} | ${reason || "model_reason_missing"}`, 700);
      }
      if (!["preserved", "altered", "unsupported", "not_applicable"].includes(causalRelation)) {
        const invalidCausality = boundedText(rawEvent.causal_relation, 80) || "missing";
        causalRelation = "unsupported";
        reason = boundedText(`fail_closed_invalid_causality=${invalidCausality} | ${reason || "model_reason_missing"}`, 700);
      }
      if (!reason) reason = "fail_closed_model_reason_missing";
      parsedEvents.set(eventId, {
        event_id: eventId,
        coverage,
        causal_relation: causalRelation,
        reason,
      });
    }
    if (!Array.isArray(rawSlot.visual_event_results)) {
      throw new Error("independent_narrative_audit_visual_events_invalid");
    }
    const expectedVisualEvents = new Map(
      expectedSlots.get(slotIndex)!.visual_event_candidates.map((event) => [event.event_id, event]),
    );
    if (rawSlot.visual_event_results.length !== expectedVisualEvents.size) {
      throw new Error("independent_narrative_audit_visual_event_count_mismatch");
    }
    const parsedVisualEvents = new Map<string, IndependentNarrativeSlotResult["visual_event_results"][number]>();
    for (const rawEvent of rawSlot.visual_event_results) {
      exactKeys(
        rawEvent,
        ["event_id", "materiality", "coverage", "causal_relation", "reason"],
        "independent_narrative_audit_visual_event_shape_invalid",
      );
      const eventId = boundedText(rawEvent.event_id, 240);
      if (!expectedVisualEvents.has(eventId)) {
        throw new Error("independent_narrative_audit_unknown_visual_event_id");
      }
      if (parsedVisualEvents.has(eventId)) {
        throw new Error("independent_narrative_audit_duplicate_visual_event_id");
      }
      let materiality = String(rawEvent.materiality || "") as "required" | "redundant";
      let coverage = String(rawEvent.coverage || "") as NarrativeEventCoverage | "not_required";
      let causalRelation = String(rawEvent.causal_relation || "") as NarrativeCausalRelation;
      let reason = boundedText(rawEvent.reason, 700);
      if (!['required', 'redundant'].includes(materiality)) {
        const invalidMateriality = boundedText(rawEvent.materiality, 80) || "missing";
        materiality = "required";
        reason = boundedText(`fail_closed_invalid_visual_materiality=${invalidMateriality} | ${reason || "model_reason_missing"}`, 700);
      }
      if (!['covered', 'omitted', 'distorted', 'not_required'].includes(coverage)) {
        const invalidCoverage = boundedText(rawEvent.coverage, 80) || "missing";
        coverage = "omitted";
        reason = boundedText(`fail_closed_invalid_visual_coverage=${invalidCoverage} | ${reason || "model_reason_missing"}`, 700);
      }
      if (!["preserved", "altered", "unsupported", "not_applicable"].includes(causalRelation)) {
        const invalidCausality = boundedText(rawEvent.causal_relation, 80) || "missing";
        causalRelation = "unsupported";
        reason = boundedText(`fail_closed_invalid_visual_causality=${invalidCausality} | ${reason || "model_reason_missing"}`, 700);
      }
      if (materiality === "redundant"
        && (coverage !== "not_required" || causalRelation !== "not_applicable")) {
        // Materiality is the auditor's explicit narration-duty verdict. Some
        // otherwise valid responses still describe a redundant frame as
        // "covered" because the generated text happens to mention its entity.
        // Canonicalize the dependent enums instead of inflating illustrative
        // poses/repeated frames into mandatory story events. An invalid or
        // missing materiality enum was already converted to required above.
        coverage = "not_required";
        causalRelation = "not_applicable";
        reason = boundedText(`canonicalized_redundant_visual_verdict | ${reason}`, 700);
      }
      if (materiality === "required" && coverage === "not_required") {
        coverage = "omitted";
        causalRelation = "unsupported";
        reason = boundedText(`fail_closed_required_visual_marked_not_required | ${reason || "model_reason_missing"}`, 700);
      }
      if (!reason) reason = "fail_closed_model_visual_reason_missing";
      parsedVisualEvents.set(eventId, {
        event_id: eventId,
        materiality,
        coverage,
        causal_relation: causalRelation,
        reason,
      });
    }
    parsedBySlot.set(slotIndex, {
      script_slot_index: slotIndex,
      event_results: expectedSlots.get(slotIndex)!.events.map((event) => parsedEvents.get(event.event_id)!),
      visual_event_results: expectedSlots.get(slotIndex)!.visual_event_candidates
        .map((event) => parsedVisualEvents.get(event.event_id)!),
      unsupported_claims: parseClaimIssues(
        rawSlot.unsupported_claims,
        "independent_narrative_audit_unsupported_claims_invalid",
      ),
      cross_boundary_claims: parseClaimIssues(
        rawSlot.cross_boundary_claims,
        "independent_narrative_audit_cross_boundary_claims_invalid",
      ),
    });
  }

  return {
    slot_audits: plan.slots.map((slot) => parsedBySlot.get(slot.script_slot_index)!),
  };
}

function normalizedQualifierText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function writerEvidenceClauses(generatedText: string): string[] {
  const rawText = String(generatedText || "").trim();
  if (!rawText) return [];
  const sentenceLike = rawText.match(/[^.!?;]+[.!?;]?/gu) || [rawText];
  return sentenceLike.flatMap((sentence) => sentence
    .split(/,\s+(?=(?:mas|porÃ©m|porem|contudo|entretanto|but|however|pero|sin embargo)\b)/iu)
    .map((clause) => clause.trim())
    .filter(Boolean));
}

function normalizedWriterEvidenceTokens(value: unknown): string[] {
  const normalized = normalizedQualifierText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

/**
 * Finds a clause only when the evidence words occur as one exact contiguous
 * normalized token window. Normalization may remove case, accents and
 * punctuation (including clitic hyphens), but it may not replace, reorder or
 * omit words from that window. Requiring exactly one matching clause prevents
 * a generic/stale excerpt from being attached to an arbitrary occurrence.
 */
function uniqueNormalizedWriterEvidenceClause(generatedText: string, excerpt: string): string | null {
  const excerptTokens = normalizedWriterEvidenceTokens(excerpt);
  if (excerptTokens.length === 0) return null;
  const candidates = writerEvidenceClauses(generatedText).filter((clause) => {
    const clauseTokens = normalizedWriterEvidenceTokens(clause);
    if (clauseTokens.length < excerptTokens.length) return false;
    for (let start = 0; start <= clauseTokens.length - excerptTokens.length; start += 1) {
      const exactWindow = excerptTokens.every((token, offset) => clauseTokens[start + offset] === token);
      if (exactWindow) return true;
    }
    return false;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function smallestEnclosingWriterEvidenceClause(generatedText: string, excerpt: string): string | null {
  const rawExcerpt = String(excerpt || "").trim();
  if (!rawExcerpt) return null;
  const excerptLower = rawExcerpt.toLocaleLowerCase();
  const literalMatches = writerEvidenceClauses(generatedText)
    .filter((clause) => clause.toLocaleLowerCase().includes(excerptLower))
    .sort((left, right) => left.length - right.length);
  if (literalMatches.length > 0) return literalMatches[0];
  return uniqueNormalizedWriterEvidenceClause(generatedText, rawExcerpt);
}

function hasAnyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasExplicitPurpose(text: string): boolean {
  if (hasAnyPattern(text, [
    /\b(?:a fim de|com (?:a )?(?:intencao|finalidade) de|com o (?:objetivo|proposito) de)\b/,
    /\b(?:a fin de|con (?:la )?(?:intencion|finalidad) de|con el objetivo de)\b/,
    /\b(?:in order to|so as to|so that|with the (?:aim|intention|purpose) of)\b/,
    /\bpara\s+que\b/,
  ])) return true;
  if (hasAnyPattern(text, [
    /\b(?:tentou|tentaram|tentava|tentavam)\s+(?:deter|dete\s+l[oa]s?|parar|impedir|capturar|conter|segurar)\b/,
    /\b(?:intento|intentaron|intentaba|intentaban)\s+(?:detener|detenerl[oa]s?|parar|impedir|capturar|contener)\b/,
    /\b(?:tried|attempted)\s+to\s+(?:stop|detain|catch|capture|contain|restrain|prevent)\b/,
  ])) return true;

  // PT/ES infinitives after "para". The clitic form handles orthographic
  // contractions such as "devora-lo" after accent/punctuation normalization.
  if (/\bpara\s+(?:nao\s+|no\s+)?[a-z]{3,}(?:ar|er|ir)(?:lo|la|los|las|se)?\b/.test(text)) return true;
  if (/\bpara\s+(?:nao\s+|no\s+)?[a-z]{3,}[aei]\s+(?:lo|la|los|las)\b/.test(text)) return true;

  // English has no morphological infinitive marker. Restrict the bare "to"
  // form to purpose verbs so destinations such as "to a company" do not become
  // false causal relations.
  return /\bto\s+(?:avoid|catch|conceal|contain|convince|deceive|destroy|detain|devour|disguise|eat|ensure|escape|hide|impersonate|kill|prevent|protect|save|stop|trick)\b/.test(text);
}

function hasConcealmentPurpose(text: string): boolean {
  return hasAnyPattern(text, [
    /\bpara (?:nao )?(?:levantar|despertar|gerar|causar) suspeit\p{L}*\b/u,
    /\bpara evitar suspeit\p{L}*\b/u,
    /\bpara que (?:(?:ela|ele|a filha|o filho|a menina|o menino|ninguem) )?nao suspeit\p{L}*\b/u,
    /\bpara (?:no )?(?:levantar|despertar|generar|causar) sospech\p{L}*\b/u,
    /\bpara evitar sospech\p{L}*\b/u,
    /\bpara que (?:(?:ella|el|la hija|el hijo|la nina|el nino|nadie) )?no sospech\p{L}*\b/u,
    /\b(?:to avoid|without raising) suspicion\b/u,
    /\bso that (?:she|he|they|nobody) (?:would not|wouldn t|did not|didn t) suspect\b/u,
  ]);
}

function hasBossImpressedByEffort(text: string): boolean {
  const boss = /\b(?:chefe|supervisor|jefe|boss|manager)\b/.test(text);
  const impressed = /\b(?:impressionad[oa]s?|impressionou|impresionad[oa]s?|impresiono|impressed|admira(?:do|da|dos|das)?|admirado)\b/.test(text);
  const effort = /\b(?:esforco|esforcos|esfuerzo|esfuerzos|effort|efforts|empenho|dedicacao|dedication|hard work)\b/.test(text);
  return boss && impressed && effort;
}

function hasWifeAndDaughter(text: string): boolean {
  const wife = /\b(?:esposa|mulher|esposa|mujer|wife)\b/.test(text);
  const daughter = /\b(?:filha|hija|daughter)\b/.test(text);
  return wife && daughter;
}

function hasRawMeatCraving(text: string): boolean {
  const craving = /\b(?:vontade|desejo|queria|querendo|ansiava|ganas|deseo|queria|craving|urge|wanted)\b/.test(text);
  const rawMeat = /\b(?:carne crua|carne cruda|raw meat)\b/.test(text);
  return craving && rawMeat;
}

interface DeterministicQualifierRule {
  id: DeterministicNarrativeQualifier;
  causal: boolean;
  present: (text: string, event: IndependentNarrativeEvent) => boolean;
}

function patternedQualifier(
  id: DeterministicNarrativeQualifier,
  patterns: readonly RegExp[],
  options: { causal?: boolean; openingOnly?: boolean } = {},
): DeterministicQualifierRule {
  return {
    id,
    causal: options.causal === true,
    present: (text, event) => {
      if (options.openingOnly && event.start_seconds > 5.001 && event.slot_type !== "hook") return false;
      return hasAnyPattern(text, patterns);
    },
  };
}

const DETERMINISTIC_QUALIFIER_RULES: readonly DeterministicQualifierRule[] = [
  patternedQualifier("accidental_mode", [
    /\b(?:sem perceber|sem se dar conta|sem saber|por acidente|acidentalmente)\b/,
    /\b(?:sin darse cuenta|sin saberlo|por accidente|accidentalmente)\b/,
    /\b(?:without reali[sz]ing|without knowing|unknowingly|unwittingly|by accident|accidentally)\b/,
  ]),
  patternedQualifier("surprise", [
    /\b(?:para (?:a |sua |minha )?surpresa|surpreendentemente|inesperadamente)\b/,
    /\b(?:para (?:su |mi )?sorpresa|sorprendentemente|inesperadamente)\b/,
    /\b(?:to (?:his|her|their|my|our) surprise|surprisingly|unexpectedly)\b/,
  ]),
  patternedQualifier("immediacy", [
    /\b(?:imediatamente|ao instante|no mesmo instante|na mesma hora|de imediato|instantaneamente)\b/,
    /\b(?:al instante|inmediatamente|en el mismo instante|de inmediato|instantaneamente)\b/,
    /\b(?:at once|immediately|in that instant|instantly|right away)\b/,
  ]),
  patternedQualifier("graduality", [
    /\b(?:aos poucos|pouco a pouco|gradualmente|progressivamente|com o passar do tempo|com o tempo)\b/,
    /\b(?:poco a poco|gradualmente|progresivamente|con el paso del tiempo|con el tiempo)\b/,
    /\b(?:little by little|gradually|progressively|over time|as time passed)\b/,
  ]),
  patternedQualifier("nightly_frequency", [
    /\b(?:todas as noites|toda noite|a cada noite|noite apos noite)\b/,
    /\b(?:todas las noches|cada noche|noche tras noche)\b/,
    /\b(?:every night|each night|night after night|nightly)\b/,
  ]),
  {
    id: "raw_meat_craving",
    causal: false,
    present: (text) => hasRawMeatCraving(text),
  },
  patternedQualifier("days_later_delay", [
    /\b(?:dias depois|dias mais tarde|alguns dias depois|poucos dias depois|depois de (?:alguns|poucos) dias)\b/,
    /\b(?:dias despues|dias mas tarde|algunos dias despues|pocos dias despues|despues de (?:algunos|pocos) dias)\b/,
    /\b(?:days later|days afterward|a few days later|several days later|after (?:a few|several) days)\b/,
  ]),
  patternedQualifier("unable_to_contain", [
    /\b(?:nao (?:conseguiu|conseguia|pode|podia) se (?:conter|controlar|segurar)|incapaz de se (?:conter|controlar)|ja nao se conteve)\b/,
    /\b(?:no pudo contenerse|no podia contenerse|incapaz de contenerse|ya no pudo contenerse)\b/,
    /\b(?:(?:could not|couldn t|was unable to|no longer could) (?:contain|control|restrain) (?:himself|herself|itself|themselves))\b/,
  ]),
  {
    id: "purpose",
    causal: true,
    present: (text, event) => {
      const sourceRequiresConcealmentTarget = hasConcealmentPurpose(
        normalizedQualifierText(event.evidence_text),
      );
      return !sourceRequiresConcealmentTarget && hasExplicitPurpose(text);
    },
  },
  {
    id: "concealment_purpose",
    causal: true,
    present: (text, event) => hasConcealmentPurpose(normalizedQualifierText(event.evidence_text))
      && hasConcealmentPurpose(text),
  },
  {
    id: "boss_impressed_by_effort",
    causal: true,
    present: (text) => hasBossImpressedByEffort(text),
  },
  patternedQualifier("fear", [
    /\b(?:com medo|chei[oa]s? de medo|em panico|panico|apavorad[oa]s?|assustad[oa]s?|aterrorizad[oa]s?)\b/,
    /\b(?:con miedo|llen[oa]s? de miedo|aterrorizad[oa]s?|asustad[oa]s?)\b/,
    /\b(?:with fear|full of fear|terrified|frightened|afraid|scared)\b/,
  ]),
  patternedQualifier("desperation", [
    /\b(?:desesperad[oa]s?|desesperadamente)\b/,
    /\b(?:desperate|desperately)\b/,
  ]),
  patternedQualifier("in_front_of_everyone", [
    /\b(?:diante de todos|perante todos|na frente de todos|publicamente)\b/,
    /\b(?:ante todos|delante de todos|frente a todos|publicamente)\b/,
    /\b(?:in front of everyone|in front of everybody|before everyone|before everybody|publicly)\b/,
  ]),
  patternedQualifier("true_appearance", [
    /\b(?:(?:aparencia|forma|aspecto) (?:real|verdadeir[oa])|verdadeir[oa] (?:aparencia|forma))\b/,
    /\b(?:(?:apariencia|forma|aspecto) (?:real|verdader[oa])|verdader[oa] (?:apariencia|forma))\b/,
    /\b(?:(?:true|real) (?:appearance|form)|appearance as (?:he|she|it) really was)\b/,
  ]),
  patternedQualifier("complete_intensity", [
    /\b(?:completamente|totalmente|por completo|inteiramente)\b/,
    /\b(?:completely|totally|entirely|utterly)\b/,
  ]),
  patternedQualifier("full_speed", [
    /\b(?:a toda velocidade|em velocidade maxima|o mais rapido possivel)\b/,
    /\b(?:a toda velocidad|a maxima velocidad|lo mas rapido posible)\b/,
    /\b(?:at full speed|at top speed|as fast as (?:he|she|it|they) could|as fast as possible)\b/,
  ]),
  patternedQualifier("forest_destination", [
    /\b(?:ao|ate o|para o|rumo ao|em direcao ao)\s+bosque\b/,
    /\b(?:a|ate a|para a|rumo a|em direcao a)\s+(?:floresta|mata)\b/,
    /\b(?:al|hasta el|para el|hacia el|rumbo al)\s+bosque\b/,
    /\b(?:to|toward|towards|into)\s+(?:the\s+)?(?:forest|woods|woodland)\b/,
  ]),
  patternedQualifier("one_day", [
    /\b(?:um dia|certo dia|num certo dia)\b/,
    /\b(?:un dia|cierto dia)\b/,
    /\bone day\b/,
  ]),
  patternedQualifier("opening_hunger", [
    /\b(?:famint\p{L}*|hambrient\p{L}*|hungr\p{L}*)\b/u,
  ], { openingOnly: true }),
  patternedQualifier("explicit_abandoned_condition", [
    /\b(?:abandonad\p{L}*|abandoned)\b/u,
  ]),
  patternedQualifier("opening_intrigued", [
    /\b(?:intrigad[oa]s?|curios[oa]s?|intrigued|curious)\b/,
  ], { openingOnly: true }),
  patternedQualifier("wear_action", [
    /\b(?:veste|vestiu|vestia|vestir|vestindo|vesti (?:lo|la)|colocou (?:a |o )?[^.]{0,24}(?:sobre si|no corpo|em si))\b/,
    /\b(?:se (?:la|lo) puso|ponersela|ponerselo|vistio|vestir(?:se)?|llevaba puest[oa])\b/,
    /\b(?:put (?:it|the skin) on|wore|wearing|donned)\b/,
  ], { causal: true }),
  patternedQualifier("large_company", [
    /\b(?:(?:grande|enorme) (?:empresa|companhia|corporacao)|(?:empresa|companhia|corporacao) (?:grande|enorme))\b/,
    /\b(?:(?:gran|enorme) (?:empresa|compania|corporacion)|(?:empresa|compania|corporacion) (?:grande|enorme))\b/,
    /\b(?:(?:big|large|major|huge) (?:company|corporation)|(?:company|corporation) (?:that was )?(?:big|large|major|huge))\b/,
  ]),
  patternedQualifier("job_interview", [
    /\b(?:entrevista de trabalho|entrevista de emprego|entrevista profissional)\b/,
    /\b(?:entrevista de trabajo|entrevista laboral|entrevista de empleo)\b/,
    /\b(?:job interview|employment interview|work interview)\b/,
  ]),
  patternedQualifier("gift_explanation", [
    /\b(?:presente|regalo|gift)\b/,
  ]),
  patternedQualifier("work_meeting", [
    /\b(?:reuniao de trabalho|reuniao profissional|reuniao da empresa)\b/,
    /\b(?:reunion de trabajo|reunion laboral|reunion de la empresa)\b/,
    /\b(?:work meeting|business meeting|company meeting)\b/,
  ]),
  patternedQualifier("mansion_specificity", [
    /\b(?:mansao|palacete|mansion)\b/,
  ]),
  {
    id: "wife_and_daughter",
    causal: false,
    present: (text) => hasWifeAndDaughter(text),
  },
];

const UNSUPPORTED_INTERPRETIVE_FILLER_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "double_life", pattern: /\b(?:vida dupla|double life|doble vida)\b/u },
  { id: "destiny", pattern: /\b(?:destino|destiny)\b/u },
  { id: "essence", pattern: /\b(?:essencia|essence|esencia)\b/u },
  { id: "psychological_void", pattern: /\b(?:vazio psicologico|psychological void|vacio psicologico)\b/u },
  { id: "justice_or_karma", pattern: /\b(?:justica|justice|karma)\b/u },
  { id: "lesson_or_punishment", pattern: /\b(?:licao|lesson|castigo|punishment)\b/u },
  {
    id: "moral_generalization",
    pattern: /\b(?:provando|mostrando|ensinando|proving|showing|teaching|demostrando|mostrando|ensenando)\s+que\b[^.!?]{0,90}\b(?:nao e tudo|never is everything|no lo es todo|sempre|always|siempre|nunca|never|vale a pena|worth it|vale la pena|compensa|pays off|e o que importa|is what matters|es lo que importa)\b/u,
  },
];

function deterministicUnsupportedInterpretiveClaims(
  planSlot: IndependentNarrativeAuditSlot,
): IndependentNarrativeClaimIssue[] {
  const generated = normalizedQualifierText(planSlot.generated_text);
  const localEvidence = normalizedQualifierText([
    ...planSlot.events.map((event) => event.evidence_text),
    ...planSlot.visual_event_candidates.map((event) => event.evidence_text),
    ...planSlot.visual_context.map((event) => event.evidence_text),
  ].join(" "));
  return UNSUPPORTED_INTERPRETIVE_FILLER_PATTERNS.flatMap(({ id, pattern }) => {
    const generatedMatch = generated.match(pattern)?.[0] || "";
    if (!generatedMatch || pattern.test(localEvidence)) return [];
    return [{
      claim: generatedMatch,
      reason: `deterministic_unsupported_interpretive_filler:${id}`,
    }];
  });
}

function withoutDeterministicQualifierPrefix(reason: string): string {
  return boundedText(reason, 700)
    .replace(/^deterministic_missing_qualifiers=\[[a-z0-9_,]*\]\s*\|\s*/i, "")
    .trim();
}

/**
 * Fail-closed local qualifier verifier for PT/ES/EN evidence. The semantic
 * auditors can judge paraphrases, but they cannot approve a clause which drops
 * an explicit narrative modifier from the source. Only the Writer's literal
 * `claimed_text_excerpt` is compared, never the wider block, so a neighboring
 * sentence cannot accidentally satisfy the event.
 */
export function applyDeterministicNarrativeQualifierGate(
  plan: IndependentNarrativeAuditPlan,
  result: IndependentNarrativeAuditResult,
): IndependentNarrativeAuditResult {
  const planSlots = new Map(plan.slots.map((slot) => [slot.script_slot_index, slot]));
  return {
    slot_audits: result.slot_audits.map((slotAudit) => {
      const planSlot = planSlots.get(slotAudit.script_slot_index);
      if (!planSlot) throw new Error("deterministic_narrative_qualifier_slot_missing");
      const eventById = new Map(planSlot.events.map((event) => [event.event_id, event]));
      return {
        ...slotAudit,
        event_results: slotAudit.event_results.map((verdict) => {
          const event = eventById.get(verdict.event_id);
          if (!event) throw new Error("deterministic_narrative_qualifier_event_missing");
          const source = normalizedQualifierText(event.evidence_text);
          const claimed = normalizedQualifierText(event.claimed_text_excerpt);
          const missingRules = DETERMINISTIC_QUALIFIER_RULES.filter((rule) =>
            rule.present(source, event) && !rule.present(claimed, event)
          );
          if (missingRules.length === 0) return verdict;

          const deterministicMissingQualifiers = [...new Set([
            ...(Array.isArray(verdict.deterministic_missing_qualifiers)
              ? verdict.deterministic_missing_qualifiers
              : []),
            ...missingRules.map((rule) => rule.id),
          ])];
          const tag = `deterministic_missing_qualifiers=[${deterministicMissingQualifiers.join(",")}]`;
          const priorReason = withoutDeterministicQualifierPrefix(verdict.reason);
          return {
            ...verdict,
            coverage: "distorted" as const,
            causal_relation: missingRules.some((rule) => rule.causal)
              ? "altered" as const
              : verdict.causal_relation,
            reason: boundedText(`${tag} | ${priorReason}`, 700),
            deterministic_missing_qualifiers: deterministicMissingQualifiers,
          };
        }),
        unsupported_claims: [
          ...slotAudit.unsupported_claims,
          ...deterministicUnsupportedInterpretiveClaims(planSlot),
        ].filter((issue, position, all) =>
          all.findIndex((candidate) => normalizedClaimKey(candidate.claim) === normalizedClaimKey(issue.claim)) === position
        ),
      };
    }),
  };
}

function mergeAuditReasons(
  comprehensiveReason: string,
  adversarialReason: string,
  disagreement: string | null = null,
): string {
  const comprehensive = boundedText(comprehensiveReason, 620);
  const adversarial = boundedText(adversarialReason, 620);
  const pieces = comprehensive === adversarial
    ? [`auditors: ${comprehensive}`]
    : [`comprehensive: ${comprehensive}`, `adversarial: ${adversarial}`];
  if (disagreement) pieces.push(disagreement);
  return boundedText(pieces.join(" | "), 700);
}

function mergeCoverageFailClosed(
  comprehensive: NarrativeEventCoverage,
  adversarial: NarrativeEventCoverage,
): NarrativeEventCoverage {
  if (comprehensive === "covered" && adversarial === "covered") return "covered";
  // A partial proposition is still a distortion even when the other auditor
  // called the entire event absent. Both outcomes fail the fidelity gate; the
  // distortion verdict retains the more actionable component-level diagnosis.
  if (comprehensive === "distorted" || adversarial === "distorted") return "distorted";
  return "omitted";
}

function mergeCausalRelationFailClosed(
  comprehensive: NarrativeCausalRelation,
  adversarial: NarrativeCausalRelation,
): NarrativeCausalRelation {
  if (comprehensive === "unsupported" || adversarial === "unsupported") return "unsupported";
  if (comprehensive === "altered" || adversarial === "altered") return "altered";
  if (comprehensive === adversarial) return comprehensive;
  // `preserved` versus `not_applicable` is an applicability disagreement, not
  // evidence that a relation was changed. Both are passing states in the
  // downstream contract. Treating this pair as `altered` made every simple
  // action fail merely because one model called the event non-causal while the
  // other used `preserved` as a generic success label. Actual causal loss must
  // still surface as coverage=distorted/omitted or an explicit altered/
  // unsupported verdict from either auditor.
  return "preserved";
}

function normalizedClaimKey(claim: string): string {
  return claim
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mergeClaimIssuesFailClosed(
  comprehensive: IndependentNarrativeClaimIssue[],
  adversarial: IndependentNarrativeClaimIssue[],
): IndependentNarrativeClaimIssue[] {
  const merged = new Map<string, { claim: string; comprehensive?: string; adversarial?: string }>();
  const append = (issue: IndependentNarrativeClaimIssue, auditor: "comprehensive" | "adversarial") => {
    const key = normalizedClaimKey(issue.claim) || `${auditor}:${merged.size}`;
    const current = merged.get(key) || { claim: issue.claim };
    current[auditor] = issue.reason;
    merged.set(key, current);
  };
  comprehensive.forEach((issue) => append(issue, "comprehensive"));
  adversarial.forEach((issue) => append(issue, "adversarial"));
  return [...merged.values()].map((issue) => ({
    claim: boundedText(issue.claim, 700),
    reason: issue.comprehensive && issue.adversarial
      ? mergeAuditReasons(issue.comprehensive, issue.adversarial)
      : boundedText(
        `${issue.comprehensive ? "comprehensive" : "adversarial"}: ${issue.comprehensive || issue.adversarial}`,
        700,
      ),
  }));
}

/**
 * Requires two independently parsed audits to agree before an event can pass.
 * A single omission, distortion, causal failure, material visual event or
 * unsupported/cross-boundary claim survives the merge. Consequently a missing
 * or malformed second result throws and the caller's outer fail-closed path
 * rejects the complete narrative audit.
 */
export function mergeIndependentNarrativeAuditsFailClosed(
  plan: IndependentNarrativeAuditPlan,
  comprehensive: IndependentNarrativeAuditResult,
  adversarial: IndependentNarrativeAuditResult,
): IndependentNarrativeAuditResult {
  const comprehensiveSlots = new Map(
    comprehensive.slot_audits.map((slot) => [slot.script_slot_index, slot]),
  );
  const adversarialSlots = new Map(
    adversarial.slot_audits.map((slot) => [slot.script_slot_index, slot]),
  );
  if (comprehensiveSlots.size !== plan.slots.length || adversarialSlots.size !== plan.slots.length) {
    throw new Error("independent_narrative_dual_audit_slot_mismatch");
  }

  return {
    slot_audits: plan.slots.map((planSlot) => {
      const comprehensiveSlot = comprehensiveSlots.get(planSlot.script_slot_index);
      const adversarialSlot = adversarialSlots.get(planSlot.script_slot_index);
      if (!comprehensiveSlot || !adversarialSlot) {
        throw new Error("independent_narrative_dual_audit_slot_missing");
      }
      const comprehensiveEvents = new Map(
        comprehensiveSlot.event_results.map((event) => [event.event_id, event]),
      );
      const adversarialEvents = new Map(
        adversarialSlot.event_results.map((event) => [event.event_id, event]),
      );
      const comprehensiveVisualEvents = new Map(
        comprehensiveSlot.visual_event_results.map((event) => [event.event_id, event]),
      );
      const adversarialVisualEvents = new Map(
        adversarialSlot.visual_event_results.map((event) => [event.event_id, event]),
      );
      if (
        comprehensiveEvents.size !== planSlot.events.length
        || adversarialEvents.size !== planSlot.events.length
        || comprehensiveVisualEvents.size !== planSlot.visual_event_candidates.length
        || adversarialVisualEvents.size !== planSlot.visual_event_candidates.length
      ) {
        throw new Error("independent_narrative_dual_audit_event_mismatch");
      }

      const eventResults = planSlot.events.map((event) => {
        const left = comprehensiveEvents.get(event.event_id);
        const right = adversarialEvents.get(event.event_id);
        if (!left || !right) throw new Error("independent_narrative_dual_audit_event_missing");
        const disagreement = left.coverage !== right.coverage || left.causal_relation !== right.causal_relation
          ? `fail_closed_disagreement:${left.coverage}/${left.causal_relation}!=${right.coverage}/${right.causal_relation}`
          : null;
        return {
          event_id: event.event_id,
          coverage: mergeCoverageFailClosed(left.coverage, right.coverage),
          causal_relation: mergeCausalRelationFailClosed(left.causal_relation, right.causal_relation),
          reason: mergeAuditReasons(left.reason, right.reason, disagreement),
        };
      });

      const visualEventResults = planSlot.visual_event_candidates.map((event) => {
        const left = comprehensiveVisualEvents.get(event.event_id);
        const right = adversarialVisualEvents.get(event.event_id);
        if (!left || !right) throw new Error("independent_narrative_dual_audit_visual_event_missing");
        if (left.materiality === "redundant" && right.materiality === "redundant") {
          return {
            event_id: event.event_id,
            materiality: "redundant" as const,
            coverage: "not_required" as const,
            causal_relation: "not_applicable" as const,
            reason: mergeAuditReasons(left.reason, right.reason),
          };
        }
        const requiredVerdicts = [left, right].filter((verdict) => verdict.materiality === "required");
        const first = requiredVerdicts[0];
        const second = requiredVerdicts[1] || first;
        const materialityDisagreement = left.materiality !== right.materiality
          ? `fail_closed_materiality_disagreement:${left.materiality}!=${right.materiality}`
          : null;
        return {
          event_id: event.event_id,
          materiality: "required" as const,
          coverage: mergeCoverageFailClosed(
            first.coverage as NarrativeEventCoverage,
            second.coverage as NarrativeEventCoverage,
          ),
          causal_relation: mergeCausalRelationFailClosed(first.causal_relation, second.causal_relation),
          reason: mergeAuditReasons(first.reason, second.reason, materialityDisagreement),
        };
      });

      return {
        script_slot_index: planSlot.script_slot_index,
        event_results: eventResults,
        visual_event_results: visualEventResults,
        unsupported_claims: mergeClaimIssuesFailClosed(
          comprehensiveSlot.unsupported_claims,
          adversarialSlot.unsupported_claims,
        ),
        cross_boundary_claims: mergeClaimIssuesFailClosed(
          comprehensiveSlot.cross_boundary_claims,
          adversarialSlot.cross_boundary_claims,
        ),
      };
    }),
  };
}

/**
 * Makes the Writer explicitly acknowledge every authoritative event ID. This
 * is not a semantic judge (the independent auditor remains authoritative), but
 * it prevents a rewrite from silently dropping checklist rows while fixing a
 * neighboring event.
 */
export function assessWriterNarrativeChecklist(options: {
  plan: IndependentNarrativeAuditPlan;
  proposedBlocks: any[];
  expectedSlotIndexes?: number[];
  /** Visual candidates become Writer obligations only after the independent
   * auditor classified them as material and emitted them in the prior audit. */
  priorMicroeventAudit?: any[];
  /** Initial drafts may enter the evaluator with semantic qualifier gaps so
   * the evaluator can produce precise repair feedback. Revisions enable this
   * guard to prevent an already restored qualifier from oscillating away. */
  enforceDeterministicQualifiers?: boolean;
}): WriterNarrativeChecklistAssessment {
  const proposedBlocks = Array.isArray(options.proposedBlocks) ? options.proposedBlocks : [];
  const planBySlot = new Map(options.plan.slots.map((slot) => [slot.script_slot_index, slot]));
  const priorRequiredEventIds = new Set(
    (Array.isArray(options.priorMicroeventAudit) ? options.priorMicroeventAudit : [])
      .map((event: any) => String(event?.event_id || "").trim())
      .filter(Boolean),
  );
  const expectedIndexes = options.expectedSlotIndexes === undefined
    ? options.plan.slots.map((slot) => slot.script_slot_index)
    : [...new Set(options.expectedSlotIndexes.map(Number).filter(Number.isInteger))];
  const byIndex = new Map<number, any[]>();
  for (const block of proposedBlocks) {
    const index = Number(block?.index);
    if (!Number.isInteger(index)) continue;
    byIndex.set(index, [...(byIndex.get(index) || []), block]);
  }
  const issues: WriterNarrativeChecklistIssue[] = [];
  for (const slotIndex of expectedIndexes) {
    const matches = byIndex.get(slotIndex) || [];
    const planSlot = planBySlot.get(slotIndex);
    if (matches.length !== 1 || !planSlot) {
      issues.push({
        script_slot_index: slotIndex,
        type: "writer_checklist_block_missing_or_duplicate",
        event_ids: planSlot?.events.map((event) => event.event_id) || [],
      });
      continue;
    }
    const rawIds = Array.isArray(matches[0]?.covered_event_ids)
      ? matches[0].covered_event_ids.map((value: unknown) => String(value || "").trim()).filter(Boolean)
      : [];
    const expectedEvents = [
      ...planSlot.events,
      ...planSlot.visual_event_candidates.filter((event) => priorRequiredEventIds.has(event.event_id)),
    ];
    const expectedIds = expectedEvents.map((event) => event.event_id);
    const expectedSet = new Set(expectedIds);
    const returnedSet = new Set(rawIds);
    const duplicateIds = [...new Set(rawIds.filter((id: string, position: number) => rawIds.indexOf(id) !== position))];
    const unknownIds = [...returnedSet].filter((id) => !expectedSet.has(id));
    const missingIds = expectedIds.filter((id) => !returnedSet.has(id));
    if (rawIds.length === 0 || missingIds.length > 0) {
      issues.push({
        script_slot_index: slotIndex,
        type: "writer_checklist_ids_missing",
        event_ids: missingIds.length > 0 ? missingIds : expectedIds,
      });
    }
    if (duplicateIds.length > 0) {
      issues.push({
        script_slot_index: slotIndex,
        type: "writer_checklist_ids_duplicate",
        event_ids: duplicateIds,
      });
    }
    if (unknownIds.length > 0) {
      issues.push({
        script_slot_index: slotIndex,
        type: "writer_checklist_ids_unknown",
        event_ids: unknownIds,
      });
    }
    const rawEvidence = Array.isArray(matches[0]?.event_text_evidence)
      ? matches[0].event_text_evidence
      : [];
    const evidenceById = new Map<string, any[]>();
    for (const row of rawEvidence) {
      const eventId = String(row?.event_id || "").trim();
      if (!eventId) continue;
      evidenceById.set(eventId, [...(evidenceById.get(eventId) || []), row]);
    }
    const rawGeneratedText = String(matches[0]?.generated_text || "").trim();
    const generatedText = rawGeneratedText.toLocaleLowerCase();
    const invalidEvidenceDetails: string[] = [];
    const invalidEvidenceIds = expectedIds.filter((eventId) => {
      const rows = evidenceById.get(eventId) || [];
      if (rows.length !== 1) {
        invalidEvidenceDetails.push(`${eventId}:row_count=${rows.length}`);
        return true;
      }
      const rowKeys = Object.keys(rows[0] || {}).sort().join("|");
      const rawExcerpt = String(rows[0]?.text_excerpt || "").trim();
      const excerpt = rawExcerpt.toLocaleLowerCase();
      if (rowKeys !== "event_id|text_excerpt") {
        invalidEvidenceDetails.push(`${eventId}:unexpected_keys=${rowKeys || "none"}`);
        return true;
      }
      if (!excerpt) {
        invalidEvidenceDetails.push(`${eventId}:empty_excerpt`);
        return true;
      }
      if (!generatedText.includes(excerpt)) {
        const normalizedClause = uniqueNormalizedWriterEvidenceClause(rawGeneratedText, rawExcerpt);
        if (!normalizedClause) {
          invalidEvidenceDetails.push(`${eventId}:excerpt_not_literal_substring`);
          return true;
        }
        // Downstream qualifier/material-action checks and the independent
        // auditor must receive a real literal clause from the final text, not
        // the Writer's punctuation-normalized approximation.
        rows[0].text_excerpt = normalizedClause;
      }
      return false;
    });
    const extraEvidenceIds = [...evidenceById.keys()].filter((eventId) => !expectedSet.has(eventId));
    if (extraEvidenceIds.length > 0) {
      invalidEvidenceDetails.push(...extraEvidenceIds.map((eventId) => `${eventId}:unknown_event_id`));
    }
    if (invalidEvidenceIds.length > 0 || extraEvidenceIds.length > 0) {
      issues.push({
        script_slot_index: slotIndex,
        type: "writer_checklist_text_evidence_invalid",
        event_ids: [...new Set([...invalidEvidenceIds, ...extraEvidenceIds])],
        details: invalidEvidenceDetails,
      });
    }
    const missingMaterialVisualActions = expectedEvents.flatMap((event) => {
      if (event.evidence_kind !== "visual_frame") return [];
      const rows = evidenceById.get(event.event_id) || [];
      if (rows.length !== 1) return [];
      const excerpt = String(rows[0]?.text_excerpt || "").trim();
      return missingExplicitMaterialVisualAction(event.evidence_text, excerpt) === true
        ? [event.event_id]
        : [];
    });
    if (missingMaterialVisualActions.length > 0) {
      issues.push({
        script_slot_index: slotIndex,
        type: "writer_checklist_material_visual_action_missing",
        event_ids: missingMaterialVisualActions,
        details: missingMaterialVisualActions.map((eventId) => {
          const event = expectedEvents.find((candidate) => candidate.event_id === eventId);
          const requirements = event ? materialVisualActionRuleIds(event.evidence_text) : [];
          return `${eventId}:explicit_physical_action_or_object_missing:${requirements.join("+") || "uncategorized"}`;
        }),
      });
    }
    const qualifierFailures = options.enforceDeterministicQualifiers === false ? [] : expectedEvents.flatMap((event) => {
      if (event.evidence_kind !== "transcript") return [];
      const rows = evidenceById.get(event.event_id) || [];
      if (rows.length !== 1) return [];
      const sourceText = normalizedQualifierText(event.evidence_text);
      const requiredRules = DETERMINISTIC_QUALIFIER_RULES
        .filter((rule) => rule.present(sourceText, event));
      const missingFromGeneratedText = requiredRules
        .filter((rule) => !rule.present(normalizedQualifierText(rawGeneratedText), event));
      let claimedExcerpt = normalizedQualifierText(rows[0]?.text_excerpt);
      let missingFromClaimedExcerpt = requiredRules
        .filter((rule) => !rule.present(claimedExcerpt, event));
      if (missingFromGeneratedText.length === 0 && missingFromClaimedExcerpt.length > 0) {
        const enclosingClause = smallestEnclosingWriterEvidenceClause(
          rawGeneratedText,
          String(rows[0]?.text_excerpt || ""),
        );
        if (enclosingClause) {
          const normalizedClause = normalizedQualifierText(enclosingClause);
          const clauseCarriesEveryQualifier = requiredRules.every((rule) => rule.present(normalizedClause, event));
          if (clauseCarriesEveryQualifier) {
            rows[0].text_excerpt = enclosingClause;
            claimedExcerpt = normalizedClause;
            missingFromClaimedExcerpt = [];
          }
        }
      }
      const missing = [...new Set([
        ...missingFromGeneratedText,
        ...missingFromClaimedExcerpt,
      ].map((rule) => rule.id))];
      return missing.length > 0 ? [{ event_id: event.event_id, missing }] : [];
    });
    if (qualifierFailures.length > 0) {
      issues.push({
        script_slot_index: slotIndex,
        type: "writer_checklist_qualifiers_missing",
        event_ids: qualifierFailures.map((failure) => failure.event_id),
        details: qualifierFailures.map((failure) => `${failure.event_id}=${failure.missing.join(",")}`),
      });
    }
  }
  return { passed: issues.length === 0, issues };
}

/** Locks previously covered facts while making every failed event explicit. */
export function buildWriterRevisionNarrativeChecklist(
  plan: IndependentNarrativeAuditPlan,
  priorMicroeventAudit: any[],
): WriterRevisionNarrativeSlot[] {
  const priorByEventId = new Map(
    (Array.isArray(priorMicroeventAudit) ? priorMicroeventAudit : [])
      .filter((event: any) => String(event?.event_id || "").trim())
      .map((event: any) => [String(event.event_id), event]),
  );
  return plan.slots.map((slot) => ({
    script_slot_index: slot.script_slot_index,
    slot_type: slot.slot_type,
    time_range: slot.time_range,
    current_generated_text: slot.generated_text,
    events: [
      ...slot.events,
      ...slot.visual_event_candidates.filter((event) => priorByEventId.has(event.event_id)),
    ].sort((left, right) => left.start_seconds - right.start_seconds || left.event_id.localeCompare(right.event_id))
      .map((event) => {
        const prior = priorByEventId.get(event.event_id) as any;
        const rawCoverage = String(prior?.coverage || "not_yet_audited");
        const rawCausalRelation = String(prior?.causal_relation || "not_yet_audited");
        const coverage = ["covered", "omitted", "distorted"].includes(rawCoverage)
          ? rawCoverage as NarrativeEventCoverage
          : "not_yet_audited" as const;
        const causalRelation = ["preserved", "altered", "unsupported", "not_applicable"].includes(rawCausalRelation)
          ? rawCausalRelation as NarrativeCausalRelation
          : "not_yet_audited" as const;
        const protectedCoverage = coverage === "covered"
          && ["preserved", "not_applicable"].includes(causalRelation);
        const sourceText = normalizedQualifierText(event.evidence_text);
        return {
          ...event,
          prior_coverage: coverage,
          prior_causal_relation: causalRelation,
          prior_reason: boundedText(prior?.reason, 700),
          revision_duty: protectedCoverage ? "MUST_PRESERVE" as const : "MUST_RESTORE_COMPLETELY" as const,
          required_deterministic_qualifiers: event.evidence_kind === "transcript"
            ? DETERMINISTIC_QUALIFIER_RULES
              .filter((rule) => rule.present(sourceText, event))
              .map((rule) => rule.id)
            : [],
        };
      }),
  }));
}

export function independentAuditToNarrativeFidelity(
  plan: IndependentNarrativeAuditPlan,
  result: IndependentNarrativeAuditResult,
): Record<string, unknown> {
  const eventById = new Map(plan.slots.flatMap((slot) => [
    ...slot.events,
    ...slot.visual_event_candidates,
  ]).map((event) => [event.event_id, event]));
  const microeventAudit: any[] = [];
  const completeNarrativeGaps: any[] = [];
  const causalErrors: any[] = [];
  const visualCandidateAudit: any[] = [];
  const slotOrder = new Map(plan.slots.map((slot, position) => [slot.script_slot_index, position]));

  const appendRequiredEvent = (
    event: IndependentNarrativeEvent,
    verdict: Pick<
      IndependentNarrativeEventResult,
      "coverage" | "causal_relation" | "reason" | "deterministic_missing_qualifiers"
    >,
    generatedText: string,
  ) => {
    const deterministicMissingQualifiers = Array.isArray(verdict.deterministic_missing_qualifiers)
      ? [...verdict.deterministic_missing_qualifiers]
      : [];
    microeventAudit.push({
      event_id: event.event_id,
      start_seconds: event.start_seconds,
      end_seconds: event.end_seconds,
      event: event.evidence_text,
      evidence_kind: event.evidence_kind,
      coverage: verdict.coverage,
      script_slot_index: event.script_slot_index,
      causal_relation: verdict.causal_relation,
      reason: verdict.reason,
      ...(deterministicMissingQualifiers.length > 0
        ? { deterministic_missing_qualifiers: deterministicMissingQualifiers }
        : {}),
    });
    if (verdict.coverage !== "covered") {
      completeNarrativeGaps.push({
        event_id: event.event_id,
        start_seconds: event.start_seconds,
        end_seconds: event.end_seconds,
        event: event.evidence_text,
        coverage: verdict.coverage,
        reason: verdict.reason,
        script_slot_index: event.script_slot_index,
        ...(deterministicMissingQualifiers.length > 0
          ? { deterministic_missing_qualifiers: deterministicMissingQualifiers }
          : {}),
      });
    }
    if (!["preserved", "not_applicable"].includes(verdict.causal_relation)) {
      causalErrors.push({
        event_id: event.event_id,
        start_seconds: event.start_seconds,
        event: event.evidence_text,
        script_claim: generatedText,
        causal_relation: verdict.causal_relation,
        reason: verdict.reason,
        script_slot_index: event.script_slot_index,
        ...(deterministicMissingQualifiers.length > 0
          ? { deterministic_missing_qualifiers: deterministicMissingQualifiers }
          : {}),
      });
    }
  };

  for (const slot of result.slot_audits) {
    const planSlot = plan.slots.find((candidate) => candidate.script_slot_index === slot.script_slot_index);
    for (const verdict of slot.event_results) {
      const event = eventById.get(verdict.event_id)!;
      const deterministicMaterialRuleIds = event.evidence_kind === "visual_frame"
        ? materialVisualActionRuleIds(event.evidence_text)
        : [];
      const deterministicMaterialMissing = deterministicMaterialRuleIds.length > 0
        && missingExplicitMaterialVisualAction(
          event.evidence_text,
          event.claimed_text_excerpt || planSlot?.generated_text || "",
        ) === true;
      appendRequiredEvent(event, deterministicMaterialMissing ? {
        ...verdict,
        coverage: verdict.coverage === "omitted" ? "omitted" : "distorted",
        reason: boundedText(
          `deterministic_material_visual_action_missing=[${deterministicMaterialRuleIds.join(",")}] | ${verdict.reason}`,
          700,
        ),
      } : verdict, planSlot?.generated_text || "");
    }
    for (const verdict of slot.visual_event_results) {
      const event = eventById.get(verdict.event_id)!;
      const deterministicMaterialRuleIds = materialVisualActionRuleIds(event.evidence_text);
      const effectiveMateriality = deterministicMaterialRuleIds.length > 0
        ? "required" as const
        : verdict.materiality;
      const deterministicMaterialityPromotion = deterministicMaterialRuleIds.length > 0
        && verdict.materiality !== "required";
      const deterministicMaterialMissing = deterministicMaterialRuleIds.length > 0
        && missingExplicitMaterialVisualAction(
          event.evidence_text,
          event.claimed_text_excerpt || planSlot?.generated_text || "",
        ) === true;
      const effectiveCoverage = deterministicMaterialMissing
        ? (verdict.coverage === "omitted" ? "omitted" as const : "distorted" as const)
        : deterministicMaterialityPromotion
        ? "covered" as const
        : verdict.coverage;
      const effectiveReason = deterministicMaterialMissing
        ? boundedText(
          `deterministic_material_visual_action_missing=[${deterministicMaterialRuleIds.join(",")}] | ${verdict.reason}`,
          700,
        )
        : deterministicMaterialityPromotion
        ? boundedText(
          `deterministic_material_visual_action_present=[${deterministicMaterialRuleIds.join(",")}] | ${verdict.reason}`,
          700,
        )
        : verdict.reason;
      visualCandidateAudit.push({
        event_id: event.event_id,
        start_seconds: event.start_seconds,
        event: event.evidence_text,
        script_slot_index: event.script_slot_index,
        materiality: effectiveMateriality,
        coverage: effectiveCoverage,
        causal_relation: verdict.causal_relation,
        reason: effectiveReason,
      });
      if (effectiveMateriality === "required") {
        appendRequiredEvent(event, {
          coverage: effectiveCoverage as NarrativeEventCoverage,
          causal_relation: verdict.causal_relation,
          reason: effectiveReason,
        }, planSlot?.generated_text || "");
      }
    }
    const fallbackTimestamp = planSlot?.time_range?.start ?? 0;
    for (const issue of slot.unsupported_claims) {
      causalErrors.push({
        start_seconds: fallbackTimestamp,
        event: "unsupported_local_claim",
        script_claim: issue.claim,
        reason: issue.reason,
        script_slot_index: slot.script_slot_index,
      });
    }
    for (const issue of slot.cross_boundary_claims) {
      causalErrors.push({
        start_seconds: fallbackTimestamp,
        event: "cross_boundary_claim",
        script_claim: issue.claim,
        reason: issue.reason,
        script_slot_index: slot.script_slot_index,
      });
    }
  }

  microeventAudit.sort((left, right) =>
    (slotOrder.get(Number(left.script_slot_index)) ?? Number.MAX_SAFE_INTEGER)
      - (slotOrder.get(Number(right.script_slot_index)) ?? Number.MAX_SAFE_INTEGER)
    || Number(left.start_seconds) - Number(right.start_seconds)
    || String(left.event_id).localeCompare(String(right.event_id))
  );
  const requiredVisualEventCount = visualCandidateAudit.filter((event) => event.materiality === "required").length;

  return {
    required_event_count: plan.total_events + requiredVisualEventCount,
    visual_candidate_count: plan.total_visual_event_candidates,
    required_visual_event_count: requiredVisualEventCount,
    visual_candidate_audit: visualCandidateAudit,
    timeline_order_preserved: result.slot_audits.every((slot) => slot.cross_boundary_claims.length === 0),
    causal_links_preserved: causalErrors.length === 0,
    microevent_audit: microeventAudit,
    complete_narrative_gaps: completeNarrativeGaps,
    causal_errors: causalErrors,
  };
}

/** Returns a legacy-compatible fidelity payload that marks every planned slot. */
export function failClosedIndependentNarrativeFidelity(
  plan: IndependentNarrativeAuditPlan,
  error: unknown,
): Record<string, unknown> {
  const reason = boundedText(error instanceof Error ? error.message : error, 700)
    || "independent_narrative_audit_failed";
  const microeventAudit = plan.slots.flatMap((slot) => [
    ...slot.events,
    ...slot.visual_event_candidates,
  ].map((event) => ({
    event_id: event.event_id,
    start_seconds: event.start_seconds,
    end_seconds: event.end_seconds,
    event: event.evidence_text,
    evidence_kind: event.evidence_kind,
    coverage: "omitted" as const,
    script_slot_index: event.script_slot_index,
    causal_relation: "unsupported" as const,
    reason,
  })));
  const completeNarrativeGaps = plan.slots.map((slot) => ({
    start_seconds: slot.time_range?.start ?? 0,
    end_seconds: slot.time_range?.end ?? slot.time_range?.start ?? 0,
    event: "independent_narrative_audit_unavailable",
    problem: reason,
    script_slot_index: slot.script_slot_index,
  }));
  const causalErrors = plan.slots.map((slot) => ({
    start_seconds: slot.time_range?.start ?? 0,
    event: "independent_narrative_audit_unavailable",
    script_claim: slot.generated_text,
    reason,
    script_slot_index: slot.script_slot_index,
  }));
  return {
    // Classification was unavailable, so every visual candidate remains
    // potentially material and is failed closed as a required omission.
    required_event_count: plan.total_events + plan.total_visual_event_candidates,
    visual_candidate_count: plan.total_visual_event_candidates,
    required_visual_event_count: plan.total_visual_event_candidates,
    visual_candidate_audit: plan.slots.flatMap((slot) => slot.visual_event_candidates.map((event) => ({
      event_id: event.event_id,
      start_seconds: event.start_seconds,
      event: event.evidence_text,
      script_slot_index: event.script_slot_index,
      materiality: "required",
      coverage: "omitted",
      causal_relation: "unsupported",
      reason,
    }))),
    timeline_order_preserved: false,
    causal_links_preserved: false,
    microevent_audit: microeventAudit,
    complete_narrative_gaps: completeNarrativeGaps,
    causal_errors: causalErrors,
  };
}
