import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ShieldCheck, RotateCcw, Activity, Zap, Brain, Target, BarChart3, Eye, Heart, AlertTriangle, FileDown, Layers, Type, BookOpen, Dna, TrendingUp, Crosshair } from 'lucide-react';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { toast } from 'sonner';

interface ValidationReport {
  id: string;
  validation_type: string;
  report_data: any;
  anomaly_detected: boolean;
  confidence_score: number;
  created_at: string;
}

const LAYER_META: Record<string, { label: string; icon: any; color: string }> = {
  blocks: { label: 'Blocos Narrativos', icon: Layers, color: 'text-blue-500' },
  transcripts: { label: 'Transcrições', icon: Type, color: 'text-teal-500' },
  verbal: { label: 'Análise Verbal', icon: Brain, color: 'text-purple-500' },
  semantics: { label: 'Semântica de Blocos', icon: BookOpen, color: 'text-indigo-500' },
  word_patterns: { label: 'Word/Phrase Patterns', icon: Zap, color: 'text-amber-500' },
  cta: { label: 'CTA Deep V2', icon: Target, color: 'text-red-500' },
  visual: { label: 'Análise Visual', icon: Eye, color: 'text-cyan-500' },
  alignment: { label: 'Alinhamento T-V', icon: Crosshair, color: 'text-indigo-500' },
  emotion: { label: 'Seq. Emocional Visual', icon: Heart, color: 'text-pink-500' },
  performance: { label: 'Performance Normalizada', icon: BarChart3, color: 'text-green-500' },
  engagement_observation: { label: 'Engagement Rate', icon: TrendingUp, color: 'text-orange-500' },
  lexicon: { label: 'Léxico Viral', icon: Zap, color: 'text-amber-500' },
  dna: { label: 'DNA Base V2', icon: Dna, color: 'text-rose-500' },
  correlations: { label: 'Correlações', icon: BarChart3, color: 'text-cyan-500' },
  outliers: { label: 'Detecção de Outliers', icon: AlertTriangle, color: 'text-orange-500' },
  text_image_compatibility: { label: 'Compatibilidade Texto-Imagem', icon: Crosshair, color: 'text-violet-500' },
};

