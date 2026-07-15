import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Dna, Clock, Heart, Megaphone, BarChart3, Layers, CheckCircle, AlertTriangle, XCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { buildDNAObjectV1, saveDNAObject, loadLatestDNAObject, type DNAObjectV1 } from "@/lib/build-dna-object-v1";
import { formatBlockName, formatSequence, deriveMissingFields } from "@/lib/format-blocks";

const statusConfig = {
  ready: { label: "READY", icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  incomplete: { label: "INCOMPLETE", icon: AlertTriangle, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  no_data: { label: "NO DATA", icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

type DnaObjectStatus = keyof typeof statusConfig;

export function normalizeDnaObjectStatus(value: unknown): DnaObjectStatus {
  return value === "ready" || value === "incomplete" || value === "no_data" ? value : "no_data";
}

export function dnaEngineErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "erro desconhecido";
}

function FieldValue({ value, suffix }: { value: unknown; suffix?: string }) {
  if (value == null) return <span className="text-muted-foreground italic">Sem dados ainda</span>;
  return <span className="font-semibold text-foreground">{String(value)}{suffix ?? ""}</span>;
}

function BlockList({ blocks }: { blocks: string[] }) {
  if (!blocks || blocks.length === 0) return <span className="text-muted-foreground italic">Nenhum</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {blocks.map((b) => (
        <Badge key={b} variant="outline" className="text-xs">{formatBlockName(b)}</Badge>
      ))}
    </div>
  );
}

function StatusReason({ missingFields }: { missingFields: string[] }) {
  if (missingFields.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        <strong>Motivo do status:</strong>{" "}
        {missingFields.length === 1 && missingFields[0] === "Sem dados suficientes"
          ? missingFields[0]
          : `faltam: ${missingFields.join(", ")}`}
      </span>
    </div>
  );
}

export default function DNAEngineViewPage() {
  const [dnaObject, setDnaObject] = useState<DNAObjectV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    loadExisting();
  }, []);

  async function loadExisting() {
    setLoading(true);
    try {
      const existing = await loadLatestDNAObject();
      if (existing) {
        setDnaObject({
          id: existing.id,
          created_at: existing.created_at,
          source_scope: existing.source_scope,
          total_videos_used: existing.total_videos_used ?? 0,
          dominant_sequence: existing.dominant_sequence,
          required_blocks: Array.isArray(existing.required_blocks) ? existing.required_blocks.map(String) : [],
          optional_blocks: Array.isArray(existing.optional_blocks) ? existing.optional_blocks.map(String) : [],
          avg_hook_time_pct: existing.avg_hook_time,
          avg_payoff_time_pct: existing.avg_payoff_time,
          avg_cta_time: existing.avg_cta_time,
          avg_block_count: existing.avg_block_count,
          avg_video_duration: existing.avg_video_duration,
          dominant_emotion: existing.dominant_emotion,
          secondary_emotion: existing.secondary_emotion,
          dominant_cta_type: existing.dominant_cta_type,
          avg_engagement_rate: existing.avg_engagement_rate,
          engagement_source: existing.notes?.includes("engagement_source: engagement_rate_relative")
            ? "engagement_rate_relative"
            : existing.notes?.includes("engagement_source: engagement_percentile_display")
              ? "engagement_percentile_display"
              : null,
          notes: existing.notes,
          status: normalizeDnaObjectStatus(existing.status),
        });
        setSavedAt(existing.created_at);
      } else {
        await handleRebuild();
      }
    } catch (err: unknown) {
      setDnaObject(null);
      toast.error(`Erro ao carregar DNA Object: ${dnaEngineErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    try {
      const obj = await buildDNAObjectV1();
      const saved = await saveDNAObject(obj);
      if (!saved?.id || !saved?.created_at) {
        throw new Error("O DNA foi calculado, mas o banco não confirmou o salvamento.");
      }
      setDnaObject({ ...obj, id: saved.id, created_at: saved.created_at });
      setSavedAt(saved.created_at);
      toast.success("DNA Object V1 reconstruído com sucesso");
    } catch (err: unknown) {
      toast.error(`Erro ao reconstruir DNA Object: ${dnaEngineErrorMessage(err)}`);
    } finally {
      setRebuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = normalizeDnaObjectStatus(dnaObject?.status);
  const sc = statusConfig[status] ?? statusConfig.no_data;
  const StatusIcon = sc.icon;

  const missingFields = dnaObject
    ? deriveMissingFields({
        dominant_sequence: dnaObject.dominant_sequence,
        dominant_emotion: dnaObject.dominant_emotion,
        avg_engagement_rate: dnaObject.avg_engagement_rate,
        required_blocks: dnaObject.required_blocks,
        total_videos_used: dnaObject.total_videos_used,
        avg_hook_time_pct: dnaObject.avg_hook_time_pct,
        avg_payoff_time_pct: dnaObject.avg_payoff_time_pct,
        status,
      })
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Dna className="h-6 w-6 text-primary" />
            DNA Object V1
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Objeto operacional consolidado a partir dos dados do sistema
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`${sc.color} border px-3 py-1 text-xs font-bold`}>
            <StatusIcon className="h-3.5 w-3.5 mr-1" />
            {sc.label}
          </Badge>
          <Button onClick={handleRebuild} disabled={rebuilding} size="sm">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${rebuilding ? "animate-spin" : ""}`} />
            Rebuild DNA Object
          </Button>
        </div>
      </div>

      <StatusReason missingFields={missingFields} />

      {savedAt && (
        <p className="text-xs text-muted-foreground">
          Última geração: {new Date(savedAt).toLocaleString("pt-BR")}
          {dnaObject?.id && <span className="ml-2 opacity-60">ID: {dnaObject.id.slice(0, 8)}…</span>}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Estrutura */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Estrutura
            </CardTitle>
            <CardDescription>Sequência e blocos dominantes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Sequência Dominante</p>
              <FieldValue value={formatSequence(dnaObject?.dominant_sequence ?? null)} />
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Blocos Obrigatórios (&gt;70%)</p>
              <BlockList blocks={dnaObject?.required_blocks ?? []} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Blocos Opcionais (30–70%)</p>
              <BlockList blocks={dnaObject?.optional_blocks ?? []} />
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Média de blocos/vídeo</span>
              <FieldValue value={dnaObject?.avg_block_count} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Total de vídeos usados</span>
              <FieldValue value={dnaObject?.total_videos_used} />
            </div>
          </CardContent>
        </Card>

        {/* Tempo */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Tempo
            </CardTitle>
            <CardDescription>Métricas temporais médias</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Duração média</span>
              <FieldValue value={dnaObject?.avg_video_duration} suffix="s" />
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Posição do Hook (%)</span>
              <FieldValue value={dnaObject?.avg_hook_time_pct} suffix="%" />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Posição do Payoff (%)</span>
              <FieldValue value={dnaObject?.avg_payoff_time_pct} suffix="%" />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Posição do CTA</span>
              <FieldValue value={dnaObject?.avg_cta_time} suffix="s" />
            </div>
          </CardContent>
        </Card>

        {/* Emoção */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-primary" />
              Emoção
            </CardTitle>
            <CardDescription>Perfil emocional dominante</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Emoção Dominante</span>
              <FieldValue value={dnaObject?.dominant_emotion} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Emoção Secundária</span>
              <FieldValue value={dnaObject?.secondary_emotion} />
            </div>
          </CardContent>
        </Card>

        {/* CTA */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              CTA
            </CardTitle>
            <CardDescription>Padrão de CTA dominante</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Tipo de CTA Dominante</span>
              <FieldValue value={dnaObject?.dominant_cta_type} />
            </div>
          </CardContent>
        </Card>

        {/* Performance */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Performance
            </CardTitle>
            <CardDescription>Engagement médio observado na base</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Avg Engagement Rate Relative</span>
              <FieldValue value={dnaObject?.avg_engagement_rate} />
            </div>
            {dnaObject?.engagement_source && (
              <p className="text-[10px] text-muted-foreground italic">
                Fonte: {dnaObject.engagement_source}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
