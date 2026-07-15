import { Timer } from 'lucide-react';
import type { VideoBlock } from '@/types/video';

interface Props {
  blocks: VideoBlock[];
}

export function StimulusIntervals({ blocks }: Props) {
  if (blocks.length < 2) return null;

  // Calculate intervals between block transitions
  const sorted = [...blocks].sort((a, b) => a.tempo_inicio - b.tempo_inicio);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i].tempo_inicio - sorted[i - 1].tempo_inicio);
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const minInterval = Math.min(...intervals);
  const maxInterval = Math.max(...intervals);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
        <Timer className="w-4 h-4 text-primary" />
        Intervalos entre Estímulos
      </h3>

      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
        <div>
          <span className="text-muted-foreground">Intervalo médio</span>
          <p className="font-bold text-foreground text-sm">{avgInterval.toFixed(3)}s</p>
        </div>
        <div>
          <span className="text-muted-foreground">Menor intervalo</span>
          <p className="font-bold text-foreground text-sm">{minInterval.toFixed(3)}s</p>
        </div>
        <div>
          <span className="text-muted-foreground">Maior intervalo</span>
          <p className="font-bold text-foreground text-sm">{maxInterval.toFixed(3)}s</p>
        </div>
      </div>

      <div className="flex items-end gap-0.5 h-12">
        {intervals.map((interval, i) => {
          const height = maxInterval > 0 ? (interval / maxInterval) * 100 : 50;
          return (
            <div
              key={i}
              className="flex-1 bg-primary/40 hover:bg-primary/70 rounded-t-sm transition-colors min-w-[3px]"
              style={{ height: `${Math.max(height, 5)}%` }}
              title={`${interval.toFixed(3)}s`}
            />
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">Sequência de intervalos entre mudanças narrativas</p>
    </div>
  );
}
