export type RevisionCompressionBudget = {
  requested_growth: number;
  current_total: number;
  acceptable_max: number;
  global_headroom: number;
  compression_required: number;
};

const nonNegativeInteger = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
};

/**
 * Compression donors are needed only for the part of a requested local repair
 * that cannot fit in the script's real remaining headroom. This deliberately
 * does not relax either the local target or the global acceptable maximum.
 */
export function resolveRevisionCompressionBudget(options: {
  requestedGrowth: unknown;
  currentTotal: unknown;
  acceptableMax: unknown;
}): RevisionCompressionBudget {
  const requestedGrowth = nonNegativeInteger(options.requestedGrowth);
  const currentTotal = nonNegativeInteger(options.currentTotal);
  const acceptableMax = nonNegativeInteger(options.acceptableMax);
  const globalHeadroom = Math.max(0, acceptableMax - currentTotal);
  return {
    requested_growth: requestedGrowth,
    current_total: currentTotal,
    acceptable_max: acceptableMax,
    global_headroom: globalHeadroom,
    compression_required: Math.max(0, currentTotal + requestedGrowth - acceptableMax),
  };
}
