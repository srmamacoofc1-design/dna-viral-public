import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Plus, Users, Eye, BarChart3, ChevronRight, Loader2, FileDown } from "lucide-react";
import { exportPageAsPDF } from '@/lib/export-pdf';

const SEGMENTS = ["meme", "curiosidade", "misterio", "terror", "historia_real", "narrativa_biblica"];
const COHORT_TYPES = [
  { value: "segmento", label: "Segmento" },
  { value: "faixa_views", label: "Faixa de Views" },
  { value: "faixa_duracao", label: "Faixa de Duração" },
  { value: "faixa_performance", label: "Faixa de Performance" },
  { value: "combinado", label: "Combinado" },
];

export default function CohortsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    cohort_name: "",
    cohort_type: "combinado",
    filter_segment: "",
    min_views: "",
    max_views: "",
    min_duration: "",
    max_duration: "",
    min_performance: "",
    max_performance: "",
    min_score: "",
    max_score: "",
  });

  const { data: cohorts, isLoading } = useQuery({
    queryKey: ["cohorts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("dataset_cohort")
        .select("*")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        cohort_name: form.cohort_name,
        cohort_type: form.cohort_type,
      };
      if (form.filter_segment) payload.filter_segment = form.filter_segment;
      if (form.min_views) payload.min_views = Number(form.min_views);
      if (form.max_views) payload.max_views = Number(form.max_views);
      if (form.min_duration) payload.min_duration = Number(form.min_duration);
      if (form.max_duration) payload.max_duration = Number(form.max_duration);
      if (form.min_performance) payload.min_performance = Number(form.min_performance);
      if (form.max_performance) payload.max_performance = Number(form.max_performance);
      if (form.min_score) payload.min_score = Number(form.min_score);
      if (form.max_score) payload.max_score = Number(form.max_score);

      const { data, error } = await supabase.functions.invoke("generate-cohort", { body: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Coorte criada com ${data.video_count} vídeos (confiança: ${data.confidence_score}%)`);
      queryClient.invalidateQueries({ queryKey: ["cohorts"] });
      setShowForm(false);
      setForm({ cohort_name: "", cohort_type: "combinado", filter_segment: "", min_views: "", max_views: "", min_duration: "", max_duration: "", min_performance: "", max_performance: "", min_score: "", max_score: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const summaryMutation = useMutation({
    mutationFn: async (cohortId: string) => {
      const { data, error } = await supabase.functions.invoke("generate-cohort-summary", { body: { cohort_id: cohortId } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Resumo da coorte gerado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["cohorts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const confidenceColor = (score: number) => {
    if (score >= 70) return "bg-green-500/10 text-green-400 border-green-500/30";
    if (score >= 40) return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
    return "bg-red-500/10 text-red-400 border-red-500/30";
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Coortes</h1>
            <p className="text-sm text-muted-foreground">Subconjuntos estratégicos para análise segmentada do DNA viral</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => exportPageAsPDF('Coortes')} className="print:hidden">
              <FileDown className="w-4 h-4 mr-1" /> Exportar PDF
            </Button>
            <Button onClick={() => setShowForm(!showForm)} variant={showForm ? "secondary" : "default"}>
              <Plus className="w-4 h-4 mr-2" />
              {showForm ? "Cancelar" : "Nova Coorte"}
            </Button>
          </div>
        </div>

        {showForm && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Criar Nova Coorte</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome da Coorte *</Label>
                  <Input value={form.cohort_name} onChange={e => setForm(f => ({ ...f, cohort_name: e.target.value }))} placeholder="Ex: Terror alto desempenho" />
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={form.cohort_type} onValueChange={v => setForm(f => ({ ...f, cohort_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COHORT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Segmento</Label>
                  <Select value={form.filter_segment} onValueChange={v => setForm(f => ({ ...f, filter_segment: v }))}>
                    <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {SEGMENTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Views Mín</Label>
                  <Input type="number" value={form.min_views} onChange={e => setForm(f => ({ ...f, min_views: e.target.value }))} placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label>Views Máx</Label>
                  <Input type="number" value={form.max_views} onChange={e => setForm(f => ({ ...f, max_views: e.target.value }))} placeholder="∞" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Duração Mín (s)</Label>
                  <Input type="number" value={form.min_duration} onChange={e => setForm(f => ({ ...f, min_duration: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Duração Máx (s)</Label>
                  <Input type="number" value={form.max_duration} onChange={e => setForm(f => ({ ...f, max_duration: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Viral Score Mín</Label>
                  <Input type="number" value={form.min_score} onChange={e => setForm(f => ({ ...f, min_score: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Viral Score Máx</Label>
                  <Input type="number" value={form.max_score} onChange={e => setForm(f => ({ ...f, max_score: e.target.value }))} />
                </div>
              </div>

              <Button onClick={() => createMutation.mutate()} disabled={!form.cohort_name || createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Gerar Coorte
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !cohorts?.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma coorte criada ainda. Clique em "Nova Coorte" para começar.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cohorts.map((c: any) => (
              <Card key={c.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{c.cohort_name}</h3>
                      <div className="text-xs text-muted-foreground mt-1">
                        {c.cohort_type && <Badge variant="outline" className="mr-2 text-xs">{c.cohort_type}</Badge>}
                        {c.active ? <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">Ativa</Badge> :
                          <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">Inativa</Badge>}
                      </div>
                    </div>
                    <Badge variant="outline" className={confidenceColor(c.confidence_score || 0)}>
                      {c.confidence_score || 0}%
                    </Badge>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {c.video_count || 0} vídeos</span>
                    {c.filter_segment && <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {c.filter_segment}</span>}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => summaryMutation.mutate(c.id)} disabled={summaryMutation.isPending}>
                      <BarChart3 className="w-3.5 h-3.5 mr-1" /> Gerar Resumo
                    </Button>
                    <Link to={`/cohorts/${c.id}`}>
                      <Button size="sm" variant="ghost">
                        Detalhes <ChevronRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
