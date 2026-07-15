export const DENSE_SPECIALIST_MINIMUM_BUDGET_MS = 2_500;

export type OptionalDenseSpecialistResult<T> =
  | {
    status: "completed";
    remaining_ms: number;
    value: T;
    failure_reason: null;
  }
  | {
    status: "skipped" | "failed";
    remaining_ms: number;
    value: null;
    failure_reason: "time_budget_insufficient" | "time_budget_exhausted" | "provider_error";
  };

export function resolveDenseSpecialistBudget(
  deadlineAtMs: number,
  nowMs = Date.now(),
  minimumBudgetMs = DENSE_SPECIALIST_MINIMUM_BUDGET_MS,
): { eligible: boolean; remaining_ms: number; minimum_budget_ms: number } {
  const deadline = Number(deadlineAtMs);
  const now = Number(nowMs);
  const minimum = Math.max(0, Math.trunc(Number(minimumBudgetMs) || 0));
  const remaining = Number.isFinite(deadline) && Number.isFinite(now)
    ? Math.max(0, Math.trunc(deadline - now))
    : 0;
  return {
    eligible: remaining >= minimum,
    remaining_ms: remaining,
    minimum_budget_ms: minimum,
  };
}

function classifyOptionalDenseSpecialistError(error: unknown): "time_budget_exhausted" | "provider_error" {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return /(?:time.?budget|timeout|timed.?out|deadline)/i.test(message)
    ? "time_budget_exhausted"
    : "provider_error";
}

/**
 * Executes an optional repair without letting transport failure invalidate the
 * already available Writer proposal. The caller remains responsible for
 * validating any completed candidate fail-closed.
 */
export async function runOptionalDenseSpecialist<T>(options: {
  deadlineAtMs: number;
  now?: () => number;
  minimumBudgetMs?: number;
  execute: (remainingMs: number) => Promise<T>;
}): Promise<OptionalDenseSpecialistResult<T>> {
  const now = options.now ?? Date.now;
  const budget = resolveDenseSpecialistBudget(
    options.deadlineAtMs,
    now(),
    options.minimumBudgetMs,
  );
  if (!budget.eligible) {
    return {
      status: "skipped",
      remaining_ms: budget.remaining_ms,
      value: null,
      failure_reason: "time_budget_insufficient",
    };
  }
  try {
    return {
      status: "completed",
      remaining_ms: budget.remaining_ms,
      value: await options.execute(budget.remaining_ms),
      failure_reason: null,
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      remaining_ms: Math.max(0, Math.trunc(Number(options.deadlineAtMs) - now())),
      value: null,
      failure_reason: classifyOptionalDenseSpecialistError(error),
    };
  }
}

/** A dense five/six-event slot may use three sentences without violating DNA. */
export function resolveEvidenceDensitySentenceMax(options: {
  slotType: string;
  observedMin?: unknown;
  observedMax?: unknown;
  requiredEventCount: number;
}): number {
  const observedMin = Math.max(1, Math.trunc(Number(options.observedMin) || 1));
  const observedMax = Math.max(observedMin, Math.trunc(Number(options.observedMax) || observedMin));
  if (String(options.slotType) === "hook") return observedMax;
  const eventCount = Math.max(0, Math.trunc(Number(options.requiredEventCount) || 0));
  const densityMax = eventCount >= 5
    ? 3
    : Math.min(3, Math.max(1, Math.ceil(eventCount / 3)));
  return Math.max(observedMin, observedMax, densityMax);
}

/**
 * A local slot with one authoritative event cannot truthfully disclose a
 * second story turn merely to imitate an aggregate micro-reveal rate. Treat
 * that single event as the complete local reveal; progression is still
 * measured across the surrounding slots. Multi-event windows keep the
 * observed DNA rate unchanged.
 */
export function resolveEvidenceAwareMicroRevealRate(options: {
  slotType: string;
  observedRate?: unknown;
  requiredEventCount: number;
}): number {
  const observed = Math.max(0, Number(options.observedRate) || 0);
  const eventCount = Math.max(0, Math.trunc(Number(options.requiredEventCount) || 0));
  const progressiveSlot = ["desenvolvimento", "tensao", "revelacao"]
    .includes(String(options.slotType || ""));
  return progressiveSlot && eventCount <= 1
    ? Math.min(observed, 0.34)
    : observed;
}

export function selectLocalQualifierGuidance<T extends Record<string, string>>(
  guidance: T,
  requiredIds: Iterable<string>,
): Partial<T> {
  const required = new Set([...requiredIds].map(String));
  return Object.fromEntries(
    Object.entries(guidance).filter(([id]) => required.has(id)),
  ) as Partial<T>;
}
