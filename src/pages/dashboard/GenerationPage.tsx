import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Layers, CheckCircle, AlertTriangle, XCircle, Info, Megaphone } from "lucide-react";
import { toast } from "sonner";
import {
  buildGenerationContextV1,
  saveGenerationContext,
  loadLatestGenerationContext,
  type GenerationContextV1,
  type GenerationSlot,
} from "@/lib/build-generation-context-v1";
import { loadLatestBlueprintContext } from "@/lib/build-blueprint-context-v1";
import { formatBlockName } from "@/lib/format-blocks";

const statusConfig = {
  ready: { label: "READY", icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  incomplete: { label: "INCOMPLETE", icon: AlertTriangle, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  no_data: { label: "NO DATA", icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

const ROLE_LABELS: Record<string, string> = {
  opening: "Opening",
  middle: "Middle",
  late: "Late",
  closing: "Closing",
};

export default function GenerationPage() {
  const [ctx, setCtx] = useState<GenerationContextV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [outdated, setOutdated] = useState(false);

  useEffect(() => { load(); }, []);

  async function checkOutdated(sourceId: string | null) {
    if (!sourceId) return false;
    try {
      const latest = await loadLatestBlueprintContext();
      return latest ? latest.id !== sourceId : false;
    } catch { return false; }
  }

  async function load() {
    setLoading(true);
    try {
      const existing = await loadLatestGenerationContext();
      if (existing) {
        const parsed: GenerationContextV1 = {
          id: existing.id,
          created_at: existing.created_at,
          source_blueprint_id: existing.source_blueprint_id,
          generation_name: existing.generation_name,
          slot_sequence: (existing.slot_sequence as unknown as GenerationSlot[]) ?? [],
          slot_count_expected: existing.slot_count_expected,
          generation_rules: (existing.generation_rules as unknown as string[]) ?? [],
          status: existing.status as GenerationContextV1["status"],
        };
        setCtx(parsed);
        setOutdated(await checkOutdated(existing.source_blueprint_id));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleBuild() {
    setBuilding(true);
    try {
      const obj = await buildGenerationContextV1();
      const saved = await saveGenerationContext(obj);
      setCtx({ ...obj, id: saved.id, created_at: saved.created_at });
      setOutdated(false);
      toast.success("Generation Context V1 construído com sucesso");
    } catch (err: any) {
      console.error(err);
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setBuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            Generation Context V1
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Nenhum contexto gerado ainda.</p>
        </div>
        <Button onClick={handleBuild} disabled={building}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${building ? "animate-spin" : ""}`} />
          Build Generation Context V1
        </Button>
      </div>
    );
  }

  const sc = statusConfig[ctx.status];
  const StatusIcon = sc.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            {ctx.generation_name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Esqueleto narrativo derivado do Blueprint Context V1
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`${sc.color} border px-3 py-1 text-xs font-bold`}>
            <StatusIcon className="h-3.5 w-3.5 mr-1" />
            {sc.label}
          </Badge>
          <Button onClick={handleBuild} disabled={building} size="sm">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${building ? "animate-spin" : ""}`} />
            Build Generation Context V1
          </Button>
        </div>
      </div>

      {/* Status reason */}
      {ctx.status !== "ready" && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>Motivo do status:</strong>{" "}
            {ctx.status === "no_data" ? "Sem Blueprint disponível" : "Blueprint ainda não está READY"}
          </span>
        </div>
      )}

      {/* Outdated alert */}
      {outdated && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Generation Context desatualizado em relação ao Blueprint mais recente. Clique em <strong>Build</strong> para atualizar.</span>
        </div>
      )}

      {/* Meta */}
      <div className="text-xs text-muted-foreground space-y-0.5">
        {ctx.created_at && (
          <p>Última geração: {new Date(ctx.created_at).toLocaleString("pt-BR")}
            {ctx.id && <span className="ml-2 opacity-60">ID: {ctx.id.slice(0, 8)}…</span>}
          </p>
        )}
        {ctx.source_blueprint_id && (
          <p>Blueprint Source: <span className="font-mono">{ctx.source_blueprint_id.slice(0, 8)}…</span></p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Slot Sequence */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Slot Sequence
            </CardTitle>
            <CardDescription>Slots narrativos ordenados</CardDescription>
          </CardHeader>
          <CardContent>
            {ctx.slot_sequence.length === 0 ? (
              <span className="text-muted-foreground italic text-sm">Nenhum slot definido</span>
            ) : (
              <div className="space-y-2">
                {ctx.slot_sequence.map((slot) => (
                  <div key={slot.index} className="rounded-md bg-muted/30 border border-border px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground w-12">Slot {slot.index}</span>
                        <span className="font-semibold text-foreground">{formatBlockName(slot.slot_type)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!slot.generation_ready && (
                          <Badge variant="outline" className="text-xs border-red-500/40 text-red-400">Not Ready</Badge>
                        )}
                        <Badge variant="outline" className={`text-xs ${slot.is_required ? "border-green-500/40 text-green-400" : "border-muted-foreground/30 text-muted-foreground"}`}>
                          {slot.is_required ? "Obrigatório" : "Opcional"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground pl-[60px]">
                      <span>Função: <strong className="text-foreground">{slot.narrative_function}</strong></span>
                      <span>Posição estrutural: <strong className="text-foreground">{ROLE_LABELS[slot.position_role] ?? slot.position_role}</strong></span>
                      {slot.expected_position_pct != null && (
                        <span>Posição esperada: <strong className="text-foreground">{slot.expected_position_pct}%</strong></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ctx.slot_count_expected != null && (
              <p className="text-xs text-muted-foreground mt-3">
                Quantidade esperada de slots: <strong>{ctx.slot_count_expected}</strong>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Rules */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              Generation Rules
            </CardTitle>
            <CardDescription>Regras estruturais do esqueleto narrativo</CardDescription>
          </CardHeader>
          <CardContent>
            {ctx.generation_rules.length === 0 ? (
              <span className="text-muted-foreground italic text-sm">Nenhuma regra gerada</span>
            ) : (
              <ul className="space-y-1.5">
                {ctx.generation_rules.map((rule, i) => (
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