function getStatusBadge(status: string) {
  if (status === 'ok') return { label: '✅ OK', cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
  if (status === 'attention') return { label: '⚠️ Atenção', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
  return { label: '❌ Crítico', cls: 'bg-red-500/20 text-red-400 border-red-500/30' };
}

function LayerCard({ report }: { report: ValidationReport }) {
  const meta = LAYER_META[report.validation_type] || { label: report.validation_type, icon: Activity, color: 'text-muted-foreground' };
  const Icon = meta.icon;
  const data = report.report_data || {};
  const status = data.status || 'critical';
  const badge = getStatusBadge(status);

  const borderColor = status === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5' :
    status === 'attention' ? 'border-amber-500/30 bg-amber-500/5' :
    'border-red-500/30 bg-red-500/5';

  const hasCoverage = data.coverage_pct !== undefined;

  return (
    <Card className={`border ${borderColor}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${meta.color}`} />
            <CardTitle className="text-sm">{meta.label}</CardTitle>
          </div>
          <Badge className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        {hasCoverage && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Cobertura</span>
              <span className={`font-bold ${data.coverage_pct >= 90 ? 'text-emerald-400' : data.coverage_pct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                {data.coverage_pct}%
              </span>
            </div>
            <Progress value={data.coverage_pct} className="h-1.5" />
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {data.total_records !== undefined && (
            <div className="text-muted-foreground">Registros: <strong className="text-foreground">{data.total_records}</strong></div>
          )}
          {data.total_ctas !== undefined && (
            <div className="text-muted-foreground">CTAs: <strong className="text-foreground">{data.total_ctas}</strong></div>
          )}
          {data.videos_covered !== undefined && (
            <div className="text-muted-foreground">Vídeos: <strong className="text-foreground">{data.videos_covered}/{data.total_videos}</strong></div>
          )}
          {data.videos_calculated !== undefined && (
            <div className="text-muted-foreground">Calculados: <strong className="text-foreground">{data.videos_calculated}/{data.total_videos}</strong></div>
          )}
          {data.missing_videos !== undefined && data.missing_videos > 0 && (
            <div className="text-red-400">Faltando: <strong>{data.missing_videos}</strong></div>
          )}
          {data.total_blocks !== undefined && (
            <div className="text-muted-foreground">Blocos: <strong className="text-foreground">{data.total_blocks}</strong></div>
          )}
          {data.linguistic_density_mean !== undefined && (
            <div className="text-muted-foreground">Densidade: <strong className="text-foreground">{data.linguistic_density_mean}</strong></div>
          )}
          {data.semantic_pressure_mean !== undefined && (
            <div className="text-muted-foreground">Pressão: <strong className="text-foreground">{data.semantic_pressure_mean}</strong></div>
          )}
          {data.emotional_intensity_mean !== undefined && (
            <div className="text-muted-foreground">Intensidade: <strong className="text-foreground">{data.emotional_intensity_mean}</strong></div>
          )}
          {data.average_intensity !== undefined && (
            <div className="text-muted-foreground">Intensidade média: <strong className="text-foreground">{data.average_intensity}</strong></div>
          )}
          {data.avg_alignment !== undefined && (
            <div className="text-muted-foreground">Alinhamento médio: <strong className="text-foreground">{data.avg_alignment}%</strong></div>
          )}
          {data.mean_score !== undefined && (
            <div className="text-muted-foreground">Score médio: <strong className="text-foreground">{data.mean_score}</strong></div>
          )}
          {data.total_words !== undefined && (
            <div className="text-muted-foreground">Palavras: <strong className="text-foreground">{data.total_words}</strong></div>
          )}
          {data.active_words !== undefined && (
            <div className="text-muted-foreground">Ativas: <strong className="text-foreground">{data.active_words}</strong></div>
          )}
          {data.noise_count !== undefined && (
            <div className="text-muted-foreground">Ruído: <strong className="text-foreground">{data.noise_count}</strong></div>
          )}
          {data.exists !== undefined && (
            <div className="text-muted-foreground">Existe: <strong className="text-foreground">{data.exists ? '✅' : '❌'}</strong></div>
          )}
          {data.videos_used !== undefined && (
            <div className="text-muted-foreground">Vídeos usados: <strong className="text-foreground">{data.videos_used}/{data.total_videos}</strong></div>
          )}
          {data.dominant_structure && (
            <div className="col-span-2 text-muted-foreground">Estrutura: <strong className="text-foreground">{data.dominant_structure}</strong></div>
          )}
          {data.total !== undefined && (
            <div className="text-muted-foreground">Total: <strong className="text-foreground">{data.total}</strong></div>
          )}
          {data.reliable !== undefined && (
            <div className="text-muted-foreground">Confiáveis: <strong className="text-emerald-400">{data.reliable}</strong></div>
          )}
          {data.unreliable !== undefined && data.unreliable > 0 && (
            <div className="text-muted-foreground">Não confiáveis: <strong className="text-amber-400">{data.unreliable}</strong></div>
          )}
        </div>

        {data.cta_distribution && Object.keys(data.cta_distribution).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(data.cta_distribution).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[10px]">{k}: {v as number}</Badge>
            ))}
          </div>
        )}

        {data.pattern_distribution && Object.keys(data.pattern_distribution).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(data.pattern_distribution).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[10px]">{k}: {v as number}</Badge>
            ))}
          </div>
        )}

        {status === 'critical' && data.coverage_pct === 0 && (
          <div className="text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1 mt-1">
            ⚠️ Nenhum dado encontrado. Função de extração precisa ser executada.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ValidationPage() {
  const [reports, setReports] = useState<ValidationReport[]>([]);
  const [globalSummary, setGlobalSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadReports = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('validation_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (data) {
      const seen = new Set<string>();
      const latest: ValidationReport[] = [];
      for (const r of data) {
        if (!seen.has(r.validation_type)) {
          seen.add(r.validation_type);
          latest.push(r as any);
        }
      }
      setReports(latest.filter(r => r.validation_type !== 'global_summary'));
      const global = latest.find(r => r.validation_type === 'global_summary');
      if (global) setGlobalSummary(global.report_data);
    }
    setLoading(false);
  };

  useEffect(() => { loadReports(); }, []);

  const runValidation = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('validate-mvp-layers', { body: { layers: 'all' } });
      if (error) throw error;
      toast.success(`Validação completa — Qualidade: ${data?.summary?.quality_score}%`);
      await loadReports();
    } catch (e: any) {
      toast.error('Erro na validação: ' + (e.message || 'desconhecido'));
    }
    setRunning(false);
  };

  const qualityScore = globalSummary?.quality_score ?? 0;
  const okCount = globalSummary?.ok_count ?? reports.filter(r => r.report_data?.status === 'ok').length;
  const attentionCount = globalSummary?.attention_count ?? reports.filter(r => r.report_data?.status === 'attention').length;
  const criticalCount = globalSummary?.critical_count ?? reports.filter(r => r.report_data?.status === 'critical').length;

  // Sort: critical → attention → ok
  const sortedReports = [...reports].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, attention: 1, ok: 2 };
    const sa = order[a.report_data?.status] ?? 1;
    const sb = order[b.report_data?.status] ?? 1;
    return sa - sb;
  });

  return (
    <AppLayout>
      <div className="space-y-6 p-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Validação do MVP</h1>
              <p className="text-xs text-muted-foreground">Cobertura real de cada camada sobre a biblioteca de {globalSummary?.layer_results?.blocks?.total_videos || '...'} vídeos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => exportPageAsPDF('Validação do MVP')} className="print:hidden">
              <FileDown className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button onClick={runValidation} disabled={running} size="sm">
              <RotateCcw className={`h-4 w-4 mr-1 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Validando...' : 'Validar'}
            </Button>
          </div>
        </div>

        {globalSummary && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className={`text-3xl font-bold ${qualityScore >= 70 ? 'text-emerald-500' : qualityScore >= 40 ? 'text-amber-500' : 'text-destructive'}`}>
                      {qualityScore}%
                    </div>
                    <div className="text-[10px] text-muted-foreground">Qualidade Global</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-emerald-500">{okCount}</div>
                      <div className="text-[10px] text-muted-foreground">OK</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-amber-500">{attentionCount}</div>
                      <div className="text-[10px] text-muted-foreground">Atenção</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-destructive">{criticalCount}</div>
                      <div className="text-[10px] text-muted-foreground">Crítico</div>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground text-right">
                  <div>{globalSummary.layers_validated} camadas</div>
                  <div>{new Date(globalSummary.timestamp).toLocaleString('pt-BR')}</div>
                </div>
              </div>
              <Progress value={qualityScore} className="h-2" />
            </CardContent>
          </Card>
        )}

        {loading && !globalSummary && (
          <div className="text-center py-12 text-muted-foreground">Carregando relatórios...</div>
        )}

        {!loading && reports.length === 0 && (
          <div className="text-center py-12">
            <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma validação executada ainda.</p>
            <p className="text-xs text-muted-foreground mt-1">Clique em "Validar" para auditar todas as camadas.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedReports.map(r => (
            <LayerCard key={r.id} report={r} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
