import {
  assessVisualTimelineCoverage,
  limitVisualTimeline,
  type VisualTimelineCoverageAssessment,
} from "./visual-timeline-coverage.ts";

export interface PersistedGeminiVisualMoment {
  timestamp_seconds: number;
  description: string;
  [key: string]: unknown;
}

export interface NarrativeVisualBlock {
  id: string;
  tempo_inicio: number;
  tempo_fim: number;
  [key: string]: unknown;
}

export interface VisualBlockMomentAssignment<TMoment extends PersistedGeminiVisualMoment> {
  block: NarrativeVisualBlock;
  moments: TMoment[];
  representative_moment: TMoment;
  used_nearest_moment: boolean;
  nearest_distance_seconds: number;
}

export interface VisualBlockEvidenceOptions {
  maxMoments?: number;
  secondsPerMoment?: number;
  minMoments?: number;
  /** Largest accepted gap as a multiple of the timeline's robust spacing. */
  sparseGapMultiplier?: number;
}

export interface VisualBlockEvidenceAssessment<TMoment extends PersistedGeminiVisualMoment> {
  passed: boolean;
  duration_seconds: number;
  persisted_moments: number;
  valid_moments: number;
  unique_timestamps: number;
  assessed_timestamps: number;
  blocks: number;
  assigned_blocks: number;
  nearest_assignments: number;
  nominal_spacing_seconds: number | null;
  maximum_observed_gap_seconds: number | null;
  maximum_allowed_gap_seconds: number | null;
  nearest_assignment_limit_seconds: number | null;
  timeline_coverage: VisualTimelineCoverageAssessment;
  assignments: Array<VisualBlockMomentAssignment<TMoment>>;
  reasons: string[];
}

const EPSILON_SECONDS = 0.001;

function positiveFinite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function intervalDistance(timestamp: number, start: number, end: number): number {
  if (timestamp < start) return start - timestamp;
  if (timestamp > end) return timestamp - end;
  return 0;
}

function finiteScore(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? score : -1;
}

function representativeMoment<TMoment extends PersistedGeminiVisualMoment>(
  moments: TMoment[],
  midpoint: number,
): TMoment {
  return [...moments].sort((left, right) => {
    const surpriseDifference = finiteScore(right.surprise_score) - finiteScore(left.surprise_score);
    if (Number.isFinite(surpriseDifference) && surpriseDifference !== 0) return surpriseDifference;
    return Math.abs(left.timestamp_seconds - midpoint) - Math.abs(right.timestamp_seconds - midpoint);
  })[0];
}

/**
 * Binds already-persisted Gemini observations to every narrative block.
 *
 * This helper never synthesizes a visual observation. A block either receives
 * one or more objects from `rawMoments`, or the whole assessment fails. When a
 * sampling point does not overlap a short block, the nearest real point may be
 * reused only inside a radius derived from the persisted timeline's actual
 * spacing. A clustered/sparse or prematurely-ended timeline is rejected before
 * any caller is allowed to persist block-level visual analysis.
 */
export function assessAndAssignPersistedGeminiMoments<
  TMoment extends PersistedGeminiVisualMoment = PersistedGeminiVisualMoment,
