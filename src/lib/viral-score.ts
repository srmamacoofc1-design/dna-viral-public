/**
 * Structural Pattern Mapper — Pure Observation from MVP Base
 *
 * RULES:
 * - NO scores, NO weights, NO formulas
 * - NO views/likes/comments as quality indicators
 * - NO invented categories or thresholds
 * - NO automatic classification of "dominant" or "outlier"
 * - ONLY counts, frequencies, distributions, and observed percentiles
 *
 * This module observes, counts, crosses and compares structural patterns
 * across all completed videos using exclusively MVP base data.
 */

import { supabase } from "@/integrations/supabase/client";

// ─── TYPES ───────────────────────────────────────────────────────────

/** ETAPA 1: Raw snapshot of a single video's structure */
export interface VideoStructureSnapshot {
  video_id: string;
  titulo: string;
  duracao_total: number;
  numero_total_blocos: number;
  blocks: BlockSnapshot[];
}

export interface BlockSnapshot {
  block_id: string;
  video_id: string;
  tipo_bloco: string | null;
  tempo_inicio: number;
  tempo_fim: number;
  duracao_bloco: number;
  posicao_relativa: number;
  word_count: number;
  texto: string | null;
  emocao: string | null;
  funcao_narrativa: string | null;
  indicators: BlockIndicators;
}

export interface BlockIndicators {
  is_emotional: boolean;
  is_impact: boolean;
  is_dominant: boolean;
  is_rare: boolean;
}

/** ETAPA 2: Distribution data per block type */
export interface BlockTypeDistribution {
  tipo_bloco: string;
  total_count: number;
  word_counts_sorted: number[];
  word_count_min: number;
  word_count_max: number;
  posicoes_relativas_sorted: number[];
}

/** Block presence across videos (distinct video count) */
export interface BlockPresenceEntry {
  tipo_bloco: string;
  distinct_video_count: number;
  presence_pct: number;
  video_ids: string[];
}

/** ETAPA 3: Sequence frequency */
export interface SequenceFrequencyEntry {
  sequence: string;
  frequency: number;
  video_ids: string[];
}

/** ETAPA 4: Per-video pattern profile (observational only) */
export interface VideoPatternProfile {
  video_id: string;
  titulo: string;
  sequence: string;
  matched_sequence_frequency: number;
  total_known_sequences: number;
  block_types_present: string[];
  block_types_absent_from_dataset: string[];
  match_percentile_within_dataset: number;
}

/** ETAPA 7: Complete structural map */
export interface StructuralMap {
  sequence_frequency_table: SequenceFrequencyEntry[];
  block_presence_table: BlockPresenceEntry[];
  block_type_distributions: BlockTypeDistribution[];
  video_pattern_profiles: VideoPatternProfile[];
  snapshots: VideoStructureSnapshot[];
  metadata: {
    total_videos: number;
    total_blocks: number;
    all_block_types: string[];
    extraction_timestamp: string;
    method: "pure_observation";
  };
}

// ─── BACKWARD COMPAT (types still imported by DNAViralPage) ─────────

/** @deprecated Scoring removed — use StructuralMap */
export interface ViralScoreResult {
  id: string;
  titulo: string;
  views: number;
  likes: number;
  comments: number;
  engagement_rate: number;
  engagement_rate_relative: number;
  dataset_weight_pct: number;
}

/** @deprecated Scoring removed — use StructuralMap */
export interface ViralScoreStats {
  max_views: number;
  max_likes: number;
  max_comments: number;
  max_engagement_rate: number;
  total_engagement_relative: number;
  total_dataset_weight: number;
  scoring_method: string;
}

/** @deprecated Scoring removed */
export function calculateViralScores(
  _videos: Array<{ id: string; titulo: string; views: number; likes: number; comments: number }>
): { results: ViralScoreResult[]; stats: ViralScoreStats } {
  return {
    results: [],
    stats: {
      max_views: 0, max_likes: 0, max_comments: 0, max_engagement_rate: 0,
      total_engagement_relative: 0, total_dataset_weight: 0,
      scoring_method: "deprecated_use_structural_map",
    },
  };
}

/** @deprecated Scoring removed */
export function calculateViralScore(
  _video: { views?: number | null; likes?: number | null; comments?: number | null }
): number | null {
  return null;
}

// ─── ETAPA 1: Extract raw structure ─────────────────────────────────

