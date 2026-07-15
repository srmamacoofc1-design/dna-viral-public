import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Database,
  FileText,
  ShieldCheck,
  RefreshCw,
  ArrowUpCircle,
  Wrench,
  Loader2,
  Play,
  Square,
  CheckCircle2,
  SkipForward,
  Ban,
  AlertTriangle,
} from "lucide-react";
import type { RunState } from "@/pages/dashboard/ScriptEnginePage";

interface Props {
  run: RunState;
  running: string | null;
  onBuildContext: () => void;
  onAssemble: () => void;
  onValidate: () => void;
  onRevise: () => void;
  onPromote: () => void;
  onRunAll: () => void;
  onCancel: () => void;
}

const statusConfig: Record<string, { color: string; icon: typeof CheckCircle2 | null }> = {
  idle: { color: "bg-muted text-muted-foreground", icon: null },
  running: { color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse", icon: Loader2 },
  ready: { color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  approved: { color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  promoted: { color: "bg-primary/15 text-primary border-primary/30", icon: ArrowUpCircle },
  skipped: { color: "bg-slate-500/15 text-slate-500 border-slate-500/30", icon: SkipForward },
  needs_revision: { color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", icon: AlertTriangle },
  rejected: { color: "bg-destructive/15 text-destructive border-destructive/30", icon: Ban },
  blocked: { color: "bg-muted text-muted-foreground border-muted", icon: Ban },
  error: { color: "bg-destructive/15 text-destructive border-destructive/30", icon: Ban },
};

function StepBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? statusConfig.idle;
  const label = status.replace(/_/g, " ").toUpperCase();
  return (
    <Badge variant="outline" className={`text-[10px] font-semibold gap-1 ${cfg.color}`}>
      {cfg.icon && status === "running" ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : cfg.icon ? (
        <cfg.icon className="h-2.5 w-2.5" />
      ) : null}
      {label}
    </Badge>
  );
}

function deriveStepStatus(
  stepKey: string,
  run: RunState,
  running: string | null,
): { status: string; message?: string } {
  // Step 1: Context
  if (stepKey === "context") {
    if (running === "context") return { status: "running" };
    if (run.generation_context_id) return { status: "ready" };
    return { status: "idle" };
  }

  // Step 2: Assemble
  if (stepKey === "assemble") {
    if (running === "assemble") return { status: "running" };
    if (run.last_step === "assemble" && run.overall_state === "rejected") {
      return { status: "rejected", message: "Reprovado pelo Escritor/Avaliador Viral" };
    }
    if (run.script_assembly_id) return { status: "ready" };
    if (!run.generation_context_id) return { status: "blocked", message: "Requer Generation Context" };
    return { status: "idle" };
  }

  // Step 3: Validate
  if (stepKey === "validate") {
    if (running === "validate") return { status: "running" };
    if (run.validation_status) return { status: run.validation_status };
    if (run.last_step === "assemble" && run.overall_state === "rejected") {
      return { status: "blocked", message: "Requer aprovação do Escritor/Avaliador Viral" };
    }
    if (!run.script_assembly_id) return { status: "blocked", message: "Requer Script Assembly" };
    return { status: "idle" };
  }

  // Step 4: Revise — KEY FIX
  if (stepKey === "revise") {
    if (running === "revise") return { status: "running" };
    // If approved → SKIPPED, not idle
    if (run.validation_status === "approved") {
      return { status: "skipped", message: "Revisão não necessária — todos os slots aprovados" };
    }
    if (run.validation_status === "needs_revision" || run.validation_status === "rejected") {
      return { status: "needs_revision", message: "Slots precisam de revisão" };
    }
    if (!run.validation_status) return { status: "blocked", message: "Requer validação primeiro" };
    return { status: "idle" };
  }

  // Step 5: Promote — KEY FIX
  if (stepKey === "promote") {
    if (running === "promote") return { status: "running" };
    if (run.promoted_script_id) return { status: "promoted" };
    if (run.validation_status === "approved") return { status: "ready", message: "Pronto para promoção" };
    if (run.validation_status && run.validation_status !== "approved") {
      return { status: "blocked", message: `Promoção bloqueada — validação: ${run.validation_status}` };
    }
    return { status: "blocked", message: "Aguardando validação aprovada" };
  }

  return { status: "idle" };
}

export function PipelineRunner({
  run, running,
  onBuildContext, onAssemble, onValidate, onRevise, onPromote,
  onRunAll, onCancel,
}: Props) {
  const stepDefs = [
    { key: "context", label: "Generation Context", icon: Database, action: onBuildContext },
    { key: "assemble", label: "Montar Roteiro", icon: FileText, action: onAssemble },
    { key: "validate", label: "Validar contra DNA", icon: ShieldCheck, action: onValidate },
    { key: "revise", label: "Revisar Slots", icon: Wrench, action: onRevise },
    { key: "promote", label: "Promover Final", icon: ArrowUpCircle, action: onPromote },
  ];

  const steps = stepDefs.map((def, idx) => {
    const derived = deriveStepStatus(def.key, run, running);
    const isEnabled = (() => {
      if (running) return false;
      if (run.auto_run) return false;
      if (def.key === "context") return true;
      if (def.key === "assemble") return !!run.generation_context_id;
      if (def.key === "validate") {
        return !!run.script_assembly_id
          && !(run.last_step === "assemble" && run.overall_state === "rejected");
      }
      if (def.key === "revise") return run.validation_status === "needs_revision" || run.validation_status === "rejected";
      if (def.key === "promote") return run.validation_status === "approved" && !run.promoted_script_id;
      return false;
    })();

    return { ...def, ...derived, enabled: isEnabled, number: idx + 1 };
  });

  const canRunAll = !running && !run.auto_run && run.overall_state !== "promoted";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            Pipeline de Execução
          </CardTitle>
          <div className="flex items-center gap-2">
            {run.auto_run ? (
              <Button size="sm" variant="destructive" onClick={onCancel} className="gap-1.5">
                <Square className="h-3.5 w-3.5" />
                Cancelar
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!canRunAll}
                onClick={onRunAll}
                className="gap-1.5 bg-primary hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" />
                Executar Tudo
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{run.pipeline_message ?? "Pipeline pronto"}</span>
            <span className="font-mono">{run.progress_pct}%</span>
          </div>
          <Progress value={run.progress_pct} className="h-2" />
        </div>

        {/* Steps */}
        <div className="space-y-1.5">
          {steps.map((step) => {
            const isActive = running === step.key;
            const isDone = step.status === "ready" || step.status === "approved" || step.status === "promoted" || step.status === "skipped";

            return (
              <div
                key={step.key}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-all ${
                  isActive
                    ? "border-primary/40 bg-primary/5"
                    : isDone
                    ? "border-border bg-muted/10"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold shrink-0 ${
                    isDone ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                    : isActive ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                  }`}>
                    {step.number}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    {step.message && (
                      <p className="text-[11px] text-muted-foreground truncate">{step.message}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <StepBadge status={step.status} />
                  {!run.auto_run && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!step.enabled}
                      onClick={step.action}
                      className="min-w-[72px] h-8 text-xs"
                    >
                      {running === step.key ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Executar"
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Auto-run info */}
        {run.auto_run && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span>Execução automática em andamento — tentativa de revisão {run.auto_run_attempt}/{run.max_auto_revisions}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
