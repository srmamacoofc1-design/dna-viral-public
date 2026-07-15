import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { applyDnaStylePack } from "@/lib/dna-style-pack";
import { toast } from "sonner";
import { Cog } from "lucide-react";
import { ModeSelector, type EngineMode } from "@/components/script-engine/ModeSelector";
import { InputPanel } from "@/components/script-engine/InputPanel";
import { PipelineRunner } from "@/components/script-engine/PipelineRunner";
import { RunStatusCard } from "@/components/script-engine/RunStatusCard";
import { ValidationSummary } from "@/components/script-engine/ValidationSummary";
import { ScriptPreview } from "@/components/script-engine/ScriptPreview";
import { ViralAgentReport } from "@/components/script-engine/ViralAgentReport";
import { AssemblyHistory } from "@/components/script-engine/AssemblyHistory";
import { HeaderStats } from "@/components/script-engine/HeaderStats";
import {
  assertRequiredDnaInjection,
  buildGenerationContextPayload,
  generationInputError,
} from "@/services/generation-input";

export type PipelineStepStatus =
  | "idle"
  | "running"
  | "ready"
  | "approved"
  | "skipped"
  | "blocked"
  | "needs_revision"
  | "rejected"
  | "promoted"
  | "error";

export interface RunState {
  mode: EngineMode;
  generation_context_id: string | null;
  script_assembly_id: string | null;
  validation_status: string | null;
  promoted_script_id: string | null;
  validation_version: number | null;
  last_step: string | null;
  overall_state: string;
  // Auto-run fields
  auto_run: boolean;
  auto_run_attempt: number;
  max_auto_revisions: number;
  pipeline_message: string | null;
  progress_pct: number;
}

const initialRun: RunState = {
  mode: "video",
  generation_context_id: null,
  script_assembly_id: null,
  validation_status: null,
  promoted_script_id: null,
  validation_version: null,
  last_step: null,
  overall_state: "idle",
  auto_run: false,
  auto_run_attempt: 0,
  max_auto_revisions: 2,
  pipeline_message: null,
  progress_pct: 0,
};

type UnknownRecord = Record<string, unknown>;

export interface DashboardWriterEvaluatorGate {
  passed: boolean;
  message: string | null;
}

const REQUIRED_VIRAL_THRESHOLDS = {
  continue_rate_percent_min: 86,
  skip_rate_percent_max_exclusive: 10,
  avg_view_percentage_min: 90,
  overall_score_min: 9,
  critical_criterion_score_min: 8.5,
  engagement_complement_tolerance_points: 1,
} as const;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function writerEvaluatorReportFromAssembly(value: unknown): unknown {
  const assemblyRow = record(value);
  const rules = record(assemblyRow?.assembly_rules);
  return rules?.writer_evaluator_loop;
}

function rejectedWriterEvaluatorMessage(report: UnknownRecord | null): string {
  const terminationReason = String(report?.termination_reason || "");
  if (terminationReason === "writer_error") {
    return "Roteiro rejeitado: o Escritor DNA não conseguiu cumprir os contratos exigidos pelo Avaliador Viral.";
  }
  if (terminationReason === "evaluator_error") {
    return "Roteiro rejeitado: o Avaliador Viral não conseguiu concluir a avaliação independente.";
  }
  if (terminationReason === "max_iterations_reached") {
    return "Roteiro rejeitado: as metas de retenção não foram atingidas dentro do limite de revisões.";
  }
  return "Roteiro rejeitado pelo Escritor/Avaliador Viral. Nenhuma etapa seguinte foi liberada.";
}

/**
 * The dashboard is an operational surface, not a bypass around the public
 * generation gate. For video inputs, an assembly ID is useful for diagnostics
 * but is never proof that the Writer/Evaluator accepted the script.
 */
