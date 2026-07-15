import { Activity } from 'lucide-react';
import type { Video, VideoBlock, VideoTranscript } from '@/types/video';

interface Props {
  video: Video;
  blocks: VideoBlock[];
  transcripts: VideoTranscript[];
}

function classifyRhythm(avgBlockDuration: number, totalDuration: number, changesPerSecond: number): string {
  if (totalDuration <= 20 && changesPerSecond > 0.3) return 'viral curto';
  if (changesPerSecond > 0.2) return 'alto';
  if (changesPerSecond > 0.1) return 'médio';
  return 'baixo';
}

export function NarrativeRhythm({ video, blocks, transcripts }: Props) {
  if (!blocks.length || !video.duracao) return null;

  const totalDuration = video.duracao;
  const numBlocks = blocks.length;
  const durations = blocks.map(b => b.tempo_fim - b.tempo_inicio);
  const avgBlockDur = durations.reduce((a, b) => a + b, 0) / durations.length;
  const minBlock = Math.min(...durations);
  const maxBlock = Math.max(...durations);
  const changesPerSecond = numBlocks / totalDuration;
  const narrativeDensity = (numBlocks / totalDuration).toFixed(3);

  // Words analysis
  const allText = transcripts.map(t => t.texto).join(' ');
  const wordCount = allText.split(/\s+/).filter(Boolean).length;
  const wordsPerSecond = totalDuration > 0 ? (wordCount / totalDuration).toFixed(2) : '—';
  
  // Sentences (approximate by periods/exclamations/questions)
  const sentenceCount = allText.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const sentencesPerSecond = totalDuration > 0 ? (sentenceCount / totalDuration).toFixed(3) : '—';

  const firstStimulus = video.tempo_primeiro_evento || video.tempo_gancho || blocks[0]?.tempo_inicio;
  const firstPayoff = video.tempo_payoff;

  const rhythmType = classifyRhythm(avgBlockDur, totalDuration, changesPerSecond);
  const rhythmColor = {
    'viral curto': 'text-red-400',
    'alto': 'text-orange-400',
    'médio': 'text-amber-400',
    'baixo': 'text-blue-400',
  }[rhythmType];

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
        <Activity className="w-4 h-4 text-primary" />
        Ritmo Narrativo
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Duração total</span>
          <p className="font-bold text-foreground text-sm">{totalDuration}s</p>
        </div>
        <div>
          <span className="text-muted-foreground">Total de blocos</span>
          <p className="font-bold text-foreground text-sm">{numBlocks}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Tempo médio/bloco</span>
          <p className="font-bold text-foreground text-sm">{avgBlockDur.toFixed(3)}s</p>
        </div>
        <div>
          <span className="text-muted-foreground">Menor bloco</span>
          <p className="font-bold text-foreground text-sm">{minBlock.toFixed(3)}s</p>
        </div>
        <div>
          <span className="text-muted-foreground">Maior bloco</span>
          <p className="font-bold text-foreground text-sm">{maxBlock.toFixed(3)}s</p>
        </div>
        <div>
          <span className="text-muted-foreground">1º estímulo</span>
          <p className="font-bold text-foreground text-sm">{firstStimulus !== undefined ? `${firstStimulus}s` : '—'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">1º payoff</span>
          <p className="font-bold text-foreground text-sm">{firstPayoff !== undefined ? `${firstPayoff}s` : '—'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Mudanças narrativas</span>
          <p className="font-bold text-foreground text-sm">{numBlocks - 1}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Mudanças/segundo</span>
          <p className="font-bold text-foreground text-sm">{changesPerSecond.toFixed(3)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Densidade narrativa</span>
          <p className="font-bold text-foreground text-sm">{narrativeDensity} blocos/s</p>
        </div>
        <div>
          <span className="text-muted-foreground">Palavras/segundo</span>
          <p className="font-bold text-foreground text-sm">{wordsPerSecond}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Frases/segundo</span>
          <p className="font-bold text-foreground text-sm">{sentencesPerSecond}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Classificação de ritmo:</span>
        <span className={`text-sm font-bold uppercase ${rhythmColor}`}>{rhythmType}</span>
      </div>

      {/* Advanced rhythm: initial / middle / final */}
      {(() => {
        const q1 = totalDuration * 0.25;
        const q3 = totalDuration * 0.75;
        const initial = blocks.filter(b => b.tempo_fim <= q1);
        const middle = blocks.filter(b => b.tempo_inicio >= q1 && b.tempo_fim <= q3);
        const final_ = blocks.filter(b => b.tempo_inicio >= q3);
        const calcRate = (arr: typeof blocks) => {
          const span = arr.length > 0
            ? Math.max(...arr.map(b => b.tempo_fim)) - Math.min(...arr.map(b => b.tempo_inicio))
            : 0;
          return span > 0 ? (arr.length / span).toFixed(3) : '—';
        };
        const rateI = calcRate(initial);
        const rateM = calcRate(middle);
        const rateF = calcRate(final_);
        const trend = rateI !== '—' && rateF !== '—'
          ? Number(rateF) > Number(rateI) ? '⬆ Acelera' : Number(rateF) < Number(rateI) ? '⬇ Desacelera' : '➡ Constante'
          : '—';
        return (
          <div className="mt-3 pt-3 border-t border-border">
            <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Ritmo por Fase</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Inicial (0–25%)</span>
                <p className="font-bold text-foreground">{rateI} blocos/s</p>
              </div>
              <div>
                <span className="text-muted-foreground">Intermediário (25–75%)</span>
                <p className="font-bold text-foreground">{rateM} blocos/s</p>
              </div>
              <div>
                <span className="text-muted-foreground">Final (75–100%)</span>
                <p className="font-bold text-foreground">{rateF} blocos/s</p>
              </div>
              <div>
                <span className="text-muted-foreground">Tendência</span>
                <p className="font-bold text-foreground">{trend}</p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
