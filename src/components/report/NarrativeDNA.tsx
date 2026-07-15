import { Dna } from 'lucide-react';
import type { Video, VideoBlock } from '@/types/video';
import { TIPO_BLOCOS, EMOCOES } from '@/types/video';

interface Props {
  video: Video;
  blocks: VideoBlock[];
}

export function NarrativeDNA({ video, blocks }: Props) {
  if (!blocks.length || !video.duracao) return null;

  const sorted = [...blocks].sort((a, b) => a.tempo_inicio - b.tempo_inicio);
  const totalDur = video.duracao;

  const hookBlock = sorted.find(b => b.tipo_bloco === 'hook');
  const payoffBlock = [...sorted].reverse().find(b => b.tipo_bloco === 'payoff');
  const revelacaoBlock = sorted.find(b => b.tipo_bloco === 'revelacao');

  // Narrative turns = type changes between consecutive blocks
  let turns = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].tipo_bloco !== sorted[i - 1].tipo_bloco) turns++;
  }

  // Time between turns
  const turnTimes: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].tipo_bloco !== sorted[i - 1].tipo_bloco) {
      turnTimes.push(sorted[i].tempo_inicio - sorted[i - 1].tempo_inicio);
    }
  }
  const avgTurnTime = turnTimes.length > 0 ? turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length : 0;

  // Highest impact block (by emotion intensity)
  const intensityMap: Record<string, number> = {
    impacto: 9, medo: 8, tensao: 7, surpresa: 7,
    curiosidade: 6, expectativa: 5, alivio: 3,
  };
  let maxImpact = sorted[0];
  let maxScore = 0;
  sorted.forEach(b => {
    const score = intensityMap[b.emocao] || 0;
    if (score > maxScore) { maxScore = score; maxImpact = b; }
  });

  // Climax position (tensao or revelacao block closest to end)
  const climaxBlock = [...sorted].reverse().find(b => b.tipo_bloco === 'tensao' || b.tipo_bloco === 'revelacao');

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-primary">
        <Dna className="w-4 h-4" />
        DNA do Vídeo
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Posição do hook</span>
          <p className="font-bold text-foreground text-sm">
            {hookBlock ? `${hookBlock.tempo_inicio.toFixed(3)}s (${((hookBlock.tempo_inicio / totalDur) * 100).toFixed(1)}%)` : '—'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {hookBlock ? `Duração: ${(hookBlock.tempo_fim - hookBlock.tempo_inicio).toFixed(3)}s` : ''}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Posição do payoff</span>
          <p className="font-bold text-foreground text-sm">
            {payoffBlock ? `${payoffBlock.tempo_inicio.toFixed(3)}s (${((payoffBlock.tempo_inicio / totalDur) * 100).toFixed(1)}%)` : '—'}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Viradas narrativas</span>
          <p className="font-bold text-foreground text-sm">{turns}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Tempo médio entre viradas</span>
          <p className="font-bold text-foreground text-sm">{avgTurnTime > 0 ? `${avgTurnTime.toFixed(3)}s` : '—'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Duração até clímax</span>
          <p className="font-bold text-foreground text-sm">
            {climaxBlock ? `${climaxBlock.tempo_inicio.toFixed(3)}s (${((climaxBlock.tempo_inicio / totalDur) * 100).toFixed(1)}%)` : '—'}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Maior impacto narrativo</span>
          <p className="font-bold text-foreground text-sm">
            {maxImpact ? `${maxImpact.tempo_inicio.toFixed(3)}s — ${EMOCOES.find(e => e.value === maxImpact.emocao)?.label || maxImpact.emocao}` : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
