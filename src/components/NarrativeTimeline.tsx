import { useState } from 'react';
import type { Video, VideoBlock } from '@/types/video';
import { TIPO_BLOCOS, EMOCOES } from '@/types/video';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Zap, Eye, Target, RotateCcw } from 'lucide-react';

interface TimelineProps {
  video: Video;
  blocks: VideoBlock[];
  onBlockClick?: (block: VideoBlock) => void;
}

export function NarrativeTimeline({ video, blocks, onBlockClick }: TimelineProps) {
  const [activeBlock, setActiveBlock] = useState<string | null>(null);

  if (!blocks.length) return null;

  // Key moments
  const keyMoments = [
    video.tempo_gancho !== undefined && { label: 'HOOK', time: video.tempo_gancho, icon: Zap, color: '#F97316' },
    video.tempo_primeiro_evento !== undefined && { label: '1º EVENTO', time: video.tempo_primeiro_evento, icon: Eye, color: '#38BDF8' },
    video.tempo_primeira_revelacao !== undefined && { label: 'REVELAÇÃO', time: video.tempo_primeira_revelacao, icon: Target, color: '#22C55E' },
    video.tempo_payoff !== undefined && { label: 'PAYOFF', time: video.tempo_payoff, icon: Target, color: '#EAB308' },
    video.loop_detectado && video.duracao && { label: 'LOOP', time: video.duracao - 1, icon: RotateCcw, color: '#A855F7' },
  ].filter(Boolean) as { label: string; time: number; icon: React.ElementType; color: string }[];

  const handleClick = (block: VideoBlock) => {
    setActiveBlock(block.id);
    onBlockClick?.(block);
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-foreground">Timeline Narrativa</h3>

      {/* Key moments */}
      {keyMoments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {keyMoments.map(m => {
            const Icon = m.icon;
            return (
              <button
                key={m.label}
                onClick={() => {
                  const b = blocks.find(bl => bl.tempo_inicio <= m.time && bl.tempo_fim > m.time);
                  if (b) handleClick(b);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors text-xs"
              >
                <Icon className="w-3 h-3" style={{ color: m.color }} />
                <span className="font-medium" style={{ color: m.color }}>{m.label}</span>
                <span className="text-muted-foreground">— {m.time}s</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Color bar */}
      <div className="flex rounded-lg overflow-hidden h-10 border border-border">
        {blocks.map((block) => {
          const tipo = TIPO_BLOCOS.find(t => t.value === block.tipo_bloco);
          const isActive = activeBlock === block.id;
          return (
            <Tooltip key={block.id}>
              <TooltipTrigger asChild>
                <div
                  onClick={() => handleClick(block)}
                  className={`flex-1 cursor-pointer transition-all ${isActive ? 'ring-2 ring-white brightness-125 z-10' : 'hover:brightness-110'}`}
                  style={{ backgroundColor: tipo?.color || '#334155' }}
                />
              </TooltipTrigger>
              <TooltipContent className="bg-popover border-border">
                <p className="text-xs font-medium">{block.tempo_inicio}s–{block.tempo_fim}s — {tipo?.label || block.tipo_bloco}</p>
                <p className="text-xs text-muted-foreground">{block.funcao_narrativa}</p>
                {block.texto && <p className="text-xs text-muted-foreground mt-1 max-w-48 truncate">"{block.texto}"</p>}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {TIPO_BLOCOS.map(t => (
          <div key={t.value} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: t.color }} />
            {t.label}
          </div>
        ))}
      </div>

      {/* Emotion wave */}
      <div className="mt-6">
        <h4 className="text-xs text-muted-foreground mb-2 font-medium">Curva Emocional</h4>
        <div className="flex items-end gap-0.5 h-16">
          {blocks.map((block) => {
            const emoIdx = EMOCOES.findIndex(e => e.value === block.emocao);
            const height = ((emoIdx + 1) / EMOCOES.length) * 100;
            const isActive = activeBlock === block.id;
            return (
              <Tooltip key={block.id}>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => handleClick(block)}
                    className={`flex-1 rounded-t-sm cursor-pointer transition-colors min-w-[2px] ${isActive ? 'bg-primary' : 'bg-primary/40 hover:bg-primary/70'}`}
                    style={{ height: `${height}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent className="bg-popover border-border">
                  <p className="text-xs">
                    {EMOCOES.find(e => e.value === block.emocao)?.icon}{' '}
                    {EMOCOES.find(e => e.value === block.emocao)?.label}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
