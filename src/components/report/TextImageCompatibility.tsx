import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Layers, AlertTriangle, Check, ArrowUp, ArrowDown, Minus, Zap } from 'lucide-react';

interface CompatibilityRecord {
  id: string;
  block_id: string;
  block_type: string;
  text_intensity_score: number;
  visual_intensity_score_calc: number;
  intensity_gap: number;
  emotional_match_score: number;
  action_match_score: number;
  curiosity_match_score: number;
  reveal_match_score: number;
  compatibility_score: number;
  compatibility_label: string;
  compatibility_reason: string;
  recommended_visual_direction: string;
  confidence_score: number;
  text_requires_visual_boost: boolean;
  visual_underpowered: boolean;
  visual_overpowered: boolean;
}

const LABEL_CONFIG: Record<string, { color: string; icon: React.ElementType; bg: string }> = {
  compatible: { color: 'text-green-400', icon: Check, bg: 'bg-green-400/10 border-green-400/30' },
  underpowered: { color: 'text-amber-400', icon: ArrowDown, bg: 'bg-amber-400/10 border-amber-400/30' },
  overpowered: { color: 'text-blue-400', icon: ArrowUp, bg: 'bg-blue-400/10 border-blue-400/30' },
  neutral: { color: 'text-muted-foreground', icon: Minus, bg: 'bg-secondary border-border' },
  conflicting: { color: 'text-red-400', icon: AlertTriangle, bg: 'bg-red-400/10 border-red-400/30' },
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  hook: 'Hook', setup: 'Setup', desenvolvimento: 'Desenvolvimento',
  tensao: 'Tensão', revelacao: 'Revelação', payoff: 'Payoff',
  loop: 'Loop', transicao: 'Transição',
};

function ScoreBar({ label, score, max = 100 }: { label: string; score: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  const color = pct >= 70 ? 'bg-green-400' : pct >= 45 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-foreground w-7 text-right">{score}</span>
    </div>
  );
}

export function TextImageCompatibility({ videoId }: { videoId: string }) {
  const [records, setRecords] = useState<CompatibilityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('text_image_compatibility')
        .select('*')
        .eq('video_id', videoId)
        .order('block_type');
      setRecords((data as any[]) || []);
      setLoading(false);
    };
    fetch();
  }, [videoId]);

  if (loading) return <div className="text-xs text-muted-foreground py-4">Carregando compatibilidade...</div>;
  if (records.length === 0) return null;

  const avgScore = Math.round(records.reduce((s, r) => s + r.compatibility_score, 0) / records.length);
  const avgConfidence = Math.round(records.reduce((s, r) => s + r.confidence_score, 0) / records.length);
  
  const labelDist = records.reduce((acc, r) => {
    acc[r.compatibility_label] = (acc[r.compatibility_label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Compatibilidade Texto ↔ Imagem</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          Score médio: <span className="font-bold text-foreground">{avgScore}</span> · 
          Confiança: <span className="font-bold text-foreground">{avgConfidence}%</span>
        </span>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(labelDist).map(([label, count]) => {
          const config = LABEL_CONFIG[label] || LABEL_CONFIG.neutral;
          const Icon = config.icon;
          return (
            <div key={label} className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs ${config.bg}`}>
              <Icon className={`w-3 h-3 ${config.color}`} />
              <span className={config.color}>{label}</span>
              <span className="font-bold text-foreground">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Per-block detail */}
      <div className="space-y-3">
        {records.map((r) => {
          const config = LABEL_CONFIG[r.compatibility_label] || LABEL_CONFIG.neutral;
          const Icon = config.icon;
          return (
            <div key={r.id} className={`border rounded-lg p-3 ${config.bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                <span className="text-xs font-semibold text-foreground">
                  {BLOCK_TYPE_LABELS[r.block_type] || r.block_type}
                </span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                  {r.compatibility_label}
                </span>
                <span className="ml-auto text-xs font-mono text-foreground">{r.compatibility_score}</span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                <ScoreBar label="Emoção" score={r.emotional_match_score} />
                <ScoreBar label="Ação" score={r.action_match_score} />
                <ScoreBar label="Curiosidade" score={r.curiosity_match_score} />
                <ScoreBar label="Revelação" score={r.reveal_match_score} />
              </div>

              <div className="flex gap-4 text-[10px] text-muted-foreground mb-1.5">
                <span>Texto: <strong className="text-foreground">{r.text_intensity_score}</strong></span>
                <span>Visual: <strong className="text-foreground">{r.visual_intensity_score_calc}</strong></span>
                <span>Gap: <strong className={r.intensity_gap > 20 ? 'text-amber-400' : r.intensity_gap < -20 ? 'text-blue-400' : 'text-foreground'}>
                  {r.intensity_gap > 0 ? '+' : ''}{r.intensity_gap}
                </strong></span>
              </div>

              <p className="text-[10px] text-muted-foreground">{r.compatibility_reason}</p>
              {r.recommended_visual_direction && r.recommended_visual_direction !== 'keep current direction' && (
                <p className="text-[10px] text-primary mt-0.5 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" />
                  {r.recommended_visual_direction}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
