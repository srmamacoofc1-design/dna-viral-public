import { AlertTriangle, CheckCircle2, Eye, Repeat2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface ViralEvaluationView {
  iteration?: number;
  passed?: boolean;
  overall_score?: number;
  metrics_disclaimer?: string;
  failed_gates?: string[];
  estimated_metrics?: Record<string, unknown>;
  criterion_scores?: Record<string, unknown>;
  narrative_fidelity_gate?: {
    required?: boolean;
    passed?: boolean;
    audited_microevents?: number;
    required_audited_microevents?: number;
    reasons?: unknown[];
  } | null;
  feedback?: {
    revision_priorities?: unknown[];
  };
}

interface ViralAuditView {
  iteration?: number;
  evaluator?: {
    overall_score?: number;
    passed?: boolean;
  };
}

interface ViralAgentReportView {
  enabled?: boolean;
  passed?: boolean;
  termination_reason?: string;
  iterations_completed?: number;
  max_iterations?: number;
  metrics_disclaimer?: string;
  error?: string | null;
  thresholds?: Record<string, unknown>;
  final_evaluation?: ViralEvaluationView | null;
  audit_trail?: ViralAuditView[];
}

interface Props {
  report: ViralAgentReportView;
  inputMode?: string;
}

const CRITERION_LABELS: Record<string, string> = {
  hook: "Gancho",
  development: "Desenvolvimento",
  payoff: "Desfecho / payoff",
  visual_fidelity: "Fidelidade visual",
  dna_strategy_application: "Aplicação do DNA",
  originality: "Originalidade",
  pacing: "Ritmo",
};

function numeric(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function resultLabel(report: ViralAgentReportView, passed: boolean): string {
  if (passed) return "Aprovado pelo Avaliador";
  switch (report.termination_reason) {
    case "max_iterations_reached":
      return "Limite de revisões atingido";
    case "evaluator_error":
      return "Erro no Avaliador Viral";
    case "writer_error":
      return "Erro no Escritor DNA";
    case "required_report_missing":
      return "Relatório obrigatório ausente";
    default:
      return "Reprovado pelo Avaliador";
  }
}

function MetricCard({
  label,
  value,
  target,
  passed,
  inverse = false,
}: {
  label: string;
  value: number | null;
  target: number;
  passed: boolean;
  inverse?: boolean;
}) {
  const display = value === null ? "—" : `${value.toFixed(1)}%`;
  const progressValue = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold text-foreground">{display}</p>
        </div>
        {passed
          ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          : <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />}
      </div>
      <Progress value={progressValue} className="h-2" />
      <p className="text-[11px] text-muted-foreground">
        Meta: {inverse ? "menos de" : "pelo menos"} {target}%
      </p>
    </div>
  );
}

export function ViralAgentReport({ report, inputMode }: Props) {
  if (!report || report.enabled === false) return null;

  const evaluation = report.final_evaluation ?? null;
  const estimates = evaluation?.estimated_metrics ?? {};
  const thresholds = report.thresholds ?? {};
  const continueTarget = numeric(thresholds.continue_rate_percent_min ?? thresholds.continue_rate_percent) ?? 86;
  const skipTarget = numeric(thresholds.skip_rate_percent_max_exclusive ?? thresholds.skip_rate_percent) ?? 10;
  const avgViewTarget = numeric(thresholds.avg_view_percentage_min ?? thresholds.avg_view_percentage) ?? 90;
  const continueRate = numeric(estimates.continue_rate_percent);
  const skipRate = numeric(estimates.skip_rate_percent);
  const avgView = numeric(estimates.avg_view_percentage);
  const scores = evaluation?.criterion_scores && typeof evaluation.criterion_scores === "object"
    ? Object.entries(evaluation.criterion_scores)
    : [];
  const priorities = Array.isArray(evaluation?.feedback?.revision_priorities)
    ? evaluation.feedback.revision_priorities
    : [];
  const auditTrail = Array.isArray(report.audit_trail) ? report.audit_trail : [];
  const narrativeGate = evaluation?.narrative_fidelity_gate ?? null;
  const narrativeRequired = narrativeGate?.required === true;
  const auditedMicroevents = numeric(narrativeGate?.audited_microevents) ?? 0;
  const requiredMicroevents = numeric(narrativeGate?.required_audited_microevents) ?? 0;
  const narrativeEvidenceRequired = inputMode === "video" || narrativeRequired;
  const narrativePassed = narrativeRequired
    && narrativeGate?.passed === true
    && requiredMicroevents > 0
    && auditedMicroevents === requiredMicroevents
    && (!Array.isArray(narrativeGate?.reasons) || narrativeGate.reasons.length === 0);
  const passed = report.passed === true
    && evaluation?.passed === true
    && (!narrativeEvidenceRequired || narrativePassed);

  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/15 p-2">
            <Repeat2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Escritor DNA ↔ Avaliador Viral</h2>
            <p className="text-xs text-muted-foreground mt-1">
              O Escritor aplica a estratégia do preset ao conteúdo visual; o Avaliador reprova e pede revisão quando os critérios não são atendidos.
            </p>
          </div>
        </div>
        <Badge className={passed
          ? "bg-green-500/15 text-green-600 border-green-500/30"
          : "bg-amber-500/15 text-amber-600 border-amber-500/30"}
          variant="outline"
        >
          {resultLabel(report, passed)}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary"><Sparkles className="h-3 w-3 mr-1" /> Agente: Escritor DNA</Badge>
        <Badge variant="secondary"><Eye className="h-3 w-3 mr-1" /> Agente: Avaliador Viral</Badge>
        {narrativeEvidenceRequired && (
          <Badge variant="secondary"><Eye className="h-3 w-3 mr-1" /> Auditor factual independente</Badge>
        )}
        <Badge variant="outline">
          {Number(report.iterations_completed ?? evaluation?.iteration ?? 0)} iteração(ões)
        </Badge>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-medium text-foreground">Previsão técnica de retenção</h3>
          <Badge variant="outline">Estimativa pré-publicação</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Continuaram assistindo"
            value={continueRate}
            target={continueTarget}
            passed={continueRate !== null && continueRate >= continueTarget}
          />
          <MetricCard
            label="Pularam o vídeo"
            value={skipRate}
            target={skipTarget}
            passed={skipRate !== null && skipRate < skipTarget}
            inverse
          />
          <MetricCard
            label="Duração média assistida"
            value={avgView}
            target={avgViewTarget}
            passed={avgView !== null && avgView >= avgViewTarget}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          “Continuaram” e “pularam” também precisam somar aproximadamente 100% (tolerância de 1 ponto).
        </p>
      </div>

      {scores.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Qualidade narrativa e visual</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {scores.map(([key, rawValue]) => {
              const value = numeric(rawValue);
              return (
                <div key={key} className="flex items-center gap-3 rounded-md border border-border/70 bg-background/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground flex-1">{CRITERION_LABELS[key] ?? key}</span>
                  <Progress value={value === null ? 0 : value * 10} className="h-1.5 w-24" />
                  <span className="text-xs font-semibold tabular-nums w-12 text-right">{value === null ? "—" : `${value.toFixed(1)}/10`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {narrativeEvidenceRequired && (
        <div className={`rounded-lg border p-3 ${narrativePassed
          ? "border-green-500/25 bg-green-500/10"
          : "border-amber-500/25 bg-amber-500/10"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Fidelidade factual por microevento</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {auditedMicroevents}/{requiredMicroevents} eventos auditados; a aprovação exige cobertura integral,
                causalidade preservada e nenhum fato inventado ou deslocado entre blocos.
              </p>
            </div>
            {narrativePassed
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
              : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />}
          </div>
        </div>
      )}

      {!passed && priorities.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">Correções pedidas pelo Avaliador</p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
            {priorities.slice(0, 8).map((priority: unknown, index: number) => (
              <li key={index}>{String(priority)}</li>
            ))}
          </ul>
        </div>
      )}

      {!passed && report.error && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
          {report.error}
        </p>
      )}

      {auditTrail.length > 0 && (
        <details className="rounded-lg border border-border bg-background/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Ver auditoria das {auditTrail.length} iteração(ões)
          </summary>
          <div className="mt-3 space-y-2">
            {auditTrail.map((item, index: number) => (
              <div key={index} className="rounded-md border border-border/70 p-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Iteração {item?.iteration ?? index + 1}</span>
                {item?.evaluator?.overall_score != null && ` • nota ${item.evaluator.overall_score}`}
                {item?.evaluator?.passed === true ? " • aprovada" : " • revisada"}
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {report.metrics_disclaimer
          ?? evaluation?.metrics_disclaimer
          ?? "Estas métricas são estimativas da IA antes da publicação. O resultado real depende da audiência, distribuição, edição, thumbnail, horário e plataforma, e só pode ser medido após publicar."}
      </p>
    </section>
  );
}
