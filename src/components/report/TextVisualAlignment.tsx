import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Eye, FileText, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Alignment {
  id: string;
  block_id: string;
  text_action: string | null;
  visual_action: string | null;
  text_emotion: string | null;
  visual_emotion: string | null;
  action_alignment_score: number | null;
  emotion_alignment_score: number | null;
  intensity_alignment_score: number | null;
  alignment_score: number;
  confidence_score: number;
}

interface AlignmentMeta {
  calculated_at: string | null;
  blocks_count: number;
  is_auto: boolean;
}

interface Props {
  videoId: string;
  avgScore?: number | null;
}

function scoreBadge(score: number | null, size: 'sm' | 'md' = 'md') {
  if (score === null || score === undefined) return <span className="text-muted-foreground text-xs">—</span>;
  const cls = size === 'sm' ? 'text-[10px] px-1.5 py-0' : '';
  if (score >= 75) return <Badge className={`bg-green-600 text-white ${cls}`}>{score}%</Badge>;
  if (score >= 40) return <Badge className={`bg-yellow-600 text-white ${cls}`}>{score}%</Badge>;
  return <Badge variant="destructive" className={cls}>{score}%</Badge>;
}

function avg(arr: (number | null)[]): number | null {
  const valid = arr.filter((v): v is number => v !== null && v !== undefined);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

export function TextVisualAlignment({ videoId, avgScore }: Props) {
  const [data, setData] = useState<Alignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [meta, setMeta] = useState<AlignmentMeta>({ calculated_at: null, blocks_count: 0, is_auto: false });

  const fetchData = async () => {
    setLoading(true);
    const [{ data: rows }, { data: logRows }] = await Promise.all([
      supabase
        .from('text_visual_alignment' as any)
        .select('*')
        .eq('video_id', videoId)
        .order('created_at'),
      supabase
        .from('extraction_logs')
        .select('created_at, extraction_step, extracted_value')
        .eq('video_id', videoId)
        .in('extraction_step', ['text_visual_alignment', 'text_visual_alignment_auto'])
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    setData((rows as any[]) || []);
    const latestLog = logRows?.[0];
    setMeta({
      calculated_at: latestLog?.created_at || null,
      blocks_count: (rows as any[])?.length || 0,
      is_auto: latestLog?.extraction_step === 'text_visual_alignment_auto' || 
               (latestLog?.extracted_value?.includes?.('auto') ?? false),
    });
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [videoId]);

  const handleCalculate = async () => {
    setProcessing(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('calculate-text-visual-alignment', {
        body: { video_id: videoId },
      });
      if (error) throw error;
      toast.success(`Alinhamento calculado: ${res.count} blocos, média ${res.avg_alignment_score}%`);
      fetchData();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao calcular alinhamento');
    } finally {
      setProcessing(false);
    }
  };

  const avgGlobal = avg(data.map(d => d.alignment_score));
  const avgAction = avg(data.map(d => d.action_alignment_score));
  const avgEmotion = avg(data.map(d => d.emotion_alignment_score));
  const avgIntensity = avg(data.map(d => d.intensity_alignment_score));
  const highCount = data.filter(d => d.alignment_score >= 75).length;
  const lowCount = data.filter(d => d.alignment_score < 40).length;

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="h-4 w-4" />
          <FileText className="h-4 w-4" />
          Alinhamento Texto–Visual
        </CardTitle>
        <Button size="sm" variant="outline" onClick={handleCalculate} disabled={processing}>
          {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {data.length > 0 ? 'Recalcular' : 'Calcular'}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : data.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Alinhamento texto–visual ainda não calculado</p>
            <p className="text-xs mt-1">Clique em "Calcular" para gerar</p>
          </div>
        ) : (
          <>
            {/* Metadata & Formula info */}
            <div className="flex flex-wrap items-center gap-3 mb-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Info className="h-3 w-3" />
                Fórmula: Ação×40% + Emoção×40% + Intensidade×20%
              </span>
              {meta.calculated_at && (
                <span className="bg-muted px-2 py-0.5 rounded">
                  📅 {new Date(meta.calculated_at).toLocaleString('pt-BR')}
                </span>
              )}
              <span className="bg-muted px-2 py-0.5 rounded">
                📊 {meta.blocks_count} blocos
              </span>
              <span className={`px-2 py-0.5 rounded ${meta.is_auto ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'}`}>
                {meta.is_auto ? '⚡ Automático' : '🖐️ Manual'}
              </span>
            </div>

            {/* Global Summary */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4 p-3 rounded-md bg-muted/50">
              <div className="text-center">
                <div className="text-xl font-bold">{avgGlobal !== null ? `${avgGlobal}%` : '—'}</div>
                <div className="text-[10px] text-muted-foreground">Geral</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold">{avgAction !== null ? `${avgAction}%` : '—'}</div>
                <div className="text-[10px] text-muted-foreground">Ação</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold">{avgEmotion !== null ? `${avgEmotion}%` : '—'}</div>
                <div className="text-[10px] text-muted-foreground">Emoção</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold">{avgIntensity !== null ? `${avgIntensity}%` : '—'}</div>
                <div className="text-[10px] text-muted-foreground">Intensidade</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-green-600">{highCount}</div>
                <div className="text-[10px] text-muted-foreground">Alta (≥75)</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-destructive">{lowCount}</div>
                <div className="text-[10px] text-muted-foreground">Baixa (&lt;40)</div>
              </div>
            </div>

            {/* Per-block table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1 px-1">#</th>
                    <th className="text-left py-1 px-1">Ação Txt</th>
                    <th className="text-left py-1 px-1">Ação Vis</th>
                    <th className="text-left py-1 px-1">Emoção Txt</th>
                    <th className="text-left py-1 px-1">Emoção Vis</th>
                    <th className="text-center py-1 px-1">Ação</th>
                    <th className="text-center py-1 px-1">Emoção</th>
                    <th className="text-center py-1 px-1">Intens.</th>
                    <th className="text-center py-1 px-1">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1 px-1 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="py-1 px-1 max-w-[80px] truncate">{row.text_action || '—'}</td>
                      <td className="py-1 px-1 max-w-[80px] truncate">{row.visual_action || '—'}</td>
                      <td className="py-1 px-1 max-w-[80px] truncate">{row.text_emotion || '—'}</td>
                      <td className="py-1 px-1 max-w-[80px] truncate">{row.visual_emotion || '—'}</td>
                      <td className="py-1 px-1 text-center">{scoreBadge(row.action_alignment_score, 'sm')}</td>
                      <td className="py-1 px-1 text-center">{scoreBadge(row.emotion_alignment_score, 'sm')}</td>
                      <td className="py-1 px-1 text-center">{scoreBadge(row.intensity_alignment_score, 'sm')}</td>
                      <td className="py-1 px-1 text-center">{scoreBadge(row.alignment_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}