export function dashboardWriterEvaluatorGate(
  inputMode: EngineMode,
  value: unknown,
): DashboardWriterEvaluatorGate {
  if (inputMode !== "video") return { passed: true, message: null };

  const report = record(value);
  if (!report || report.enabled !== true || report.passed !== true) {
    return { passed: false, message: rejectedWriterEvaluatorMessage(report) };
  }

  const thresholds = record(report.thresholds);
  const evaluation = record(report.final_evaluation);
  const estimated = record(evaluation?.estimated_metrics);
  const scores = record(evaluation?.criterion_scores);
  const auditTrail = Array.isArray(report.audit_trail) ? report.audit_trail : [];
  const lastAudit = record(auditTrail.at(-1));
  const lastAuditEvaluation = record(lastAudit?.evaluator);
  const narrativeGate = record(evaluation?.narrative_fidelity_gate);

  const configured = thresholds && {
    continueMin: finite(thresholds.continue_rate_percent_min),
    skipMax: finite(thresholds.skip_rate_percent_max_exclusive),
    avgViewMin: finite(thresholds.avg_view_percentage_min),
    overallMin: finite(thresholds.overall_score_min),
    criticalMin: finite(thresholds.critical_criterion_score_min),
    complementTolerance: finite(thresholds.engagement_complement_tolerance_points),
  };
  const thresholdsAreValid = configured
    && configured.continueMin !== null
    && configured.continueMin >= REQUIRED_VIRAL_THRESHOLDS.continue_rate_percent_min
    && configured.skipMax !== null
    && configured.skipMax > 0
    && configured.skipMax <= REQUIRED_VIRAL_THRESHOLDS.skip_rate_percent_max_exclusive
    && configured.avgViewMin !== null
    && configured.avgViewMin >= REQUIRED_VIRAL_THRESHOLDS.avg_view_percentage_min
    && configured.overallMin !== null
    && configured.overallMin >= REQUIRED_VIRAL_THRESHOLDS.overall_score_min
    && configured.criticalMin !== null
    && configured.criticalMin >= REQUIRED_VIRAL_THRESHOLDS.critical_criterion_score_min
    && configured.complementTolerance !== null
    && configured.complementTolerance >= 0
    && configured.complementTolerance <= REQUIRED_VIRAL_THRESHOLDS.engagement_complement_tolerance_points;

  if (!configured || !thresholdsAreValid || !evaluation || evaluation.passed !== true || !estimated || !scores) {
    return {
      passed: false,
      message: "Roteiro bloqueado: o relatório do Avaliador Viral está ausente, inválido ou usa limiares abaixo das metas obrigatórias.",
    };
  }

  const continueRate = finite(estimated.continue_rate_percent);
  const skipRate = finite(estimated.skip_rate_percent);
  const avgView = finite(estimated.avg_view_percentage);
  const overallScore = finite(evaluation.overall_score);
  const criticalScores = ["hook", "development", "payoff", "visual_fidelity"]
    .map((criterion) => finite(scores[criterion]));
  const failedGates = Array.isArray(evaluation.failed_gates) ? evaluation.failed_gates : null;
  const auditedMicroevents = finite(narrativeGate?.audited_microevents);
  const requiredMicroevents = finite(narrativeGate?.required_audited_microevents);
  const narrativeReasons = Array.isArray(narrativeGate?.reasons) ? narrativeGate.reasons : null;

  const measuredGatesPassed = continueRate !== null
    && continueRate >= configured.continueMin!
    && skipRate !== null
    && skipRate < configured.skipMax!
    && Math.abs(continueRate + skipRate - 100) <= configured.complementTolerance!
    && avgView !== null
    && avgView >= configured.avgViewMin!
    && overallScore !== null
    && overallScore >= configured.overallMin!
    && criticalScores.every((score) => score !== null && score >= configured.criticalMin!)
    && failedGates !== null
    && failedGates.length === 0;
  const narrativeGatePassed = narrativeGate?.required === true
    && narrativeGate.passed === true
    && requiredMicroevents !== null
    && requiredMicroevents > 0
    && auditedMicroevents === requiredMicroevents
    && narrativeReasons !== null
    && narrativeReasons.length === 0;
  const auditIsValid = auditTrail.length > 0 && lastAuditEvaluation?.passed === true;

  if (!measuredGatesPassed || !narrativeGatePassed || !auditIsValid) {
    return {
      passed: false,
      message: "Roteiro bloqueado: o relatório recebido não comprova todos os limiares de retenção, fidelidade visual e auditoria independente.",
    };
  }

  return { passed: true, message: null };
}