>(
  rawMoments: unknown,
  rawBlocks: NarrativeVisualBlock[],
  durationSeconds: number,
  options: VisualBlockEvidenceOptions = {},
): VisualBlockEvidenceAssessment<TMoment> {
  const duration = Number(durationSeconds);
  const maxMoments = Math.max(1, Math.trunc(positiveFinite(options.maxMoments, 40)));
  const secondsPerMoment = positiveFinite(options.secondsPerMoment, 3);
  const minMoments = Math.max(1, Math.trunc(positiveFinite(options.minMoments, 3)));
  const sparseGapMultiplier = positiveFinite(options.sparseGapMultiplier, 2.5);
  const persisted = Array.isArray(rawMoments) ? rawMoments : [];
  const reasons: string[] = [];
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) reasons.push("narrative_blocks_missing");
  const durationTolerance = Number.isFinite(duration) && duration > 0
    ? Math.max(0.05, duration * 0.01)
    : 0;

  const validMoments: TMoment[] = [];
  let invalidMoments = 0;
  for (const value of persisted) {
    if (!value || typeof value !== "object") {
      invalidMoments++;
      continue;
    }
    const record = value as Record<string, unknown>;
    const timestamp = record.timestamp_seconds;
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (
      typeof timestamp !== "number"
      || !Number.isFinite(timestamp)
      || timestamp < 0
      || !(duration > 0)
      || timestamp > duration + durationTolerance
      || !description
    ) {
      invalidMoments++;
      continue;
    }
    // Keep the exact persisted object as the evidence payload. Validation may
    // reject it, but this layer never rewrites or synthesizes an observation.
    validMoments.push(record as TMoment);
  }
  validMoments.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  if (!Array.isArray(rawMoments)) reasons.push("persisted_gemini_timeline_missing");
  if (invalidMoments > 0) reasons.push(`persisted_gemini_moments_invalid_${invalidMoments}`);

  // Density is temporal, so multiple descriptions at the same timestamp count
  // as one sampling point. The original objects remain available to blocks.
  const timelineMoments: TMoment[] = [];
  for (const moment of validMoments) {
    const previous = timelineMoments[timelineMoments.length - 1];
    if (!previous || Math.abs(previous.timestamp_seconds - moment.timestamp_seconds) > EPSILON_SECONDS) {
      timelineMoments.push(moment);
    }
  }

  // maxMoments is an output/transport bound, not a reason to discard valid
  // legacy evidence. Downsample only the coverage timeline, preserving its
  // real first and last objects; block assignment below may use every valid
  // persisted Gemini moment.
  const assessedTimelineMoments = limitVisualTimeline(timelineMoments, maxMoments);
  const timelineCoverage = assessVisualTimelineCoverage(
    assessedTimelineMoments,
    duration,
    { maxMoments, secondsPerMoment, minMoments },
  );
  reasons.push(...timelineCoverage.reasons);

  const timestamps = assessedTimelineMoments.map((moment) => moment.timestamp_seconds);
  const internalGaps: number[] = [];
  for (let index = 1; index < timestamps.length; index++) {
    const gap = timestamps[index] - timestamps[index - 1];
    if (gap > EPSILON_SECONDS) internalGaps.push(gap);
  }
  const medianSpacing = median(internalGaps);
  const densitySpacing = duration > 0 && timestamps.length > 1
    ? duration / (timestamps.length - 1)
    : null;
  // Taking the larger baseline prevents a cluster of near-duplicate timestamps
  // from making a large uncovered hole look acceptable.
  const nominalSpacing = medianSpacing === null
    ? densitySpacing
    : densitySpacing === null
    ? medianSpacing
    : Math.max(medianSpacing, densitySpacing);
  const maximumAllowedGap = nominalSpacing === null ? null : nominalSpacing * sparseGapMultiplier;
  const openingGap = timestamps.length > 0 ? Math.max(0, timestamps[0]) : null;
  const endingGap = timestamps.length > 0 && duration > 0
    ? Math.max(0, duration - timestamps[timestamps.length - 1])
    : null;
  const observedGaps = [
    ...(openingGap === null ? [] : [openingGap]),
    ...internalGaps,
    ...(endingGap === null ? [] : [endingGap]),
  ];
  const maximumObservedGap = observedGaps.length > 0 ? Math.max(...observedGaps) : null;
  if (
    maximumAllowedGap !== null
    && maximumObservedGap !== null
    && maximumObservedGap > maximumAllowedGap + EPSILON_SECONDS
  ) {
    reasons.push(
      `visual_timeline_sparse_gap_${maximumObservedGap.toFixed(3)}s_above_${maximumAllowedGap.toFixed(3)}s`,
    );
  }

  const maximumInternalRadius = internalGaps.length > 0 ? Math.max(...internalGaps) / 2 : 0;
  const observedNearestRadius = Math.max(maximumInternalRadius, openingGap ?? 0, endingGap ?? 0);
  const nearestAssignmentLimit = maximumAllowedGap === null
    ? null
    : Math.min(maximumAllowedGap / 2, observedNearestRadius || nominalSpacing! / 2);

  const assignments: Array<VisualBlockMomentAssignment<TMoment>> = [];
  const seenBlockIds = new Set<string>();
  for (let blockIndex = 0; blockIndex < rawBlocks.length; blockIndex++) {
    const block = rawBlocks[blockIndex];
    const blockId = typeof block?.id === "string" ? block.id.trim() : "";
    const start = Number(block?.tempo_inicio);
    const end = Number(block?.tempo_fim);
    const label = blockId || `index_${blockIndex}`;
    if (!blockId || seenBlockIds.has(blockId)) {
      reasons.push(`narrative_block_${label}_id_invalid_or_duplicate`);
      continue;
    }
    seenBlockIds.add(blockId);
    if (
      !Number.isFinite(start)
      || !Number.isFinite(end)
      || start < 0
      || end <= start
      || !(duration > 0)
      || end > duration + durationTolerance
    ) {
      reasons.push(`narrative_block_${label}_interval_invalid`);
      continue;
    }

    const overlapping = validMoments.filter((moment) =>
      moment.timestamp_seconds >= start - EPSILON_SECONDS
      && moment.timestamp_seconds <= end + EPSILON_SECONDS
    );
    if (overlapping.length > 0) {
      assignments.push({
        block,
        moments: overlapping,
        representative_moment: representativeMoment(overlapping, (start + end) / 2),
        used_nearest_moment: false,
        nearest_distance_seconds: 0,
      });
      continue;
    }

    let nearest: TMoment | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const midpoint = (start + end) / 2;
    for (const moment of validMoments) {
      const distance = intervalDistance(moment.timestamp_seconds, start, end);
      if (
        distance < nearestDistance - EPSILON_SECONDS
        || (
          Math.abs(distance - nearestDistance) <= EPSILON_SECONDS
          && nearest
          && Math.abs(moment.timestamp_seconds - midpoint) < Math.abs(nearest.timestamp_seconds - midpoint)
        )
      ) {
        nearest = moment;
        nearestDistance = distance;
      }
    }
    if (
      nearest
      && nearestAssignmentLimit !== null
      && nearestDistance <= nearestAssignmentLimit + EPSILON_SECONDS
    ) {
      assignments.push({
        block,
        moments: [nearest],
        representative_moment: nearest,
        used_nearest_moment: true,
        nearest_distance_seconds: nearestDistance,
      });
    } else {
      reasons.push(
        `narrative_block_${label}_without_nearby_gemini_moment_${
          Number.isFinite(nearestDistance) ? nearestDistance.toFixed(3) : "missing"
        }s`,
      );
    }
  }

  if (assignments.length !== rawBlocks.length) {
    reasons.push(`visual_block_coverage_${assignments.length}_of_${rawBlocks.length}`);
  }

  return {
    passed: reasons.length === 0 && assignments.length === rawBlocks.length,
    duration_seconds: Number.isFinite(duration) ? duration : 0,
    persisted_moments: persisted.length,
    valid_moments: validMoments.length,
    unique_timestamps: timelineMoments.length,
    assessed_timestamps: assessedTimelineMoments.length,
    blocks: rawBlocks.length,
    assigned_blocks: assignments.length,
    nearest_assignments: assignments.filter((assignment) => assignment.used_nearest_moment).length,
    nominal_spacing_seconds: nominalSpacing,
    maximum_observed_gap_seconds: maximumObservedGap,
    maximum_allowed_gap_seconds: maximumAllowedGap,
    nearest_assignment_limit_seconds: nearestAssignmentLimit,
    timeline_coverage: timelineCoverage,
    assignments,
    reasons: [...new Set(reasons)],
  };
}
