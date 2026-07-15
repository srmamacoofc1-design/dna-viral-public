/**
 * Structural Fit — Pure observational layer
 * 
 * Measures how close each video's structure is to the dominant patterns
 * in the dataset. Uses ONLY MVP base data.
 * 
 * NO quality labels. NO "better" or "worse".
 * NO invented weights or scoring formulas.
 * 
 * Sources:
 *   - video_blocks.tipo_bloco → block type presence
 *   - video_blocks.tempo_inicio / videos.duracao → relative positions
 *   - block_word_patterns → word counts
 * 
 * Manual decisions documented:
 *   - Block overlap is measured as set intersection (Jaccard-like)
 *     Decision: using set overlap count, NOT Jaccard distance
 *     This is a counting method, not an invented formula
 *   - Percentiles are computed from the actual distribution
 *     No arbitrary thresholds applied
 */

import {
  extractStructureSnapshots,
  buildBlockPresenceTable,
  buildSequenceFrequencyTable,
  type VideoStructureSnapshot,
  type BlockPresenceEntry,
  type SequenceFrequencyEntry,
} from "./viral-score";

export interface StructuralFitProfile {
  video_id: string;
  titulo: string;
  /** Block types present in this video */
  block_types_present: string[];
  /** Count of block types that overlap with the most common set */
  block_overlap_count: number;
  /** Percentage of most-common block types present in this video */
  block_overlap_pct: number;
  /** The video's block sequence */
  sequence: string;
  /** How many other videos share this exact sequence */
  sequence_match_frequency: number;
  /** Median position deviation: avg abs difference from dataset median positions */
  position_deviation_from_median: number | null;
  /** Percentile of this video's fit within the dataset (observational, no labels) */
  fit_percentile: number;
  /** Total block types in dataset for reference */
  total_dataset_block_types: number;
}

export interface StructuralFitResult {
  profiles: StructuralFitProfile[];
  /** Most common block types across dataset (by presence_pct) */
  dominant_block_types: string[];
  /** Reference: block presence table */
  block_presence: BlockPresenceEntry[];
  /** Reference: sequence frequency table */
  sequence_frequency: SequenceFrequencyEntry[];
  metadata: {
    total_videos: number;
    total_block_types: number;
    extraction_timestamp: string;
    method: "structural_overlap_observation";
    manual_decisions: string[];
  };
}

export async function computeStructuralFit(): Promise<StructuralFitResult> {
  const snapshots = await extractStructureSnapshots();

  if (snapshots.length === 0) {
    return {
      profiles: [],
      dominant_block_types: [],
      block_presence: [],
      sequence_frequency: [],
      metadata: {
        total_videos: 0,
        total_block_types: 0,
        extraction_timestamp: new Date().toISOString(),
        method: "structural_overlap_observation",
        manual_decisions: [],
      },
    };
  }

  const blockPresence = buildBlockPresenceTable(snapshots);
  const seqTable = buildSequenceFrequencyTable(snapshots);

  // Dominant block types: those present in > 50% of videos
  // NOTE: 50% is derived from "majority of videos" — a counting threshold, not quality
  const totalVideos = snapshots.length;
  const dominantTypes = blockPresence
    .filter(bp => bp.presence_pct > 50)
    .map(bp => bp.tipo_bloco);

  const allBlockTypes = [...new Set(
    snapshots.flatMap(s => s.blocks.map(b => b.tipo_bloco).filter(Boolean))
  )] as string[];

  // Compute median positions per block type across dataset
  const positionsByType = new Map<string, number[]>();
  for (const snap of snapshots) {
    for (const b of snap.blocks) {
      if (!b.tipo_bloco) continue;
      const positions = positionsByType.get(b.tipo_bloco) || [];
      positions.push(b.posicao_relativa);
      positionsByType.set(b.tipo_bloco, positions);
    }
  }
  const medianPositions = new Map<string, number>();
  for (const [type, positions] of positionsByType.entries()) {
    const sorted = [...positions].sort((a, b) => a - b);
    medianPositions.set(type, sorted[Math.floor(sorted.length / 2)]);
  }

  // Build profiles
  const seqFreqMap = new Map(seqTable.map(s => [s.sequence, s.frequency]));

  const profiles: StructuralFitProfile[] = snapshots.map(snap => {
    const typesPresent = [...new Set(snap.blocks.map(b => b.tipo_bloco).filter(Boolean))] as string[];
    const overlapCount = typesPresent.filter(t => dominantTypes.includes(t)).length;
    const overlapPct = dominantTypes.length > 0 ? +(overlapCount / dominantTypes.length * 100).toFixed(1) : 0;

    const seq = snap.blocks.map(b => b.tipo_bloco ?? "null").join(" → ");
    const seqFreq = seqFreqMap.get(seq) ?? 0;

    // Position deviation from median
    let posDeviation: number | null = null;
    const deviations: number[] = [];
    for (const b of snap.blocks) {
      if (!b.tipo_bloco) continue;
      const median = medianPositions.get(b.tipo_bloco);
      if (median != null) {
        deviations.push(Math.abs(b.posicao_relativa - median));
      }
    }
    if (deviations.length > 0) {
      posDeviation = +(deviations.reduce((s, d) => s + d, 0) / deviations.length).toFixed(4);
    }

    return {
      video_id: snap.video_id,
      titulo: snap.titulo,
      block_types_present: typesPresent,
      block_overlap_count: overlapCount,
      block_overlap_pct: overlapPct,
      sequence: seq,
      sequence_match_frequency: seqFreq,
      position_deviation_from_median: posDeviation,
      fit_percentile: 0, // computed below
      total_dataset_block_types: allBlockTypes.length,
    };
  });

  // Compute fit_percentile based on overlap_pct (observational rank)
  const overlapValues = profiles.map(p => p.block_overlap_pct).sort((a, b) => a - b);
  for (const p of profiles) {
    if (overlapValues.length <= 1) {
      p.fit_percentile = 0;
    } else {
      const belowCount = overlapValues.filter(v => v < p.block_overlap_pct).length;
      p.fit_percentile = +(belowCount / (overlapValues.length - 1) * 100).toFixed(1);
    }
  }

  return {
    profiles,
    dominant_block_types: dominantTypes,
    block_presence: blockPresence,
    sequence_frequency: seqTable,
    metadata: {
      total_videos: totalVideos,
      total_block_types: allBlockTypes.length,
      extraction_timestamp: new Date().toISOString(),
      method: "structural_overlap_observation",
      manual_decisions: [
        "dominant_block_types defined as presence_pct > 50% (majority threshold — counting, not quality)",
        "fit_percentile computed from rank position of block_overlap_pct within dataset",
        "position_deviation_from_median uses mean absolute deviation from per-type median positions",
      ],
    },
  };
}
