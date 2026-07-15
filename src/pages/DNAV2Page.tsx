import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { RefreshCw, Dna, TrendingUp, BarChart3, Layers, Calendar, Activity, Zap, BookOpen, AlertTriangle, Target, Brain, FileDown } from 'lucide-react';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';

const tooltipStyle = { backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--foreground))' };
const COLORS = ['#3B82F6', '#F59E0B', '#22C55E', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#10B981'];

interface DNAv2Snapshot {
  id: string;
  version_name: string;
  dataset_type: string;
  total_videos_used: number;
  total_blocks_used: number;
  avg_density: number | null;
  verbal_density: number | null;
  dominant_structure_sequence: string | null;
  dominant_verbal_pattern: string | null;
  dominant_cta_pattern: string | null;
  dominant_emotional_arc: string | null;
  cta_distribution: Record<string, number>;
  segment_breakdown: Record<string, number>;
  formula_registry_snapshot: Record<string, any>;
  generated_at: string;
}

export default function DNAV2Page() {
  const [snapshot, setSnapshot] = useState<DNAv2Snapshot | null>(null);
  const [correlations, setCorrelations] = useState<any[]>([]);
  const [weights, setWeights] = useState<any[]>([]);
  const [verbalLayers, setVerbalLayers] = useState<any[]>([]);
  const [lexicon, setLexicon] = useState<any[]>([]);
  const [phrases, setPhrases] = useState<any[]>([]);
  const [outliers, setOutliers] = useState<any[]>([]);
  const [validations, setValidations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [snapRes, corrRes, weightRes, verbalRes, lexRes, phraseRes, outlierRes, valRes] = await Promise.all([
        supabase.from('dna_base_v2').select('*').order('generated_at', { ascending: false }).limit(1),
        supabase.from('performance_correlation').select('*').order('correlation_with_views', { ascending: false }).limit(20),
        supabase.from('pattern_performance_weights').select('*').order('strength_score', { ascending: false }).limit(30),
        supabase.from('verbal_layer_patterns').select('*').order('avg_engagement_rate', { ascending: false }),
        supabase.from('viral_lexicon_global').select('*').order('performance_weighted_score', { ascending: false }).limit(30),
        supabase.from('viral_phrase_bank').select('*').order('performance_weight', { ascending: false }).limit(30),
        supabase.from('outlier_detection').select('*, videos(titulo, engagement_rate_relative, views)').order('z_score', { ascending: false }).limit(50),
        supabase.from('validation_reports').select('*').order('created_at', { ascending: false }).limit(10),
      ]);

      if (snapRes.data?.[0]) {
        const d = snapRes.data[0] as any;
        setSnapshot({
          ...d,
          cta_distribution: typeof d.cta_distribution === 'object' ? d.cta_distribution : {},
          segment_breakdown: typeof d.segment_breakdown === 'object' ? d.segment_breakdown : {},
          formula_registry_snapshot: typeof d.formula_registry_snapshot === 'object' ? d.formula_registry_snapshot : {},
        });
      }
      setCorrelations(corrRes.data || []);
      setWeights(weightRes.data || []);
      setVerbalLayers(verbalRes.data || []);
      setLexicon(lexRes.data || []);
      setPhrases(phraseRes.data || []);
      setOutliers(outlierRes.data || []);
      setValidations(valRes.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar DNA V2:', err);
      toast.error('Erro ao carregar dados do DNA V2');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Auto-regenerate if video count changed
  useEffect(() => {
    if (!snapshot || loading) return;
    (async () => {
      const { count } = await supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed');
      if (count && count > (snapshot.total_videos_used || 0)) {
        toast.info(`Detectados ${count} vídeos (snapshot tinha ${snapshot.total_videos_used}). Atualizando DNA...`);
        handleRegenerate();
      }
    })();
  }, [snapshot, loading]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const resp = await supabase.functions.invoke('generate-dna-base-v2', { body: {} });
      if (resp.error) throw resp.error;
      toast.success('DNA Base V2 regenerado com sucesso');
      await loadAll();
    } catch (err: any) {
      toast.error('Erro: ' + (err.message || 'Desconhecido'));
    } finally {
      setRegenerating(false);
    }
  }

  const isEmpty = (arr: any[]) => !arr || arr.length === 0;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Dna className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">DNA Base V2</h1>
              <p className="text-xs text-muted-foreground">Inteligência consolidada do modelo v2_refined</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => exportPageAsPDF('DNA Base V2 — Relatório')}>
              <FileDown className="w-3 h-3 mr-1" />
              Exportar PDF
            </Button>
            <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
              <RefreshCw className={`w-3 h-3 mr-1 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Gerando...' : 'Regerar DNA V2'}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-12">Carregando inteligência V2...</div>
        ) : (
          <>
            {/* === SNAPSHOT === */}
            <Section icon={<Dna className="w-4 h-4" />} title="Snapshot DNA Base V2" subtitle={snapshot ? `Gerado: ${new Date(snapshot.generated_at).toLocaleString('pt-BR')}` : 'Sem snapshot'}>
              {snapshot ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Metric label="Vídeos" value={String(snapshot.total_videos_used)} />
                    <Metric label="Blocos" value={String(snapshot.total_blocks_used)} />
                    <Metric label="Densidade Média" value={snapshot.avg_density != null ? snapshot.avg_density.toFixed(4) : '—'} />
                    <Metric label="Densidade Verbal" value={snapshot.verbal_density != null ? snapshot.verbal_density.toFixed(4) : '—'} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PatternCard label="Sequência Estrutural Dominante" value={snapshot.dominant_structure_sequence} />
                    <PatternCard label="Padrão Verbal Dominante" value={snapshot.dominant_verbal_pattern} />
                    <PatternCard label="CTA Dominante" value={snapshot.dominant_cta_pattern} />
                    <PatternCard label="Arco Emocional Dominante" value={snapshot.dominant_emotional_arc} />
                  </div>

                  {/* CTA Distribution Chart */}
                  {Object.keys(snapshot.cta_distribution).length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Distribuição CTA</div>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={Object.entries(snapshot.cta_distribution).map(([name, value]) => ({ name, value }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                              {Object.keys(snapshot.cta_distribution).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Segment Breakdown */}
                  {Object.keys(snapshot.segment_breakdown).length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Segmentos</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(snapshot.segment_breakdown).sort((a, b) => Number(b[1]) - Number(a[1])).map(([seg, count]) => (
                          <span key={seg} className="px-2 py-1 bg-muted/30 rounded text-xs text-foreground capitalize">{seg}: <span className="font-bold">{String(count)}</span></span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Visual Layer from formula registry */}
                  {snapshot.formula_registry_snapshot?.visual_layer && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Camada Visual</div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <Metric label="Blocos IA" value={String(snapshot.formula_registry_snapshot.visual_layer.ai_extraction_blocks ?? '—')} />
                        <Metric label="Blocos Metadados" value={String(snapshot.formula_registry_snapshot.visual_layer.metadata_import_blocks ?? '—')} />
                        <Metric label="Confiança Visual" value={snapshot.formula_registry_snapshot.visual_layer.avg_visual_confidence != null ? `${snapshot.formula_registry_snapshot.visual_layer.avg_visual_confidence}%` : '—'} />
                        <Metric label="Presença Humana" value={String(snapshot.formula_registry_snapshot.visual_layer.human_presence_blocks ?? '—')} />
                        <Metric label="Alinhamento Médio" value={snapshot.formula_registry_snapshot.visual_layer.avg_alignment_score != null ? `${snapshot.formula_registry_snapshot.visual_layer.avg_alignment_score}%` : '—'} />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState message="Nenhum snapshot V2 gerado. Clique em 'Regerar DNA V2' após o reprocessamento." />
              )}
            </Section>

            {/* === CORRELATIONS === */}
            <Section icon={<TrendingUp className="w-4 h-4" />} title="Correlações de Performance" subtitle={`${correlations.length} padrões`}>
              {isEmpty(correlations) ? <EmptyState message="Aguardando reprocessamento para calcular correlações." /> : (
                <div className="space-y-3">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={correlations.slice(0, 15).map(c => ({ name: `${c.pattern_type}:${c.pattern_name}`.substring(0, 20), views: c.correlation_with_views, engagement: c.correlation_with_engagement }))}>
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="views" name="Views" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="engagement" name="Engagement" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1 px-2">Tipo</th>
                        <th className="text-left py-1 px-2">Padrão</th>
                        <th className="text-right py-1 px-2">Corr. Views</th>
                        <th className="text-right py-1 px-2">Corr. Engagement</th>
                        <th className="text-right py-1 px-2">Amostra</th>
                      </tr></thead>
                      <tbody>
                        {correlations.map(c => (
                          <tr key={c.id} className="border-b border-border/30 hover:bg-muted/20">
                            <td className="py-1 px-2 text-muted-foreground">{c.pattern_type}</td>
                            <td className="py-1 px-2 font-medium text-foreground">{c.pattern_name}</td>
                            <td className="py-1 px-2 text-right font-mono">{c.correlation_with_views?.toFixed(3) ?? '—'}</td>
                            <td className="py-1 px-2 text-right font-mono">{c.correlation_with_engagement?.toFixed(3) ?? '—'}</td>
                            <td className="py-1 px-2 text-right text-muted-foreground">{c.sample_size}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Section>

            {/* === PATTERN WEIGHTS === */}
            <Section icon={<Activity className="w-4 h-4" />} title="Pesos de Performance por Padrão" subtitle={`${weights.length} padrões`}>
              {isEmpty(weights) ? <EmptyState message="Aguardando reprocessamento para calcular pesos." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1 px-2">Tipo</th>
                      <th className="text-left py-1 px-2">Valor</th>
                      <th className="text-left py-1 px-2">Bloco</th>
                      <th className="text-right py-1 px-2">Frequência</th>
                      <th className="text-right py-1 px-2">Força</th>
                      <th className="text-right py-1 px-2">Avg Views</th>
                      <th className="text-right py-1 px-2">Engagement</th>
                    </tr></thead>
                    <tbody>
                      {weights.map(w => (
                        <tr key={w.id} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="py-1 px-2 text-muted-foreground">{w.pattern_type}</td>
                          <td className="py-1 px-2 font-medium text-foreground max-w-[200px] truncate">{w.pattern_value}</td>
                          <td className="py-1 px-2 text-muted-foreground">{w.block_type || '—'}</td>
                          <td className="py-1 px-2 text-right">{w.frequency}</td>
                          <td className="py-1 px-2 text-right font-mono text-primary">{Number(w.strength_score)?.toFixed(2) ?? '—'}</td>
                          <td className="py-1 px-2 text-right font-mono">{Number(w.avg_views)?.toLocaleString('pt-BR') ?? '—'}</td>
                          <td className="py-1 px-2 text-right font-mono">{Number(w.avg_engagement_score)?.toFixed(3) ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* === VERBAL LAYERS === */}
            <Section icon={<Brain className="w-4 h-4" />} title="Padrões Verbais por Camada" subtitle={`${verbalLayers.length} camadas`}>
              {isEmpty(verbalLayers) ? <EmptyState message="Aguardando reprocessamento para consolidar camadas verbais." /> : (
                <div className="space-y-4">
                  {verbalLayers.map(layer => {
                    const topWords = Array.isArray(layer.top_words) ? layer.top_words.slice(0, 8) : [];
                    const topPhrases = Array.isArray(layer.top_phrases) ? layer.top_phrases.slice(0, 5) : [];
                    const topEmotions = Array.isArray(layer.top_emotions) ? layer.top_emotions.slice(0, 5) : [];
                    return (
                      <div key={layer.id} className="bg-muted/20 border border-border/30 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground uppercase">{layer.layer_type}</span>
                          <div className="flex gap-3 text-[10px] text-muted-foreground">
                            <span>{layer.total_videos_analyzed} vídeos</span>
                            <span>{layer.total_blocks_analyzed} blocos</span>
                            <span>Engagement rate: <span className="text-primary font-bold">{Number(layer.avg_engagement_rate)?.toFixed(1) ?? '—'}</span></span>
                          </div>
                        </div>
                        {topWords.length > 0 && (
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-1">Top Palavras</div>
                            <div className="flex flex-wrap gap-1">
                              {topWords.map((w: any, i: number) => (
                                <span key={i} className="px-1.5 py-0.5 bg-primary/10 rounded text-[10px] text-primary font-mono">{typeof w === 'string' ? w : w.word || w.value} {w.count ? `(${w.count})` : ''}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {topPhrases.length > 0 && (
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-1">Top Frases</div>
                            <div className="flex flex-wrap gap-1">
                              {topPhrases.map((p: any, i: number) => (
                                <span key={i} className="px-1.5 py-0.5 bg-accent/10 rounded text-[10px] text-accent-foreground font-mono">{typeof p === 'string' ? p : p.phrase || p.value} {p.count ? `(${p.count})` : ''}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {topEmotions.length > 0 && (
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-1">Emoções Dominantes</div>
                            <div className="flex flex-wrap gap-1">
                              {topEmotions.map((e: any, i: number) => (
                                <span key={i} className="px-1.5 py-0.5 bg-muted/50 rounded text-[10px] text-foreground">{typeof e === 'string' ? e : e.emotion || e.value} {e.count ? `(${e.count})` : ''}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* === LEXICON === */}
            <Section icon={<BookOpen className="w-4 h-4" />} title="Léxico Viral Global" subtitle={`Top ${lexicon.length} palavras`}>
              {isEmpty(lexicon) ? <EmptyState message="Aguardando reprocessamento para popular o léxico." /> : (
                <div className="space-y-3">
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={lexicon.slice(0, 15).map(w => ({ word: w.word, score: Number(w.performance_weighted_score), freq: w.frequency_total }))}>
                        <XAxis dataKey="word" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={50} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="score" name="Score Ponderado" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {lexicon.map(w => (
                      <span key={w.id} className="px-2 py-1 bg-primary/5 border border-primary/20 rounded text-xs text-foreground">
                        <span className="font-bold">{w.word}</span>
                        <span className="text-muted-foreground ml-1">×{w.frequency_total}</span>
                        <span className="text-primary ml-1">{Number(w.performance_weighted_score)?.toFixed(1)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* === PHRASE BANK === */}
            <Section icon={<Zap className="w-4 h-4" />} title="Banco de Frases Virais" subtitle={`Top ${phrases.length} frases`}>
              {isEmpty(phrases) ? <EmptyState message="Aguardando reprocessamento para popular o banco de frases." /> : (
                <div className="space-y-1">
                  {phrases.map(p => (
                    <div key={p.id} className="flex items-center gap-3 text-xs border-b border-border/20 py-1.5 px-2 hover:bg-muted/20 rounded">
                      <span className="flex-1 font-medium text-foreground">"{p.phrase_text}"</span>
                      <span className="text-muted-foreground">{p.narrative_position || '—'}</span>
                      <span className="text-muted-foreground">{p.emotional_trigger || '—'}</span>
                      <span className="font-mono text-primary">{Number(p.performance_weight)?.toFixed(2)}</span>
                      <span className="text-muted-foreground">×{p.frequency_count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* === OUTLIERS === */}
            <Section icon={<AlertTriangle className="w-4 h-4" />} title="Detecção de Outliers" subtitle={`${outliers.filter(o => o.outlier_flag).length} outliers detectados`}>
              {isEmpty(outliers) ? <EmptyState message="Aguardando normalização de performance." /> : (
                <div className="space-y-1">
                  {outliers.filter(o => o.outlier_flag).map(o => {
                    const video = (o as any).videos;
                    return (
                      <div key={o.id} className="flex items-center gap-3 text-xs border-b border-border/20 py-1.5 px-2 hover:bg-muted/20 rounded">
                        <span className={`w-2 h-2 rounded-full ${Number(o.z_score) > 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className="flex-1 font-medium text-foreground truncate">{video?.titulo || o.video_id.substring(0, 12)}</span>
                        <span className="text-muted-foreground">{o.outlier_type}</span>
                        <span className="font-mono text-primary">z={Number(o.z_score)?.toFixed(2)}</span>
                        <span className="text-muted-foreground text-[10px] max-w-[200px] truncate">{o.outlier_reason}</span>
                      </div>
                    );
                  })}
                  {outliers.filter(o => o.outlier_flag).length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-2">Nenhum outlier detectado no dataset.</div>
                  )}
                </div>
              )}
            </Section>

            {/* === VALIDATIONS === */}
            <Section icon={<Target className="w-4 h-4" />} title="Relatórios de Validação" subtitle={`${validations.length} últimos`}>
              {isEmpty(validations) ? <EmptyState message="Aguardando execução de validações." /> : (
                <div className="space-y-1">
                  {validations.map(v => {
                    const report = typeof v.report_data === 'object' ? v.report_data : {};
                    return (
                      <div key={v.id} className="flex items-center gap-3 text-xs border-b border-border/20 py-1.5 px-2 hover:bg-muted/20 rounded">
                        <span className={`w-2 h-2 rounded-full ${v.anomaly_detected ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                        <span className="font-medium text-foreground">{v.validation_type}</span>
                        <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString('pt-BR')}</span>
                        <span className="font-mono text-primary">{v.confidence_score}%</span>
                        {v.anomaly_detected && <span className="text-amber-500 text-[10px]">⚠ anomalia</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-primary">{icon}</span>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {subtitle && <span className="text-[10px] text-muted-foreground ml-auto">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded p-2.5 text-center">
      <div className="text-sm font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function PatternCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-muted/20 border border-border/30 rounded p-3">
      <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">{label}</div>
      <div className="text-xs font-mono text-primary font-semibold">{value || '—'}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-xs text-muted-foreground text-center py-6 bg-muted/10 rounded">
      {message}
    </div>
  );
}
