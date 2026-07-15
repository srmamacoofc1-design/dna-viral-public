export type NarrativeBlock = Record<string, unknown> & {
  bloco_id?: number;
  tipo_bloco?: string;
  tempo_inicio?: number;
  tempo_fim?: number;
  texto?: string;
  emocao?: string;
  funcao_narrativa?: string;
  semantic_shift_score?: number;
  visual_shift_score?: number;
};

export const REQUIRED_NARRATIVE_BLOCK_TYPES = [
  "hook",
  "desenvolvimento",
  "payoff",
] as const;

export const MIN_NARRATIVE_BLOCKS = 3;
export const MAX_NARRATIVE_BLOCKS = 18;
export const MIN_TRANSCRIPT_TIMELINE_COVERAGE = 0.7;

export type TranscriptTimelineSegment = {
  tempo_inicio?: number | string | null;
  tempo_fim?: number | string | null;
};

export type TranscriptTextSegment = TranscriptTimelineSegment & {
  texto?: string | null;
};

const ESSENTIAL_TYPES = new Set<string>(REQUIRED_NARRATIVE_BLOCK_TYPES);

/**
 * Resolves the media/container duration as the authoritative timeline and
 * fails closed when the transcript belongs to a longer/different source or is
 * too incomplete to support narrative segmentation. The transcript duration
 * is only a legacy fallback when the video row has no usable media duration.
 */
export function assertTranscriptTimelineMatchesSource(
  source: readonly TranscriptTimelineSegment[],
  videoDuration: unknown,
): number {
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error("TRANSCRIPT_TIMELINE_INVALID: no_segments");
  }

  const intervals = source.map((segment, index) => {
    const start = Number(segment.tempo_inicio);
    const end = Number(segment.tempo_fim);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`TRANSCRIPT_TIMELINE_INVALID: segment_${index + 1}_invalid`);
    }
    return { start, end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);

  const transcriptMax = Math.max(...intervals.map((interval) => interval.end));
  const storedDuration = Number(videoDuration);
  const hasAuthoritativeDuration = Number.isFinite(storedDuration) && storedDuration > 0;
  const sourceDuration = hasAuthoritativeDuration ? storedDuration : transcriptMax;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || sourceDuration > 3_600) {
    throw new Error("TRANSCRIPT_TIMELINE_INVALID: source_duration_invalid");
  }

  const tolerance = Math.max(0.5, sourceDuration * 0.01);
  if (hasAuthoritativeDuration && transcriptMax > sourceDuration + tolerance) {
    throw new Error(
      `TRANSCRIPT_TIMELINE_EXCEEDS_SOURCE_DURATION: transcript=${transcriptMax.toFixed(3)} source=${sourceDuration.toFixed(3)}`,
    );
  }

  const openingLimit = Math.max(2, sourceDuration * 0.1);
  if (intervals[0].start > openingLimit) {
    throw new Error("TRANSCRIPT_TIMELINE_INCOMPLETE: opening_coverage_missing");
  }

  let unionStart = Math.max(0, Math.min(sourceDuration, intervals[0].start));
  let unionEnd = Math.max(0, Math.min(sourceDuration, intervals[0].end));
  let coveredSeconds = 0;
  for (const interval of intervals.slice(1)) {
    const start = Math.max(0, Math.min(sourceDuration, interval.start));
    const end = Math.max(0, Math.min(sourceDuration, interval.end));
    if (end <= start) continue;
    if (start <= unionEnd) {
      unionEnd = Math.max(unionEnd, end);
    } else {
      coveredSeconds += unionEnd - unionStart;
      unionStart = start;
      unionEnd = end;
    }
  }
  coveredSeconds += Math.max(0, unionEnd - unionStart);
  const coverage = coveredSeconds / sourceDuration;
  if (coverage < MIN_TRANSCRIPT_TIMELINE_COVERAGE) {
    throw new Error(
      `TRANSCRIPT_TIMELINE_INCOMPLETE: coverage_${coverage.toFixed(4)}_below_${MIN_TRANSCRIPT_TIMELINE_COVERAGE}`,
    );
  }
  return sourceDuration;
}