export default function ScriptEnginePage() {
  const [mode, setMode] = useState<EngineMode>("video");
  const [run, setRun] = useState<RunState>(initialRun);
  const [assembly, setAssembly] = useState<any>(null);
  const [promoted, setPromoted] = useState<any>(null);
  const [genContext, setGenContext] = useState<any>(null);
  const [running, setRunning] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Input state
  const [inputData, setInputData] = useState<Record<string, any>>({});

  const updateRun = useCallback((patch: Partial<RunState>) => {
    setRun((prev) => ({ ...prev, ...patch }));
  }, []);

  // Load assembly data when ID changes
  useEffect(() => {
    if (!run.script_assembly_id) { setAssembly(null); return; }
    supabase
      .from("script_assemblies")
      .select("*")
      .eq("id", run.script_assembly_id)
      .single()
      .then(({ data }) => { if (data) setAssembly(data); });
  }, [run.script_assembly_id]);

  // Load promoted when ID changes
  useEffect(() => {
    if (!run.promoted_script_id) { setPromoted(null); return; }
    supabase
      .from("promoted_scripts")
      .select("*")
      .eq("id", run.promoted_script_id)
      .single()
      .then(({ data }) => { if (data) setPromoted(data); });
  }, [run.promoted_script_id]);

  // Pipeline step handlers
  async function callEdge(fn: string, body: Record<string, any>) {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) throw new Error(error.message ?? `Edge function ${fn} failed`);
    return data;
  }

  async function runBuildContext(): Promise<string | null> {
    const inputError = generationInputError(mode, inputData);
    if (inputError) {
      toast.error(inputError);
      updateRun({ overall_state: "error", pipeline_message: inputError, progress_pct: 0 });
      return null;
    }
    setRunning("context");
    updateRun({ overall_state: "running", last_step: "context", pipeline_message: "Construindo contexto de geração...", progress_pct: 5 });
    try {
      // If video mode, run topic analysis first
      if (mode === "video" && inputData.reference_video_id) {
        updateRun({ pipeline_message: "Analisando tópicos do vídeo...", progress_pct: 8 });
        const topicResult = await callEdge("analyze-reference-topics", {
          reference_video_id: inputData.reference_video_id,
        });
        if (topicResult?.status !== "ready") {
          throw new Error(`Análise visual obrigatória não concluída: ${topicResult?.error || "resposta inválida"}`);
        }
      }

      updateRun({ pipeline_message: "Construindo contexto de geração...", progress_pct: 12 });
      const result = await callEdge("build-complete-generation-context", buildGenerationContextPayload(mode, inputData));
      const gcId = result?.generation_context_id ?? result?.id;
      if (!gcId) throw new Error("No generation_context_id returned");

      updateRun({ pipeline_message: "Injetando DNA de estilo da base viral...", progress_pct: 16 });
      const targetLang = String(inputData.language || "").toLowerCase().startsWith("en") ? "en" : "pt";
      const styleResult = await applyDnaStylePack(gcId, targetLang, {
        presetId: inputData.dna_preset_id ?? null,
        hookApelao: inputData.hook_apelao ?? true,
      });
      assertRequiredDnaInjection(styleResult, mode, inputData.dna_preset_id ?? null);
      if (!styleResult.injected) {
        console.warn("Style pack não injetado:", styleResult.reason);
      }

      updateRun({
        generation_context_id: gcId,
        overall_state: "ready",
        last_step: "context",
        pipeline_message: "Contexto pronto",
        progress_pct: 20,
      });
      setGenContext(result);
      toast.success("Generation Context criado");
      return gcId;
    } catch (err: any) {
      toast.error(err.message);
      updateRun({ overall_state: "error", last_step: "context", pipeline_message: `Erro: ${err.message}`, progress_pct: 0 });
      return null;
    } finally {
      setRunning(null);
    }
  }

  async function runAssemble(gcId?: string): Promise<string | null> {
    const contextId = gcId ?? run.generation_context_id;
    if (!contextId) return null;
    setRunning("assemble");
    updateRun({ overall_state: "running", last_step: "assemble", pipeline_message: "Montando roteiro...", progress_pct: 30 });
    try {
      const result = await callEdge("assemble-script", {
        generation_context_id: contextId,
      });
      const saId = result?.assembly_id ?? result?.script_assembly_id ?? result?.id;
      if (!saId) throw new Error("No assembly_id returned");
      updateRun({
        script_assembly_id: saId,
        validation_status: null,
        validation_version: null,
        promoted_script_id: null,
        overall_state: "running",
        last_step: "assemble",
        pipeline_message: "Roteiro persistido. Conferindo o Escritor e o Avaliador Viral...",
        progress_pct: 38,
      });

      const { data: freshAssembly } = await supabase
        .from("script_assemblies")
        .select("*")
        .eq("id", saId)
        .maybeSingle();
      if (freshAssembly) setAssembly(freshAssembly);
      const writerEvaluatorReport = writerEvaluatorReportFromAssembly(freshAssembly)
        ?? result?.writer_evaluator_loop;
      const writerEvaluatorGate = dashboardWriterEvaluatorGate(mode, writerEvaluatorReport);
      if (!writerEvaluatorGate.passed) {
        const message = writerEvaluatorGate.message
          || "Roteiro rejeitado pelo Escritor/Avaliador Viral.";
        updateRun({
          script_assembly_id: saId,
          overall_state: "rejected",
          last_step: "assemble",
          pipeline_message: message,
          progress_pct: 40,
        });
        toast.error(message);
        return null;
      }

      updateRun({
        script_assembly_id: saId,
        overall_state: "ready",
        last_step: "assemble",
        pipeline_message: mode === "video"
          ? "Roteiro aprovado pelo Escritor e pelo Avaliador Viral"
          : "Roteiro montado",
        progress_pct: 40,
      });
      toast.success(mode === "video"
        ? "Roteiro aprovado pelo Escritor e pelo Avaliador Viral"
        : "Script montado com sucesso");
      return saId;
    } catch (err: any) {
      toast.error(err.message);
      updateRun({ overall_state: "error", last_step: "assemble", pipeline_message: `Erro: ${err.message}`, progress_pct: 20 });
      return null;
    } finally {
      setRunning(null);
    }
  }

  async function runValidate(saId?: string): Promise<string | null> {
    const assemblyId = saId ?? run.script_assembly_id;
    if (!assemblyId) return null;
    if (mode === "video") {
      let assemblyForGate = assembly?.id === assemblyId ? assembly : null;
      if (!assemblyForGate) {
        const { data } = await supabase
          .from("script_assemblies")
          .select("*")
          .eq("id", assemblyId)
          .maybeSingle();
        assemblyForGate = data;
        if (data) setAssembly(data);
      }
      const writerEvaluatorGate = dashboardWriterEvaluatorGate(
        mode,
        writerEvaluatorReportFromAssembly(assemblyForGate),
      );
      if (!writerEvaluatorGate.passed) {
        const message = writerEvaluatorGate.message
          || "Validação bloqueada: o Escritor/Avaliador Viral não aprovou este roteiro.";
        updateRun({
          overall_state: "rejected",
          last_step: "assemble",
          validation_status: null,
          pipeline_message: message,
          progress_pct: 40,
        });
        toast.error(message);
        return null;
      }
    }
    setRunning("validate");
    updateRun({ overall_state: "running", last_step: "validate", pipeline_message: "Validando contra DNA viral...", progress_pct: 50 });
    try {
      const result = await callEdge("validate-script-against-dna", {
        script_assembly_id: assemblyId,
      });
      const vs = result?.validation_status ?? "error";
      updateRun({
        validation_status: vs,
        validation_version: result?.validation_version ?? 1,
        overall_state: vs === "approved" ? "approved" : vs,
        last_step: "validate",
        pipeline_message: vs === "approved" ? "Validação aprovada" : `Validação: ${vs}`,
        progress_pct: 60,
      });
      // Refresh assembly to get validation_result
      const { data: fresh } = await supabase
        .from("script_assemblies")
        .select("*")
        .eq("id", assemblyId)
        .single();
      if (fresh) setAssembly(fresh);
      toast.success(`Validação: ${vs}`);
      return vs;
    } catch (err: any) {
      toast.error(err.message);
      updateRun({ overall_state: "error", last_step: "validate", pipeline_message: `Erro: ${err.message}`, progress_pct: 40 });
      return null;
    } finally {
      setRunning(null);
    }
  }

  async function runRevise(saId?: string): Promise<string | null> {
    const assemblyId = saId ?? run.script_assembly_id;
    if (!assemblyId) return null;
    setRunning("revise");
    updateRun({ overall_state: "running", last_step: "revise", pipeline_message: "Revisando slots reprovados...", progress_pct: 65 });
    try {
      const result = await callEdge("revise-script-assembly", {
        script_assembly_id: assemblyId,
      });
      const newId = result?.new_script_assembly_id;
      if (!newId) throw new Error("No new assembly created");
      updateRun({
        script_assembly_id: newId,
        validation_status: null,
        overall_state: "ready",
        last_step: "revise",
        pipeline_message: "Revisão concluída — revalidando...",
        progress_pct: 70,
      });
      toast.success("Revisão cirúrgica concluída — nova versão criada");
      return newId;
    } catch (err: any) {
      toast.error(err.message);
      updateRun({ overall_state: "error", last_step: "revise", pipeline_message: `Erro: ${err.message}`, progress_pct: 60 });
      return null;
    } finally {
      setRunning(null);
    }
  }

  async function runPromote(saId?: string): Promise<boolean> {
    const assemblyId = saId ?? run.script_assembly_id;
    if (!assemblyId) return false;
    setRunning("promote");
    updateRun({ overall_state: "running", last_step: "promote", pipeline_message: "Promovendo versão final...", progress_pct: 90 });
    try {
      const result = await callEdge("promote-script-final", {
        script_assembly_id: assemblyId,
      });
      if (result?.status === "promoted") {
        updateRun({
          promoted_script_id: result?.video_script_id ?? result?.promoted_script_id,
          overall_state: "promoted",
          last_step: "promote",
          pipeline_message: "✅ Roteiro final pronto!",
          progress_pct: 100,
        });
        toast.success("Script promovido com sucesso!");
        return true;
      } else if (result?.status === "already_promoted") {
        updateRun({ overall_state: "promoted", last_step: "promote", pipeline_message: "Script já estava promovido", progress_pct: 100 });
        toast.info("Script já estava promovido");
        return true;
      } else {
        throw new Error(result?.status_reason ?? `Status: ${result?.status}`);
      }
    } catch (err: any) {
      toast.error(err.message);
      updateRun({ overall_state: "error", last_step: "promote", pipeline_message: `Erro: ${err.message}`, progress_pct: 60 });
      return false;
    } finally {
      setRunning(null);
    }
  }

  // ─── AUTO-RUN ───────────────────────────────────
  async function runFullPipeline() {
    cancelRef.current = false;
    updateRun({ auto_run: true, auto_run_attempt: 0, pipeline_message: "Iniciando pipeline automático...", progress_pct: 0 });

    // Step 1: Context
    const gcId = await runBuildContext();
    if (!gcId || cancelRef.current) { updateRun({ auto_run: false }); return; }

    // Step 2: Assemble
    const saId = await runAssemble(gcId);
    if (!saId || cancelRef.current) { updateRun({ auto_run: false }); return; }

    // Step 3: Validate
    let vs = await runValidate(saId);
    if (!vs || cancelRef.current) { updateRun({ auto_run: false }); return; }

    let currentSaId = saId;
    let attempt = 0;
    const maxRevisions = run.max_auto_revisions;

    // Revision loop
    while (vs === "needs_revision" && attempt < maxRevisions && !cancelRef.current) {
      attempt++;
      updateRun({ auto_run_attempt: attempt, pipeline_message: `Revisão automática ${attempt}/${maxRevisions}...` });

      // Revise
      const newSaId = await runRevise(currentSaId);
      if (!newSaId || cancelRef.current) { updateRun({ auto_run: false }); return; }
      currentSaId = newSaId;

      // Re-validate
      updateRun({ pipeline_message: `Revalidando após revisão ${attempt}...` });
      vs = await runValidate(currentSaId);
      if (!vs || cancelRef.current) { updateRun({ auto_run: false }); return; }
    }

    if (vs === "needs_revision") {
      updateRun({
        auto_run: false,
        pipeline_message: `Execução interrompida após ${maxRevisions} tentativas de revisão. Validação ainda não atingiu aprovação.`,
        progress_pct: 70,
      });
      toast.warning(`Pipeline parou após ${maxRevisions} revisões — não atingiu aprovação`);
      return;
    }

    if (vs === "rejected") {
      updateRun({
        auto_run: false,
        pipeline_message: "Script rejeitado pela validação. Revisão manual necessária.",
        progress_pct: 60,
      });
      return;
    }

    if (vs !== "approved") {
      updateRun({ auto_run: false, pipeline_message: `Validação retornou status inesperado: ${vs}` });
      return;
    }

    // If approved, skip revise → promote
    updateRun({ pipeline_message: "Revisão não necessária — todos os slots aprovados", progress_pct: 80 });

    // Step 5: Promote
    const ok = await runPromote(currentSaId);
    updateRun({ auto_run: false });
    if (!ok) {
      updateRun({ pipeline_message: "Falha ao promover script final" });
    }
  }

  function cancelAutoRun() {
    cancelRef.current = true;
    updateRun({ auto_run: false, pipeline_message: "Pipeline cancelado pelo usuário" });
    toast.info("Pipeline cancelado");
  }

  function handleSelectAssembly(sa: any) {
    const selectedRules = record(sa?.assembly_rules);
    const selectedMode = selectedRules?.input_mode === "video"
      || selectedRules?.input_mode === "theme"
      || selectedRules?.input_mode === "transform"
      ? selectedRules.input_mode as EngineMode
      : mode;
    const writerEvaluatorGate = dashboardWriterEvaluatorGate(
      selectedMode,
      selectedRules?.writer_evaluator_loop,
    );
    const evaluatorRejected = selectedMode === "video" && !writerEvaluatorGate.passed;
    updateRun({
      script_assembly_id: sa.id,
      generation_context_id: sa.source_generation_context_id,
      validation_status: evaluatorRejected ? null : sa.validation_status,
      validation_version: evaluatorRejected ? null : sa.validation_version,
      promoted_script_id: null,
      last_step: evaluatorRejected ? "assemble" : sa.validation_status ? "validate" : "assemble",
      overall_state: evaluatorRejected
        ? "rejected"
        : sa.status === "final" ? "promoted" : sa.validation_status ?? "ready",
      pipeline_message: evaluatorRejected ? writerEvaluatorGate.message : null,
      progress_pct: evaluatorRejected ? 40 : sa.status === "final" ? 100 : sa.validation_status === "approved" ? 60 : 40,
      auto_run: false,
      auto_run_attempt: 0,
    });
  }

  function handleModeChange(nextMode: EngineMode) {
    cancelRef.current = true;
    setMode(nextMode);
    setInputData((previous) => ({
      dna_preset_id: previous.dna_preset_id,
      hook_apelao: previous.hook_apelao,
      language: previous.language,
      notes: previous.notes,
    }));
    setRun({ ...initialRun, mode: nextMode });
    setAssembly(null);
    setPromoted(null);
    setGenContext(null);
    setRunning(null);
  }

  function handleInputChange(nextInput: Record<string, any>) {
    const contextSensitiveKeys = [
      "reference_video_id", "reference_video_ready", "theme", "niche", "objective",
      "original_script", "preserve_meaning", "language", "notes", "dna_preset_id", "hook_apelao",
    ];
    const changed = contextSensitiveKeys.some((key) => inputData[key] !== nextInput[key]);
    setInputData(nextInput);
    if (changed && run.generation_context_id) {
      cancelRef.current = true;
      setRun({ ...initialRun, mode, pipeline_message: "Entrada ou DNA alterado — reconstrua o contexto antes de montar." });
      setAssembly(null);
      setPromoted(null);
      setGenContext(null);
      setRunning(null);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cog className="h-6 w-6 text-primary" />
            Script Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Console operacional de engenharia viral de roteiros
          </p>
        </div>
      </div>

      <HeaderStats />

      <ModeSelector mode={mode} onModeChange={handleModeChange} />

      <InputPanel key={mode} mode={mode} inputData={inputData} onChange={handleInputChange} />

      <PipelineRunner
        run={run}
        running={running}
        onBuildContext={runBuildContext}
        onAssemble={() => runAssemble()}
        onValidate={() => runValidate()}
        onRevise={() => runRevise()}
        onPromote={() => runPromote()}
        onRunAll={runFullPipeline}
        onCancel={cancelAutoRun}
      />

      <RunStatusCard run={run} />

      {assembly?.validation_result && (
        <ValidationSummary
          validationResult={assembly.validation_result}
          validationStatus={assembly.validation_status}
          onRevise={run.validation_status === "needs_revision" || run.validation_status === "rejected" ? () => runRevise() : undefined}
          revising={running === "revise"}
        />
      )}

      {assembly?.assembly_rules?.writer_evaluator_loop && (
        <ViralAgentReport
          report={assembly.assembly_rules.writer_evaluator_loop}
          inputMode={assembly.assembly_rules.input_mode || mode}
        />
      )}

      <ScriptPreview assembly={assembly} promoted={promoted} />

      <AssemblyHistory onSelect={handleSelectAssembly} currentId={run.script_assembly_id} />
    </div>
  );
}
