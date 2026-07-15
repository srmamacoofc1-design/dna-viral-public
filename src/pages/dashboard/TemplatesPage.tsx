import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, FileText, Layers, Clock, Heart, Megaphone, CheckCircle, AlertTriangle, XCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { buildTemplateContextV1, saveTemplateContext, loadLatestTemplateContext, type TemplateContextV1 } from "@/lib/build-template-context-v1";
import { formatBlockName, formatSequence, generateTemplateName } from "@/lib/format-blocks";

const statusConfig = {
  ready: { label: "READY", icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  incomplete: { label: "INCOMPLETE", icon: AlertTriangle, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  no_data: { label: "NO DATA", icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

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

function StatusReason({ status, obj }: { status: string; obj: TemplateContextV1 }) {
  if (status === "ready") return null;
  if (status === "no_data") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span><strong>Motivo do status:</strong> Sem dados suficientes</span>
      </div>
    );
  }
  const missing: string[] = [];
  if (!obj.dominant_sequence) missing.push("Sequência dominante");
  if (!obj.dominant_emotion) missing.push("Emoção dominante");
  if (!obj.required_blocks || obj.required_blocks.length === 0) missing.push("Blocos obrigatórios");
  if (missing.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span><strong>Motivo do status:</strong> faltam: {missing.join(", ")}</span>
    </div>
  );
}

export default function TemplatesPage() {
  const [template, setTemplate] = useState<TemplateContextV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    loadExisting();
  }, []);

  async function loadExisting() {
    setLoading(true);
    try {
      const existing = await loadLatestTemplateContext();
      if (existing) {
        setTemplate({
          id: existing.id,
          created_at: existing.created_at,
          source_dna_object_id: existing.source_dna_object_id,
          template_name: existing.template_name,
          dominant_sequence: existing.dominant_sequence,
          required_blocks: (existing.required_blocks as string[]) ?? [],
          optional_blocks: (existing.optional_blocks as string[]) ?? [],
          hook_position_pct: existing.hook_position_pct,
          payoff_position_pct: existing.payoff_position_pct,
          cta_position_seconds: existing.cta_position_seconds,
          dominant_emotion: existing.dominant_emotion,
          secondary_emotion: existing.secondary_emotion,
          dominant_cta_type: existing.dominant_cta_type,
          avg_block_count: existing.avg_block_count,
          avg_video_duration: existing.avg_video_duration,
          template_rules: (existing.template_rules as string[]) ?? [],
          notes: existing.notes,
          status: existing.status as TemplateContextV1["status"],
        });
        setSavedAt(existing.created_at);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    try {
      const obj = await buildTemplateContextV1();
      obj.template_name = generateTemplateName(obj.dominant_sequence);
      const saved = await saveTemplateContext(obj);
      setTemplate({ ...obj, id: saved.id, created_at: saved.created_at });
      setSavedAt(saved.created_at);
      toast.success("Template Context V1 reconstruído com sucesso");
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao reconstruir Template: " + (err.message ?? ""));
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

  if (!template) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Template Context V1
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Nenhum template gerado ainda.</p>
        </div>
        <Button onClick={handleRebuild} disabled={rebuilding}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${rebuilding ? "animate-spin" : ""}`} />
          Gerar Template Context V1
        </Button>
      </div>
    );
  }

  const status = template.status;
  const sc = statusConfig[status];
  const StatusIcon = sc.icon;
  const displayName = generateTemplateName(template.dominant_sequence);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            {displayName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Template narrativo derivado do DNA Object V1
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`${sc.color} border px-3 py-1 text-xs font-bold`}>
            <StatusIcon className="h-3.5 w-3.5 mr-1" />
            {sc.label}
          </Badge>
          <Button onClick={handleRebuild} disabled={rebuilding} size="sm">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${rebuilding ? "animate-spin" : ""}`} />
            Rebuild Template
          </Button>
        </div>
      </div>

      <StatusReason status={status} obj={template} />

      {savedAt && (
        <p className="text-xs text-muted-foreground">
          Última geração: {new Date(savedAt).toLocaleString("pt-BR")}
          {template.id && <span className="ml-2 opacity-60">ID: {template.id.slice(0, 8)}…</span>}
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
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Sequência Dominante</p>
              <FieldValue value={formatSequence(template.dominant_sequence)} />
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Blocos Obrigatórios</p>
              <BlockList blocks={template.required_blocks} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Blocos Opcionais</p>
              <BlockList blocks={template.optional_blocks} />
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Média de blocos</span>
              <FieldValue value={template.avg_block_count} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Duração média</span>
              <FieldValue value={template.avg_video_duration} suffix="s" />
            </div>
          </CardContent>
        </Card>

        {/* Tempo + Emoção + CTA */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Posições & Emoção
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Posição do Hook (%)</span>
              <FieldValue value={template.hook_position_pct} suffix="%" />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Posição do Payoff (%)</span>
              <FieldValue value={template.payoff_position_pct} suffix="%" />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Posição do CTA</span>
              <FieldValue value={template.cta_position_seconds} suffix="s" />
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Emoção Dominante</span>
              <FieldValue value={template.dominant_emotion} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Emoção Secundária</span>
              <FieldValue value={template.secondary_emotion} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Tipo CTA Dominante</span>
              <FieldValue value={template.dominant_cta_type} />
            </div>
          </CardContent>
        </Card>

        {/* Regras */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              Template Rules
            </CardTitle>
            <CardDescription>Regras derivadas automaticamente do DNA</CardDescription>
          </CardHeader>
          <CardContent>
            {template.template_rules.length === 0 ? (
              <span className="text-muted-foreground italic text-sm">Nenhuma regra gerada</span>
            ) : (
              <ul className="space-y-1.5">
                {template.template_rules.map((rule, i) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    {rule}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
