import { useState, useMemo, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Shield, CheckCircle, AlertTriangle, XCircle, Loader2, FileDown,
  ChevronLeft, ChevronRight, BarChart3, PieChart as PieChartIcon,
  ClipboardCheck, Database, FileText, ArrowUp, List,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

// ── Types ──
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

// ── Constants ──
const VIDEOS_PER_PAGE = 25;
const ISSUES_PER_PAGE = 50;

const dimensionLabels: Record<string, string> = {
  structural: "Estrutural",
  temporal: "Temporal",
  verbal: "Verbal",
  emotional: "Emocional",
  relational: "Relacional",
};

const STATUS_COLORS = {
  READY: "hsl(var(--primary))",
  MINOR_ISSUES: "hsl(45 93% 47%)",
  NEEDS_ATTENTION: "hsl(0 84% 60%)",
};

const TOC_ITEMS = [
  { id: "section-1-executive", label: "1 — Resumo Executivo" },
  { id: "section-2-dimensions", label: "2 — Validação por Dimensão" },
  { id: "section-3-issues", label: "3 — Issue Breakdown" },
  { id: "section-4-videos", label: "4 — Relatório por Vídeo" },
  { id: "section-5-stats", label: "5 — Estatísticas Globais" },
];

// ── Helpers ──
const statusIcon = (status: string) => {
  if (status === "PASS") return <CheckCircle className="w-5 h-5 text-green-500" />;
  if (status === "ACCEPTABLE") return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
  return <XCircle className="w-5 h-5 text-red-500" />;
};

const statusBadge = (status: string) => {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    READY: { label: "Ready", variant: "default" },
    MINOR_ISSUES: { label: "Minor Issues", variant: "secondary" },
    NEEDS_ATTENTION: { label: "Atenção", variant: "destructive" },
    READY_FOR_PHASE_2: { label: "PRONTO P/ FASE 2", variant: "default" },
    ACCEPTABLE_WITH_CAVEATS: { label: "Aceitável", variant: "secondary" },
    NEEDS_REMEDIATION: { label: "Precisa Correção", variant: "destructive" },
  };
  const m = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
};

const scrollToId = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
};

const scrollToTop = () => {
  document.getElementById("report-cover")?.scrollIntoView({ behavior: "smooth" });
};

// ── Back to top button ──
function BackToTop() {
  return (
    <div className="flex justify-end mt-4 print:hidden" data-no-print>
      <Button variant="ghost" size="sm" onClick={scrollToTop} className="text-xs text-muted-foreground gap-1">
        <ArrowUp className="w-3 h-3" /> Voltar ao topo
      </Button>
    </div>
  );
}

// ── Pagination component ──
function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-4 print:hidden" data-no-print>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="text-sm text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ── Cover Page (print only) ──
function PrintCover({ report }: { report: ReadinessReport }) {
  return (
    <div className="hidden print:flex print:flex-col print:items-center print:justify-center print:min-h-[100vh] print:text-center print:py-20">
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-black tracking-tight">MASTER READINESS REPORT</h1>
          <p className="text-lg text-muted-foreground mt-2">Sistema: ViralDNA</p>
        </div>
        <div className="w-32 h-1 bg-primary mx-auto" />
        <div className="space-y-3 text-base">
          <p><span className="font-semibold">Generated at:</span> {new Date(report.generated_at).toLocaleString("pt-BR")}</p>
          <p><span className="font-semibold">Readiness Score:</span> <span className="text-3xl font-black text-primary">{report.readiness_score}%</span></p>
          <p><span className="font-semibold">Validation Status:</span> {report.validation_status}</p>
          <p><span className="font-semibold">Total Vídeos:</span> {report.total_videos}</p>
          <p><span className="font-semibold">Total Blocos:</span> {report.total_blocks}</p>
        </div>
        <div className="w-32 h-1 bg-muted mx-auto" />
        <p className="text-xs text-muted-foreground">Documento oficial de conclusão da Fase 1 do MVP</p>
      </div>
    </div>
  );
}