/**
 * Replaces provider prose with exact caption speech. Each transcript segment
 * is assigned once to the block with the greatest positive time overlap;
 * punctuation and segment order are retained. Provider text (and therefore a
 * publication title/paraphrase) can never reach video_blocks.texto.
 */
export function assignExactTranscriptTextToBlocks<T extends NarrativeBlock>(
  sourceBlocks: readonly T[],
  sourceTranscript: readonly TranscriptTextSegment[],
): NarrativeBlock[] {
  if (!Array.isArray(sourceBlocks) || sourceBlocks.length === 0) {
    throw new Error("NARRATIVE_TRANSCRIPT_ASSIGNMENT_INVALID: no_blocks");
  }
  if (!Array.isArray(sourceTranscript) || sourceTranscript.length === 0) {
    throw new Error("NARRATIVE_TRANSCRIPT_ASSIGNMENT_INVALID: no_transcript");
  }
  const blocks = sourceBlocks.map((block) => ({ ...block }));
  const assigned = blocks.map(() => [] as Array<{ order: number; text: string }>);
  const transcript = sourceTranscript.map((segment, order) => {
    const start = Number(segment.tempo_inicio);
    const end = Number(segment.tempo_fim);
    const exactText = String(segment.texto || "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !exactText) {
      throw new Error(`NARRATIVE_TRANSCRIPT_ASSIGNMENT_INVALID: segment_${order + 1}`);
    }
    return { start, end, exactText, order };
  }).sort((left, right) => left.start - right.start || left.end - right.end || left.order - right.order);

  for (const segment of transcript) {
    let bestIndex = -1;
    let bestOverlap = 0;
    for (let index = 0; index < blocks.length; index++) {
      const blockStart = Number(blocks[index].tempo_inicio);
      const blockEnd = Number(blocks[index].tempo_fim);
      const overlap = Math.max(0, Math.min(segment.end, blockEnd) - Math.max(segment.start, blockStart));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestOverlap <= 0) {
      throw new Error(`NARRATIVE_TRANSCRIPT_ASSIGNMENT_INVALID: segment_${segment.order + 1}_without_overlap`);
    }
    assigned[bestIndex].push({ order: segment.order, text: segment.exactText });
  }

  blocks.forEach((block, index) => {
    block.texto = assigned[index]
      .sort((left, right) => left.order - right.order)
      .map((segment) => segment.text)
      .join(" ")
      .trim();
  });
  return blocks;
}

function timelineTolerance(totalDuration: number): {
  end: number;
  gap: number;
  overlap: number;
  totalGap: number;
  totalOverlap: number;
} {
  // Transcript timestamps are normally contiguous to the millisecond, while
  // provider decimals and container duration can differ slightly. These caps
  // tolerate ordinary rounding without accepting multi-second holes or a
  // narrative timeline from a different/longer source.
  return {
    end: Math.max(0.5, Math.min(1.5, totalDuration * 0.01)),
    gap: 3,
    overlap: Math.max(0.25, Math.min(1, totalDuration * 0.005)),
    totalGap: Math.max(5, totalDuration * 0.1),
    totalOverlap: Math.max(1, totalDuration * 0.02),
  };
}

