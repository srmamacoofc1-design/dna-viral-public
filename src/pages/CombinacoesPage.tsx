import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Loader2, Sparkles, Search, FileDown, ShieldCheck, Zap } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportPageAsPDF } from "@/lib/export-pdf";

export default function CombinacoesPage() {
  const [extracting, setExtracting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterFunction, setFilterFunction] = useState("all");

  // DNA-approved combinations from viral_word_combinations
  const { data: wordCombinations, refetch: refetchCombos } = useQuery({
    queryKey: ["combo_word_combinations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("viral_word_combinations")
        .select("*")
        .order("approval_score", { ascending: false });
      return (data || []) as any[];
    },
  });

  // Cross-video patterns
  const { data: comboPatterns, refetch: refetchPatterns } = useQuery({
    queryKey: ["combo_combination_patterns"],
    queryFn: async () => {
      const { data } = await supabase
        .from("viral_combination_patterns")
        .select("*")
        .order("pattern_score", { ascending: false });
      return data || [];
    },
  });

  // Videos
  const { data: videos } = useQuery({
    queryKey: ["combo_videos_engagement"],
    queryFn: async () => {
      const { data } = await supabase
        .from("videos")
        .select("id, titulo, views, likes, comments, engagement_rate_relative")
        .eq("status", "completed");
      return data || [];
    },
  });

  const totalVideos = videos?.length || 1;

  // ── Derived data ──
  const allCombos = wordCombinations || [];
  const approvedForDna = useMemo(() => allCombos.filter((c: any) => c.approved_for_dna), [allCombos]);
  const discarded = allCombos.length - approvedForDna.length;
  const visualConfirmed = useMemo(() => approvedForDna.filter((c: any) => c.linked_micro_event || c.linked_temporal_signal || c.linked_visual_signal), [approvedForDna]);

  const byFunction = useMemo(() => {
    const counts: Record<string, number> = { HOOK: 0, TWIST: 0, PAYOFF: 0, CTA: 0, BUILD: 0 };
    for (const c of approvedForDna) counts[c.dominant_function] = (counts[c.dominant_function] || 0) + 1;
    return counts;
  }, [approvedForDna]);

  const functionDistData = useMemo(() => 
    Object.entries(byFunction).map(([name, count]) => ({ name, count })).filter(d => d.count > 0).sort((a, b) => b.count - a.count),
    [byFunction]
  );

  const dnaReady = approvedForDna.length > 0;

  // Filtered
  const filteredCombos = useMemo(() => {
    return approvedForDna.filter((c: any) => {
      if (searchTerm && !c.combination_text?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterFunction !== "all" && c.dominant_function !== filterFunction) return false;
      return true;
    });
  }, [approvedForDna, searchTerm, filterFunction]);

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout: extração demorou mais de 65s")), 65000)
      );
      const invoke = supabase.functions.invoke("extract-viral-combinations");
      const { data, error }: any = await Promise.race([invoke, timeout]);
      if (error) throw error;
      toast.success(`Extração: ${data?.stats?.approved_for_dna || 0} aprovadas para DNA de ${data?.stats?.total_extracted || 0} extraídas`);
      await Promise.all([refetchCombos(), refetchPatterns()]);
    } catch (e: any) {
      console.error("extract-viral-combinations failed:", e);
      toast.error(`Erro na extração: ${e.message}`);
    } finally {
      setExtracting(false);
    }
  };

  const handleExportPDF = () => exportPageAsPDF("ViralDNA — Combinações de Impacto");

  const approvalColor = (score: number) => {
    if (score >= 0.8) return "text-green-400";
    if (score >= 0.6) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Combinações de Impacto</h1>
            <p className="text-sm text-muted-foreground">
              Frases funcionais extraídas de zonas narrativas quentes — {totalVideos} vídeos
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleExtract} disabled={extracting}>
              {extracting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {extracting ? "Extraindo..." : "Extrair & Cruzar"}
            </Button>
            <Button variant="outline" onClick={handleExportPDF}>
              <FileDown className="w-4 h-4 mr-2" />PDF
            </Button>
          </div>
        </div>

        {/* DNA Ready Badge */}
        <Card className={dnaReady ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"}>
          <CardContent className="pt-4 flex items-center gap-3">
            <ShieldCheck className={`w-6 h-6 ${dnaReady ? "text-green-400" : "text-yellow-400"}`} />
            <div>
              <p className="text-sm font-bold">COMBINATION_DNA_READY = {dnaReady ? "TRUE ✅" : "FALSE ⚠️"}</p>
              <p className="text-xs text-muted-foreground">
                {approvedForDna.length} aprovadas | {discarded} descartadas | {visualConfirmed.length} com confirmação visual/temporal
              </p>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{allCombos.length}</p>
            <p className="text-xs text-muted-foreground">Total Extraídas</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-red-400">{discarded}</p>
            <p className="text-xs text-muted-foreground">Descartadas</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-400">{approvedForDna.length}</p>
            <p className="text-xs text-muted-foreground">DNA Aprovadas</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-chart-2">{visualConfirmed.length}</p>
            <p className="text-xs text-muted-foreground">Visual Confirmadas</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-chart-3">{byFunction.HOOK}</p>
            <p className="text-xs text-muted-foreground">HOOK</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-chart-4">{byFunction.CTA}</p>
            <p className="text-xs text-muted-foreground">CTA</p>
          </CardContent></Card>
        </div>

        {/* Zone breakdown */}
        <div className="grid grid-cols-5 gap-2">
          {["HOOK", "TWIST", "PAYOFF", "CTA", "BUILD"].map(zone => (
            <Card key={zone}><CardContent className="pt-3 text-center">
              <p className="text-lg font-bold">{byFunction[zone] || 0}</p>
              <p className="text-[10px] text-muted-foreground">{zone}</p>
            </CardContent></Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Buscar combinação..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
              <Select value={filterFunction} onValueChange={setFilterFunction}>
                <SelectTrigger className="w-full md:w-40"><SelectValue placeholder="Função" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Funções</SelectItem>
                  <SelectItem value="HOOK">HOOK</SelectItem>
                  <SelectItem value="TWIST">TWIST</SelectItem>
                  <SelectItem value="PAYOFF">PAYOFF</SelectItem>
                  <SelectItem value="CTA">CTA</SelectItem>
                  <SelectItem value="BUILD">BUILD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="dna-approved" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="dna-approved">✅ DNA Aprovadas ({approvedForDna.length})</TabsTrigger>
            <TabsTrigger value="all-extracted">📋 Todas ({allCombos.length})</TabsTrigger>
            <TabsTrigger value="cross-patterns">🔗 Padrões Cross ({comboPatterns?.length || 0})</TabsTrigger>
            <TabsTrigger value="distribution">📊 Distribuição</TabsTrigger>
          </TabsList>

          {/* TAB: DNA Approved */}
          <TabsContent value="dna-approved">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-green-400" />
                  Combinações Aprovadas para DNA — approval ≥0.60 + semantic ≥0.60 + emotional ≥0.50
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">#</TableHead>
                        <TableHead className="text-xs">Combinação</TableHead>
                        <TableHead className="text-xs">Função</TableHead>
                        <TableHead className="text-xs">Emoção</TableHead>
                        <TableHead className="text-xs">Approval</TableHead>
                        <TableHead className="text-xs">Semantic</TableHead>
                        <TableHead className="text-xs">Emotional</TableHead>
                        <TableHead className="text-xs">Sinais</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCombos.slice(0, 80).map((c: any, i: number) => (
                        <TableRow key={c.id || i}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="text-xs font-medium max-w-[200px] truncate">"{c.combination_text}"</TableCell>
                          <TableCell>
                            <Badge variant={functionVariant(c.dominant_function)} className="text-[10px]">{c.dominant_function}</Badge>
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">{c.emotional_intent}</TableCell>
                          <TableCell className={`text-xs font-bold ${approvalColor(Number(c.approval_score))}`}>
                            {Number(c.approval_score || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-xs">{Number(c.semantic_coherence_score || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-xs">{Number(c.emotional_score || 0).toFixed(2)}</TableCell>
                          <TableCell>
                            <div className="flex gap-0.5">
                              {c.linked_micro_event && <Zap className="w-3 h-3 text-yellow-400" />}
                              {c.linked_temporal_signal && <Zap className="w-3 h-3 text-blue-400" />}
                              {c.linked_visual_signal && <Zap className="w-3 h-3 text-green-400" />}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredCombos.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                            Clique em "Extrair & Cruzar" para iniciar a análise de combinações de impacto
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: All Extracted */}
          <TabsContent value="all-extracted">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Todas as Combinações Extraídas (incluindo descartadas)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">#</TableHead>
                        <TableHead className="text-xs">Combinação</TableHead>
                        <TableHead className="text-xs">Função</TableHead>
                        <TableHead className="text-xs">Approval</TableHead>
                        <TableHead className="text-xs">DNA?</TableHead>
                        <TableHead className="text-xs">Emoção</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allCombos.slice(0, 100).map((c: any, i: number) => (
                        <TableRow key={c.id || i} className={c.approved_for_dna ? "" : "opacity-50"}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="text-xs font-medium max-w-[200px] truncate">{c.combination_text}</TableCell>
                          <TableCell>
                            <Badge variant={functionVariant(c.dominant_function)} className="text-[10px]">{c.dominant_function}</Badge>
                          </TableCell>
                          <TableCell className={`text-xs font-bold ${approvalColor(Number(c.approval_score))}`}>
                            {Number(c.approval_score || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {c.approved_for_dna ? <Badge className="bg-green-600 text-[10px]">✓ DNA</Badge> : <Badge variant="outline" className="text-[10px]">✗</Badge>}
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">{c.emotional_intent}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Cross-Video Patterns */}
          <TabsContent value="cross-patterns">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Padrões Cross-Video Consolidados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">#</TableHead>
                        <TableHead className="text-xs">Combinação</TableHead>
                        <TableHead className="text-xs">Função</TableHead>
                        <TableHead className="text-xs">Vídeos</TableHead>
                        <TableHead className="text-xs">Score</TableHead>
                        <TableHead className="text-xs">Emoção</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(comboPatterns || []).slice(0, 60).map((c: any, i: number) => (
                        <TableRow key={c.id || i}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="text-xs font-medium max-w-[200px] truncate">"{c.combination_text}"</TableCell>
                          <TableCell>
                            <Badge variant={functionVariant(c.dominant_function)} className="text-[10px]">{c.dominant_function}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{c.videos_count}</TableCell>
                          <TableCell className="text-xs font-bold">{Number(c.pattern_score || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">{c.emotional_intent}</TableCell>
                        </TableRow>
                      ))}
                      {(!comboPatterns || comboPatterns.length === 0) && (
                        <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Sem padrões cross-video</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Distribution */}
          <TabsContent value="distribution">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Aprovadas por Zona Narrativa</CardTitle></CardHeader>
                <CardContent>
                  {functionDistData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={functionDistData}>
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Resumo da Extração</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
                      <span className="text-sm">Total Extraídas</span>
                      <Badge variant="outline">{allCombos.length}</Badge>
                    </div>
                    <div className="flex justify-between items-center p-3 rounded-lg bg-red-500/10">
                      <span className="text-sm">Descartadas</span>
                      <Badge variant="destructive">{discarded}</Badge>
                    </div>
                    <div className="flex justify-between items-center p-3 rounded-lg bg-green-500/10">
                      <span className="text-sm font-bold">Aprovadas DNA</span>
                      <Badge className="bg-green-600">{approvedForDna.length}</Badge>
                    </div>
                    <div className="flex justify-between items-center p-3 rounded-lg bg-blue-500/10">
                      <span className="text-sm">Com Confirmação Visual/Temporal</span>
                      <Badge variant="secondary">{visualConfirmed.length}</Badge>
                    </div>
                    <div className="border-t border-border pt-3">
                      <div className="grid grid-cols-5 gap-2 text-center">
                        {["HOOK", "TWIST", "PAYOFF", "CTA", "BUILD"].map(z => (
                          <div key={z}>
                            <p className="text-lg font-bold">{byFunction[z] || 0}</p>
                            <p className="text-[10px] text-muted-foreground">{z}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function functionVariant(fn: string): "default" | "secondary" | "destructive" | "outline" {
  switch (fn) {
    case "HOOK": return "destructive";
    case "CTA": return "default";
    case "PAYOFF": return "secondary";
    default: return "outline";
  }
}
