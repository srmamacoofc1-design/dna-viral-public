export interface VisualTimelineMomentLike {
  timestamp_seconds: number;
}

export interface VisualTimelineCoverageOptions {
  maxMoments: number;
  secondsPerMoment?: number;
  minMoments?: number;
}

export interface VisualTimelineCoverageAssessment {
  passed: boolean;
  duration_seconds: number;
  observed_moments: number;
  required_moments: number;
  max_moments: number;
  first_timestamp_seconds: number | null;
  last_timestamp_seconds: number | null;
  opening_deadline_seconds: number;
  opening_moment_count: number;
  required_opening_moments: number;
  ending_floor_seconds: number;
  covers_opening: boolean;
  covers_ending: boolean;
  reasons: string[];
}

function positiveFinite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Density target shared by both multimodal ingestion paths. The cap is a
 * transport/output bound, not permission to stop early: opening and ending
 * coverage are assessed independently below.
 */
export function requiredVisualMomentCount(
  durationSeconds: number,
  options: VisualTimelineCoverageOptions,
): number {
  const duration = positiveFinite(durationSeconds, 0);
  const secondsPerMoment = positiveFinite(options.secondsPerMoment, 3);
  const maxMoments = Math.max(1, Math.trunc(positiveFinite(options.maxMoments, 30)));
  const minMoments = Math.max(1, Math.min(maxMoments, Math.trunc(positiveFinite(options.minMoments, 3))));
  // The opening and ending are independently required below, so a timeline
  // with N moments already spans N evidence positions. Using ceil here made a
  // fully covered 82.94s source with 27 moments (one each 3.07s) fail an
  // "approximately every 3 seconds" contract solely due to rounding. Floor
  // preserves the intended density without accepting an early-stopping model.
  return Math.min(maxMoments, Math.max(minMoments, Math.floor(Math.max(duration, 1) / secondsPerMoment)));
}

/**
 * Evenly reduces an over-complete timeline while always preserving its first
 * and last evidence points. Call this only after sanitizing and sorting.
 */
export function limitVisualTimeline<T extends VisualTimelineMomentLike>(
  moments: T[],
  maxMoments: number,
): T[] {
  const limit = Math.max(1, Math.trunc(positiveFinite(maxMoments, 1)));
  if (moments.length <= limit) return [...moments];
  if (limit === 1) return [moments[0]];

  const selected: T[] = [];
  const used = new Set<number>();
  for (let position = 0; position < limit; position++) {
    const index = Math.round((position * (moments.length - 1)) / (limit - 1));
    if (!used.has(index)) {
      used.add(index);
      selected.push(moments[index]);
    }
  }
  // Rounding is normally unique because limit < moments.length. Keep the
  // function total and deterministic if that invariant ever changes.
  for (let index = 0; selected.length < limit && index < moments.length; index++) {
    if (!used.has(index)) selected.push(moments[index]);
  }
  return selected.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
}

export function assessVisualTimelineCoverage(
  moments: VisualTimelineMomentLike[],
  durationSeconds: number,
  options: VisualTimelineCoverageOptions,
): VisualTimelineCoverageAssessment {
  const duration = positiveFinite(durationSeconds, 0);
  const maxMoments = Math.max(1, Math.trunc(positiveFinite(options.maxMoments, 30)));
  const requiredMoments = requiredVisualMomentCount(duration, options);
  const rawTimestamps = moments
    .map((moment) => Number(moment?.timestamp_seconds))
    .filter((timestamp) => Number.isFinite(timestamp));
  const upperTimestampBound = duration > 0 ? duration + Math.max(1, duration * 0.01) : Number.POSITIVE_INFINITY;
  const invalidTimestampCount = moments.length - rawTimestamps.length
    + rawTimestamps.filter((timestamp) => timestamp < 0 || timestamp > upperTimestampBound).length;
  const validTimestamps = rawTimestamps
    .filter((timestamp) => timestamp >= 0 && timestamp <= upperTimestampBound)
    .sort((a, b) => a - b);
  const timestamps: number[] = [];
  for (const timestamp of validTimestamps) {
    const previous = timestamps[timestamps.length - 1];
    if (previous === undefined || Math.abs(timestamp - previous) > 0.001) {
      timestamps.push(timestamp);
    }
  }
  const first = timestamps.length ? timestamps[0] : null;
  const last = timestamps.length ? timestamps[timestamps.length - 1] : null;
  const openingDeadline = Math.min(5, duration > 0 ? duration : 5);
  const requiredOpeningMoments = duration >= 4 ? 2 : 1;
  const openingMomentCount = timestamps.filter((timestamp) => timestamp <= openingDeadline).length;
  const endingFloor = duration * 0.9;
  const coversOpening = first !== null && first <= openingDeadline && openingMomentCount >= requiredOpeningMoments;
  const coversEnding = last !== null && last >= endingFloor;
  const reasons: string[] = [];

  if (!(duration > 0)) reasons.push("duration_missing_or_invalid");
  if (invalidTimestampCount > 0) reasons.push(`visual_timestamps_out_of_bounds_${invalidTimestampCount}`);
  if (validTimestamps.length > timestamps.length) {
    reasons.push(`visual_duplicate_timestamps_${validTimestamps.length - timestamps.length}`);
  }
  if (timestamps.length < requiredMoments) {
    reasons.push(`visual_moments_${timestamps.length}_below_${requiredMoments}`);
  }
  if (timestamps.length > maxMoments) {
    reasons.push(`visual_moments_${timestamps.length}_above_${maxMoments}`);
  }
  if (!coversOpening) reasons.push("opening_not_covered");
  if (openingMomentCount < requiredOpeningMoments) {
    reasons.push(`opening_moments_${openingMomentCount}_below_${requiredOpeningMoments}`);
  }
  if (!coversEnding) reasons.push("ending_not_covered");

  return {
    passed: reasons.length === 0,
    duration_seconds: duration,
    observed_moments: timestamps.length,
    required_moments: requiredMoments,
    max_moments: maxMoments,
    first_timestamp_seconds: first,
    last_timestamp_seconds: last,
    opening_deadline_seconds: openingDeadline,
    opening_moment_count: openingMomentCount,
    required_opening_moments: requiredOpeningMoments,
    ending_floor_seconds: endingFloor,
    covers_opening: coversOpening,
    covers_ending: coversEnding,
    reasons,
  };
}
