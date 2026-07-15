/**
 * TRILHO B — Performance Observation (Sinais Externos)
 * 
 * Pure observational layer for engagement metrics.
 * NO quality labels. NO "better" or "worse".
 * Only: percentiles, z-scores, relative positions within dataset.
 * 
 * Sources (all from videos table):
 *   - views, likes, comments → raw metrics
 *   - engagement_rate = (likes + comments) / views → calculated
 *   - engagement_rate_relative = engagement_rate / max_engagement_rate → calculated
 *   - engagement_percentile → rank position in dataset
 *   - engagement_percentile_display → percentile * 100
 */

import { supabase } from "@/integrations/supabase/client";

export interface EngagementDistribution {
  count: number;
  min: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
  stddev: number;
}

export interface VideoEngagementProfile {
  video_id: string;
  titulo: string;
  views: number;
  likes: number;
  comments: number;
  engagement_rate: number | null;
  engagement_rate_relative: number | null;
  engagement_percentile: number | null;
  engagement_percentile_display: number | null;
  z_score: number | null;
}

export interface PerformanceObservation {
  distribution: EngagementDistribution | null;
  profiles: VideoEngagementProfile[];
  metadata: {
    total_videos: number;
    eligible_videos: number;
    insufficient_data: boolean;
    extraction_timestamp: string;
    method: "engagement_rate_observation";
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

export async function getPerformanceObservation(): Promise<PerformanceObservation> {
  const { data: videos, error } = await supabase
    .from("videos")
    .select("id, titulo, views, likes, comments, engagement_rate, engagement_rate_relative, engagement_percentile, engagement_percentile_display")
    .eq("status", "completed");

  if (error || !videos || videos.length === 0) {
    return {
      distribution: null,
      profiles: [],
      metadata: {
        total_videos: 0,
        eligible_videos: 0,
        insufficient_data: true,
        extraction_timestamp: new Date().toISOString(),
        method: "engagement_rate_observation",
      },
    };
  }

  // Build profiles
  const profiles: VideoEngagementProfile[] = videos.map(v => ({
    video_id: v.id,
    titulo: v.titulo || "",
    views: Number(v.views) || 0,
    likes: Number(v.likes) || 0,
    comments: Number(v.comments) || 0,
    engagement_rate: v.engagement_rate != null ? Number(v.engagement_rate) : null,
    engagement_rate_relative: v.engagement_rate_relative != null ? Number(v.engagement_rate_relative) : null,
    engagement_percentile: v.engagement_percentile != null ? Number(v.engagement_percentile) : null,
    engagement_percentile_display: v.engagement_percentile_display != null ? Number(v.engagement_percentile_display) : null,
    z_score: null, // calculated below
  }));

  // Get eligible (those with engagement_rate)
  const eligible = profiles.filter(p => p.engagement_rate != null && p.engagement_rate > 0);

  if (eligible.length < 2) {
    return {
      distribution: null,
      profiles,
      metadata: {
        total_videos: videos.length,
        eligible_videos: eligible.length,
        insufficient_data: true,
        extraction_timestamp: new Date().toISOString(),
        method: "engagement_rate_observation",
      },
    };
  }

  // Distribution
  const rates = eligible.map(p => p.engagement_rate!).sort((a, b) => a - b);
  const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
  const variance = rates.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / rates.length;
  const stddev = Math.sqrt(variance);

  const distribution: EngagementDistribution = {
    count: rates.length,
    min: rates[0],
    p10: percentile(rates, 10),
    p25: percentile(rates, 25),
    median: percentile(rates, 50),
    p75: percentile(rates, 75),
    p90: percentile(rates, 90),
    max: rates[rates.length - 1],
    mean: +mean.toFixed(6),
    stddev: +stddev.toFixed(6),
  };

  // Z-scores
  if (stddev > 0) {
    for (const p of profiles) {
      if (p.engagement_rate != null) {
        p.z_score = +((p.engagement_rate - mean) / stddev).toFixed(3);
      }
    }
  }

  return {
    distribution,
    profiles,
    metadata: {
      total_videos: videos.length,
      eligible_videos: eligible.length,
      insufficient_data: false,
      extraction_timestamp: new Date().toISOString(),
      method: "engagement_rate_observation",
    },
  };
}
