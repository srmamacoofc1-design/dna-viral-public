import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { FileDown, Zap, MessageSquare, Heart, BookOpen, RefreshCw, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { toast } from 'sonner';

const TYPE_COLORS: Record<string, string> = {
  explicit: '#3b82f6',
  implicit: '#8b5cf6',
  emotional: '#ef4444',
  narrative: '#f59e0b',
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  explicit: Zap,
  implicit: MessageSquare,
  emotional: Heart,
  narrative: BookOpen,
};

const TYPE_LABELS: Record<string, string> = {
  explicit: 'Explícito',
  implicit: 'Implícito',
  emotional: 'Emocional',
  narrative: 'Narrativo',
};

const INTENSITY_LABELS = ['', 'Fraco', 'Moderado', 'Forte', 'Muito Forte', 'Crítico'];

export default function CTADeepPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  

  const fetchData = async () => {
    setLoading(true);
    const [{ data: evts }, { data: vids }] = await Promise.all([
      supabase.from('video_cta_events').select('*').order('created_at', { ascending: false }),
      supabase.from('videos').select('id,titulo,duracao,idioma').eq('status', 'completed'),
    ]);
    setEvents(evts || []);
    setVideos(vids || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const processAll = async () => {
    if (!videos.length) return;
    setProcessing(true);
    setProcessProgress(0);
    let done = 0;
    const total = videos.length;

    for (const v of videos) {
      try {
        await supabase.functions.invoke('extract-cta-deep-v2', { body: { video_id: v.id } });
      } catch (e) {
        console.error(`CTA V2 error for ${v.id}:`, e);
      }
      done++;
      setProcessProgress(Math.round((done / total) * 100));
    }

    toast.success(`CTA Deep V2 processado para ${total} vídeos`);
    setProcessing(false);
    fetchData();
  };

  // Summary stats
  const totalCTAs = events.length;
  const videosWithCTA = new Set(events.map(e => e.video_id)).size;
  const byType = ['explicit', 'implicit', 'emotional', 'narrative'].map(t => ({
    type: t,
    label: TYPE_LABELS[t],
    count: events.filter(e => e.cta_type === t).length,
  }));
  const avgIntensity = totalCTAs > 0
    ? +(events.reduce((s, e) => s + (e.cta_intensity || 0), 0) / totalCTAs).toFixed(2)
    : 0;
  const avgPerVideo = videosWithCTA > 0 ? +(totalCTAs / videosWithCTA).toFixed(1) : 0;
  const avgConfidence = totalCTAs > 0
    ? Math.round(events.reduce((s, e) => s + (e.cta_confidence || 0), 0) / totalCTAs)
    : 0;

  const intensityDist = [1, 2, 3, 4, 5].map(i => ({
    level: INTENSITY_LABELS[i],
    count: events.filter(e => e.cta_intensity === i).length,
  }));

  const pieData = byType.filter(b => b.count > 0).map(b => ({
    name: b.label,
    value: b.count,
    color: TYPE_COLORS[b.type],
  }));

  // Top CTAs by intensity
  const topCTAs = [...events]
    .sort((a, b) => (b.cta_intensity || 0) - (a.cta_intensity || 0))
    .slice(0, 10);

  return (
    <AppLayout>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">CTA Deep V2</h1>
            <p className="text-sm text-muted-foreground">Detecção inteligente de CTAs: explícitos, implícitos, emocionais e narrativos</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportPageAsPDF('CTA Deep V2')}>
              <FileDown className="w-4 h-4 mr-1" /> Exportar PDF
            </Button>
            <Button size="sm" onClick={processAll} disabled={processing || !videos.length}>
              {processing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
              {processing ? 'Processando...' : 'Processar Todos'}
            </Button>
          </div>
        </div>

        {processing && (
          <div className="mb-4">
            <Progress value={processProgress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">{processProgress}% concluído</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : totalCTAs === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Zap className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg">Nenhum CTA detectado ainda.</p>
            <p className="text-sm">Clique em "Processar Todos" para analisar os vídeos.</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase">Total CTAs</p>
                  <p className="text-2xl font-bold">{totalCTAs}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase">Vídeos com CTA</p>
                  <p className="text-2xl font-bold">{videosWithCTA}/{videos.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase">Média por vídeo</p>
                  <p className="text-2xl font-bold">{avgPerVideo}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase">Intensidade média</p>
                  <p className="text-2xl font-bold">{avgIntensity}</p>
                </CardContent>
              </Card>
            </div>

            {/* Type Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Distribuição por Tipo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {byType.map(b => {
                      const Icon = TYPE_ICONS[b.type];
                      const pct = totalCTAs > 0 ? Math.round((b.count / totalCTAs) * 100) : 0;
                      return (
                        <div key={b.type} className="flex items-center gap-3">
                          <Icon className="w-4 h-4" style={{ color: TYPE_COLORS[b.type] }} />
                          <span className="text-sm w-20">{b.label}</span>
                          <div className="flex-1">
                            <div className="h-2 bg-secondary rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: TYPE_COLORS[b.type] }} />
                            </div>
                          </div>
                          <span className="text-sm font-medium w-16 text-right">{b.count} ({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Distribuição Visual</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center">
                  {pieData.length > 0 && (
                    <PieChart width={200} height={200}>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Intensity Chart */}
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Distribuição de Intensidade</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={intensityDist}>
                    <XAxis dataKey="level" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top CTAs */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top 10 CTAs por Intensidade</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {topCTAs.map((c, i) => {
                    const vid = videos.find(v => v.id === c.video_id);
                    return (
                      <div key={c.id || i} className="flex items-start gap-3 p-2 rounded border border-border bg-background">
                        <Badge variant="outline" style={{ borderColor: TYPE_COLORS[c.cta_type], color: TYPE_COLORS[c.cta_type] }}>
                          {TYPE_LABELS[c.cta_type] || c.cta_type}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{c.cta_text}</p>
                          <p className="text-xs text-muted-foreground truncate">{vid?.titulo || c.video_id}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge variant={c.cta_intensity >= 4 ? "destructive" : "secondary"}>
                            {INTENSITY_LABELS[c.cta_intensity] || c.cta_intensity}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">{c.cta_confidence}% conf.</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
