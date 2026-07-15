import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, CheckCircle, AlertTriangle, XCircle, Loader2, FileDown } from "lucide-react";
import { exportPageAsPDF } from "@/lib/export-pdf";

interface DimensionSummary {
  total_issues: number;
  affected_videos: number;
  pass_rate: number;
  status: string;
}

interface VideoReport {
  video_id: string;
  video_title: string;
  total_blocks: number;
  blocks_with_text: number;
  blocks_with_verbal: number;
  canonical_units: number;
  narrative_functions: number;
  issues_count: number;
  status: string;
}

interface ReadinessReport {
  generated_at: string;
  total_videos: number;
  total_blocks: number;
  total_verbal_analyses: number;
  total_canonical_units: number;
  readiness_score: number;
  validation_status: string;
  ready_videos: number;
  videos_with_issues: number;
  dimension_summary: Record<string, DimensionSummary>;
  detected_issues: number;
  issue_breakdown: any[];
  video_reports: VideoReport[];
}

const dimensionLabels: Record<string, string> = {
  structural: "Estrutural",
  temporal: "Temporal",
  verbal: "Verbal",
  emotional: "Emocional",
  relational: "Relacional",
};

const statusIcon = (status: string) => {
  if (status === "PASS") return <CheckCircle className="w-5 h-5 text-green-500" />;
  if (status === "ACCEPTABLE") return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
  return <XCircle className="w-5 h-5 text-red-500" />;
};

const statusBadge = (status: string) => {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    READY: { label: "Ready", variant: "default" },
    MINOR_ISSUES: { label: "Minor", variant: "secondary" },
    NEEDS_ATTENTION: { label: "Atenção", variant: "destructive" },
    READY_FOR_PHASE_2: { label: "PRONTO P/ FASE 2", variant: "default" },
    ACCEPTABLE_WITH_CAVEATS: { label: "Aceitável", variant: "secondary" },
    NEEDS_REMEDIATION: { label: "Precisa Correção", variant: "destructive" },
  };
  const m = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
};

export default function DataReadinessPage() {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(false);

  const runValidation = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("data-readiness-check");
      if (error) throw error;
      setReport(data);
      toast.success("Validação concluída");
    } catch (e: any) {
      toast.error(e.message || "Erro na validação");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div id="data-readiness-content" className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Data Readiness Validation</h1>
              <p className="text-sm text-muted-foreground">Validação final da Fase 1 — Prontidão para consumo por IA</p>
            </div>
          </div>
          <div className="flex gap-2">
            {report && (
              <Button variant="outline" size="sm" onClick={() => exportPageAsPDF("data-readiness-report")}>
                <FileDown className="w-4 h-4 mr-1" /> PDF
              </Button>
            )}
            <Button onClick={runValidation} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {loading ? "Validando..." : "Executar Validação"}
            </Button>
          </div>
        </div>

        {report && (
          <>
            {/* Score card */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-4xl font-black text-primary">{report.readiness_score}%</div>
                  <p className="text-xs text-muted-foreground mt-1">Readiness Score</p>
                  <div className="mt-2">{statusBadge(report.validation_status)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-3xl font-bold">{report.total_videos}</div>
                  <p className="text-xs text-muted-foreground">Vídeos</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-3xl font-bold">{report.total_blocks}</div>
                  <p className="text-xs text-muted-foreground">Blocos</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-3xl font-bold text-green-500">{report.ready_videos}</div>
                  <p className="text-xs text-muted-foreground">Vídeos Ready</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-3xl font-bold text-yellow-500">{report.detected_issues}</div>
                  <p className="text-xs text-muted-foreground">Issues</p>
                </CardContent>
              </Card>
            </div>

            {/* Dimension summary */}
            <Card>
              <CardHeader><CardTitle className="text-lg">Validação por Dimensão</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dimensão</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Pass Rate</TableHead>
                      <TableHead className="text-center">Issues</TableHead>
                      <TableHead className="text-center">Vídeos Afetados</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(report.dimension_summary).map(([dim, data]) => (
                      <TableRow key={dim}>
                        <TableCell className="font-medium">{dimensionLabels[dim] || dim}</TableCell>
                        <TableCell className="text-center">{statusIcon(data.status)}</TableCell>
                        <TableCell className="text-center font-mono">{data.pass_rate}%</TableCell>
                        <TableCell className="text-center">{data.total_issues}</TableCell>
                        <TableCell className="text-center">{data.affected_videos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Issues */}
            {report.issue_breakdown.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Issues Detectadas</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dimensão</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Detalhe</TableHead>
                        <TableHead>Vídeo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.issue_breakdown.map((issue, i) => (
                        <TableRow key={i}>
                          <TableCell><Badge variant="outline">{dimensionLabels[issue.dimension] || issue.dimension}</Badge></TableCell>
                          <TableCell className="font-mono text-xs">{issue.issue}</TableCell>
                          <TableCell className="text-xs max-w-xs truncate">{issue.detail}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{issue.video_title}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Video reports */}
            <Card>
              <CardHeader><CardTitle className="text-lg">Relatório por Vídeo</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vídeo</TableHead>
                      <TableHead className="text-center">Blocos</TableHead>
                      <TableHead className="text-center">c/ Texto</TableHead>
                      <TableHead className="text-center">c/ Verbal</TableHead>
                      <TableHead className="text-center">Canônicos</TableHead>
                      <TableHead className="text-center">Funções</TableHead>
                      <TableHead className="text-center">Issues</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.video_reports.map((v) => (
                      <TableRow key={v.video_id}>
                        <TableCell className="max-w-[200px] truncate text-xs">{v.video_title}</TableCell>
                        <TableCell className="text-center">{v.total_blocks}</TableCell>
                        <TableCell className="text-center">{v.blocks_with_text}</TableCell>
                        <TableCell className="text-center">{v.blocks_with_verbal}</TableCell>
                        <TableCell className="text-center">{v.canonical_units}</TableCell>
                        <TableCell className="text-center">{v.narrative_functions}</TableCell>
                        <TableCell className="text-center">{v.issues_count}</TableCell>
                        <TableCell className="text-center">{statusBadge(v.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
