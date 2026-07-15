import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Loader2, Brain, Trophy, Zap, Eye, Target, GitBranch, Layers } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const FUNCTION_COLORS: Record<string, string> = {
  HOOK: "#f59e0b",
  SETUP: "#6366f1",
  BUILD: "#3b82f6",
  MICRO_PEAK: "#ec4899",
  TWIST: "#ef4444",
  PAYOFF: "#10b981",
  CTA: "#f97316",
  TRANSITION: "#8b5cf6",
  ACTION: "#94a3b8",
};

export default function VerbalIntelligencePage() {
  const [consolidating, setConsolidating] = useState(false);
  const [analyzingSequences, setAnalyzingSequences] = useState(false);
  const [activeFunction, setActiveFunction] = useState("HOOK");

  const { data: summaries, refetch: refetchSummaries } = useQuery({
    queryKey: ["verbal_intelligence_summary"],
    queryFn: async () => {
      const { data } = await supabase
        .from("verbal_intelligence_summary")
        .select("*")
        .order("total_canonical_units", { ascending: false });
      return (data || []) as any[];
    },
  });

  const { data: topUnits } = useQuery({
    queryKey: ["verbal_canonical_top", activeFunction],
    queryFn: async () => {
      const { data } = await supabase
        .from("verbal_canonical_units")
        .select("*")
        .eq("narrative_function", activeFunction)
        .order("narrative_replicability_score", { ascending: false })
        .limit(20);
      return (data || []) as any[];
    },
  });

  const { data: totalCount } = useQuery({
    queryKey: ["verbal_canonical_count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("verbal_canonical_units")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: sequences, refetch: refetchSequences } = useQuery({
    queryKey: ["verbal_narrative_sequences"],
    queryFn: async () => {
      const { data } = await supabase
        .from("verbal_narrative_sequences")
        .select("*")
        .order("frequency", { ascending: false });
      return (data || []) as any[];
    },
  });

  const { data: phase2Profile, refetch: refetchProfile } = useQuery({
    queryKey: ["verbal_phase2_profile"],
    queryFn: async () => {
      const { data } = await supabase
        .from("verbal_phase2_profile")
        .select("*")
        .order("total_units", { ascending: false });
      return (data || []) as any[];
    },
  });

  const handleConsolidate = async () => {
    setConsolidating(true);
    try {
      const { data, error } = await supabase.functions.invoke("consolidate-verbal-intelligence", { body: {} });
      if (error) throw error;
      toast.success(`Consolidação concluída: ${data.total_canonical_units} unidades canônicas`);
      refetchSummaries();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || String(err)));
    } finally {
      setConsolidating(false);
    }
  };

  const handleAnalyzeSequences = async () => {
    setAnalyzingSequences(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-narrative-sequences", { body: {} });
      if (error) throw error;
      toast.success(`Análise concluída: ${data.total_sequence_patterns} padrões, ${data.total_videos_with_sequences} vídeos`);
      refetchSequences();
      refetchProfile();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || String(err)));
    } finally {
      setAnalyzingSequences(false);
    }
  };

  const distributionData = (summaries || [])
    .filter((s: any) => s.total_canonical_units > 0)
    .map((s: any) => ({
      name: s.narrative_function,
      units: s.total_canonical_units,
      fill: FUNCTION_COLORS[s.narrative_function] || "#94a3b8",
    }));

  const activeSummary = (summaries || []).find((s: any) => s.narrative_function === activeFunction);
  const activeProfile = (phase2Profile || []).find((p: any) => p.narrative_function === activeFunction);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              Verbal Intelligence Layer
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Inteligência verbal consolidada + Sequências narrativas + Perfil Fase 2
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleConsolidate} disabled={consolidating} variant="outline" size="sm">
              {consolidating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Consolidar
            </Button>
            <Button onClick={handleAnalyzeSequences} disabled={analyzingSequences} size="sm">
              {analyzingSequences ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <GitBranch className="h-4 w-4 mr-2" />}
              Analisar Sequências
            </Button>
          </div>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Canônicas</p>
              <p className="text-2xl font-bold">{totalCount || 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Funções Ativas</p>
              <p className="text-2xl font-bold">{distributionData.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Confiança Média</p>
              <p className="text-2xl font-bold">
                {summaries && summaries.length > 0
                  ? Math.round(summaries.filter((s: any) => s.total_canonical_units > 0).reduce((s: number, r: any) => s + (r.avg_confidence || 0), 0) / summaries.filter((s: any) => s.total_canonical_units > 0).length)
                  : 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Sequências Detectadas</p>
              <p className="text-2xl font-bold">{sequences?.length || 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Perfil Fase 2</p>
              <p className="text-2xl font-bold">{phase2Profile?.length || 0} funções</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="distribution">
          <TabsList className="flex-wrap">
            <TabsTrigger value="distribution">Distribuição</TabsTrigger>
            <TabsTrigger value="sequences">Sequências</TabsTrigger>
            <TabsTrigger value="strength">Força Verbal</TabsTrigger>
            <TabsTrigger value="emotions">Emoções</TabsTrigger>
            <TabsTrigger value="ranking">Ranking</TabsTrigger>
            <TabsTrigger value="phase2">Perfil Fase 2</TabsTrigger>
            <TabsTrigger value="table">Tabela Canônica</TabsTrigger>
          </TabsList>

          {/* 1. Distribution */}
          <TabsContent value="distribution">
            <Card>
              <CardHeader><CardTitle>Distribuição por Função Narrativa</CardTitle></CardHeader>
              <CardContent>
                {distributionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={distributionData}>
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="units" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-8">Clique em "Consolidar" para gerar dados</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 2. Sequences */}
          <TabsContent value="sequences">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-primary" />
                    Padrões de Sequência Narrativa
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {sequences && sequences.length > 0 ? (
                    <div className="space-y-3">
                      {sequences.slice(0, 20).map((s: any, i: number) => (
                        <div key={s.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-lg font-bold text-muted-foreground">#{i + 1}</span>
                              {s.sequence_pattern.split(" → ").map((fn: string, j: number) => (
                                <span key={j} className="flex items-center gap-1">
                                  {j > 0 && <span className="text-muted-foreground">→</span>}
                                  <Badge style={{ backgroundColor: FUNCTION_COLORS[fn] || "#94a3b8" }} className="text-white text-xs">
                                    {fn}
                                  </Badge>
                                </span>
                              ))}
                            </div>
                            <Badge variant="secondary" className="text-sm font-bold shrink-0">
                              {s.frequency}x
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Engagement Rate</span>
                              <p className="font-mono font-bold">{s.avg_engagement_rate?.toFixed(2)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Intensidade</span>
                              <p className="font-mono font-bold">{s.avg_emotional_intensity?.toFixed(1)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Confiança</span>
                              <p className="font-mono font-bold">{s.avg_confidence?.toFixed(1)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Viewer Dir.</span>
                              <p className="font-mono font-bold">{((s.viewer_directed_rate || 0) * 100).toFixed(0)}%</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Replicabilidade</span>
                              <p className="font-mono font-bold">{((s.avg_replicability || 0) * 100).toFixed(0)}%</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Emoção Dom.</span>
                              <p className="font-bold">{s.dominant_emotion || "—"}</p>
                            </div>
                          </div>
                          {s.sample_videos && (s.sample_videos as any[]).length > 0 && (
                            <div className="mt-2 text-[11px] text-muted-foreground">
                              Vídeos: {(s.sample_videos as any[]).map((v: any) => v.title?.slice(0, 25) || "—").join(" | ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      Clique em "Analisar Sequências" para detectar padrões narrativos
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 3. Strength */}
          <TabsContent value="strength">
            <Card>
              <CardHeader><CardTitle>Força Verbal por Função</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Função</TableHead>
                        <TableHead>Unidades</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Replicabilidade</TableHead>
                        <TableHead>Viewer Dir.</TableHead>
                        <TableHead>Replicabilidade Narrativa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(summaries || []).filter((s: any) => s.total_canonical_units > 0).map((s: any) => (
                        <TableRow key={s.narrative_function}>
                          <TableCell>
                            <Badge style={{ backgroundColor: FUNCTION_COLORS[s.narrative_function] }} className="text-white">
                              {s.narrative_function}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono">{s.total_canonical_units}</TableCell>
                          <TableCell className="font-mono">{s.avg_confidence?.toFixed(1)}</TableCell>
                          <TableCell className="font-mono">{((s.avg_replicability || 0) * 100).toFixed(0)}%</TableCell>
                          <TableCell className="font-mono">{((s.viewer_directed_rate || 0) * 100).toFixed(0)}%</TableCell>
                          <TableCell className="font-mono font-bold">{s.avg_replicability_score?.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 4. Emotions */}
          <TabsContent value="emotions">
            <Card>
              <CardHeader><CardTitle>Distribuição Emocional por Função</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(summaries || []).filter((s: any) => s.total_canonical_units > 0).map((s: any) => (
                    <Card key={s.narrative_function} className="border">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge style={{ backgroundColor: FUNCTION_COLORS[s.narrative_function] }} className="text-white">
                            {s.narrative_function}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{s.total_canonical_units} unidades</span>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p><span className="text-muted-foreground">Emoção principal:</span> <strong>{s.primary_emotion || "—"}</strong></p>
                          <p><span className="text-muted-foreground">Emoção secundária:</span> {s.secondary_emotion || "—"}</p>
                          <p><span className="text-muted-foreground">Intensidade média:</span> <span className="font-mono">{s.avg_emotional_intensity?.toFixed(1)}</span></p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 5. Ranking */}
          <TabsContent value="ranking">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Top Elementos Verbais
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  {["HOOK", "BUILD", "TWIST", "PAYOFF", "CTA", "MICRO_PEAK", "SETUP"].map(fn => (
                    <Button
                      key={fn}
                      size="sm"
                      variant={activeFunction === fn ? "default" : "outline"}
                      onClick={() => setActiveFunction(fn)}
                      style={activeFunction === fn ? { backgroundColor: FUNCTION_COLORS[fn] } : {}}
                    >
                      {fn}
                    </Button>
                  ))}
                </div>

                {activeSummary?.top_units && (activeSummary.top_units as any[]).length > 0 ? (
                  <div className="space-y-3">
                    {(activeSummary.top_units as any[]).slice(0, 10).map((u: any, i: number) => (
                      <div key={i} className="border rounded-lg p-3">
                        <div className="flex items-start gap-3">
                          <span className="text-lg font-bold text-muted-foreground">#{i + 1}</span>
                          <div className="flex-1">
                            <p className="font-medium text-sm">"{u.text}"</p>
                            <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                              <span>Replicabilidade: <strong className="text-foreground">{u.narrative_replicability_score?.toFixed(2)}</strong></span>
                              <span>Confidence: {u.confidence}</span>
                              {u.emotion && <span>Emoção: {u.emotion}</span>}
                              {u.video_title && <span>Vídeo: {u.video_title?.slice(0, 30)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    Nenhum dado para {activeFunction}. Execute a consolidação primeiro.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 6. Phase 2 Profile */}
          <TabsContent value="phase2">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-primary" />
                    Perfil Verbal Final — Fase 2
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "ACTION"].map(fn => (
                      <Button
                        key={fn}
                        size="sm"
                        variant={activeFunction === fn ? "default" : "outline"}
                        onClick={() => setActiveFunction(fn)}
                        style={activeFunction === fn ? { backgroundColor: FUNCTION_COLORS[fn] } : {}}
                      >
                        {fn}
                      </Button>
                    ))}
                  </div>

                  {activeProfile ? (
                    <div className="space-y-6">
                      {/* Metrics overview */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="text-center p-3 border rounded-lg">
                          <p className="text-2xl font-bold">{activeProfile.total_units}</p>
                          <p className="text-xs text-muted-foreground">Unidades</p>
                        </div>
                        <div className="text-center p-3 border rounded-lg">
                          <p className="text-2xl font-bold">{activeProfile.avg_confidence?.toFixed(1)}</p>
                          <p className="text-xs text-muted-foreground">Confiança</p>
                        </div>
                        <div className="text-center p-3 border rounded-lg">
                          <p className="text-2xl font-bold">{((activeProfile.viewer_directed_rate || 0) * 100).toFixed(0)}%</p>
                          <p className="text-xs text-muted-foreground">Viewer Dir.</p>
                        </div>
                        <div className="text-center p-3 border rounded-lg">
                          <p className="text-2xl font-bold">{((activeProfile.avg_replicability || 0) * 100).toFixed(0)}%</p>
                          <p className="text-xs text-muted-foreground">Replicabilidade</p>
                        </div>
                      </div>

                      {/* Emotions */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card className="border">
                          <CardContent className="pt-4">
                            <h4 className="font-semibold mb-2 text-sm">Emoções</h4>
                            <p className="text-sm"><span className="text-muted-foreground">Principal:</span> <strong>{activeProfile.primary_emotion || "—"}</strong></p>
                            <p className="text-sm"><span className="text-muted-foreground">Secundária:</span> {activeProfile.secondary_emotion || "—"}</p>
                            <p className="text-sm"><span className="text-muted-foreground">Intensidade:</span> <span className="font-mono">{activeProfile.avg_emotional_intensity?.toFixed(1)}</span></p>
                            {activeProfile.emotion_distribution && Object.keys(activeProfile.emotion_distribution as object).length > 0 && (
                              <div className="mt-2 space-y-1">
                                {Object.entries(activeProfile.emotion_distribution as Record<string, number>)
                                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                                  .slice(0, 5)
                                  .map(([emotion, count]) => (
                                    <div key={emotion} className="flex justify-between text-xs">
                                      <span>{emotion}</span>
                                      <Badge variant="secondary">{count as number}x</Badge>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <Card className="border">
                          <CardContent className="pt-4">
                            <h4 className="font-semibold mb-2 text-sm">Histograma de Intensidade</h4>
                            {activeProfile.intensity_histogram && (activeProfile.intensity_histogram as any[]).length > 0 ? (
                              <ResponsiveContainer width="100%" height={150}>
                                <BarChart data={activeProfile.intensity_histogram as any[]}>
                                  <XAxis dataKey="range" fontSize={10} />
                                  <YAxis fontSize={10} />
                                  <Tooltip />
                                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            ) : (
                              <p className="text-xs text-muted-foreground">Sem dados</p>
                            )}
                          </CardContent>
                        </Card>
                      </div>

                      {/* Top Patterns */}
                      {activeProfile.top_verbal_patterns && (activeProfile.top_verbal_patterns as any[]).length > 0 && (
                        <Card className="border">
                          <CardContent className="pt-4">
                            <h4 className="font-semibold mb-2 text-sm">Padrões Verbais Recorrentes</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              {(activeProfile.top_verbal_patterns as any[]).slice(0, 12).map((p: any, i: number) => (
                                <div key={i} className="flex justify-between items-center text-sm border rounded p-2">
                                  <span className="font-mono text-xs">"{p.pattern}"</span>
                                  <Badge variant="secondary" className="ml-2 shrink-0">{p.count}x</Badge>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Top Units */}
                      {activeProfile.top_units && (activeProfile.top_units as any[]).length > 0 && (
                        <Card className="border">
                          <CardContent className="pt-4">
                            <h4 className="font-semibold mb-3 text-sm">Top Unidades — {activeFunction}</h4>
                            <div className="space-y-2">
                              {(activeProfile.top_units as any[]).map((u: any, i: number) => (
                                <div key={i} className="border rounded-lg p-3">
                                  <div className="flex items-start gap-2">
                                    <span className="font-bold text-muted-foreground text-sm">#{i + 1}</span>
                                    <div className="flex-1">
                                      <p className="text-sm font-medium">"{u.text}"</p>
                                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                                        <span>Replicabilidade: <strong className="text-foreground">{u.narrative_replicability_score?.toFixed(2)}</strong></span>
                                        <span>Conf: {u.confidence}</span>
                                        {u.emotion && <span>Emoção: {u.emotion}</span>}
                                        {u.viewer_directed && <Eye className="h-3 w-3 text-blue-500 inline" />}
                                        {u.video_title && <span>{u.video_title?.slice(0, 30)}</span>}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      Sem perfil para {activeFunction}. Execute "Analisar Sequências" primeiro.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 7. Canonical Table */}
          <TabsContent value="table">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  Tabela Canônica — Base Final
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  {["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "TRANSITION", "ACTION"].map(fn => (
                    <Button
                      key={fn}
                      size="sm"
                      variant={activeFunction === fn ? "default" : "outline"}
                      onClick={() => setActiveFunction(fn)}
                    >
                      {fn}
                    </Button>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Texto</TableHead>
                        <TableHead>Emoção</TableHead>
                        <TableHead>Conf.</TableHead>
                        <TableHead>Rep.</TableHead>
                        <TableHead>VD</TableHead>
                        <TableHead>Força</TableHead>
                        <TableHead>Vídeo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(topUnits || []).map((u: any) => (
                        <TableRow key={u.id}>
                          <TableCell className="max-w-[300px] truncate text-sm">{u.candidate_text}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{u.emotional_intent || "—"}</Badge></TableCell>
                          <TableCell className="font-mono text-sm">{u.confidence_score}</TableCell>
                          <TableCell>{u.replicable_for_dna ? <Eye className="h-4 w-4 text-green-500" /> : "—"}</TableCell>
                          <TableCell>{u.viewer_directed ? <Eye className="h-4 w-4 text-blue-500" /> : "—"}</TableCell>
                          <TableCell className="font-mono font-bold text-sm">{u.narrative_replicability_score?.toFixed(2)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{u.video_title || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
