import { cn } from '@/lib/utils';

/**
 * Engagement Percentile Badge — Pure observational display
 * 
 * Shows the video's engagement percentile position within the dataset.
 * NO quality labels. NO interpretive classifications.
 * Color bands indicate percentile ranges, NOT quality.
 * 
 * Source: videos.engagement_percentile_display (percentil de engagement_rate no dataset)
 */

type PercentileBand = 'P90+' | 'P60-89' | 'P40-59' | 'P0-39';

interface Props {
  /** Engagement percentile (0-100), from engagement_percentile_display column */
  percentile: number | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showBand?: boolean;
}

export function getPercentileBand(percentile: number): PercentileBand {
  if (percentile >= 90) return 'P90+';
  if (percentile >= 60) return 'P60-89';
  if (percentile >= 40) return 'P40-59';
  return 'P0-39';
}

const bandConfig: Record<PercentileBand, { color: string; bg: string; border: string }> = {
  'P90+': { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  'P60-89': { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  'P40-59': { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  'P0-39': { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
};

export function EngagementBadge({ percentile, size = 'md', showBand = true }: Props) {
  if (percentile == null) {
    return (
      <div className="text-xs text-muted-foreground">—</div>
    );
  }

  const rounded = Math.round(percentile);
  const band = getPercentileBand(rounded);
  const config = bandConfig[band];

  return (
    <div className={cn(
      'flex items-center gap-1.5',
      size === 'sm' && 'text-xs',
      size === 'md' && 'text-sm',
      size === 'lg' && 'text-base',
    )}>
      <span className={cn('font-bold tabular-nums', config.color)}>P{rounded}</span>
      {showBand && (
        <span className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border',
          config.bg, config.border, config.color,
          size === 'lg' && 'text-xs px-2 py-1',
        )}>
          {band}
        </span>
      )}
    </div>
  );
}

/** Get engagement percentile from a video row */
export function getEngagementPercentile(video: Record<string, any>): number | null {
  if (video.engagement_percentile_display != null) return Number(video.engagement_percentile_display);
  if (video.engagement_rate_relative != null) return Math.round(Number(video.engagement_rate_relative) * 100);
  return null;
}