export function narrativeBlockContractViolations(
  source: readonly NarrativeBlock[],
  totalDuration: number,
): string[] {
  const violations: string[] = [];
  if (!Array.isArray(source) ||
    source.length < MIN_NARRATIVE_BLOCKS ||
    source.length > MAX_NARRATIVE_BLOCKS) {
    violations.push(
      `expected_${MIN_NARRATIVE_BLOCKS}_${MAX_NARRATIVE_BLOCKS}_blocks_received_${
        Array.isArray(source) ? source.length : 0
      }`,
    );
    return violations;
  }
  if (!Number.isFinite(totalDuration) || totalDuration <= 0 || totalDuration > 3_600) {
    violations.push("total_duration_invalid");
    return violations;
  }

  const presentTypes = new Set(
    source.map((block) => String(block.tipo_bloco || "").trim().toLowerCase()),
  );
  const missingTypes = REQUIRED_NARRATIVE_BLOCK_TYPES.filter((type) => !presentTypes.has(type));
  if (missingTypes.length > 0) {
    violations.push(`missing_required_block_types_${missingTypes.join("_")}`);
  }
  const normalizedTypes = source.map((block) => String(block.tipo_bloco || "").trim().toLowerCase());
  const hookIndex = normalizedTypes.indexOf("hook");
  const developmentIndex = normalizedTypes.indexOf("desenvolvimento");
  const payoffIndex = normalizedTypes.lastIndexOf("payoff");
  if (hookIndex !== 0 || developmentIndex <= hookIndex || payoffIndex <= developmentIndex) {
    violations.push("narrative_chain_hook_development_payoff_invalid");
  }

  const tolerance = timelineTolerance(totalDuration);
  const openingLimit = Math.max(2, totalDuration * 0.1);
  let previousEnd: number | null = null;
  let totalGap = 0;
  let totalOverlap = 0;
  let unionStart: number | null = null;
  let unionEnd: number | null = null;
  let coveredSeconds = 0;
  source.forEach((block, index) => {
    const expectedId = index + 1;
    if (!Number.isSafeInteger(Number(block.bloco_id)) || Number(block.bloco_id) !== expectedId) {
      violations.push(`block_${expectedId}_id_not_sequential`);
    }
    if (!String(block.texto || "").trim()) violations.push(`block_${expectedId}_text_empty`);

    const start = Number(block.tempo_inicio);
    const end = Number(block.tempo_fim);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      violations.push(`block_${expectedId}_timestamps_not_finite`);
      previousEnd = null;
      return;
    }
    if (start < 0) violations.push(`block_${expectedId}_start_negative`);
    if (end <= start) violations.push(`block_${expectedId}_duration_not_positive`);
    if (end > totalDuration + tolerance.end) {
      violations.push(`block_${expectedId}_end_after_source_duration`);
    }
    if (index === 0 && start > openingLimit) violations.push("opening_block_too_late");
    if (previousEnd !== null) {
      const delta = start - previousEnd;
      if (delta > 0) totalGap += delta;
      if (delta < 0) totalOverlap += -delta;
      if (delta > tolerance.gap) violations.push(`block_${expectedId}_gap_too_large`);
      if (delta < -tolerance.overlap) violations.push(`block_${expectedId}_overlap_too_large`);
    }
    previousEnd = end;

    const clippedStart = Math.max(0, Math.min(totalDuration, start));
    const clippedEnd = Math.max(0, Math.min(totalDuration, end));
    if (clippedEnd > clippedStart) {
      if (unionStart === null || unionEnd === null) {
        unionStart = clippedStart;
        unionEnd = clippedEnd;
      } else if (clippedStart <= unionEnd) {
        unionEnd = Math.max(unionEnd, clippedEnd);
      } else {
        coveredSeconds += unionEnd - unionStart;
        unionStart = clippedStart;
        unionEnd = clippedEnd;
      }
    }
  });

  if (unionStart !== null && unionEnd !== null) coveredSeconds += unionEnd - unionStart;
  if (totalGap > tolerance.totalGap) violations.push("total_timeline_gap_too_large");
  if (totalOverlap > tolerance.totalOverlap) violations.push("total_timeline_overlap_too_large");
  if (coveredSeconds / totalDuration < 0.85) violations.push("timeline_union_coverage_below_85_percent");

  const lastEnd = Number(source.at(-1)?.tempo_fim);
  if (Number.isFinite(lastEnd) && lastEnd < totalDuration * 0.9) {
    violations.push("ending_coverage_below_90_percent");
  }
  return violations;
}

/**
 * Fails closed when a provider result cannot represent the minimum viral
 * narrative contract. Call this after normalization and before replacing any
 * persisted blocks so an incomplete response never destroys a valid analysis.
 */
