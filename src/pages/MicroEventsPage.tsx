import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Zap, BarChart3, Activity, RefreshCw, Download, Target, Eye, AlertTriangle, Pause, Layers, Lock, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface MicroEvent {
  id: string;
  video_id: string;
  block_id: string;
  timestamp_seconds: number;
  event_type: string;
  event_strength: number;
  visual_change_score: number;
  temporal_intensity: number;
  alignment_score: number;
  confidence_score: number;
  processing_status: string;
}

const EVENT_TYPE_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  visual_reveal: { label: 'Visual Reveal', icon: Eye, color: 'hsl(var(--chart-1))' },
  shock_visual: { label: 'Shock Visual', icon: AlertTriangle, color: 'hsl(var(--chart-2))' },
  reaction_moment: { label: 'Reaction Moment', icon: Sparkles, color: 'hsl(var(--chart-3))' },
  sudden_transition: { label: 'Sudden Transition', icon: Zap, color: 'hsl(var(--chart-4))' },
  attention_lock: { label: 'Attention Lock', icon: Lock, color: 'hsl(var(--chart-5))' },
  micro_pause: { label: 'Micro Pause', icon: Pause, color: 'hsl(var(--primary))' },
  burst_sequence: { label: 'Burst Sequence', icon: Layers, color: 'hsl(var(--chart-2))' },
};

const COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--primary))', 'hsl(var(--chart-2))',
];

