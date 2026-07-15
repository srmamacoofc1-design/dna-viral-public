import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AlertTriangle, CheckCircle, Search, Filter } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FUNCTION_COLORS: Record<string, string> = {
  HOOK: "text-chart-1",
  SETUP: "text-chart-2",
  BUILD: "text-chart-3",
  MICRO_PEAK: "text-chart-4",
  TWIST: "text-chart-5",
  PAYOFF: "text-green-400",
  CTA: "text-yellow-400",
  TRANSITION: "text-muted-foreground",
};

export default function CTAAuditPage() {
  const [filterFn, setFilterFn] = useState("all");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["narrative-dedup-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("audit-cta-dedup", {
        body: {},
      });
      if (error) throw error;
      return data;
    },
    enabled: false,
  });

  const summary = data?.summary;
  const perFunction = data?.per_function as Record<string, { raw: number; unique: number; duplicates: number }> | undefined;

  const filteredGroups = filterFn === "all"
    ? data?.collapsed_groups
    : data?.collapsed_groups?.filter((g: any) => g.narrative_function === filterFn);

  const functionEntries = perFunction
    ? Object.entries(perFunction).filter(([, v]) => v.raw > 0).sort((a, b) => b[1].duplicates - a[1].duplicates)
    : [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">🔍 Auditoria Narrativa — Deduplicação Global</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Detecta fragmentos e duplicatas em TODAS as funções narrativas
            </p>
          </div>
          <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            Executar Auditoria
          </Button>
        </div>

        {isLoading || isFetching ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
              <p className="text-muted-foreground">Analisando unidades narrativas...</p>
            </CardContent>
          </Card>
        ) : !data ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Search className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">
                Clique em "Executar Auditoria" para analisar duplicações narrativas
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Global Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4 pb-4 text-center">
                  <div className="text-2xl font-bold">{summary?.total_raw_units}</div>
                  <div className="text-xs text-muted-foreground">Unidades Brutas</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4 text-center">
                  <div className="text-2xl font-bold text-green-400">{summary?.total_unique_units}</div>
                  <div className="text-xs text-muted-foreground">Unidades Canônicas</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4 text-center">
                  <div className="text-2xl font-bold text-red-400">{summary?.total_duplicates_removed}</div>
                  <div className="text-xs text-muted-foreground">Duplicatas Removidas</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4 text-center">
                  <div className="text-2xl font-bold text-yellow-400">{summary?.dedup_ratio}</div>
                  <div className="text-xs text-muted-foreground">Taxa Duplicação</div>
                </CardContent>
              </Card>
            </div>

            {/* Per-Function Breakdown */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Deduplicação por Função Narrativa</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Função</TableHead>
                        <TableHead className="text-xs text-right">Brutas</TableHead>
                        <TableHead className="text-xs text-right">Canônicas</TableHead>
                        <TableHead className="text-xs text-right">Duplicatas</TableHead>
                        <TableHead className="text-xs text-right">Taxa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {functionEntries.map(([fn, stats]) => (
                        <TableRow key={fn}>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${FUNCTION_COLORS[fn] || ""}`}>
                              {fn}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right">{stats.raw}</TableCell>
                          <TableCell className="text-xs text-right text-green-400">{stats.unique}</TableCell>
                          <TableCell className="text-xs text-right text-red-400">{stats.duplicates}</TableCell>
                          <TableCell className="text-xs text-right text-yellow-400">
                            {stats.raw > 0 ? `${Math.round((stats.duplicates / stats.raw) * 100)}%` : "0%"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Sources */}
            <Card>
              <CardContent className="pt-4 flex flex-wrap gap-2 text-xs">
                <span className="text-muted-foreground">Fontes:</span>
                {summary?.sources_analyzed?.map((s: string) => (
                  <Badge key={s} variant="secondary">{s}</Badge>
                ))}
              </CardContent>
            </Card>

            {/* Filter + Collapsed Groups */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-400" />
                    Grupos Colapsados ({data?.total_groups})
                  </CardTitle>
                  <Select value={filterFn} onValueChange={setFilterFn}>
                    <SelectTrigger className="w-40">
                      <Filter className="w-3 h-3 mr-1" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas Funções</SelectItem>
                      {["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "TRANSITION"].map(fn => (
                        <SelectItem key={fn} value={fn}>{fn}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {(!filteredGroups || filteredGroups.length === 0) ? (
                  <div className="text-center py-6 text-muted-foreground flex items-center justify-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-400" />
                    Nenhuma duplicação detectada {filterFn !== "all" ? `para ${filterFn}` : ""}
                  </div>
                ) : (
                  filteredGroups.map((group: any, i: number) => (
                    <div key={i} className="bg-muted/20 rounded-lg p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">"{group.kept_text}"</p>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className={`text-xs ${FUNCTION_COLORS[group.narrative_function] || ""}`}>
                              {group.narrative_function}
                            </Badge>
                            <Badge variant="outline" className="text-xs">{group.kept_source}</Badge>
                            <Badge variant="secondary" className="text-xs">🎯 {group.kept_intensity}</Badge>
                          </div>
                        </div>
                      </div>

                      <div className="pl-6 space-y-1.5 border-l-2 border-red-500/30 ml-1.5">
                        <p className="text-xs text-red-400 font-medium">
                          ❌ {group.collapsed_fragments.length} fragmento(s) removido(s):
                        </p>
                        {group.collapsed_fragments.map((frag: any, j: number) => (
                          <div key={j} className="text-xs text-muted-foreground flex items-center gap-2">
                            <span className="line-through">"{frag.text}"</span>
                            <Badge variant="outline" className="text-[10px]">{frag.source}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