export async function extractStructureSnapshots(): Promise<VideoStructureSnapshot[]> {
  const { data: videos, error: vErr } = await supabase
    .from("videos")
    .select("id, titulo, duracao, numero_blocos")
    .eq("status", "completed");

  if (vErr || !videos || videos.length === 0) return [];

  const { data: blocks, error: bErr } = await supabase
    .from("video_blocks")
    .select("id, video_id, tipo_bloco, tempo_inicio, tempo_fim, texto, emocao, funcao_narrativa")
    .in("video_id", videos.map(v => v.id));

  if (bErr || !blocks) return [];

  const { data: wordPatterns } = await supabase
    .from("block_word_patterns")
    .select("block_id, is_emotional, is_impact, is_dominant, is_rare, word")
    .in("video_id", videos.map(v => v.id));

  // Build indicator map per block
  const indicatorMap = new Map<string, { is_emotional: boolean; is_impact: boolean; is_dominant: boolean; is_rare: boolean; word_count: number }>();
  if (wordPatterns) {
    for (const wp of wordPatterns) {
      const existing = indicatorMap.get(wp.block_id);
      if (existing) {
        existing.word_count++;
        if (wp.is_emotional) existing.is_emotional = true;
        if (wp.is_impact) existing.is_impact = true;
        if (wp.is_dominant) existing.is_dominant = true;
        if (wp.is_rare) existing.is_rare = true;
      } else {
        indicatorMap.set(wp.block_id, {
          is_emotional: wp.is_emotional,
          is_impact: wp.is_impact,
          is_dominant: wp.is_dominant,
          is_rare: wp.is_rare,
          word_count: 1,
        });
      }
    }
  }

  const blocksByVideo = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const list = blocksByVideo.get(b.video_id) || [];
    list.push(b);
    blocksByVideo.set(b.video_id, list);
  }

  return videos.map(v => {
    const vBlocks = (blocksByVideo.get(v.id) || [])
      .sort((a, b) => (a.tempo_inicio ?? 0) - (b.tempo_inicio ?? 0));
    const duracao = v.duracao || 1;

    return {
      video_id: v.id,
      titulo: v.titulo || "",
      duracao_total: duracao,
      numero_total_blocos: vBlocks.length,
      blocks: vBlocks.map(b => {
        const ind = indicatorMap.get(b.id);
        const textoStr = b.texto || "";
        const wordCount = ind?.word_count ?? (textoStr ? textoStr.split(/\s+/).filter(Boolean).length : 0);
        return {
          block_id: b.id,
          video_id: b.video_id,
          tipo_bloco: b.tipo_bloco ?? null,
          tempo_inicio: b.tempo_inicio ?? 0,
          tempo_fim: b.tempo_fim ?? 0,
          duracao_bloco: (b.tempo_fim ?? 0) - (b.tempo_inicio ?? 0),
          posicao_relativa: duracao > 0 ? (b.tempo_inicio ?? 0) / duracao : 0,
          word_count: wordCount,
          texto: b.texto,
          emocao: b.emocao,
          funcao_narrativa: b.funcao_narrativa,
          indicators: {
            is_emotional: ind?.is_emotional ?? false,
            is_impact: ind?.is_impact ?? false,
            is_dominant: ind?.is_dominant ?? false,
            is_rare: ind?.is_rare ?? false,
          },
        };
      }),
    };
  });
}

// ─── ETAPA 2: Map distribution per block type ───────────────────────

export function mapBlockTypeDistributions(snapshots: VideoStructureSnapshot[]): BlockTypeDistribution[] {
  const typeMap = new Map<string, { wordCounts: number[]; positions: number[] }>();

  for (const snap of snapshots) {
    for (const b of snap.blocks) {
      if (b.tipo_bloco === null) continue;
      const entry = typeMap.get(b.tipo_bloco) || { wordCounts: [], positions: [] };
      entry.wordCounts.push(b.word_count);
      entry.positions.push(+b.posicao_relativa.toFixed(4));
      typeMap.set(b.tipo_bloco, entry);
    }
  }

  return Array.from(typeMap.entries()).map(([tipo, data]) => {
    const wc = [...data.wordCounts].sort((a, b) => a - b);
    const pos = [...data.positions].sort((a, b) => a - b);
    return {
      tipo_bloco: tipo,
      total_count: wc.length,
      word_counts_sorted: wc,
      word_count_min: wc[0] ?? 0,
      word_count_max: wc[wc.length - 1] ?? 0,
      posicoes_relativas_sorted: pos,
    };
  }).sort((a, b) => b.total_count - a.total_count);
}

// ─── Block presence table (distinct videos per block type) ──────────