export default function MicroEventsPage() {
  const [data, setData] = useState<MicroEvent[]>([]);
  const [videos, setVideos] = useState<{ id: string; titulo: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [eRes, vRes] = await Promise.all([
      supabase.from('video_micro_events').select('*'),
      supabase.from('videos').select('id, titulo').eq('status', 'completed'),
    ]);
    setData((eRes.data as MicroEvent[]) || []);
    setVideos(vRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleProcess = async () => {
    setProcessing(true);
    try {
      let hasMore = true;
      let totalProcessed = 0;
      let totalEvents = 0;

      while (hasMore) {
        const { data: result, error } = await supabase.functions.invoke('detect-micro-events', {
          body: { mode: 'incremental', batch_size: 10 },
        });
        if (error) throw error;
        totalProcessed += result.processed_videos || 0;
        totalEvents += result.total_events || 0;
        hasMore = result.has_more === true;
        if (hasMore) toast.info(`Processados ${totalProcessed} vídeos, ${totalEvents} eventos...`);
      }

      toast.success(`Concluído: ${totalProcessed} vídeos, ${totalEvents} micro-eventos`);
      await fetchData();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const completed = data.filter(d => d.processing_status === 'completed');
  const noSignal = data.filter(d => d.processing_status === 'completed_no_signal');
  const failed = data.filter(d => d.processing_status === 'failed');
  const coveredVideoIds = new Set([...completed, ...noSignal].map(d => d.video_id));
  const videosWithEvents = new Set(completed.map(d => d.video_id));
  const videosNoSignalOnly = [...coveredVideoIds].filter(v => !videosWithEvents.has(v));
  const coveredBlockIds = new Set(completed.map(d => d.block_id));
  const noSignalBlockIds = new Set(noSignal.map(d => d.block_id));
  const totalVideos = videos.length;
  const coveragePct = totalVideos ? Math.round((coveredVideoIds.size / totalVideos) * 100) : 0;

  // Distribution by type
  const typeDist = Object.entries(
    completed.reduce((acc, e) => {
      acc[e.event_type] = (acc[e.event_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: EVENT_TYPE_LABELS[name]?.label || name, value, key: name }))
   .sort((a, b) => b.value - a.value);

  // Strength distribution
  const strengthDist = [
    { range: '0–0.3 (baixo)', count: completed.filter(e => e.event_strength < 0.3).length },
    { range: '0.3–0.6 (médio)', count: completed.filter(e => e.event_strength >= 0.3 && e.event_strength < 0.6).length },
    { range: '0.6–1.0 (alto)', count: completed.filter(e => e.event_strength >= 0.6).length },
  ];

  // Top events by event_strength
  const topEvents = [...completed]
    .sort((a, b) => b.event_strength - a.event_strength)
    .slice(0, 10);

  // Top blocks by event count
  const blockCounts = completed.reduce((acc, e) => {
    acc[e.block_id] = (acc[e.block_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topBlocks = Object.entries(blockCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Videos with most events
  const videoCounts = completed.reduce((acc, e) => {
    acc[e.video_id] = (acc[e.video_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topVideos = Object.entries(videoCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([vid, count]) => ({
      name: videos.find(v => v.id === vid)?.titulo?.slice(0, 30) || vid.slice(0, 8),
      events: count,
    }));

  const getVideoTitle = (id: string) => videos.find(v => v.id === id)?.titulo?.slice(0, 25) || id.slice(0, 8);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Micro-Picos Virais</h1>
              <p className="text-sm text-muted-foreground">Detecção de micro-momentos de impacto por bloco</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exportPageAsPDF('Micro-Picos Virais')} size="sm" variant="outline">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">PDF</span>
            </Button>
            <Button onClick={handleProcess} disabled={processing} size="sm">
              <RefreshCw className={`w-4 h-4 ${processing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{processing ? 'Processando...' : 'Processar Pendentes'}</span>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Carregando...</div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-2xl font-bold text-foreground">{completed.length}</div>
                <div className="text-xs text-muted-foreground">Total Micro-Eventos</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-2xl font-bold text-foreground">{coveredVideoIds.size}/{totalVideos}</div>
                <div className="text-xs text-muted-foreground">Cobertura ({coveragePct}%)</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-2xl font-bold text-foreground">{videosWithEvents.size}</div>
                <div className="text-xs text-muted-foreground">Vídeos com eventos</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-2xl font-bold text-foreground">{videosNoSignalOnly.length}</div>
                <div className="text-xs text-muted-foreground">Sem sinal suficiente</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-2xl font-bold text-foreground">
                  {completed.length ? (completed.reduce((s, e) => s + e.event_strength, 0) / completed.length).toFixed(2) : '0'}
                </div>
                <div className="text-xs text-muted-foreground">Força média</div>
              </div>
            </div>

            {/* Coverage detail */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Cobertura Detalhada</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Blocos com eventos: </span>
                  <span className="font-semibold text-foreground">{coveredBlockIds.size}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Blocos sem sinal: </span>
                  <span className="font-semibold text-foreground">{noSignalBlockIds.size}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Falhas: </span>
                  <span className="font-semibold text-foreground">{failed.length}</span>
                </div>
              </div>
              {videosNoSignalOnly.length > 0 && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Vídeos sem sinal suficiente:</p>
                  {videosNoSignalOnly.map(vid => (
                    <p key={vid} className="text-xs text-foreground">
                      • {videos.find(v => v.id === vid)?.titulo || vid.slice(0, 12)}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Charts row */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Type distribution */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Distribuição por Tipo</h3>
                {typeDist.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={typeDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                        {typeDist.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">Sem dados</div>
                )}
              </div>

              {/* Strength distribution */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Distribuição de Força</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={strengthDist}>
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top videos */}
            {topVideos.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Top Vídeos por Quantidade de Eventos</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={topVideos} layout="vertical">
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="events" fill="hsl(var(--chart-3))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top events by intensity */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Top 10 Eventos — Maior Intensidade Registrada</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-2">Vídeo</th>
                      <th className="text-left py-2 px-2">Tipo</th>
                      <th className="text-right py-2 px-2">Tempo</th>
                      <th className="text-right py-2 px-2">Força</th>
                      <th className="text-right py-2 px-2">Visual</th>
                      <th className="text-right py-2 px-2">Temporal</th>
                      <th className="text-right py-2 px-2">Alinhamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topEvents.map((e) => (
                      <tr key={e.id} className="border-b border-border/50">
                        <td className="py-2 px-2 text-foreground">{getVideoTitle(e.video_id)}</td>
                        <td className="py-2 px-2">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
                            {EVENT_TYPE_LABELS[e.event_type]?.label || e.event_type}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-muted-foreground">{Number(e.timestamp_seconds).toFixed(1)}s</td>
                        <td className="py-2 px-2 text-right font-semibold text-foreground">{e.event_strength.toFixed(3)}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">{e.visual_change_score.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">{e.temporal_intensity.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">{e.alignment_score.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top blocks */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Top 10 Blocos com Mais Eventos</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-2">Vídeo</th>
                      <th className="text-left py-2 px-2">Block ID</th>
                      <th className="text-right py-2 px-2">Eventos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topBlocks.map(([blockId, count]) => {
                      const evt = completed.find(e => e.block_id === blockId);
                      return (
                        <tr key={blockId} className="border-b border-border/50">
                          <td className="py-2 px-2 text-foreground">{evt ? getVideoTitle(evt.video_id) : '—'}</td>
                          <td className="py-2 px-2 text-muted-foreground font-mono text-xs">{blockId.slice(0, 12)}...</td>
                          <td className="py-2 px-2 text-right font-semibold text-foreground">{count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
