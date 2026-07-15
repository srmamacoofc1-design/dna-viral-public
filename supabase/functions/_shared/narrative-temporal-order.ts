export interface NarrativeMicroeventTiming {
  start_seconds: unknown;
  end_seconds: unknown;
  script_slot_index: unknown;
}

const TIMELINE_EPSILON_SECONDS = 1e-6;

/**
 * Detects a real temporal regression in an audit already ordered by script
 * slot. Adjacent slots may legitimately share evidence at their boundary: a
 * point frame at 5.00s and the next transcript segment at 4.67-9.37s describe
 * overlapping source time, not a reversed story. Within one slot, however, a
 * decreasing start remains an actual ordering error even when ranges overlap.
 *
 * Invalid timestamps/slots are deliberately left to the gate's dedicated
 * validation errors; this helper only decides temporal order.
 */
export function hasNarrativeMicroeventOrderRegression(
  previous: NarrativeMicroeventTiming | null,
  current: NarrativeMicroeventTiming,
): boolean {
  if (!previous) return false;

  const previousStart = Number(previous.start_seconds);
  const previousEnd = Number(previous.end_seconds);
  const currentStart = Number(current.start_seconds);
  const currentEnd = Number(current.end_seconds);
  const previousSlot = Number(previous.script_slot_index);
  const currentSlot = Number(current.script_slot_index);

  if (![previousStart, previousEnd, currentStart, currentEnd].every(Number.isFinite)
    || previousStart < 0
    || currentStart < 0
    || previousEnd < previousStart
    || currentEnd < currentStart) {
    return false;
  }
  if (currentStart + TIMELINE_EPSILON_SECONDS >= previousStart) return false;

  if (Number.isInteger(previousSlot)
    && Number.isInteger(currentSlot)
    && currentSlot === previousSlot) {
    return true;
  }

  const rangesOverlap = currentStart <= previousEnd + TIMELINE_EPSILON_SECONDS
    && previousStart <= currentEnd + TIMELINE_EPSILON_SECONDS;
  return !rangesOverlap;
}
