import { useEffect, useState } from 'react';
import { Dna, TrendingUp, Clock, BarChart3, Layers, RefreshCw, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface DNASnapshot {
  id: string;
  version_name: string;
  dataset_type: string;
  total_videos_used: number;
  total_blocks_used: number;
  avg_hook_time: number | null;
  avg_reveal_time: number | null;
  avg_payoff_time: number | null;
  avg_turn_count: number | null;
  avg_density: number | null;
  dominant_structure_sequence: string | null;
  dominant_hook_type: string | null;
  dominant_emotion_sequence: string | null;
  dominant_cta_type: string | null;
  segment_breakdown: Record<string, { count: number; avg_score: number; dominant_sequence: string }>;
  formula_registry_snapshot: Record<string, any>;
  generated_at: string;
}

export function DNABaseV1() {
  const [snapshot, setSnapshot] = useState<DNASnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  async function loadLatest() {
    setLoading(true);
    const { data } = await supabase
      .from('dna_base_versions')
      .select('*')
      .eq('version_name', 'DNA_BASE_V1')
      .order('generated_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const d = data[0] as any;
      setSnapshot({
        ...d,
        segment_breakdown: typeof d.segment_breakdown === 'object' ? d.segment_breakdown : {},
        formula_registry_snapshot: typeof d.formula_registry_snapshot === 'object' ? d.formula_registry_snapshot : {},
      });
    }
    setLoading(false);
  }

  useEffect(() => { loadLatest(); }, []);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await supabase.functions.invoke('generate-dna-base', {
        body: { dataset_type: 'completed_videos' },
      });
      if (resp.error) throw resp.error;
      const result = resp.data;
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(`DNA Base V1 gerado: ${result.total_videos} vídeos, ${result.total_blocks} blocos`);
        await loadLatest();
      }
    } catch (err: any) {
      toast.error('Erro ao regerar: ' + (err.message || 'Desconhecido'));
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) return <div className="text-xs text-muted-foreground py-4 text-center">Carregando DNA Base...</div>;

  if (!snapshot) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
          <Dna className="w-4 h-4 text-primary" />
          DNA Estrutural Base V1
        </h3>
        <p className="text-xs text-muted-foreground text-center py-4">
          Nenhum snapshot gerado ainda.
        </p>
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
            <RefreshCw className={`w-3 h-3 mr-1 ${regenerating ? 'animate-spin' : ''}`} />
            {regenerating ? 'Gerando...' : 'Gerar DNA Base V1'}
          </Button>
        </div>
      </div>
    );
  }

  const generatedDate = new Date(snapshot.generated_at).toLocaleString('pt-BR');
  const segments = Object.entries(snapshot.segment_breakdown || {}).sort((a, b) => (b[1] as any).count - (a[1] as any).count);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-4 flex items-center gap-2 font-semibold text-muted-foreground">
        <Dna className="w-4 h-4 text-primary" />
        DNA Estrutural Base V1
        <span className="text-[10px] ml-auto text-muted-foreground">Snapshot Persistido</span>
      </h3>

      {/* Meta info */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground mb-4 bg-muted/20 rounded p-2">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {generatedDate}
        </span>
        <span>📊 {snapshot.total_videos_used} vídeos</span>
        <span>🧱 {snapshot.total_blocks_used} blocos</span>
        <span>📂 Coorte: <span className="text-foreground font-medium">{snapshot.dataset_type}</span></span>
      </div>

      {/* Core metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <MetricCard icon={<Clock className="w-3 h-3" />} label="Hook Médio" value={snapshot.avg_hook_time != null ? `${snapshot.avg_hook_time}s` : '—'} />
        <MetricCard icon={<TrendingUp className="w-3 h-3" />} label="Revelação Média" value={snapshot.avg_reveal_time != null ? `${snapshot.avg_reveal_time}s` : '—'} />
        <MetricCard icon={<BarChart3 className="w-3 h-3" />} label="Payoff Médio" value={snapshot.avg_payoff_time != null ? `${snapshot.avg_payoff_time}s` : '—'} />
        <MetricCard icon={<Layers className="w-3 h-3" />} label="Turns Médios" value={snapshot.avg_turn_count != null ? String(snapshot.avg_turn_count) : '—'} />
        <MetricCard icon={<BarChart3 className="w-3 h-3" />} label="Densidade" value={snapshot.avg_density != null ? `${snapshot.avg_density} b/s` : '—'} />
      </div>

      {/* Dominant patterns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        <div className="bg-muted/20 border border-border/30 rounded p-3">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Sequência Dominante</div>
          <div className="text-xs font-mono text-primary font-semibold">{snapshot.dominant_structure_sequence || '—'}</div>
        </div>
        <div className="bg-muted/20 border border-border/30 rounded p-3 space-y-1">
          <div className="text-[10px] text-muted-foreground">
            🎣 Hook: <span className="text-foreground font-medium">{snapshot.dominant_hook_type || '—'}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            💚 Emoção: <span className="text-foreground font-medium">{snapshot.dominant_emotion_sequence || '—'}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            📣 CTA: <span className="text-foreground font-medium">{snapshot.dominant_cta_type || '—'}</span>
          </div>
        </div>
      </div>

      {/* Segment breakdown */}
      {segments.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Estrutura por Segmento</div>
          <div className="space-y-1">
            {segments.map(([seg, data]: [string, any]) => (
              <div key={seg} className="flex items-center gap-2 text-[10px] border border-border/20 rounded px-2 py-1.5">
                <span className="text-foreground font-medium capitalize w-24 truncate">{seg}</span>
                <span className="text-muted-foreground">{data.count} vídeos</span>
                <span className="text-primary">Score: {data.avg_score}</span>
                <span className="text-muted-foreground font-mono ml-auto truncate max-w-[200px]" title={data.dominant_sequence}>
                  {(data.dominant_sequence || '').length > 40 ? data.dominant_sequence.substring(0, 40) + '…' : data.dominant_sequence}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Regenerate button */}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
          <RefreshCw className={`w-3 h-3 mr-1 ${regenerating ? 'animate-spin' : ''}`} />
          {regenerating ? 'Regenerando...' : 'Regerar DNA Base V1'}
        </Button>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">{icon}</div>
      <div className="text-sm font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
