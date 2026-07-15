import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CTADeepReportProps {
  videoId: string;
}

const TYPE_LABELS: Record<string, string> = {
  direto: '🎯 Direto',
  indireto: '💬 Indireto',
  emocional: '💖 Emocional',
  racional: '🧠 Racional',
  implicito: '👁️ Implícito',
};

const TONE_COLORS: Record<string, string> = {
  urgente: 'bg-red-500/20 text-red-300',
  sugestivo: 'bg-blue-500/20 text-blue-300',
  autoridade: 'bg-purple-500/20 text-purple-300',
  curiosidade: 'bg-yellow-500/20 text-yellow-300',
};

export function CTADeepReport({ videoId }: CTADeepReportProps) {
  const { data: ctas, isLoading } = useQuery({
    queryKey: ['cta-deep-analysis', videoId],
    queryFn: async () => {
      const { data } = await supabase
        .from('cta_deep_analysis' as any)
        .select('*')
        .eq('video_id', videoId)
        .order('created_at');
      return data || [];
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando CTA...</div>;
  if (!ctas?.length) return null;

  const explicit = ctas.filter((c: any) => !c.implicit_cta_detected).length;
  const implicit = ctas.filter((c: any) => c.implicit_cta_detected).length;
  const avgIntensity = Math.round(ctas.reduce((s: number, c: any) => s + (c.cta_intensity || 0), 0) / ctas.length);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          📣 CTA Profundo
          <Badge variant="outline" className="text-xs">{ctas.length} CTAs detectados</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-green-400">{explicit}</div>
            <div className="text-xs text-muted-foreground">Explícitos</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-yellow-400">{implicit}</div>
            <div className="text-xs text-muted-foreground">Implícitos</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-primary">{avgIntensity}%</div>
            <div className="text-xs text-muted-foreground">Intensidade Média</div>
          </div>
        </div>

        <div className="space-y-2">
          {ctas.map((c: any, i: number) => (
            <div key={c.id || i} className="bg-muted/20 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{TYPE_LABELS[c.cta_type] || c.cta_type}</Badge>
                <Badge className={TONE_COLORS[c.cta_tone] || 'bg-muted text-muted-foreground'}>{c.cta_tone}</Badge>
                <Badge variant="secondary" className="text-xs">📍 {c.cta_position}</Badge>
                <Badge variant="secondary" className="text-xs">🎯 {c.cta_target}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">{c.cta_intensity}% intensidade</span>
              </div>
              {c.cta_text && (
                <p className="text-xs text-muted-foreground line-clamp-2 italic">"{c.cta_text}"</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
