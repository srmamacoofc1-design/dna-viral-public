import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Loader2, Play, FileDown, Layers, Timer, Heart, MessageSquare, Eye, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function PatternLibraryPage() {
  const [detecting, setDetecting] = useState(false);
  const [extractingCombos, setExtractingCombos] = useState(false);

  const { data: seqPatterns, isLoading: loadingSeq, refetch: refetchSeq } = useQuery({
    queryKey: ["viral_sequence_patterns"],
    queryFn: async () => {
      const { data } = await supabase.from("viral_sequence_patterns").select("*").order("pattern_score", { ascending: false }).limit(20);
      return data || [];
    },
  });

  const { data: timingPatterns, isLoading: loadingTiming, refetch: refetchTiming } = useQuery({
    queryKey: ["viral_timing_patterns"],
    queryFn: async () => {
      const { data } = await supabase.from("viral_timing_patterns").select("*").order("pattern_score", { ascending: false }).limit(20);
      return data || [];
    },
  });

  const { data: emotionalPatterns, isLoading: loadingEmo, refetch: refetchEmo } = useQuery({
    queryKey: ["viral_emotional_patterns"],
    queryFn: async () => {
      const { data } = await supabase.from("viral_emotional_patterns").select("*").order("pattern_score", { ascending: false }).limit(20);
      return data || [];
    },
  });

  const { data: verbalPatterns, isLoading: loadingVerbal, refetch: refetchVerbal } = useQuery({
    queryKey: ["viral_verbal_patterns"],
    queryFn: async () => {
      const { data } = await supabase.from("viral_verbal_patterns").select("*").order("pattern_score", { ascending: false }).limit(100);
      return data || [];
    },
  });

  const { data: visualPatterns, isLoading: loadingVisual, refetch: refetchVisual } = useQuery({
    queryKey: ["viral_visual_patterns"],
    queryFn: async () => {
      const { data } = await supabase.from("viral_visual_patterns").select("*").order("pattern_score", { ascending: false }).limit(20);
      return data || [];
    },
  });

  const { data: comboPatterns, isLoading: loadingCombos, refetch: refetchCombos } = useQuery({
    queryKey: ["viral_combination_patterns"],
    queryFn: async () => {
      const { data } = await supabase.from("viral_combination_patterns").select("*").order("pattern_score", { ascending: false }).limit(100);
      return data || [];
    },
  });

  const isLoading = loadingSeq || loadingTiming || loadingEmo || loadingVerbal || loadingVisual || loadingCombos;

  const totalPatterns = (seqPatterns?.length || 0) + (timingPatterns?.length || 0) + (emotionalPatterns?.length || 0) + (verbalPatterns?.length || 0) + (visualPatterns?.length || 0);

  const allPatterns = [
    ...(seqPatterns?.map(p => ({ ...p, type: "Narrativo", pattern_name: p.sequence_structure })) || []),
    ...(timingPatterns?.map(p => ({ ...p, type: "Temporal", pattern_name: p.timing_signature })) || []),
    ...(emotionalPatterns?.map(p => ({ ...p, type: "Emocional", pattern_name: p.emotional_sequence })) || []),
    ...(verbalPatterns?.map(p => ({ ...p, type: "Verbal", pattern_name: p.phrase_structure })) || []),
    ...(visualPatterns?.map(p => ({ ...p, type: "Visual", pattern_name: p.visual_signature })) || []),
  ].sort((a, b) => Number(b.pattern_score) - Number(a.pattern_score)).slice(0, 20);

  const typeDist = [
    { name: "Narrativo", value: seqPatterns?.length || 0 },
    { name: "Temporal", value: timingPatterns?.length || 0 },
    { name: "Emocional", value: emotionalPatterns?.length || 0 },
    { name: "Verbal", value: verbalPatterns?.length || 0 },
    { name: "Visual", value: visualPatterns?.length || 0 },
  ].filter(d => d.value > 0);

  // Verbal category breakdown
  const verbalByCategory = (verbalPatterns || []).reduce((acc, p) => {
    const cat = (p as any).pattern_category || "outro";
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Exclusive classification: each pattern has exactly ONE verbal_function
  const hookPatterns = (verbalPatterns || []).filter((p: any) => p.verbal_function === "HOOK");
  const payoffPatterns = (verbalPatterns || []).filter((p: any) => p.verbal_function === "PAYOFF");
  const ctaPatterns = (verbalPatterns || []).filter((p: any) => p.verbal_function === "CTA");
  const setupPatterns = (verbalPatterns || []).filter((p: any) => p.verbal_function === "SETUP");
  const buildPatterns = (verbalPatterns || []).filter((p: any) => p.verbal_function === "BUILD");
  const twistPatterns = (verbalPatterns || []).filter((p: any) => p.verbal_function === "TWIST");
  const wordCombos = (verbalPatterns || []).filter((p: any) => p.pattern_category === "word_combination");

  // Narrative function distribution
  const narrativeFuncDist = [
    { name: "HOOK", value: hookPatterns.length },
    { name: "SETUP", value: setupPatterns.length },
    { name: "BUILD", value: buildPatterns.length },
    { name: "TWIST", value: twistPatterns.length },
    { name: "PAYOFF", value: payoffPatterns.length },
    { name: "CTA", value: ctaPatterns.length },
  ].filter(d => d.value > 0);

  const verbalCatDist = Object.entries(verbalByCategory).map(([name, value]) => ({ name: categoryLabel(name), value })).filter(d => d.value > 0);

  const avgVerbalScore = verbalPatterns && verbalPatterns.length > 0
    ? verbalPatterns.reduce((sum, p) => sum + Number(p.pattern_score), 0) / verbalPatterns.length
    : 0;

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("detect-cross-patterns");
      if (error) throw error;
      toast.success(`Detecção concluída: ${data.total_patterns} padrões encontrados`);
      refetchSeq(); refetchTiming(); refetchEmo(); refetchVerbal(); refetchVisual();
    } catch (e: any) {
      toast.error("Erro na detecção: " + e.message);
    } finally {
      setDetecting(false);
    }
  };

  const handleExtractCombos = async () => {
    setExtractingCombos(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-viral-combinations");
      if (error) throw error;
      toast.success(`Combinações extraídas: ${data.cross_video_patterns} padrões cross-video`);
      refetchCombos();
    } catch (e: any) {
      toast.error("Erro na extração: " + e.message);
    } finally {
      setExtractingCombos(false);
    }
  };

  const handleExportPDF = () => {
    toast.info("Use Ctrl+P para exportar em PDF");
    window.print();
  };

  const scoreColor = (score: number) => {
    if (score >= 0.7) return "text-green-400";
    if (score >= 0.4) return "text-yellow-400";
    return "text-muted-foreground";
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Biblioteca de Padrões Virais</h1>
            <p className="text-sm text-muted-foreground">Cross-Video Pattern Library — Etapa 3</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleDetect} disabled={detecting} variant="default">
              {detecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              {detecting ? "Detectando..." : "Detectar Padrões"}
            </Button>
            <Button onClick={handleExtractCombos} disabled={extractingCombos} variant="secondary">
              {extractingCombos ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {extractingCombos ? "Extraindo..." : "Extrair Combinações"}
            </Button>
            <Button variant="outline" onClick={handleExportPDF}>
              <FileDown className="w-4 h-4 mr-2" />PDF
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-primary">{totalPatterns}</p>
            <p className="text-xs text-muted-foreground">Total Padrões</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <Layers className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{seqPatterns?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Narrativos</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <Timer className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{timingPatterns?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Temporais</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <Heart className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{emotionalPatterns?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Emocionais</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <MessageSquare className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{verbalPatterns?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Verbais</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <Eye className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{visualPatterns?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Visuais</p>
          </CardContent></Card>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* Top 20 Global */}
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Top 20 Padrões Globais</CardTitle></CardHeader>
                <CardContent>
                  {allPatterns.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Nenhum padrão detectado. Clique em "Detectar Padrões".</p>
                  ) : (
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Vídeos</TableHead>
                            <TableHead>Score</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allPatterns.map((p, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                              <TableCell><Badge variant="outline" className="text-xs">{p.type}</Badge></TableCell>
                              <TableCell>{p.videos_count}</TableCell>
                              <TableCell className={`font-mono font-bold ${scoreColor(Number(p.pattern_score))}`}>
                                {Number(p.pattern_score).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Distribuição por Tipo</CardTitle></CardHeader>
                <CardContent>
                  {typeDist.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie data={typeDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, value }) => `${name}: ${value}`}>
                          {typeDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Tabs by type */}
            <Tabs defaultValue="verbal" className="space-y-4">
              <TabsList className="flex flex-wrap h-auto gap-1">
                <TabsTrigger value="narrative">Narrativos ({seqPatterns?.length || 0})</TabsTrigger>
                <TabsTrigger value="timing">Temporais ({timingPatterns?.length || 0})</TabsTrigger>
                <TabsTrigger value="emotional">Emocionais ({emotionalPatterns?.length || 0})</TabsTrigger>
                <TabsTrigger value="verbal">Verbais ({verbalPatterns?.length || 0})</TabsTrigger>
                <TabsTrigger value="visual">Visuais ({visualPatterns?.length || 0})</TabsTrigger>
                <TabsTrigger value="combos">🧬 Combinações ({comboPatterns?.length || 0})</TabsTrigger>
              </TabsList>

              <TabsContent value="narrative">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Padrões Narrativos (Sequências Recorrentes)</CardTitle></CardHeader>
                  <CardContent>
                    <PatternTable
                      data={(seqPatterns || []).map(p => ({
                        name: p.sequence_structure,
                        detail: p.sequence_emotion_flow || "",
                        videos: p.videos_count,
                        occurrences: p.occurrence_count,
                        score: Number(p.pattern_score),
                      }))}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="timing">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Padrões Temporais (Ritmo e Aceleração)</CardTitle></CardHeader>
                  <CardContent>
                    <PatternTable
                      data={(timingPatterns || []).map(p => ({
                        name: p.timing_signature,
                        detail: `Densidade: ${Number(p.avg_cut_density).toFixed(2)} | Pausa: ${Number(p.avg_pause_duration).toFixed(1)}s`,
                        videos: p.videos_count,
                        occurrences: p.videos_count,
                        score: Number(p.pattern_score),
                      }))}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="emotional">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Padrões Emocionais (Arcos Recorrentes)</CardTitle></CardHeader>
                  <CardContent>
                    <PatternTable
                      data={(emotionalPatterns || []).map(p => ({
                        name: p.emotional_sequence,
                        detail: `Intensidade: ${Number(p.avg_intensity).toFixed(1)}`,
                        videos: p.videos_count,
                        occurrences: p.videos_count,
                        score: Number(p.pattern_score),
                      }))}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="verbal">
                <div className="space-y-6">
                  {/* Verbal Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-lg font-bold text-primary">{verbalPatterns?.length || 0}</p>
                      <p className="text-xs text-muted-foreground">Total Verbais</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-lg font-bold">{avgVerbalScore.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">Score Médio</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-lg font-bold">{wordCombos.length}</p>
                      <p className="text-xs text-muted-foreground">Combinações</p>
                    </CardContent></Card>
                    <Card><CardContent className="pt-4 text-center">
                      <p className="text-lg font-bold">{Object.keys(verbalByCategory).length}</p>
                      <p className="text-xs text-muted-foreground">Categorias</p>
                    </CardContent></Card>
                  </div>

                  {/* Narrative Function KPI row */}
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    <Card className="border-yellow-500/30"><CardContent className="pt-3 text-center">
                      <p className="text-sm font-bold text-yellow-400">{hookPatterns.length}</p>
                      <p className="text-[10px] text-muted-foreground">🎣 HOOK</p>
                    </CardContent></Card>
                    <Card className="border-blue-500/30"><CardContent className="pt-3 text-center">
                      <p className="text-sm font-bold text-blue-400">{setupPatterns.length}</p>
                      <p className="text-[10px] text-muted-foreground">📋 SETUP</p>
                    </CardContent></Card>
                    <Card className="border-orange-500/30"><CardContent className="pt-3 text-center">
                      <p className="text-sm font-bold text-orange-400">{buildPatterns.length}</p>
                      <p className="text-[10px] text-muted-foreground">📈 BUILD</p>
                    </CardContent></Card>
                    <Card className="border-purple-500/30"><CardContent className="pt-3 text-center">
                      <p className="text-sm font-bold text-purple-400">{twistPatterns.length}</p>
                      <p className="text-[10px] text-muted-foreground">🔀 TWIST</p>
                    </CardContent></Card>
                    <Card className="border-green-500/30"><CardContent className="pt-3 text-center">
                      <p className="text-sm font-bold text-green-400">{payoffPatterns.length}</p>
                      <p className="text-[10px] text-muted-foreground">🎯 PAYOFF</p>
                    </CardContent></Card>
                    <Card className="border-red-500/30"><CardContent className="pt-3 text-center">
                      <p className="text-sm font-bold text-red-400">{ctaPatterns.length}</p>
                      <p className="text-[10px] text-muted-foreground">📢 CTA</p>
                    </CardContent></Card>
                  </div>

                  {/* Narrative Function Distribution Chart */}
                  <div className="grid md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Distribuição por Função Narrativa</CardTitle></CardHeader>
                      <CardContent>
                        {narrativeFuncDist.length > 0 ? (
                          <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={narrativeFuncDist}>
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis />
                              <Tooltip />
                              <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : <p className="text-sm text-muted-foreground text-center py-4">Sem dados</p>}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle className="text-sm">Categorias Verbais</CardTitle></CardHeader>
                      <CardContent>
                        {verbalCatDist.length > 0 ? (
                          <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={verbalCatDist}>
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis />
                              <Tooltip />
                              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : <p className="text-sm text-muted-foreground text-center py-4">Sem dados</p>}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Word Combos */}
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Combinações de Palavras ({wordCombos.length})</CardTitle></CardHeader>
                    <CardContent>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {wordCombos.slice(0, 15).map((p, i) => (
                          <div key={i} className="flex items-center justify-between text-sm border-b border-border pb-1">
                             <span className="font-medium truncate max-w-[60%]" title={p.phrase_structure}>
                               {p.phrase_structure.replace("combo:", "").replace("bigram:", "").replace("strong:", "")}
                             </span>
                            <div className="flex gap-2 items-center">
                              <Badge variant="outline" className="text-xs">{p.videos_count}v</Badge>
                              <span className={`font-mono text-xs font-bold ${scoreColor(Number(p.pattern_score))}`}>
                                {Number(p.pattern_score).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                        {wordCombos.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sem combinações</p>}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Hook, Payoff, CTA verbal sections */}
                  <div className="grid md:grid-cols-3 gap-4">
                    <Card>
                      <CardHeader><CardTitle className="text-sm">🎣 Hook Verbal ({hookPatterns.length})</CardTitle></CardHeader>
                      <CardContent>
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {hookPatterns.slice(0, 10).map((p, i) => (
                            <div key={i} className="text-sm border-b border-border pb-1">
                              <div className="flex justify-between">
                                <span className="font-medium truncate max-w-[65%]" title={p.phrase_structure}>
                                  {cleanLabel(p.phrase_structure)}
                                </span>
                                <Badge variant="outline" className="text-xs">{p.videos_count}v</Badge>
                              </div>
                              {(p as any).sample_phrases?.length > 0 && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5" title={(p as any).sample_phrases[0]}>
                                  "{(p as any).sample_phrases[0]}"
                                </p>
                              )}
                            </div>
                          ))}
                          {hookPatterns.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Sem padrões</p>}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle className="text-sm">🎯 Payoff Verbal ({payoffPatterns.length})</CardTitle></CardHeader>
                      <CardContent>
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {payoffPatterns.slice(0, 10).map((p, i) => (
                            <div key={i} className="text-sm border-b border-border pb-1">
                              <div className="flex justify-between">
                                <span className="font-medium truncate max-w-[65%]" title={p.phrase_structure}>
                                  {cleanLabel(p.phrase_structure)}
                                </span>
                                <Badge variant="outline" className="text-xs">{p.videos_count}v</Badge>
                              </div>
                              {(p as any).sample_phrases?.length > 0 && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5" title={(p as any).sample_phrases[0]}>
                                  "{(p as any).sample_phrases[0]}"
                                </p>
                              )}
                            </div>
                          ))}
                          {payoffPatterns.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Sem padrões</p>}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle className="text-sm">📢 CTA Verbal ({ctaPatterns.length})</CardTitle></CardHeader>
                      <CardContent>
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {ctaPatterns.slice(0, 10).map((p, i) => (
                            <div key={i} className="text-sm border-b border-border pb-1">
                              <div className="flex justify-between">
                                <span className="font-medium truncate max-w-[65%]" title={p.phrase_structure}>
                                  {cleanLabel(p.phrase_structure)}
                                </span>
                                <Badge variant="outline" className="text-xs">{p.videos_count}v</Badge>
                              </div>
                              {(p as any).sample_phrases?.length > 0 && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5" title={(p as any).sample_phrases[0]}>
                                  "{(p as any).sample_phrases[0]}"
                                </p>
                              )}
                            </div>
                          ))}
                          {ctaPatterns.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Sem padrões</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Full verbal patterns table */}
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Todos os Padrões Verbais</CardTitle></CardHeader>
                    <CardContent>
                      <VerbalPatternTable data={verbalPatterns || []} />
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="visual">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Padrões Visuais (Ações e Emoções)</CardTitle></CardHeader>
                  <CardContent>
                    <PatternTable
                      data={(visualPatterns || []).map(p => ({
                        name: p.visual_signature,
                        detail: `Transição: ${p.frame_transition_pattern || "N/A"} | Alinhamento: ${p.alignment_type || "N/A"}`,
                        videos: p.videos_count,
                        occurrences: p.videos_count,
                        score: Number(p.pattern_score),
                      }))}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="combos">
                <div className="space-y-6">
                  {/* Combo KPIs */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    {["HOOK", "SETUP", "BUILD", "TWIST", "PAYOFF", "CTA"].map(func => {
                      const count = (comboPatterns || []).filter((p: any) => p.dominant_function === func).length;
                      const icons: Record<string, string> = { HOOK: "🎣", SETUP: "📋", BUILD: "📈", TWIST: "🔀", PAYOFF: "🎯", CTA: "📢" };
                      return (
                        <Card key={func}><CardContent className="pt-3 text-center">
                          <p className="text-sm font-bold">{count}</p>
                          <p className="text-[10px] text-muted-foreground">{icons[func]} {func}</p>
                        </CardContent></Card>
                      );
                    })}
                  </div>

                  {/* Combo Distribution Chart */}
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Distribuição por Função Narrativa</CardTitle></CardHeader>
                    <CardContent>
                      {(comboPatterns?.length || 0) > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={["HOOK", "SETUP", "BUILD", "TWIST", "PAYOFF", "CTA"].map(f => ({
                            name: f,
                            value: (comboPatterns || []).filter((p: any) => p.dominant_function === f).length,
                          })).filter(d => d.value > 0)}>
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="value" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : <p className="text-sm text-muted-foreground text-center py-4">Clique em "Extrair Combinações" para iniciar</p>}
                    </CardContent>
                  </Card>

                  {/* Full Combinations Table */}
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Todas as Combinações Virais ({comboPatterns?.length || 0})</CardTitle></CardHeader>
                    <CardContent>
                      {(comboPatterns?.length || 0) === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">Nenhuma combinação extraída ainda.</p>
                      ) : (
                        <div className="max-h-[500px] overflow-y-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Combinação</TableHead>
                                <TableHead>Função</TableHead>
                                <TableHead>Intenção</TableHead>
                                <TableHead>Vídeos</TableHead>
                                <TableHead>Ocorr.</TableHead>
                                <TableHead>Conf.</TableHead>
                                <TableHead>Score</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(comboPatterns || []).map((p: any, i: number) => {
                                const funcColor: Record<string, string> = {
                                  HOOK: "bg-yellow-500/20 text-yellow-300",
                                  SETUP: "bg-blue-500/20 text-blue-300",
                                  BUILD: "bg-orange-500/20 text-orange-300",
                                  TWIST: "bg-purple-500/20 text-purple-300",
                                  PAYOFF: "bg-green-500/20 text-green-300",
                                  CTA: "bg-red-500/20 text-red-300",
                                };
                                return (
                                  <TableRow key={i}>
                                    <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                                    <TableCell className="text-xs font-medium max-w-48" title={p.combination_text}>
                                      "{p.combination_text}"
                                    </TableCell>
                                    <TableCell>
                                      <Badge className={`text-[10px] px-1.5 py-0 ${funcColor[p.dominant_function] || "bg-muted text-muted-foreground"}`}>
                                        {p.dominant_function}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs">{p.emotional_intent || "—"}</TableCell>
                                    <TableCell>{p.videos_count}</TableCell>
                                    <TableCell>{p.total_occurrences}</TableCell>
                                    <TableCell className="text-xs">{p.avg_confidence}%</TableCell>
                                    <TableCell className={`font-mono font-bold ${Number(p.pattern_score) >= 0.7 ? "text-green-400" : Number(p.pattern_score) >= 0.4 ? "text-yellow-400" : "text-muted-foreground"}`}>
                                      {Number(p.pattern_score).toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/^(phrasal|tone|bigram|strong|hook|payoff|cta|hook_emotion|cta_tone|cta_implicit|phrase_cat|combo):/, "")
    .trim();
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    phrase_structure: "Estrutura Frasal",
    word_combination: "Combinação Palavras",
    hook_verbal: "Hook Verbal",
    payoff_verbal: "Payoff Verbal",
    cta_verbal: "CTA Verbal",
    tone_pattern: "Tom/Pressão",
    outro: "Outro",
  };
  return map[cat] || cat;
}

function PatternTable({ data }: { data: { name: string; detail: string; videos: number; occurrences: number; score: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">Nenhum padrão encontrado nesta categoria.</p>;

  return (
    <div className="max-h-96 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Padrão</TableHead>
            <TableHead>Detalhe</TableHead>
            <TableHead>Vídeos</TableHead>
            <TableHead>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((p, i) => (
            <TableRow key={i}>
              <TableCell className="font-mono text-xs">{i + 1}</TableCell>
              <TableCell className="text-xs font-medium max-w-48 truncate" title={p.name}>{p.name}</TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-48 truncate" title={p.detail}>{p.detail}</TableCell>
              <TableCell>{p.videos}</TableCell>
              <TableCell className={`font-mono font-bold ${p.score >= 0.7 ? "text-green-400" : p.score >= 0.4 ? "text-yellow-400" : "text-muted-foreground"}`}>
                {p.score.toFixed(2)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VerbalPatternTable({ data }: { data: any[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">Nenhum padrão verbal.</p>;

  const funcColor: Record<string, string> = {
    HOOK: "bg-yellow-500/20 text-yellow-300",
    SETUP: "bg-blue-500/20 text-blue-300",
    BUILD: "bg-orange-500/20 text-orange-300",
    TWIST: "bg-purple-500/20 text-purple-300",
    PAYOFF: "bg-green-500/20 text-green-300",
    CTA: "bg-red-500/20 text-red-300",
  };

  return (
    <div className="max-h-[500px] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Padrão</TableHead>
              <TableHead>Função Dominante</TableHead>
              <TableHead>Intenção</TableHead>
              <TableHead>Categoria</TableHead>
            <TableHead>Vídeos</TableHead>
            <TableHead>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((p, i) => (
            <TableRow key={i}>
              <TableCell className="font-mono text-xs">{i + 1}</TableCell>
              <TableCell className="text-xs font-medium max-w-40 truncate" title={p.phrase_structure}>
                {cleanLabel(p.phrase_structure)}
              </TableCell>
              <TableCell>
                <Badge className={`text-[10px] px-1.5 py-0 ${funcColor[p.verbal_function] || "bg-muted text-muted-foreground"}`}>
                  {p.verbal_function || "—"}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">{p.emotional_intent || "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px]">
                  {categoryLabel(p.pattern_category || "outro")}
                </Badge>
              </TableCell>
              <TableCell>{p.videos_count}</TableCell>
              <TableCell className={`font-mono font-bold ${Number(p.pattern_score) >= 0.7 ? "text-green-400" : Number(p.pattern_score) >= 0.4 ? "text-yellow-400" : "text-muted-foreground"}`}>
                {Number(p.pattern_score).toFixed(2)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