export function buildBlockPresenceTable(snapshots: VideoStructureSnapshot[]): BlockPresenceEntry[] {
  const presenceMap = new Map<string, Set<string>>();

  for (const snap of snapshots) {
    for (const b of snap.blocks) {
      if (b.tipo_bloco === null) continue;
      const set = presenceMap.get(b.tipo_bloco) || new Set();
      set.add(snap.video_id);
      presenceMap.set(b.tipo_bloco, set);
    }
  }

  const totalVideos = snapshots.length;

  return Array.from(presenceMap.entries())
    .map(([tipo, videoSet]) => ({
      tipo_bloco: tipo,
      distinct_video_count: videoSet.size,
      presence_pct: totalVideos > 0 ? +(videoSet.size / totalVideos * 100).toFixed(1) : 0,
      video_ids: Array.from(videoSet),
    }))
    .sort((a, b) => b.distinct_video_count - a.distinct_video_count);
}

// ─── ETAPA 3: Sequence frequency table ──────────────────────────────

export function buildSequenceFrequencyTable(snapshots: VideoStructureSnapshot[]): SequenceFrequencyEntry[] {
  const seqMap = new Map<string, string[]>();

  for (const snap of snapshots) {
    const seq = snap.blocks
      .map(b => b.tipo_bloco ?? "null")
      .join(" → ");
    const ids = seqMap.get(seq) || [];
    ids.push(snap.video_id);
    seqMap.set(seq, ids);
  }

  return Array.from(seqMap.entries())
    .map(([sequence, video_ids]) => ({
      sequence,
      frequency: video_ids.length,
      video_ids,
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

// ─── ETAPA 4: Video pattern profiles (observational, no labels) ─────

export function buildVideoPatternProfiles(
  snapshots: VideoStructureSnapshot[],
  seqTable: SequenceFrequencyEntry[],
  allBlockTypes: string[]
): VideoPatternProfile[] {
  // Build sequence frequency lookup
  const seqFreqMap = new Map(seqTable.map(s => [s.sequence, s.frequency]));

  // Collect all match counts first for percentile calculation
  const profiles = snapshots.map(snap => {
    const seq = snap.blocks.map(b => b.tipo_bloco ?? "null").join(" → ");
    const matchedFreq = seqFreqMap.get(seq) ?? 0;
    const typesPresent = [...new Set(snap.blocks.map(b => b.tipo_bloco).filter(Boolean))] as string[];
    const typesAbsent = allBlockTypes.filter(t => !typesPresent.includes(t));

    return {
      video_id: snap.video_id,
      titulo: snap.titulo,
      sequence: seq,
      matched_sequence_frequency: matchedFreq,
      total_known_sequences: seqTable.length,
      block_types_present: typesPresent,
      block_types_absent_from_dataset: typesAbsent,
      match_percentile_within_dataset: 0, // will be computed below
    };
  });

  // Compute percentile from the real distribution of matched_sequence_frequency
  const allFreqs = profiles.map(p => p.matched_sequence_frequency).sort((a, b) => a - b);

  for (const p of profiles) {
    if (allFreqs.length <= 1) {
      p.match_percentile_within_dataset = 0;
    } else {
      const belowCount = allFreqs.filter(f => f < p.matched_sequence_frequency).length;
      p.match_percentile_within_dataset = +(belowCount / (allFreqs.length - 1) * 100).toFixed(1);
    }
  }

  return profiles;
}

// ─── ETAPA 7: Generate complete structural map ──────────────────────

export async function generateStructuralMap(): Promise<StructuralMap> {
  const snapshots = await extractStructureSnapshots();

  if (snapshots.length === 0) {
    return {
      sequence_frequency_table: [],
      block_presence_table: [],
      block_type_distributions: [],
      video_pattern_profiles: [],
      snapshots: [],
      metadata: {
        total_videos: 0,
        total_blocks: 0,
        all_block_types: [],
        extraction_timestamp: new Date().toISOString(),
        method: "pure_observation",
      },
    };
  }

  const distributions = mapBlockTypeDistributions(snapshots);
  const blockPresence = buildBlockPresenceTable(snapshots);
  const seqTable = buildSequenceFrequencyTable(snapshots);

  const allBlockTypes = [...new Set(
    snapshots.flatMap(s => s.blocks.map(b => b.tipo_bloco).filter(Boolean))
  )] as string[];

  const profiles = buildVideoPatternProfiles(snapshots, seqTable, allBlockTypes);
  const totalBlocks = snapshots.reduce((s, v) => s + v.numero_total_blocos, 0);

  return {
    sequence_frequency_table: seqTable,
    block_presence_table: blockPresence,
    block_type_distributions: distributions,
    video_pattern_profiles: profiles,
    snapshots,
    metadata: {
      total_videos: snapshots.length,
      total_blocks: totalBlocks,
      all_block_types: allBlockTypes,
      extraction_timestamp: new Date().toISOString(),
      method: "pure_observation",
    },
  };
}
