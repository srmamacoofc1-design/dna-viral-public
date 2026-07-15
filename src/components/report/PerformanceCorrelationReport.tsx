import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

const MIN_RELIABLE_SAMPLE = 5;

function corrStrength(val: number | null): { label: string; color: string } {
  if (val == null) return { label: '—', color: 'text-muted-foreground' };
  const abs = Math.abs(val);
  if (abs > 0.7) return { label: 'Forte', color: 'text-emerald-500' };
  if (abs > 0.4) return { label: 'Média', color: 'text-amber-500' };
  if (abs > 0.2) return { label: 'Fraca', color: 'text-orange-400' };
  return { label: 'Irrelevante', color: 'text-muted-foreground' };
}

export function PerformanceCorrelationReport() {
  const [generating, setGenerating] = useState(false);

  const { data: correlations, isLoading, refetch } = useQuery({
    queryKey: ['performance-correlations'],
    queryFn: async () => {
      const { data } = await supabase
        .from('performance_correlation')
        .select('*')
        .order('pattern_type');
      return data || [];
    },
  });

  const { data: dnaV2 } = useQuery({
    queryKey: ['dna-base-v2-latest'],
    queryFn: async () => {
      const { data } = await supabase
        .from('dna_base_v2')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  async function runCorrelations() {
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke('calculate-pattern-correlations');
      if (error) throw error;
      toast.success('Correlações recalculadas');
      refetch();
    } catch (err) {
      toast.error('Erro ao calcular correlações');
    } finally {
      setGenerating(false);
    }
  }

  async function generateDNAV2() {
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke('generate-dna-base-v2');
      if (error) throw error;
      toast.success('DNA Base V2 gerado');
      refetch();
    } catch (err) {
      toast.error('Erro ao gerar DNA V2');
    } finally {
      setGenerating(false);
    }
  }

  function corrBadge(val: number | null, sampleSize: number) {
    if (val == null) return <span className="text-xs text-muted-foreground">—</span>;
    const unreliable = sampleSize < MIN_RELIABLE_SAMPLE;
    const { color } = corrStrength(val);
    return (
      <span className={`text-sm font-mono font-bold ${unreliable ? 'text-muted-foreground/50 line-through' : color}`}>
        {val > 0 ? '+' : ''}{val.toFixed(3)}
      </span>
    );
  }

  function reliabilityBadge(sampleSize: number, confidence: number) {
    if (sampleSize < MIN_RELIABLE_SAMPLE) {
      return <Badge variant="destructive" className="text-[9px]">⚠️ n&lt;{MIN_RELIABLE_SAMPLE}</Badge>;
    }
    if (confidence >= 70) return <Badge variant="default" className="text-[9px] bg-emerald-600">Confiável</Badge>;
    if (confidence >= 40) return <Badge variant="secondary" className="text-[9px]">Moderado</Badge>;
    return <Badge variant="outline" className="text-[9px]">Fraco</Badge>;
  }

  // Separate reliable and unreliable
  const reliable = (correlations as any[] || []).filter(c => (c.sample_size || 0) >= MIN_RELIABLE_SAMPLE);
  const unreliable = (correlations as any[] || []).filter(c => (c.sample_size || 0) < MIN_RELIABLE_SAMPLE);

  return (
    <div className="space-y-4">
      {/* DNA Base V2 */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>🧬 DNA Base V2</span>
            <Button size="sm" variant="outline" onClick={generateDNAV2} disabled={generating}>
              <RefreshCw className={`h-3 w-3 mr-1 ${generating ? 'animate-spin' : ''}`} />
              Gerar V2
            </Button>
          </CardTitle>
        </CardHeader>
        {dnaV2 && (
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Estrutura:</span> <span className="font-mono text-xs">{(dnaV2 as any).dominant_structure_sequence || '—'}</span></div>
              <div><span className="text-muted-foreground">Verbal:</span> <span>{(dnaV2 as any).dominant_verbal_pattern || '—'}</span></div>
              <div><span className="text-muted-foreground">CTA:</span> <span>{(dnaV2 as any).dominant_cta_pattern || '—'}</span></div>
              <div><span className="text-muted-foreground">Arco Emocional:</span> <span>{(dnaV2 as any).dominant_emotional_arc || '—'}</span></div>
              <div><span className="text-muted-foreground">Vídeos:</span> <span>{(dnaV2 as any).total_videos_used}</span></div>
              <div><span className="text-muted-foreground">Blocos:</span> <span>{(dnaV2 as any).total_blocks_used}</span></div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Correlations */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>📊 Correlações Padrão × Performance</span>
            <Button size="sm" variant="outline" onClick={runCorrelations} disabled={generating}>
              <RefreshCw className={`h-3 w-3 mr-1 ${generating ? 'animate-spin' : ''}`} />
              Recalcular
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !correlations?.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma correlação calculada ainda.</p>
          ) : (
            <div className="space-y-4">
              {/* Reliable */}
              {reliable.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-emerald-500 uppercase">Correlações Confiáveis (n≥{MIN_RELIABLE_SAMPLE})</div>
                  {reliable.map((c: any, i: number) => {
                    const { label: vLabel } = corrStrength(c.correlation_with_views);
                    return (
                      <div key={c.id || i} className="flex items-center justify-between bg-muted/20 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{c.pattern_type}</Badge>
                          <span className="text-sm">{c.pattern_name.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground">Views</div>
                            {corrBadge(c.correlation_with_views, c.sample_size)}
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground">Eng.</div>
                            {corrBadge(c.correlation_with_engagement, c.sample_size)}
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground">Força</div>
                            <span className="text-[10px]">{vLabel}</span>
                          </div>
                          {reliabilityBadge(c.sample_size, c.confidence_score)}
                          <span className="text-[10px] text-muted-foreground">n={c.sample_size}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Unreliable */}
              {unreliable.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase">⚠️ Não Confiáveis (n&lt;{MIN_RELIABLE_SAMPLE})</div>
                  {unreliable.map((c: any, i: number) => (
                    <div key={c.id || i} className="flex items-center justify-between bg-muted/10 rounded-lg p-3 opacity-50">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{c.pattern_type}</Badge>
                        <span className="text-sm line-through">{c.pattern_name.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {reliabilityBadge(c.sample_size, c.confidence_score)}
                        <span className="text-[10px] text-muted-foreground">n={c.sample_size}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
