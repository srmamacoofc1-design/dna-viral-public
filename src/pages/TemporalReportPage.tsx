import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Timer, Play, BarChart3, Zap, Activity, RefreshCw, CheckCircle, AlertCircle, Clock, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface TemporalRow {
  id: string;
  video_id: string;
  block_id: string;
  cut_count: number;
  cut_density: number;
  avg_cut_interval: number;
  rhythm_level: string;
  tempo_pattern: string;
  confidence_score: number;
  processing_status: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))'];

export default function TemporalReportPage() {
  const [data, setData] = useState<TemporalRow[]>([]);
  const [videos, setVideos] = useState<{ id: string; titulo: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [tRes, vRes] = await Promise.all([
      supabase.from('video_temporal_profile').select('*'),
      supabase.from('videos').select('id, titulo').eq('status', 'completed'),
    ]);
    setData((tRes.data as TemporalRow[]) || []);
    setVideos(vRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleProcess = async (mode: 'incremental' | 'force_all' = 'incremental') => {
    setProcessing(true);
    try {
      let hasMore = true;
      let totalProcessed = 0;
      let totalBlocks = 0;

      while (hasMore) {
        const { data: res, error } = await supabase.functions.invoke('process-temporal-profile', {
          body: { mode, batch_size: 15 },
        });
        if (error) throw error;
        totalProcessed += res.videos_processed;
        totalBlocks += res.blocks_processed;
        hasMore = res.has_more && res.videos_processed > 0;

        if (hasMore) {
          toast.info(`Processando... ${res.coverage} vídeos cobertos`);
        }
      }

      toast.success(`Concluído: ${totalProcessed} vídeos, ${totalBlocks} blocos processados`);
      await fetchData();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <AppLayout><div className="max-w-4xl mx-auto px-4 py-20 text-center text-muted-foreground">Carregando...</div></AppLayout>;
  }

  const completed = data.filter(r => r.processing_status === 'completed');
  const failed = data.filter(r => r.processing_status === 'failed');
  const pending = data.filter(r => r.processing_status === 'pending' || r.processing_status === 'processing');

  const totalCuts = completed.reduce((s, r) => s + r.cut_count, 0);
  const uniqueVideos = new Set(completed.map(r => r.video_id)).size;
  const totalBlocks = completed.length;
  const avgDensity = totalBlocks > 0 ? (completed.reduce((s, r) => s + r.cut_density, 0) / totalBlocks) : 0;
  const avgCutsPerBlock = totalBlocks > 0 ? totalCuts / totalBlocks : 0;
  const coveragePct = videos.length > 0 ? Math.round((uniqueVideos / videos.length) * 100) : 0;

  // Rhythm distribution
  const rhythmCounts: Record<string, number> = { low: 0, medium: 0, high: 0, explosive: 0 };
  completed.forEach(r => { if (rhythmCounts[r.rhythm_level] !== undefined) rhythmCounts[r.rhythm_level]++; });
  const rhythmData = Object.entries(rhythmCounts).map(([name, value]) => ({ name, value }));

  // Tempo pattern distribution
  const tempoCounts: Record<string, number> = {};
  completed.forEach(r => { tempoCounts[r.tempo_pattern] = (tempoCounts[r.tempo_pattern] || 0) + 1; });
  const tempoData = Object.entries(tempoCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Top videos by density
  const videoAgg = new Map<string, { cuts: number; blocks: number; totalDensity: number }>();
  completed.forEach(r => {
    const agg = videoAgg.get(r.video_id) || { cuts: 0, blocks: 0, totalDensity: 0 };
    agg.cuts += r.cut_count;
    agg.blocks += 1;
    agg.totalDensity += r.cut_density;
    videoAgg.set(r.video_id, agg);
  });
  const topVideosByDensity = Array.from(videoAgg.entries())
    .map(([vid, agg]) => ({
      video_id: vid,
      titulo: videos.find(v => v.id === vid)?.titulo || vid.slice(0, 8),
      avgDensity: agg.totalDensity / agg.blocks,
      totalCuts: agg.cuts,
      blocks: agg.blocks,
    }))
    .sort((a, b) => b.avgDensity - a.avgDensity)
    .slice(0, 10);

  // Top blocks by intensity
  const topBlocks = [...completed].sort((a, b) => b.cut_density - a.cut_density).slice(0, 10);

  const rhythmLabel: Record<string, string> = { low: '🟢 Baixo', medium: '🟡 Médio', high: '🟠 Alto', explosive: '🔴 Explosivo' };
  const tempoLabel: Record<string, string> = {
    stable: '⏸ Estável',
    accelerating: '⏩ Acelerando',
    burst: '💥 Burst',
    pause_before_reveal: '⏳ Pausa→Revelação',
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 pb-20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Timer className="w-6 h-6 text-primary" />
            <h1 className="font-semibold text-2xl text-foreground">Relatório Temporal</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => exportPageAsPDF('Relatório Temporal')} size="sm" variant="outline">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">PDF</span>
            </Button>
            <Button onClick={() => handleProcess('incremental')} disabled={processing} size="sm" variant="outline">
              <RefreshCw className={`w-4 h-4 ${processing ? 'animate-spin' : ''}`} />
              {processing ? 'Processando...' : 'Processar Pendentes'}
            </Button>
          </div>
        </div>

        {/* Processing Status Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Cobertura</p>
              <p className="text-sm font-bold text-foreground">{uniqueVideos}/{videos.length} ({coveragePct}%)</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Blocos OK</p>
              <p className="text-sm font-bold text-foreground">{totalBlocks}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-500" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Pendentes</p>
              <p className="text-sm font-bold text-foreground">{pending.length}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Falhas</p>
              <p className="text-sm font-bold text-foreground">{failed.length}</p>
            </div>
          </div>
        </div>

        {completed.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Timer className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg mb-2">Nenhum dado temporal encontrado</p>
            <p className="text-sm mb-4">Clique em "Processar Pendentes" para gerar a análise temporal incrementalmente</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
              {[
                { label: 'Vídeos', value: uniqueVideos, icon: Play },
                { label: 'Blocos', value: totalBlocks, icon: Activity },
                { label: 'Total Cortes', value: totalCuts, icon: Zap },
                { label: 'Média Cortes/Bloco', value: avgCutsPerBlock.toFixed(1), icon: BarChart3 },
                { label: 'Densidade Média', value: avgDensity.toFixed(3), icon: Timer },
              ].map(s => (
                <div key={s.label} className="bg-card border border-border rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-muted-foreground">Distribuição de Ritmo</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={rhythmData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${rhythmLabel[name] || name}: ${value}`}>
                      {rhythmData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-muted-foreground">Distribuição de Padrão Temporal</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={tempoData}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [v, 'Blocos']} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top videos by density */}
            <div className="bg-card border border-border rounded-lg p-4 mb-6">
              <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-muted-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Top Vídeos por Densidade Temporal
              </h3>
              <div className="space-y-2">
                {topVideosByDensity.map((v, i) => (
                  <div key={v.video_id} className="flex items-center gap-3 text-sm">
                    <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                    <span className="flex-1 text-foreground truncate">{v.titulo}</span>
                    <span className="text-xs text-muted-foreground">{v.totalCuts} cortes</span>
                    <span className="text-xs text-muted-foreground">{v.blocks} blocos</span>
                    <span className="text-xs font-mono font-bold text-primary">{v.avgDensity.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top blocks by intensity */}
            <div className="bg-card border border-border rounded-lg p-4 mb-6">
              <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-muted-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Top Blocos por Intensidade
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-2">#</th>
                      <th className="text-left py-2 pr-2">Vídeo</th>
                      <th className="text-right py-2 pr-2">Cortes</th>
                      <th className="text-right py-2 pr-2">Densidade</th>
                      <th className="text-left py-2 pr-2">Ritmo</th>
                      <th className="text-left py-2">Padrão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topBlocks.map((b, i) => (
                      <tr key={b.id} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                        <td className="py-1.5 pr-2 text-foreground truncate max-w-[120px]">
                          {videos.find(v => v.id === b.video_id)?.titulo || b.video_id.slice(0, 8)}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">{b.cut_count}</td>
                        <td className="py-1.5 pr-2 text-right font-mono font-bold text-primary">{b.cut_density.toFixed(3)}</td>
                        <td className="py-1.5 pr-2">{rhythmLabel[b.rhythm_level] || b.rhythm_level}</td>
                        <td className="py-1.5">{tempoLabel[b.tempo_pattern] || b.tempo_pattern}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Confidence */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-xs uppercase tracking-wider mb-2 font-semibold text-muted-foreground">Confiança Média</h3>
              <p className="text-2xl font-bold text-foreground">
                {(completed.reduce((s, r) => s + r.confidence_score, 0) / completed.length * 100).toFixed(1)}%
              </p>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
