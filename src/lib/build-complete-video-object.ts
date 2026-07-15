import { supabase } from "@/integrations/supabase/client";

export interface CompleteVideoObject {
  video_id: string;
  metadata: {
    title: string | null;
    duration: number | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    engagement_rate: number | null;
    engagement_rate_relative: number | null;
    engagement_percentile: number | null;
    engagement_percentile_display: number | null;
  };
  narrative: {
    sequence_order: string[];
    dominant_structure: string | null;
    emotional_arc: string | null;
  };
  blocks: Array<{
    block_id: string;
    start_time: number;
    end_time: number;
    duration: number;
    block_type: string;
    text: string | null;
    verbal_density: number | null;
    alignment_score: number | null;
  }>;
  micro_events: Array<{
    event_id: string;
    timestamp: number;
    event_type: string;
  }>;
  alignment: {
    avg_alignment_score: number | null;
    visual_confidence: number | null;
  };
  performance: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    engagement_rate: number | null;
    engagement_rate_relative: number | null;
  };
  semantic_patterns: {
    dominant_words: any[];
    dominant_phrases: any[];
  };
  _meta: {
    generated_at: string;
    source: string;
    version: string;
  };
}

function calcEngagementRate(views: number | null, likes: number | null, comments: number | null): number | null {
  const v = Number(views) || 0;
  if (v === 0) return null;
  const l = Number(likes) || 0;
  const c = Number(comments) || 0;
  return Number(((l + c) / v).toFixed(6));
}

/**
 * Build a complete video object from direct DB queries.
 * Each call fetches fresh data for a single video.
 */
export async function buildCompleteVideoObject(videoId: string): Promise<CompleteVideoObject> {
  const [
    videoRes,
    blocksRes,
    microEventsRes,
    alignmentRes,
    semanticRes,
    blockSemanticsRes,
  ] = await Promise.all([
    supabase.from("videos").select("*").eq("id", videoId).single(),
    supabase.from("video_blocks").select("*").eq("video_id", videoId).order("bloco_id", { ascending: true }),
    supabase.from("video_micro_events").select("*").eq("video_id", videoId).order("timestamp_seconds", { ascending: true }),
    supabase.from("text_visual_alignment").select("*").eq("video_id", videoId),
    supabase.from("semantic_patterns").select("*").eq("video_id", videoId).limit(1),
    supabase.from("block_semantic_patterns").select("*").eq("video_id", videoId),
  ]);

  const video = videoRes.data;
  if (!video) throw new Error(`Video ${videoId} not found`);

  const blocks = blocksRes.data || [];
  const microEvents = microEventsRes.data || [];
  const alignments = alignmentRes.data || [];
  const semantic = semanticRes.data?.[0] || null;
  const blockSemantics = blockSemanticsRes.data || [];

  // Engagement rate
  const engRate = calcEngagementRate(
    (video as any).views,
    (video as any).likes,
    (video as any).comments,
  );

  // Narrative info from blocks
  const sequenceOrder = blocks.map((b: any) => b.tipo_bloco as string);
  const emotions = blocks
    .map((b: any) => b.emocao)
    .filter(Boolean);
  const emotionalArc = emotions.length > 0 ? emotions.join(" → ") : null;

  // Dominant structure from sequence
  const typeCounts: Record<string, number> = {};
  sequenceOrder.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
  const dominantStructure = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Build block density map from block_semantic_patterns
  const densityMap = new Map<string, number>();
  blockSemantics.forEach((bs: any) => {
    if (bs.block_id && bs.weighted_word_score != null) {
      densityMap.set(bs.block_id, Number(bs.weighted_word_score));
    }
  });

  // Build alignment map
  const alignMap = new Map<string, number>();
  alignments.forEach((a: any) => {
    if (a.block_id && a.alignment_score != null) {
      alignMap.set(a.block_id, Number(a.alignment_score));
    }
  });

  // Avg alignment
  const alignScores = alignments
    .map((a: any) => Number(a.alignment_score))
    .filter((n: number) => !isNaN(n));
  const avgAlignment = alignScores.length > 0
    ? Number((alignScores.reduce((s: number, v: number) => s + v, 0) / alignScores.length).toFixed(2))
    : null;

  const confScores = alignments
    .map((a: any) => Number(a.confidence_score))
    .filter((n: number) => !isNaN(n));
  const avgConfidence = confScores.length > 0
    ? Number((confScores.reduce((s: number, v: number) => s + v, 0) / confScores.length).toFixed(2))
    : null;

  return {
    video_id: videoId,
    metadata: {
      title: video.titulo || null,
      duration: video.duracao != null ? Number(video.duracao) : null,
      views: (video as any).views != null ? Number((video as any).views) : null,
      likes: (video as any).likes != null ? Number((video as any).likes) : null,
      comments: (video as any).comments != null ? Number((video as any).comments) : null,
      engagement_rate: engRate,
      engagement_rate_relative: (video as any).engagement_rate_relative != null ? Number((video as any).engagement_rate_relative) : null,
      engagement_percentile: (video as any).engagement_percentile != null ? Number((video as any).engagement_percentile) : null,
      engagement_percentile_display: (video as any).engagement_percentile_display != null ? Number((video as any).engagement_percentile_display) : null,
    },
    narrative: {
      sequence_order: sequenceOrder,
      dominant_structure: dominantStructure,
      emotional_arc: emotionalArc,
    },
    blocks: blocks.map((b: any) => ({
      block_id: b.id,
      start_time: Number(b.tempo_inicio),
      end_time: Number(b.tempo_fim),
      duration: Number((Number(b.tempo_fim) - Number(b.tempo_inicio)).toFixed(2)),
      block_type: b.tipo_bloco,
      text: b.texto || null,
      verbal_density: densityMap.get(b.id) ?? (b.block_density_score != null ? Number(b.block_density_score) : null),
      alignment_score: alignMap.get(b.id) ?? null,
    })),
    micro_events: microEvents.map((e: any) => ({
      event_id: e.id,
      timestamp: Number(e.timestamp_seconds),
      event_type: e.event_type,
    })),
    alignment: {
      avg_alignment_score: avgAlignment,
      visual_confidence: avgConfidence,
    },
    performance: {
      views: (video as any).views != null ? Number((video as any).views) : null,
      likes: (video as any).likes != null ? Number((video as any).likes) : null,
      comments: (video as any).comments != null ? Number((video as any).comments) : null,
      engagement_rate: engRate,
      engagement_rate_relative: (video as any).engagement_rate_relative != null ? Number((video as any).engagement_rate_relative) : null,
    },
    semantic_patterns: {
      dominant_words: Array.isArray(semantic?.trigger_words) ? semantic.trigger_words : Array.isArray(semantic?.repeated_words) ? semantic.repeated_words : [],
      dominant_phrases: Array.isArray(semantic?.strong_phrases) ? semantic.strong_phrases : [],
    },
    _meta: {
      generated_at: new Date().toISOString(),
      source: "buildCompleteVideoObject",
      version: "1.0.0",
    },
  };
}

/**
 * Export the complete video object as a downloadable JSON file.
 */
export async function exportCompleteVideoObject(videoId: string, videoTitle?: string): Promise<void> {
  const obj = await buildCompleteVideoObject(videoId);
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const safeName = (videoTitle || videoId).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 60);
  const filename = `video_${safeName}_complete.json`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