// ── Print TOC (print only) ──
function PrintTOC() {
  return (
    <div className="hidden print:block print:break-before-page print:py-16">
      <h2 className="text-2xl font-bold mb-8 flex items-center gap-2">
        <List className="w-6 h-6" /> ÍNDICE
      </h2>
      <div className="space-y-4 text-lg">
        {TOC_ITEMS.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-dotted border-muted-foreground/30 pb-2">
            <span className="font-medium">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Interactive TOC (screen only) ──
function ScreenTOC() {
  return (
    <Card className="print:hidden" data-no-print>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <List className="w-4 h-4 text-primary" /> ÍNDICE
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <nav className="flex flex-col gap-1">
          {TOC_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => scrollToId(item.id)}
              className="text-left text-sm px-3 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground hover:text-foreground"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </CardContent>
    </Card>
  );
}

// ── Section Components ──
function Section1Executive({ report }: { report: ReadinessReport }) {
  return (
    <div id="section-1-executive" className="space-y-4 print:break-before-page">
      <h2 className="text-xl font-bold flex items-center gap-2 border-b pb-2">
        <ClipboardCheck className="w-5 h-5 text-primary" /> SEÇÃO 1 — Resumo Executivo
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card><CardContent className="pt-4 text-center">
          <div className="text-4xl font-black text-primary">{report.readiness_score}%</div>
          <p className="text-xs text-muted-foreground mt-1">Readiness Score</p>
          <div className="mt-2">{statusBadge(report.validation_status)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_videos}</div>
          <p className="text-xs text-muted-foreground">Total Vídeos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_blocks}</div>
          <p className="text-xs text-muted-foreground">Total Blocos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_verbal_analyses}</div>
          <p className="text-xs text-muted-foreground">Análises Verbais</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_canonical_units}</div>
          <p className="text-xs text-muted-foreground">Unidades Canônicas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold text-green-500">{report.ready_videos}</div>
          <p className="text-xs text-muted-foreground">Vídeos Ready</p>
          <p className="text-xs text-yellow-500 mt-1">{report.videos_with_issues} com issues</p>
        </CardContent></Card>
      </div>
      <p className="text-xs text-muted-foreground">Gerado em: {new Date(report.generated_at).toLocaleString("pt-BR")}</p>
      <BackToTop />
    </div>
  );
}

