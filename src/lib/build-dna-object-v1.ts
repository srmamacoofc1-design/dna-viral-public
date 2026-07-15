import { supabase } from "@/integrations/supabase/client";

export interface DNAObjectV1 {
  id?: string;
  created_at?: string;
  source_scope: string;
  total_videos_used: number;
  dominant_sequence: string | null;
  required_blocks: string[];
  optional_blocks: string[];
  avg_hook_time_pct: number | null;
  avg_payoff_time_pct: number | null;
  avg_cta_time: number | null;
  avg_block_count: number | null;
  avg_video_duration: number | null;
  dominant_emotion: string | null;
  secondary_emotion: string | null;
  dominant_cta_type: string | null;
  /** Observational: average engagement_rate_relative across eligible videos */
  avg_engagement_rate: number | null;
  /** Which column was used: engagement_rate_relative or engagement_percentile_display */
  engagement_source: "engagement_rate_relative" | "engagement_percentile_display" | null;
  notes: string | null;
  status: "ready" | "incomplete" | "no_data";
}

export async function buildDNAObjectV1(): Promise<DNAObjectV1> {
  // 1. Fetch latest dna_base_v2 + dna_base_v2_formal in parallel
  const [dnaBaseRes, dnaFormalRes, videoStatsRes, blocksRes, ctaDataRes, ctaProfilesRes] =
    await Promise.all([
      supabase.from("dna_base_v2").select("*").order("generated_at", { ascending: false }).limit(1).single(),
      supabase.from("dna_base_v2_formal").select("*").order("generated_at", { ascending: false }).limit(1).single(),
      // Fetch videos with both score columns + duration
      supabase.from("videos").select("duracao, engagement_rate_relative, engagement_percentile_display").eq("status", "completed"),
      // Single query for all block data needed
      supabase.from("video_blocks").select("video_id, tipo_bloco"),
      supabase.from("cta_deep_analysis").select("cta_type"),
      supabase.from("cta_profiles").select("cta_position_seconds"),
    ]);

  const dnaBase = dnaBaseRes.data;
  const dnaFormal = dnaFormalRes.data;
  const videoStats = videoStatsRes.data ?? [];
  const blocks = blocksRes.data ?? [];
  const ctaData = ctaDataRes.data ?? [];
  const ctaProfiles = ctaProfilesRes.data ?? [];

  const totalVideos = videoStats.length;

  // No data at all
  if (totalVideos === 0) {
    return {
      source_scope: "all_videos",
      total_videos_used: 0,
      dominant_sequence: null,
      required_blocks: [],
      optional_blocks: [],
      avg_hook_time_pct: null,
      avg_payoff_time_pct: null,
      avg_cta_time: null,
      avg_block_count: null,
      avg_video_duration: null,
      dominant_emotion: null,
      secondary_emotion: null,
      dominant_cta_type: null,
      avg_engagement_rate: null,
      engagement_source: null,
      notes: null,
      status: "no_data",
    };
  }

  // --- Compute fields from single blocks query ---

  // Block type presence per video + block count per video
  const videoBlockTypes: Record<string, Set<string>> = {};
  const videoBlockCountMap: Record<string, number> = {};
  blocks.forEach((b) => {
    if (!videoBlockTypes[b.video_id]) videoBlockTypes[b.video_id] = new Set();
    videoBlockTypes[b.video_id].add(b.tipo_bloco);
    videoBlockCountMap[b.video_id] = (videoBlockCountMap[b.video_id] || 0) + 1;
  });

  // Required and optional blocks — thresholds derived from actual distribution
  // Calculate the frequency percentages and use natural clustering
  const blockTypeVideoCounts: Record<string, number> = {};
  Object.values(videoBlockTypes).forEach((types) => {
    types.forEach((t) => {
      blockTypeVideoCounts[t] = (blockTypeVideoCounts[t] || 0) + 1;
    });
  });

  // Derive thresholds from the distribution itself (P75 and P25 of presence percentages)
  const presencePcts = Object.values(blockTypeVideoCounts).map(c => c / totalVideos);
  presencePcts.sort((a, b) => a - b);
  
  const requiredBlocks: string[] = [];
  const optionalBlocks: string[] = [];

  if (presencePcts.length > 0) {
    const p75 = presencePcts[Math.floor(presencePcts.length * 0.75)] ?? 0;
    const p25 = presencePcts[Math.floor(presencePcts.length * 0.25)] ?? 0;
    
    Object.entries(blockTypeVideoCounts).forEach(([type, count]) => {
      const pct = count / totalVideos;
      if (pct >= p75) requiredBlocks.push(type);
      else if (pct >= p25) optionalBlocks.push(type);
    });
  }

  // Avg block count per video
  const blockCountValues = Object.values(videoBlockCountMap);
  const avgBlockCount = blockCountValues.length > 0
    ? blockCountValues.reduce((a, b) => a + b, 0) / blockCountValues.length
    : null;

  // Dominant sequence from dna_base_v2
  const dominantSequence = dnaBase?.dominant_structure_sequence ?? null;

  // Avg duration
  const avgDuration = videoStats.reduce((s, v) => s + (Number(v.duracao) || 0), 0) / totalVideos;

  // --- avg_engagement_rate — derived from engagement_rate_relative (observational) ---
  let avgEngagementRate: number | null = null;
  let engagementSource: DNAObjectV1["engagement_source"] = null;

  const engagementValid = videoStats.filter((v) => v.engagement_rate_relative != null && Number(v.engagement_rate_relative) > 0);
  if (engagementValid.length > 0) {
    avgEngagementRate = engagementValid.reduce((s, v) => s + Number(v.engagement_rate_relative), 0) / engagementValid.length;
    engagementSource = "engagement_rate_relative";
  } else {
    const percentileValid = videoStats.filter((v) => v.engagement_percentile_display != null);
    if (percentileValid.length > 0) {
      avgEngagementRate = percentileValid.reduce((s, v) => s + Number(v.engagement_percentile_display), 0) / percentileValid.length;
      engagementSource = "engagement_percentile_display";
    }
  }

  // --- CORREÇÃO 2: Hook / Payoff como percentual explícito ---
  let avgHookTimePct: number | null = null;
  let avgPayoffTimePct: number | null = null;
  if (dnaFormal) {
    const temporal = dnaFormal.temporal as Record<string, unknown> | null;
    if (temporal) {
      avgHookTimePct = (temporal.avg_hook_time_pct as number) ?? null;
      avgPayoffTimePct = (temporal.avg_payoff_time_pct as number) ?? null;
    }
  }

  // CTA avg time (seconds)
  const ctaTimes = ctaProfiles.filter((c) => c.cta_position_seconds != null);
  const avgCtaTime = ctaTimes.length > 0
    ? ctaTimes.reduce((s, c) => s + Number(c.cta_position_seconds), 0) / ctaTimes.length
    : null;

  // Emotion from formal DNA — try explicit field first, fallback to emotion_distribution top entry
  let dominantEmotion: string | null = null;
  let secondaryEmotion: string | null = null;
  if (dnaFormal) {
    const emotional = dnaFormal.emotional as Record<string, unknown> | null;
    if (emotional) {
      dominantEmotion = (emotional.dominant_emotion as string) ?? null;
      secondaryEmotion = (emotional.secondary_emotion as string) ?? null;

      // If dominant_emotion not present, derive from emotion_distribution (no hardcoded fallback)
      if (!dominantEmotion && Array.isArray(emotional.emotion_distribution)) {
        const dist = emotional.emotion_distribution as Array<{ emotion: string; count: number; pct: number }>;
        if (dist.length > 0) dominantEmotion = dist[0].emotion;
        if (dist.length > 1 && !secondaryEmotion) secondaryEmotion = dist[1].emotion;
      }
    }
  }

  // Dominant CTA type
  let dominantCtaType: string | null = dnaBase?.dominant_cta_pattern ?? null;
  if (!dominantCtaType && ctaData.length > 0) {
    const ctaCounts: Record<string, number> = {};
    ctaData.forEach((c) => {
      if (c.cta_type) ctaCounts[c.cta_type] = (ctaCounts[c.cta_type] || 0) + 1;
    });
    const sorted = Object.entries(ctaCounts).sort((a, b) => b[1] - a[1]);
    dominantCtaType = sorted[0]?.[0] ?? null;
  }

  // --- CORREÇÃO 4: Status mais criterioso ---
  let status: DNAObjectV1["status"];
  if (totalVideos === 0) {
    status = "no_data";
  } else if (
    dominantSequence != null &&
    avgEngagementRate != null &&
    dominantEmotion != null &&
    requiredBlocks.length > 0
  ) {
    status = "ready";
  } else {
    status = "incomplete";
  }

  return {
    source_scope: "all_videos",
    total_videos_used: totalVideos,
    dominant_sequence: dominantSequence,
    required_blocks: requiredBlocks,
    optional_blocks: optionalBlocks,
    avg_hook_time_pct: avgHookTimePct,
    avg_payoff_time_pct: avgPayoffTimePct,
    avg_cta_time: avgCtaTime != null ? Math.round(avgCtaTime * 100) / 100 : null,
    avg_block_count: avgBlockCount != null ? Math.round(avgBlockCount * 10) / 10 : null,
    avg_video_duration: avgDuration != null ? Math.round(avgDuration * 100) / 100 : null,
    dominant_emotion: dominantEmotion,
    secondary_emotion: secondaryEmotion,
    dominant_cta_type: dominantCtaType,
    avg_engagement_rate: avgEngagementRate != null ? Math.round(avgEngagementRate * 10) / 10 : null,
    engagement_source: engagementSource,
    notes: null,
    status,
  };
}

export async function saveDNAObject(obj: DNAObjectV1) {
  const { data, error } = await supabase
    .from("dna_objects")
    .insert({
      source_scope: obj.source_scope,
      total_videos_used: obj.total_videos_used,
      dominant_sequence: obj.dominant_sequence,
      required_blocks: obj.required_blocks,
      optional_blocks: obj.optional_blocks,
      avg_hook_time: obj.avg_hook_time_pct,
      avg_payoff_time: obj.avg_payoff_time_pct,
      avg_cta_time: obj.avg_cta_time,
      avg_block_count: obj.avg_block_count,
      avg_video_duration: obj.avg_video_duration,
      dominant_emotion: obj.dominant_emotion,
      secondary_emotion: obj.secondary_emotion,
      dominant_cta_type: obj.dominant_cta_type,
      avg_engagement_rate: obj.avg_engagement_rate,
      notes: obj.engagement_source ? `engagement_source: ${obj.engagement_source}` : obj.notes,
      status: obj.status,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function loadLatestDNAObject() {
  const { data, error } = await supabase
    .from("dna_objects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}
