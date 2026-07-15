import { Layers } from 'lucide-react';
import type { Video, VideoBlock } from '@/types/video';
import { TIPO_BLOCOS, EMOCOES_EXTENDED, getEmotionIntensity, calculateBlockImpactScore } from '@/types/video';

interface Props {
  video: Video;
  blocks: VideoBlock[];
}

export function BlockAnalysis({ video, blocks }: Props) {
  if (!blocks.length || !video.duracao) return null;

  const totalDuration = video.duracao;

  const payoffTime = video.tempo_payoff;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
        <Layers className="w-4 h-4 text-primary" />
        Análise por Bloco (Emoção + Impacto)
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 pr-2">#</th>
              <th className="text-left py-2 pr-2">Tipo</th>
              <th className="text-left py-2 pr-2">Duração</th>
              <th className="text-left py-2 pr-2">% Vídeo</th>
              <th className="text-left py-2 pr-2">Emoção</th>
              <th className="text-left py-2 pr-2">Intensidade</th>
              <th className="text-left py-2">Impact</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block, i) => {
              const dur = block.tempo_fim - block.tempo_inicio;
              const pct = ((dur / totalDuration) * 100).toFixed(1);
              const tipo = TIPO_BLOCOS.find(t => t.value === block.tipo_bloco);
              const emoInfo = EMOCOES_EXTENDED.find(e => e.value === block.emocao);
              const intensity = getEmotionIntensity(block.emocao);
              const impact = calculateBlockImpactScore(block, totalDuration, blocks.length, payoffTime);
              const impactColor = impact >= 75 ? 'text-red-400' : impact >= 50 ? 'text-amber-400' : impact >= 25 ? 'text-blue-400' : 'text-muted-foreground';
              return (
                <tr key={block.id} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{ backgroundColor: `${tipo?.color}20`, color: tipo?.color }}>
                      {tipo?.label}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-foreground">{dur.toFixed(3)}s</td>
                  <td className="py-1.5 pr-2 text-foreground">{pct}%</td>
                  <td className="py-1.5 pr-2 text-foreground">
                    {emoInfo ? `${emoInfo.icon} ${emoInfo.label}` : '—'}
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-1">
                      <div className="w-12 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${intensity}%` }} />
                      </div>
                      <span className="text-foreground">{intensity}%</span>
                    </div>
                  </td>
                  <td className={`py-1.5 font-bold ${impactColor}`}>
                    {impact}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
