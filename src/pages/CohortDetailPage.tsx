import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, BarChart3, Dna, BookOpen, TrendingUp, FileDown } from "lucide-react";
import { exportPageAsPDF } from '@/lib/export-pdf';

export default function CohortDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: cohort, isLoading: loadingCohort } = useQuery({
    queryKey: ["cohort", id],
    queryFn: async () => {
      const { data } = await supabase.from("dataset_cohort").select("*").eq("id", id!).single();
      return data;
    },
    enabled: !!id,
  });

  const { data: summary } = useQuery({
    queryKey: ["cohort-summary", id],
    queryFn: async () => {
      const { data } = await supabase.from("cohort_analysis_summary").select("*").eq("cohort_id", id!).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  const { data: videoCount } = useQuery({
    queryKey: ["cohort-videos-count", id],
    queryFn: async () => {
      const { count } = await supabase.from("dataset_cohort_videos").select("*", { count: "exact", head: true }).eq("cohort_id", id!);
      return count || 0;
    },
    enabled: !!id,
  });

  const summaryMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-cohort-summary", { body: { cohort_id: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Resumo gerado"); queryClient.invalidateQueries({ queryKey: ["cohort-summary", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const dnaMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-dna-base-v2", { body: { cohort_id: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success("DNA Base V2 da coorte gerado"),
    onError: (e: Error) => toast.error(e.message),
  });

  const lexiconMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("update-viral-lexicon", { body: { cohort_id: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => toast.success(`Léxico atualizado: ${data?.active_words || 0} palavras ativas`),
    onError: (e: Error) => toast.error(e.message),
  });

  const corrMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("calculate-pattern-correlations", { body: { cohort_id: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success("Correlações da coorte calculadas"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (loadingCohort) return <AppLayout><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div></AppLayout>;
  if (!cohort) return <AppLayout><div className="text-center py-20 text-muted-foreground">Coorte não encontrada</div></AppLayout>;

  const rules = (cohort as any).rules_json || {};

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{cohort.cohort_name}</h1>
            <div className="flex items-center gap-2 mt-1">
              {(cohort as any).cohort_type && <Badge variant="outline">{(cohort as any).cohort_type}</Badge>}
              {(cohort as any).active ? <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">Ativa</Badge> :
                <Badge variant="outline" className="bg-muted text-muted-foreground">Inativa</Badge>}
              <Badge variant="outline">{videoCount} vídeos</Badge>
              <Badge variant="outline" className={(cohort as any).confidence_score >= 70 ? "bg-green-500/10 text-green-400" : (cohort as any).confidence_score >= 40 ? "bg-yellow-500/10 text-yellow-400" : "bg-red-500/10 text-red-400"}>
                Confiança: {(cohort as any).confidence_score || 0}%
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={() => exportPageAsPDF(`Coorte — ${cohort.cohort_name}`)} className="print:hidden">
              <FileDown className="w-4 h-4 mr-1" /> Exportar PDF
            </Button>
          </div>
        </div>

        {/* Rules */}
        <Card>
          <CardHeader><CardTitle className="text-base">Regras Aplicadas</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {rules.filter_segment && <div><span className="text-muted-foreground">Segmento:</span> <span className="font-medium">{rules.filter_segment}</span></div>}
              {rules.min_views != null && <div><span className="text-muted-foreground">Views Mín:</span> <span className="font-medium">{Number(rules.min_views).toLocaleString()}</span></div>}
              {rules.max_views != null && <div><span className="text-muted-foreground">Views Máx:</span> <span className="font-medium">{Number(rules.max_views).toLocaleString()}</span></div>}
              {rules.min_duration != null && <div><span className="text-muted-foreground">Duração Mín:</span> <span className="font-medium">{rules.min_duration}s</span></div>}
              {rules.max_duration != null && <div><span className="text-muted-foreground">Duração Máx:</span> <span className="font-medium">{rules.max_duration}s</span></div>}
              {rules.min_score != null && <div><span className="text-muted-foreground">Score Mín:</span> <span className="font-medium">{rules.min_score}</span></div>}
              {rules.max_score != null && <div><span className="text-muted-foreground">Score Máx:</span> <span className="font-medium">{rules.max_score}</span></div>}
              {!Object.values(rules).some(v => v != null) && <div className="col-span-4 text-muted-foreground">Sem filtros específicos (dataset completo)</div>}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Ações da Coorte</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => summaryMutation.mutate()} disabled={summaryMutation.isPending} variant="outline">
              {summaryMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BarChart3 className="w-4 h-4 mr-2" />}
              Gerar Resumo
            </Button>
            <Button onClick={() => dnaMutation.mutate()} disabled={dnaMutation.isPending} variant="outline">
              {dnaMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Dna className="w-4 h-4 mr-2" />}
              Gerar DNA Base
            </Button>
            <Button onClick={() => lexiconMutation.mutate()} disabled={lexiconMutation.isPending} variant="outline">
              {lexiconMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BookOpen className="w-4 h-4 mr-2" />}
              Gerar Léxico
            </Button>
            <Button onClick={() => corrMutation.mutate()} disabled={corrMutation.isPending} variant="outline">
              {corrMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
              Gerar Correlações
            </Button>
          </CardContent>
        </Card>

        {/* Summary */}
        {summary && (
          <Card>
            <CardHeader><CardTitle className="text-base">Resumo da Coorte</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MetricCard label="Engagement Rate Médio" value={summary.avg_engagement_rate != null ? Number(summary.avg_engagement_rate).toFixed(1) : "—"} />
                <MetricCard label="Performance Média" value={(summary as any).avg_normalized_performance_score != null ? Number((summary as any).avg_normalized_performance_score).toFixed(1) : summary.avg_performance != null ? Number(summary.avg_performance).toFixed(1) : "—"} />
                <MetricCard label="Alinhamento Médio" value={summary.avg_alignment_score != null ? Number(summary.avg_alignment_score).toFixed(1) : "—"} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PatternCard label="Estrutura Dominante" value={summary.dominant_structure} />
                <PatternCard label="Padrão Verbal Dominante" value={(summary as any).dominant_verbal_pattern} />
                <PatternCard label="CTA Dominante" value={(summary as any).dominant_cta_pattern} />
                <PatternCard label="Arco Emocional Dominante" value={(summary as any).dominant_emotional_arc || summary.dominant_emotion} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-4 text-center">
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function PatternCard({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-medium text-foreground">{value || "—"}</div>
    </div>
  );
}