function Section2Dimensions({ report }: { report: ReadinessReport }) {
  return (
    <div id="section-2-dimensions" className="space-y-4 print:break-before-page">
      <h2 className="text-xl font-bold flex items-center gap-2 border-b pb-2">
        <Shield className="w-5 h-5 text-primary" /> SEÇÃO 2 — Validação por Dimensão
      </h2>
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dimensão</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Pass Rate (%)</TableHead>
                <TableHead className="text-center">Total Issues</TableHead>
                <TableHead className="text-center">Vídeos Afetados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(report.dimension_summary).map(([dim, data]) => (
                <TableRow key={dim}>
                  <TableCell className="font-medium">{dimensionLabels[dim] || dim}</TableCell>
                  <TableCell className="text-center flex items-center justify-center gap-1">
                    {statusIcon(data.status)} <span className="text-xs">{data.status}</span>
                  </TableCell>
                  <TableCell className="text-center font-mono">{data.pass_rate}%</TableCell>
                  <TableCell className="text-center">{data.total_issues}</TableCell>
                  <TableCell className="text-center">{data.affected_videos}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <BackToTop />
    </div>
  );
}

function Section3Issues({ report }: { report: ReadinessReport }) {
  const [page, setPage] = useState(1);
  const issues = report.issue_breakdown;
  const totalPages = Math.ceil(issues.length / ISSUES_PER_PAGE);
  const paged = issues.slice((page - 1) * ISSUES_PER_PAGE, page * ISSUES_PER_PAGE);

  if (issues.length === 0) {
    return (
      <div id="section-3-issues" className="space-y-4 print:break-before-page">
        <h2 className="text-xl font-bold flex items-center gap-2 border-b pb-2">
          <AlertTriangle className="w-5 h-5 text-primary" /> SEÇÃO 3 — Issue Breakdown
        </h2>
        <Card><CardContent className="pt-4 text-center text-muted-foreground">Nenhuma issue detectada ✅</CardContent></Card>
        <BackToTop />
      </div>
    );
  }

  return (
    <div id="section-3-issues" className="space-y-4 print:break-before-page">
      <h2 className="text-xl font-bold flex items-center gap-2 border-b pb-2">
        <AlertTriangle className="w-5 h-5 text-primary" /> SEÇÃO 3 — Issue Breakdown Completo ({issues.length} issues)
      </h2>
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto print:max-h-none print:overflow-visible">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dimensão</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Detalhe</TableHead>
                  <TableHead>Video ID</TableHead>
                  <TableHead>Video Title</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((issue: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell><Badge variant="outline">{dimensionLabels[issue.dimension] || issue.dimension}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{issue.issue}</TableCell>
                    <TableCell className="text-xs max-w-xs">{issue.detail}</TableCell>
                    <TableCell className="text-xs font-mono max-w-[100px] truncate">{issue.video_id?.substring(0, 8) || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{issue.video_title}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </CardContent>
      </Card>
      <BackToTop />
    </div>
  );
}

function Section4VideoDetails({ report }: { report: ReadinessReport }) {
  const [page, setPage] = useState(1);
  const videos = report.video_reports;
  const totalPages = Math.ceil(videos.length / VIDEOS_PER_PAGE);
  const paged = videos.slice((page - 1) * VIDEOS_PER_PAGE, page * VIDEOS_PER_PAGE);

  return (
    <div id="section-4-videos" className="space-y-4 print:break-before-page">
      <h2 className="text-xl font-bold flex items-center gap-2 border-b pb-2">
        <Database className="w-5 h-5 text-primary" /> SEÇÃO 4 — Relatório Detalhado por Vídeo ({videos.length} vídeos)
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {paged.map((v) => (
          <Card key={v.video_id} className="border-l-4" style={{
            borderLeftColor: v.status === "READY" ? "hsl(var(--primary))" : v.status === "MINOR_ISSUES" ? "hsl(45 93% 47%)" : "hsl(0 84% 60%)",
          }}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-tight line-clamp-2">{v.video_title}</h3>
                {statusBadge(v.status)}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">{v.video_id}</p>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="font-bold">{v.total_blocks}</div>
                  <div className="text-muted-foreground">Blocos</div>
                </div>
                <div>
                  <div className="font-bold">{v.blocks_with_text}</div>
                  <div className="text-muted-foreground">c/ Texto</div>
                </div>
                <div>
                  <div className="font-bold">{v.blocks_with_verbal}</div>
                  <div className="text-muted-foreground">c/ Verbal</div>
                </div>
                <div>
                  <div className="font-bold">{v.canonical_units}</div>
                  <div className="text-muted-foreground">Canônicos</div>
                </div>
                <div>
                  <div className="font-bold">{v.narrative_functions}</div>
                  <div className="text-muted-foreground">Funções</div>
                </div>
                <div>
                  <div className="font-bold">{v.issues_count}</div>
                  <div className="text-muted-foreground">Issues</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      <BackToTop />
    </div>
  );
}

function Section5Stats({ report }: { report: ReadinessReport }) {
  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = { READY: 0, MINOR_ISSUES: 0, NEEDS_ATTENTION: 0 };
    report.video_reports.forEach(v => { counts[v.status] = (counts[v.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [report]);

  const dimensionData = useMemo(() => {
    return Object.entries(report.dimension_summary).map(([dim, data]) => ({
      name: dimensionLabels[dim] || dim,
      pass_rate: data.pass_rate,
      issues: data.total_issues,
    }));
  }, [report]);

  const PIE_COLORS = [STATUS_COLORS.READY, STATUS_COLORS.MINOR_ISSUES, STATUS_COLORS.NEEDS_ATTENTION];

  return (
    <div id="section-5-stats" className="space-y-4 print:break-before-page">
      <h2 className="text-xl font-bold flex items-center gap-2 border-b pb-2">
        <BarChart3 className="w-5 h-5 text-primary" /> SEÇÃO 5 — Estatísticas Globais
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_videos}</div>
          <p className="text-xs text-muted-foreground">Total Vídeos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_blocks}</div>
          <p className="text-xs text-muted-foreground">Total Blocos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_verbal_analyses}</div>
          <p className="text-xs text-muted-foreground">Análises Verbais</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-2xl font-bold">{report.total_canonical_units}</div>
          <p className="text-xs text-muted-foreground">Unidades Canônicas</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-1"><BarChart3 className="w-4 h-4" /> Pass Rate por Dimensão</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dimensionData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="pass_rate" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-1"><PieChartIcon className="w-4 h-4" /> Distribuição por Status</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={statusDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusDistribution.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      <BackToTop />
    </div>
  );
}

// ── Main Page ──
export default function MasterReadinessReportPage() {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const generateReport = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("data-readiness-check");
      if (error) throw error;
      setReport(data);

      setSaving(true);
      await supabase.from("readiness_reports").insert({
        generated_at: data.generated_at,
        readiness_score: data.readiness_score,
        validation_status: data.validation_status,
        total_videos: data.total_videos,
        total_blocks: data.total_blocks,
        report_json: data,
      });
      setSaving(false);

      toast.success("Relatório gerado e snapshot salvo");
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar relatório");
    } finally {
      setLoading(false);
      setSaving(false);
    }
  }, []);

  const handleExportPDF = useCallback(() => {
    const style = document.createElement("style");
    style.id = "master-pdf-style";
    style.textContent = `
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        nav, header, button, [data-no-print], [role="navigation"] { display: none !important; }
        .print\\:break-before-page { break-before: page; page-break-before: always; }
        .print\\:hidden { display: none !important; }
        .print\\:block, .print\\:flex { display: flex !important; }
        .print\\:max-h-none { max-height: none !important; }
        .print\\:overflow-visible { overflow: visible !important; }
        main { padding: 0 !important; }

        @page {
          size: A4;
          margin: 15mm 12mm 25mm 12mm;
        }

        .print-footer {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 9pt;
          color: #666;
          border-top: 1px solid #ddd;
          padding-top: 3px;
          padding-bottom: 2mm;
        }

        .print-footer::after {
          content: "Página " counter(page);
        }
      }
    `;
    document.head.appendChild(style);
    window.addEventListener("afterprint", () => style.remove(), { once: true });
    setTimeout(() => style.remove(), 5000);
    window.print();
  }, []);

  return (
    <AppLayout>
      <div id="report-cover" className="max-w-7xl mx-auto p-4 space-y-8 scroll-smooth">
        {/* Screen Header */}
        <div className="flex items-center justify-between flex-wrap gap-4 print:hidden" data-no-print>
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Master Readiness Report</h1>
              <p className="text-sm text-muted-foreground">Documento oficial de conclusão da Fase 1</p>
            </div>
          </div>
          <div className="flex gap-2">
            {report && (
              <Button variant="outline" size="sm" onClick={handleExportPDF}>
                <FileDown className="w-4 h-4 mr-1" /> Exportar PDF
              </Button>
            )}
            <Button onClick={generateReport} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {loading ? "Gerando..." : "Gerar Relatório"}
            </Button>
          </div>
        </div>

        {!report && !loading && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Clique em <strong>"Gerar Relatório"</strong> para criar o documento oficial de conclusão da Fase 1.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Usa exclusivamente os dados existentes. Não recalcula nem altera nada.
              </p>
            </CardContent>
          </Card>
        )}

        {report && (
          <>
            {/* Print Cover Page */}
            <PrintCover report={report} />
            {/* Print TOC */}
            <PrintTOC />
            {/* Screen TOC */}
            <ScreenTOC />
            {/* Sections */}
            <Section1Executive report={report} />
            <Section2Dimensions report={report} />
            <Section3Issues report={report} />
            <Section4VideoDetails report={report} />
            <Section5Stats report={report} />
          </>
        )}

        {/* Print footer - appears on every printed page via position:fixed */}
        <div className="print-footer hidden print:block" aria-hidden="true" />
      </div>
    </AppLayout>
  );
}
