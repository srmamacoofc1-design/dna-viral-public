import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface VerbalAnalysisProps {
  videoId: string;
}

const PATTERN_LABELS: Record<string, { label: string; color: string }> = {
  pergunta: { label: '❓ Pergunta', color: 'bg-blue-500/20 text-blue-300' },
  afirmacao: { label: '📢 Afirmação', color: 'bg-muted text-muted-foreground' },
  alerta: { label: '⚠️ Alerta', color: 'bg-yellow-500/20 text-yellow-300' },
  segredo: { label: '🤫 Segredo', color: 'bg-purple-500/20 text-purple-300' },
  erro: { label: '❌ Erro', color: 'bg-red-500/20 text-red-300' },
  proibicao: { label: '🚫 Proibição', color: 'bg-red-500/20 text-red-300' },
  promessa: { label: '🤝 Promessa', color: 'bg-green-500/20 text-green-300' },
  descoberta: { label: '🔍 Descoberta', color: 'bg-cyan-500/20 text-cyan-300' },
};

const TONE_LABELS: Record<string, string> = {
  misterioso: '🌙 Misterioso',
  urgente: '🔥 Urgente',
  emocional: '💖 Emocional',
  tecnico: '🔬 Técnico',
  neutro: '⚪ Neutro',
  chocante: '⚡ Chocante',
};

export function VerbalDNAReport({ videoId }: VerbalAnalysisProps) {
  const { data: analyses, isLoading } = useQuery({
    queryKey: ['block-verbal-analysis', videoId],
    queryFn: async () => {
      const { data } = await supabase
        .from('block_verbal_analysis' as any)
        .select('*')
        .eq('video_id', videoId)
        .order('created_at');
      return data || [];
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando DNA Verbal...</div>;
  if (!analyses?.length) return null;

  const avgDensity = (analyses.reduce((s: number, a: any) => s + (Number(a.linguistic_density) || 0), 0) / analyses.length).toFixed(2);
  const avgIntensity = Math.round(analyses.reduce((s: number, a: any) => s + (Number(a.emotional_intensity) || 0), 0) / analyses.length);
  const avgPressure = (analyses.reduce((s: number, a: any) => s + (Number(a.semantic_pressure_score) || 0), 0) / analyses.length).toFixed(1);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          🧬 DNA Verbal — Análise por Bloco
          <Badge variant="outline" className="text-xs">{analyses.length} blocos</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-primary">{avgDensity}</div>
            <div className="text-xs text-muted-foreground">Densidade Linguística</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-primary">{avgIntensity}%</div>
            <div className="text-xs text-muted-foreground">Intensidade Emocional</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-primary">{avgPressure}</div>
            <div className="text-xs text-muted-foreground">Pressão Semântica</div>
          </div>
        </div>

        {/* Per-block */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {analyses.map((a: any, i: number) => {
            const patternInfo = PATTERN_LABELS[a.phrase_pattern] || PATTERN_LABELS.afirmacao;
            return (
              <div key={a.id || i} className="bg-muted/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={patternInfo.color}>{patternInfo.label}</Badge>
                  <Badge variant="outline" className="text-xs">{TONE_LABELS[a.tone] || a.tone}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{a.word_count} palavras • {a.phrase_count} frases</span>
                </div>
                {(a.trigger_words as string[])?.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {(a.trigger_words as string[]).map((tw: string, j: number) => (
                      <Badge key={j} variant="secondary" className="text-xs bg-orange-500/20 text-orange-300">{tw}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Densidade: {Number(a.linguistic_density).toFixed(2)}</span>
                  <span>Intensidade: {a.emotional_intensity}%</span>
                  <span>Pressão: {Number(a.semantic_pressure_score).toFixed(1)}</span>
                  <span>Complexidade: {Number(a.syntactic_complexity).toFixed(1)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
