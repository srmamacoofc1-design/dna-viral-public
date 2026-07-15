import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Printer, List, ArrowUp, FileText, Archive, Database, Download } from "lucide-react";
import { toast } from "sonner";
import { loadMasterData, type MasterData } from "@/lib/master-system-data";
import { exportExecutivePDF, exportSnapshot, exportDatasetPackage, type PreparedDownload } from "@/lib/master-export";
import {
  SectionDNABase,
  SectionDNAFormal,
  SectionDataReadiness,
  SectionMasterReadiness,
  SectionVerbalIntelligence,
  SectionNarrativeSequences,
  SectionCTA,
  SectionPerformance,
  SectionCohorts,
  SectionMicroEvents,
  SectionAlignment,
  SectionOutliers,
  SectionSemanticPatterns,
  SectionWordPatterns,
  SectionVideoByVideo,
} from "@/components/master-report/MasterSections";

const SECTIONS = [
  { id: "sec-dna-base", label: "3 — DNA Base V2" },
  { id: "sec-dna-formal", label: "4 — DNA Formal V1" },
  { id: "sec-readiness", label: "5 — Data Readiness" },
  { id: "sec-master-readiness", label: "6 — Master Readiness" },
  { id: "sec-verbal", label: "7 — Verbal Intelligence" },
  { id: "sec-sequences", label: "8 — Narrative Sequences" },
  { id: "sec-cta", label: "9 — CTA Analysis" },
  { id: "sec-performance", label: "10 — Performance" },
  { id: "sec-cohorts", label: "11 — Cohorts" },
  { id: "sec-micro-events", label: "12 — Micro Events" },
  { id: "sec-alignment", label: "13 — Alignment" },
  { id: "sec-outliers", label: "14 — Outliers" },
  { id: "sec-semantic", label: "15 — Semantic Patterns" },
  { id: "sec-words", label: "16 — Word Patterns" },
  { id: "sec-videos", label: "17 — Video-by-Video" },
];

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function canShareFile(file: File | null) {
  try {
    if (!file || typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    return typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export default function MasterSystemReportPage() {
  const [data, setData] = useState<MasterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [downloadFile, setDownloadFile] = useState<PreparedDownload | null>(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (downloadFile?.objectUrl) {
        URL.revokeObjectURL(downloadFile.objectUrl);
      }
    };
  }, [downloadFile]);

  const openDownloadModal = useCallback((nextFile: PreparedDownload) => {
    setDownloadFile((previousFile) => {
      if (previousFile?.objectUrl) {
        URL.revokeObjectURL(previousFile.objectUrl);
      }
      return nextFile;
    });
    setDownloadModalOpen(true);
  }, []);

  const handleExportSnapshot = useCallback(async () => {
    if (!data) return;
    setExporting("snapshot");
    try {
      const result = exportSnapshot(data);
      openDownloadModal(result);
      toast.success(`Snapshot pronto — ${(result.rawSize / 1024 / 1024).toFixed(1)} MB → ${(result.compressedSize / 1024 / 1024).toFixed(2)} MB gzip`);
    } catch (e: any) {
      toast.error("Erro ao preparar snapshot: " + e.message);
    } finally {
      setExporting(null);
    }
  }, [data, openDownloadModal]);

  const handleExportZip = useCallback(async () => {
    if (!data) return;
    setExporting("zip");
    try {
      const result = await exportDatasetPackage(data, (msg) => toast.info(msg));
      openDownloadModal(result);
      toast.success(`Pacote pronto — ${result.totalFiles} arquivos, ${(result.zipSize / 1024 / 1024).toFixed(2)} MB${result.sha256Available ? ", SHA-256 ✓" : ", SHA-256 indisponível"}`);
    } catch (e: any) {
      toast.error("Erro ao preparar pacote: " + e.message);
    } finally {
      setExporting(null);
    }
  }, [data, openDownloadModal]);

  const handleNativeShare = useCallback(async () => {
    if (!downloadFile?.shareFile || typeof navigator === "undefined" || typeof navigator.share !== "function") {
      toast.error("Compartilhamento não disponível neste navegador");
      return;
    }

    try {
      await navigator.share({
        title: downloadFile.fileName,
        files: [downloadFile.shareFile],
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.error("Não foi possível abrir o menu de compartilhar");
      }
    }
  }, [downloadFile]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadMasterData();
      setData(result);
      toast.success(`Dados carregados em ${(result.fetchTimeMs / 1000).toFixed(1)}s`);
    } catch (e: any) {
      setError(e.message || "Erro ao carregar dados");
      toast.error("Erro ao carregar dados do sistema");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const onBefore = () => setIsPrintMode(true);
    const onAfter = () => setIsPrintMode(false);
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const scrollToTop = () => document.getElementById("msr-cover")?.scrollIntoView({ behavior: "smooth" });
  const shareAvailable = canShareFile(downloadFile?.shareFile ?? null);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Carregando snapshot global do sistema...</p>
          <p className="text-xs text-muted-foreground">Isso pode levar alguns segundos</p>
        </div>
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto p-6 text-center space-y-4">
          <p className="text-destructive font-medium">{error || "Sem dados disponíveis"}</p>
          <Button onClick={fetchData}>Tentar Novamente</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div id="msr-cover" className="print:flex print:flex-col print:items-center print:justify-center print:min-h-[100vh] print:text-center print:py-20">
        <div className="max-w-5xl mx-auto px-4 py-8 print:py-0">
          <div className="text-center space-y-4 mb-8">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">MASTER SYSTEM REPORT</h1>
            <p className="text-lg text-muted-foreground">Viral Narrative Engine — Sistema Completo</p>
            <div className="w-32 h-1 bg-primary mx-auto" />
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              <Badge variant="outline">{data.videos.length} vídeos</Badge>
              <Badge variant="outline">{data.blocks.length} blocos</Badge>
              <Badge variant="outline">15 relatórios agregados</Badge>
              <Badge variant="outline">Fetch: {(data.fetchTimeMs / 1000).toFixed(1)}s</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{new Date(data.fetchedAt).toLocaleString("pt-BR")}</p>

            <div className="flex flex-wrap justify-center gap-2 print:hidden">
              <Button onClick={() => exportExecutivePDF()} className="gap-2">
                <Printer className="w-4 h-4" /> PDF Executivo
              </Button>
              <Button variant="outline" onClick={handleExportSnapshot} disabled={!!exporting} className="gap-2">
                {exporting === "snapshot" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                Snapshot .json.gz
              </Button>
              <Button variant="outline" onClick={handleExportZip} disabled={!!exporting} className="gap-2">
                {exporting === "zip" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                Dataset Package .zip
              </Button>
              <Button variant="ghost" onClick={fetchData} className="gap-2">
                <FileText className="w-4 h-4" /> Recarregar
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 print:break-before-page">
        <Card className="mb-8 print:border-0 print:shadow-none">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <List className="w-4 h-4 text-primary" /> ÍNDICE NAVEGÁVEL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  onClick={() => scrollTo(section.id)}
                  className="text-left text-sm px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground hover:text-foreground print:hover:bg-transparent"
                >
                  {section.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="max-w-5xl mx-auto px-4 space-y-8 pb-16">
        <SectionDNABase data={data} />
        <SectionDNAFormal data={data} />
        <SectionDataReadiness data={data} />
        <SectionMasterReadiness data={data} />
        <SectionVerbalIntelligence data={data} />
        <SectionNarrativeSequences data={data} />
        <SectionCTA data={data} />
        <SectionPerformance data={data} />
        <SectionCohorts data={data} />
        <SectionMicroEvents data={data} />
        <SectionAlignment data={data} />
        <SectionOutliers data={data} />
        <SectionSemanticPatterns data={data} />
        <SectionWordPatterns data={data} />
        <SectionVideoByVideo data={data} isPrintMode={isPrintMode} />
      </div>

      <button onClick={scrollToTop} className="fixed bottom-6 right-6 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:opacity-90 transition print:hidden">
        <ArrowUp className="w-5 h-5" />
      </button>

      <Dialog open={downloadModalOpen} onOpenChange={setDownloadModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivo pronto para download</DialogTitle>
            <DialogDescription>
              O arquivo foi preparado sem abrir tela em branco. Agora você baixa manualmente por aqui.
            </DialogDescription>
          </DialogHeader>

          {downloadFile && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
              <p className="text-sm font-medium break-all">{downloadFile.fileName}</p>
              <p className="text-xs text-muted-foreground">Tamanho: {formatFileSize(downloadFile.sizeBytes)}</p>
              <p className="text-xs text-muted-foreground">Se estiver no iPhone/iPad, use “Compartilhar / Salvar arquivo” se o botão de baixar não aparecer.</p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {downloadFile && (
              <Button asChild className="gap-2">
                <a href={downloadFile.objectUrl} download={downloadFile.fileName}>
                  <Download className="w-4 h-4" /> Baixar arquivo
                </a>
              </Button>
            )}
            {shareAvailable && (
              <Button type="button" variant="outline" onClick={handleNativeShare} className="gap-2">
                <Download className="w-4 h-4" /> Compartilhar / Salvar arquivo
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style>{`
        @media print {
          header, [data-no-print], .print\\:hidden { display: none !important; }
          body { font-size: 10pt; }
          .print\\:break-before-page { break-before: page; }
          .print\\:max-h-none { max-height: none !important; }
          .print\\:overflow-visible { overflow: visible !important; }
          @page { margin: 1.5cm; size: A4; }
        }
      `}</style>
    </AppLayout>
  );
}