export function assertNarrativeBlockContract(
  source: readonly NarrativeBlock[],
  totalDuration: number,
): void {
  const violations = narrativeBlockContractViolations(source, totalDuration);
  if (violations.length === 0) return;
  throw new Error(`NARRATIVE_BLOCK_CONTRACT_INVALID: ${violations.join(", ")}`);
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function joinedText(left: unknown, right: unknown): string {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a) return b;
  if (!b || a === b || a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
}

function mergedType(left: NarrativeBlock, right: NarrativeBlock): string {
  const a = String(left.tipo_bloco || "").trim();
  const b = String(right.tipo_bloco || "").trim();
  if (a === b) return a;
  if (a === "hook" || b === "hook") return "hook";
  if (a === "payoff" || b === "payoff") return "payoff";
  if (a === "desenvolvimento" || b === "desenvolvimento") return "desenvolvimento";
  if (a === "tensao" || b === "tensao") return "tensao";
  if (a === "revelacao" || b === "revelacao") return "revelacao";
  return a || b || "transicao";
}

function mergeCost(blocks: NarrativeBlock[], index: number): number {
  const left = blocks[index];
  const right = blocks[index + 1];
  const leftType = String(left.tipo_bloco || "");
  const rightType = String(right.tipo_bloco || "");
  const boundaryStrength = Math.max(0, Math.min(100, finite(right.semantic_shift_score, 50)));
  const essentialPenalty = (ESSENTIAL_TYPES.has(leftType) ? 1_000 : 0)
    + (ESSENTIAL_TYPES.has(rightType) ? 1_000 : 0);
  const typePenalty = leftType && rightType && leftType !== rightType ? 45 : 0;
  const edgePenalty = index === 0 || index + 1 === blocks.length - 1 ? 250 : 0;
  return boundaryStrength + essentialPenalty + typePenalty + edgePenalty;
}

function mergePair(left: NarrativeBlock, right: NarrativeBlock): NarrativeBlock {
  const type = mergedType(left, right);
  const typeOwner = String(left.tipo_bloco || "") === type ? left : right;
  return {
    ...left,
    tipo_bloco: type,
    tempo_inicio: Math.min(finite(left.tempo_inicio, 0), finite(right.tempo_inicio, 0)),
    tempo_fim: Math.max(finite(left.tempo_fim, 0), finite(right.tempo_fim, 0)),
    texto: joinedText(left.texto, right.texto),
    emocao: typeOwner.emocao || right.emocao || left.emocao,
    funcao_narrativa: joinedText(left.funcao_narrativa, right.funcao_narrativa),
    semantic_shift_score: finite(left.semantic_shift_score, finite(right.semantic_shift_score, 50)),
    visual_shift_score: Math.max(
      finite(left.visual_shift_score, 0),
      finite(right.visual_shift_score, 0),
    ),
  };
}

/**
 * Coalesces the weakest adjacent semantic boundaries until a provider result
 * fits the supported narrative range. No text or time span is discarded, and
 * hook/payoff boundaries receive a strong preservation penalty.
 */
export function enforceNarrativeBlockLimit<T extends NarrativeBlock>(
  source: readonly T[],
  maxBlocks: number,
): NarrativeBlock[] {
  const limit = Math.max(1, Math.floor(maxBlocks));
  const blocks: NarrativeBlock[] = source.map((block) => ({ ...block }));
  while (blocks.length > limit) {
    let candidate = 0;
    let candidateCost = Number.POSITIVE_INFINITY;
    for (let index = 0; index < blocks.length - 1; index++) {
      const cost = mergeCost(blocks, index);
      if (cost < candidateCost) {
        candidate = index;
        candidateCost = cost;
      }
    }
    blocks.splice(candidate, 2, mergePair(blocks[candidate], blocks[candidate + 1]));
  }
  blocks.forEach((block, index) => {
    block.bloco_id = index + 1;
  });
  return blocks;
}
