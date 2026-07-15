import { useEffect, useState } from 'react';
import { Camera, User, Zap, Film, Eye, Dog, Type, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { VideoBlock } from '@/types/video';

interface VisualRecord {
  id: string;
  block_id: string;
  block_type: string;
  representative_frame_path: string | null;
  representative_timestamp: number | null;
  scene_description: string | null;
  main_action: string | null;
  main_objects: string[];
  human_presence: boolean | null;
  animal_presence: boolean | null;
  text_on_screen_presence: boolean | null;
  visual_intensity_level: string | null;
  scene_change_detected: boolean | null;
  scene_change_count: number;
  avg_visual_intensity_score: number | null;
  confidence_score: number;
  data_source_type: string;
}

interface Props {
  videoId: string;
  blocks: VideoBlock[];
  duracao?: number;
}

const BLOCK_ICONS: Record<string, string> = {
  hook: '🎣', setup: '📐', desenvolvimento: '🔄', tensao: '⚡',
  revelacao: '💡', payoff: '🎯', transicao: '🔀', loop: '🔁',
};

const INTENSITY_COLORS: Record<string, string> = {
  alta: 'text-destructive',
  media: 'text-primary',
  baixa: 'text-muted-foreground',
};

export function VisualBlockAnalysis({ videoId, blocks, duracao }: Props) {
  const [records, setRecords] = useState<VisualRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPersisted, setHasPersisted] = useState(false);

  useEffect(() => {
    async function load() {
      // Try persisted data first
      const { data } = await supabase
        .from('visual_block_analysis')
        .select('*')
        .eq('video_id', videoId)
        .order('block_type');

      if (data && data.length > 0) {
        setRecords(data.map((d: any) => ({
          ...d,
          main_objects: Array.isArray(d.main_objects) ? d.main_objects : [],
        })));
        setHasPersisted(true);
      }
      setLoading(false);
    }
    load();
  }, [videoId]);

  if (loading) return null;

  if (!hasPersisted) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
          <Camera className="w-4 h-4 text-primary" />
          Análise Visual por Bloco
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
          Dados visuais ainda não processados. Reprocesse o vídeo para gerar a análise visual formal.
        </div>
      </div>
    );
  }

  const totalSceneChanges = records.reduce((s, r) => s + r.scene_change_count, 0);
  const avgGlobalIntensity = records.length > 0
    ? Math.round(records.reduce((s, r) => s + (r.avg_visual_intensity_score || 0), 0) / records.length)
    : 0;
  const cutsPerSecond = duracao && duracao > 0 ? (totalSceneChanges / duracao).toFixed(2) : '—';
  const humanBlocks = records.filter(r => r.human_presence).length;
  const textBlocks = records.filter(r => r.text_on_screen_presence).length;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
        <Camera className="w-4 h-4 text-primary" />
        Análise Visual por Bloco
        <span className="text-[10px] ml-auto text-muted-foreground">Persistido • {records.length} blocos</span>
      </h3>

      {/* Global stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <StatCard label="Mudanças de Cena" value={totalSceneChanges} />
        <StatCard label="Cortes/seg" value={cutsPerSecond} />
        <StatCard label="Intensidade Média" value={avgGlobalIntensity} />
        <StatCard label="Blocos c/ Humano" value={humanBlocks} />
        <StatCard label="Blocos c/ Texto" value={textBlocks} />
      </div>

      {/* Per-block */}
      <div className="space-y-2">
        {records.map((rec) => {
          const block = blocks.find(b => b.id === rec.block_id);
          return (
            <div key={rec.id} className="border border-border/30 rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{BLOCK_ICONS[rec.block_type] || '📦'}</span>
                <span className="text-xs font-semibold text-foreground uppercase">{rec.block_type}</span>
                {rec.visual_intensity_level && (
                  <span className={`text-[10px] font-medium ${INTENSITY_COLORS[rec.visual_intensity_level] || ''}`}>
                    {rec.visual_intensity_level}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {block ? `${block.tempo_inicio.toFixed(1)}s — ${block.tempo_fim.toFixed(1)}s` : ''}
                  {' '}• conf: {rec.confidence_score}%
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
                <div className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Cortes:</span>
                  <span className="text-foreground font-medium">{rec.scene_change_count}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Eye className="w-3 h-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Intensidade:</span>
                  <span className="text-foreground font-medium">{rec.avg_visual_intensity_score ?? '—'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Humano:</span>
                  <span className={rec.human_presence ? 'text-emerald-400' : 'text-muted-foreground'}>
                    {rec.human_presence === true ? 'Sim' : rec.human_presence === false ? 'Não' : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Dog className="w-3 h-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Animal:</span>
                  <span className={rec.animal_presence ? 'text-emerald-400' : 'text-muted-foreground'}>
                    {rec.animal_presence === true ? 'Sim' : rec.animal_presence === false ? 'Não' : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Type className="w-3 h-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Texto:</span>
                  <span className={rec.text_on_screen_presence ? 'text-emerald-400' : 'text-muted-foreground'}>
                    {rec.text_on_screen_presence === true ? 'Sim' : rec.text_on_screen_presence === false ? 'Não' : '—'}
                  </span>
                </div>
              </div>

              {/* Action & Objects */}
              {rec.main_action && (
                <div className="text-[10px] text-primary/80 mt-2">
                  🎬 Ação: <span className="font-medium">{rec.main_action}</span>
                </div>
              )}
              {rec.main_objects.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  🏷️ {rec.main_objects.join(', ')}
                </div>
              )}

              {/* Scene description */}
              {rec.scene_description && (
                <p className="text-[10px] text-muted-foreground mt-2 italic border-l-2 border-primary/30 pl-2">
                  {rec.scene_description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted/30 rounded p-2 text-center">
      <div className="text-lg font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
