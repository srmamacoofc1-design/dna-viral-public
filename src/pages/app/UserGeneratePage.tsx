import { useState, useCallback, useMemo, useRef, type ComponentProps } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { applyDnaStylePack } from "@/lib/dna-style-pack";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ModeSelector, type EngineMode } from "@/components/script-engine/ModeSelector";
import { InputPanel } from "@/components/script-engine/InputPanel";
import { RunStatusCard } from "@/components/script-engine/RunStatusCard";
import { ScriptPreview } from "@/components/script-engine/ScriptPreview";
import { ViralAgentReport } from "@/components/script-engine/ViralAgentReport";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, ListVideo, Loader2, Sparkles, Play, Square } from "lucide-react";
import type { RunState } from "@/pages/dashboard/ScriptEnginePage";
import {
  referenceQueueReadyForGeneration,
  type ReferenceLinkQueueEntry,
} from "@/lib/reference-link-queue";
import {
  assertRequiredDnaInjection,
  buildGenerationContextPayload,
  generationInputError,
} from "@/services/generation-input";

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

type ScriptAssembly = Database["public"]["Tables"]["script_assemblies"]["Row"];
type PromotedScript = Database["public"]["Tables"]["promoted_scripts"]["Row"];
type ViralAgentReportData = ComponentProps<typeof ViralAgentReport>["report"];
type ViralEvaluationData = NonNullable<ViralAgentReportData["final_evaluation"]>;
type ViralAuditData = NonNullable<ViralAgentReportData["audit_trail"]>[number];
type GenerationInput = Record<string, unknown>;
type UnknownRecord = Record<string, unknown>;

type PipelineExecutionStatus = "completed" | "failed" | "cancelled";

interface PipelineExecutionResult {
  status: PipelineExecutionStatus;
  message?: string;
  promotedScriptId?: string;
}

interface BatchGenerationItem {
  clientId: string;
  referenceVideoId: string;
  label: string;
  status: "pending" | "running" | PipelineExecutionStatus;
  promotedScriptId?: string;
  error?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOptionalType(
  record: UnknownRecord,
  key: string,
  expectedType: "boolean" | "number" | "string",
): boolean {
  return record[key] === undefined || typeof record[key] === expectedType;
}

function isViralEvaluation(value: unknown): value is ViralEvaluationData {
  if (!isRecord(value)) return false;
  if (!hasOptionalType(value, "iteration", "number")) return false;
  if (!hasOptionalType(value, "passed", "boolean")) return false;
  if (!hasOptionalType(value, "overall_score", "number")) return false;
  if (!hasOptionalType(value, "metrics_disclaimer", "string")) return false;
  if (value.failed_gates !== undefined && !Array.isArray(value.failed_gates)) return false;
  if (value.estimated_metrics !== undefined && !isRecord(value.estimated_metrics)) return false;
  if (value.criterion_scores !== undefined && !isRecord(value.criterion_scores)) return false;
  if (value.feedback !== undefined) {
    if (!isRecord(value.feedback)) return false;
    if (value.feedback.revision_priorities !== undefined && !Array.isArray(value.feedback.revision_priorities)) return false;
  }
  return true;
}

function isViralAudit(value: unknown): value is ViralAuditData {
  if (!isRecord(value) || !hasOptionalType(value, "iteration", "number")) return false;
  if (value.evaluator === undefined) return true;
  return isRecord(value.evaluator)
    && hasOptionalType(value.evaluator, "overall_score", "number")
    && hasOptionalType(value.evaluator, "passed", "boolean");
}

function asViralAgentReport(value: unknown): ViralAgentReportData | null {
  if (!isRecord(value)) return null;
  if (!hasOptionalType(value, "enabled", "boolean")) return null;
  if (!hasOptionalType(value, "passed", "boolean")) return null;
  if (!hasOptionalType(value, "termination_reason", "string")) return null;
  if (!hasOptionalType(value, "iterations_completed", "number")) return null;
  if (!hasOptionalType(value, "max_iterations", "number")) return null;
  if (!hasOptionalType(value, "metrics_disclaimer", "string")) return null;
  if (value.error !== undefined && value.error !== null && typeof value.error !== "string") return null;
  if (value.thresholds !== undefined && !isRecord(value.thresholds)) return null;
  if (value.final_evaluation !== undefined
    && value.final_evaluation !== null
    && !isViralEvaluation(value.final_evaluation)) return null;
  if (value.audit_trail !== undefined
    && (!Array.isArray(value.audit_trail) || !value.audit_trail.every(isViralAudit))) return null;
  return value;
}

function reportFromAssembly(assembly: ScriptAssembly | null): ViralAgentReportData | null {
  const rules = assembly?.assembly_rules;
  if (!isRecord(rules)) return null;
  return asViralAgentReport(rules.writer_evaluator_loop);
}

function missingAgentReport(error?: string): ViralAgentReportData {
  return {
    enabled: true,
    passed: false,
    termination_reason: "required_report_missing",
    iterations_completed: 0,
    max_iterations: 4,
    final_evaluation: null,
    audit_trail: [],
    error: error ?? "O backend não devolveu o relatório obrigatório dos dois agentes.",
  };
}

function errorMessage(error: unknown, fallback = "Erro inesperado"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Edge Functions deliberately return terse errors so a provider response can
 * never leak credentials into the UI. Translate known transient cases into an
 * actionable message while keeping unknown failures available for support.
 */
function readablePipelineError(error: unknown): string {
  const raw = errorMessage(error);
  const normalized = raw.toLowerCase();
  if (/(?:429|quota|rate.?limit|resource.?exhausted|suspend|forbidden|\b403\b|\b503\b|overload)/.test(normalized)) {
    return "A IA configurada está sem quota ou capacidade neste momento. Seu vídeo e a Base Viral foram preservados; tente novamente quando houver uma chave Gemini ativa com quota.";
  }
  if (/(?:gemini_total_timeout|structured_agent_http|semantic_guard_|failed to send a request|functionsfetcherror)/.test(normalized)) {
    return "O serviço de IA não respondeu a tempo para concluir a revisão. Seu vídeo e a Base Viral continuam salvos; tente novamente em alguns minutos.";
  }
  return raw;
}

function viralAgentStopMessage(report: ViralAgentReportData): string {
  const detail = `${report.termination_reason || ""} ${report.error || ""}`.toLowerCase();
  if (/(?:429|quota|rate.?limit|resource.?exhausted|suspend|forbidden|\b403\b|\b503\b|overload)/.test(detail)) {
    return "O Avaliador Viral não conseguiu usar a IA por falta de quota ou capacidade. Nenhum roteiro foi promovido, e os dados do vídeo foram preservados para uma nova tentativa.";
  }
  if (report.termination_reason === "evaluator_error") {
    return "O Avaliador Viral não conseguiu concluir a análise independente. Nenhum roteiro foi promovido; tente novamente para manter o gate de qualidade ativo.";
  }
  if (report.termination_reason === "writer_error") {
    return "O Escritor DNA não conseguiu concluir a revisão solicitada pelo Avaliador. Nenhum roteiro foi promovido; tente novamente.";
  }
  return `O Avaliador Viral interrompeu a entrega: ${report.termination_reason || "metas de qualidade não atingidas"}.`;
}

function isRetryableViralQualityFailure(report: ViralAgentReportData | null): boolean {
  return report?.enabled === true
    && report.passed !== true
    && report.termination_reason === "max_iterations_reached";
}

async function readFunctionErrorPayload(error: unknown): Promise<UnknownRecord | null> {
  const response = (error as { context?: unknown } | null)?.context;
  if (!(response instanceof Response)) return null;
  try {
    const payload: unknown = await response.clone().json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

export default function UserGeneratePage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<EngineMode>("video");
  const [run, setRun] = useState<RunState>(initialRun);
  const [assembly, setAssembly] = useState<ScriptAssembly | null>(null);
  const [promoted, setPromoted] = useState<PromotedScript | null>(null);
  const [agentReport, setAgentReport] = useState<ViralAgentReportData | null>(null);
  const [, setGenContext] = useState<unknown>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [inputData, setInputData] = useState<GenerationInput>({});
  const [referenceQueue, setReferenceQueue] = useState<ReferenceLinkQueueEntry[]>([]);
  const [batchItems, setBatchItems] = useState<BatchGenerationItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const cancelRef = useRef(false);

  const readyReferenceCandidates = useMemo(
    () => referenceQueueReadyForGeneration(referenceQueue),
    [referenceQueue],
  );

  const updateRun = useCallback((patch: Partial<RunState>) => {
    setRun((prev) => ({ ...prev, ...patch }));
  }, []);

  const executePipeline = async (
    runMode: EngineMode,
    runInput: GenerationInput,
    options: { fromBatch?: boolean; quiet?: boolean } = {},
  ): Promise<PipelineExecutionResult> => {
    if (!user) {
      if (!options.quiet) toast.error("Faça login primeiro");
      return { status: "failed", message: "Faça login primeiro" };
    }
    const inputError = generationInputError(runMode, runInput);
    if (inputError) {
      if (!options.quiet) toast.error(inputError);
      return { status: "failed", message: inputError };
    }
    if (!options.fromBatch) cancelRef.current = false;
    setRunning("pipeline");
    setRun({
      ...initialRun,
      mode: runMode,
      auto_run: true,
      overall_state: "running",
      pipeline_message: "Iniciando pipeline automático...",
      progress_pct: 0,
    });
    setAssembly(null);
    setPromoted(null);
    setAgentReport(null);
    setGenContext(null);

    let historyRunId: string | null = null;
    const referenceVideoId = typeof runInput.reference_video_id === "string"
      ? runInput.reference_video_id
      : null;
    const patchHistory = async (patch: Database["public"]["Tables"]["reference_generation_runs"]["Update"]) => {
      if (!historyRunId) return;
      const { error } = await supabase.from("reference_generation_runs").update(patch).eq("id", historyRunId);
      if (error) console.warn("Falha ao atualizar o histórico da geração:", error.message);
    };
    const finishCancelled = async (): Promise<PipelineExecutionResult> => {
      await patchHistory({
        pipeline_status: "cancelled",
        current_step: "cancelled",
        error_message: "Cancelado pelo usuário.",
        finished_at: new Date().toISOString(),
      });
      return { status: "cancelled", message: "Cancelado pelo usuário." };
    };

    try {
      if (runMode === "video") {
        if (!referenceVideoId) throw new Error("Vídeo de referência ausente.");
        const { data: historyRow, error: historyError } = await supabase
          .from("reference_generation_runs")
          .insert({
            reference_video_id: referenceVideoId,
            user_id: user.id,
            execution_mode: "video",
            pipeline_status: "running",
            current_step: "topics",
            progress_pct: 0,
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (historyError || !historyRow?.id) {
          throw new Error(historyError?.message || "Não foi possível registrar esta geração no histórico.");
        }
        historyRunId = historyRow.id;
        updateRun({ pipeline_message: "Validando análise visual e tópicos do vídeo...", progress_pct: 5 });
        const { data: topicData, error: topicError } = await supabase.functions.invoke("analyze-reference-topics", {
          body: { reference_video_id: referenceVideoId },
        });
        if (topicError || topicData?.status !== "ready") {
          throw new Error(`Análise visual obrigatória não concluída: ${topicError?.message || topicData?.error || "resposta inválida"}`);
        }
        await patchHistory({ current_step: "context", progress_pct: 10 });
        if (cancelRef.current) return finishCancelled();
      }

      // Step 1: Build context
      updateRun({ pipeline_message: "Construindo contexto de geração...", progress_pct: 10 });
      const payload = buildGenerationContextPayload(runMode, runInput, user.id);

      const { data: ctxData, error: ctxErr } = await supabase.functions.invoke("build-complete-generation-context", { body: payload });
      if (ctxErr || !ctxData?.generation_context_id) throw new Error(ctxErr?.message || "Falha ao construir contexto");
      if (cancelRef.current) return finishCancelled();

      const gcId = ctxData.generation_context_id;
      updateRun({ generation_context_id: gcId, last_step: "context", progress_pct: 18, pipeline_message: "Injetando DNA de estilo da base viral..." });
      await patchHistory({ generation_context_id: gcId, current_step: "dna", progress_pct: 18 });

      // Step 1.5: Enrich context with real viral style patterns from the base
      const targetLang = String(runInput.language || "").toLowerCase().startsWith("en") ? "en" : "pt";
      const selectedPresetId = typeof runInput.dna_preset_id === "string" ? runInput.dna_preset_id : null;
      const hookApelao = typeof runInput.hook_apelao === "boolean" ? runInput.hook_apelao : true;
      const styleResult = await applyDnaStylePack(gcId, targetLang, {
        presetId: selectedPresetId,
        hookApelao,
      });
      assertRequiredDnaInjection(styleResult, runMode, selectedPresetId);
      if (!styleResult.injected) {
        console.warn("Style pack não injetado:", styleResult.reason);
      }
      await patchHistory({ generation_context_id: gcId, current_step: "assemble", progress_pct: 20 });
      if (cancelRef.current) return finishCancelled();

      updateRun({ progress_pct: 20, pipeline_message: "Contexto pronto. Montando roteiro..." });

      // Step 2: Assemble
      const { data: asmData, error: asmErr } = await supabase.functions.invoke("assemble-script", { body: { generation_context_id: gcId } });
      if (asmErr || !asmData?.script_assembly_id) throw new Error(asmErr?.message || "Falha ao montar roteiro");
      setAgentReport(asViralAgentReport(asmData?.writer_evaluator_loop));
      if (cancelRef.current) return finishCancelled();

      let saId = asmData.script_assembly_id;
      updateRun({ script_assembly_id: saId, last_step: "assemble", progress_pct: 40, pipeline_message: "Roteiro montado. Validando contra DNA..." });
      await patchHistory({ script_assembly_id: saId, current_step: "validate", progress_pct: 40 });

      // Fetch assembly
      const { data: asmRow } = await supabase.from("script_assemblies").select("*").eq("id", saId).single();
      setAssembly(asmRow);
      let currentAgentReport = reportFromAssembly(asmRow)
        ?? asViralAgentReport(asmData?.writer_evaluator_loop);
      if (runMode === "video" && currentAgentReport?.enabled !== true) {
        currentAgentReport = missingAgentReport();
      }
      setAgentReport(currentAgentReport);
      if (runMode === "video"
        && currentAgentReport?.passed !== true
        && !isRetryableViralQualityFailure(currentAgentReport)) {
        const message = viralAgentStopMessage(currentAgentReport);
        updateRun({
          last_step: "assemble",
          progress_pct: 55,
          overall_state: "stopped",
          auto_run: false,
          pipeline_message: message,
        });
        await patchHistory({
          script_assembly_id: saId,
          pipeline_status: "failed",
          current_step: "viral_evaluator",
          progress_pct: 55,
          error_message: message,
          finished_at: new Date().toISOString(),
        });
        if (!options.quiet) toast.error("O roteiro não atingiu as metas do Avaliador Viral e não foi promovido.");
        return { status: "failed", message };
      }

      // Step 3: Validate
      const { data: valData, error: valErr } = await supabase.functions.invoke("validate-script-against-dna", { body: { script_assembly_id: saId } });
      if (valErr) throw new Error(valErr.message || "Falha na validação");
      if (cancelRef.current) return finishCancelled();

      let valStatus = valData?.validation_status || "unknown";
      updateRun({ validation_status: valStatus, validation_version: valData?.validation_version || 1, last_step: "validate", progress_pct: 60 });
      await patchHistory({ validation_status: valStatus, current_step: "validate", progress_pct: 60 });

      // Step 4: Revise loop if needed
      let attempt = 0;
      let currentSaId = saId;
      const maxRevisions = 2;
      while (valStatus === "needs_revision" && attempt < maxRevisions && !cancelRef.current) {
        attempt++;
        updateRun({ auto_run_attempt: attempt, pipeline_message: `Revisando slots reprovados (tentativa ${attempt})...`, progress_pct: 65 });
        
        const { data: revData, error: revErr } = await supabase.functions.invoke("revise-script-assembly", { body: { script_assembly_id: currentSaId } });
        const revPayload = isRecord(revData)
          ? revData
          : revErr
            ? await readFunctionErrorPayload(revErr)
            : null;
        const revisionReport = asViralAgentReport(revPayload?.writer_evaluator_loop);
        if (revisionReport) {
          currentAgentReport = revisionReport;
          setAgentReport(currentAgentReport);
        }
        if (runMode === "video" && revisionReport?.passed !== true) {
          if (!revisionReport) {
            currentAgentReport = missingAgentReport(
              revErr?.message || "A revisão não devolveu o relatório obrigatório dos dois agentes.",
            );
            setAgentReport(currentAgentReport);
          }
          const statusReason = typeof revPayload?.status_reason === "string" ? revPayload.status_reason : null;
          const message = revisionReport
            ? viralAgentStopMessage(revisionReport)
            : `A revisão foi interrompida pelo Avaliador Viral: ${statusReason || "metas não atingidas"}.`;
          if (revisionReport
            && isRetryableViralQualityFailure(revisionReport)
            && attempt < maxRevisions) {
            updateRun({
              last_step: "revise",
              progress_pct: 68,
              pipeline_message: `O Avaliador ainda encontrou perdas de retenção. Executando a tentativa externa ${attempt + 1} de ${maxRevisions}...`,
            });
            continue;
          }
          updateRun({
            last_step: "revise",
            progress_pct: 70,
            overall_state: "stopped",
            auto_run: false,
            pipeline_message: message,
          });
          await patchHistory({
            script_assembly_id: currentSaId,
            pipeline_status: "failed",
            current_step: "viral_evaluator",
            progress_pct: 70,
            error_message: message,
            finished_at: new Date().toISOString(),
          });
          if (!options.quiet) toast.error("A revisão não atingiu as metas do Avaliador Viral e não foi promovida.");
          return { status: "failed", message };
        }
        if (revErr) throw new Error(revErr.message || "Falha na revisão");
        
        // Revise creates a NEW assembly — use the new ID going forward
        if (revPayload?.new_script_assembly_id) {
          currentSaId = String(revPayload.new_script_assembly_id);
          updateRun({ script_assembly_id: currentSaId });
          await patchHistory({ script_assembly_id: currentSaId, current_step: "revalidate", progress_pct: 70 });
        }

        updateRun({ pipeline_message: "Revalidando roteiro...", progress_pct: 70 });
        const { data: revalData, error: revalErr } = await supabase.functions.invoke("validate-script-against-dna", { body: { script_assembly_id: currentSaId } });
        if (revalErr) throw new Error(revalErr.message);
        
        valStatus = revalData?.validation_status || "unknown";
        const revalidationReport = asViralAgentReport(revalData?.writer_evaluator_loop);
        if (revalidationReport) {
          currentAgentReport = revalidationReport;
          setAgentReport(currentAgentReport);
        }
        updateRun({ validation_status: valStatus, validation_version: revalData?.validation_version });
      }
      
      // Use final assembly ID for remaining steps
      saId = currentSaId;

      if (cancelRef.current) return finishCancelled();

      if (valStatus !== "approved") {
        const message = `Validação não aprovada após ${attempt} revisões. Status: ${valStatus}`;
        updateRun({ auto_run: false, pipeline_message: message, progress_pct: 75, overall_state: "stopped" });
        await patchHistory({
          script_assembly_id: saId,
          validation_status: valStatus,
          pipeline_status: "failed",
          current_step: "validate",
          progress_pct: 75,
          error_message: message,
          finished_at: new Date().toISOString(),
        });
        return { status: "failed", message };
      }

      if (runMode === "video" && currentAgentReport?.passed !== true) {
        const message = "Promoção bloqueada: relatório obrigatório do Avaliador Viral ausente ou reprovado.";
        updateRun({
          auto_run: false,
          pipeline_message: message,
          progress_pct: 75,
          overall_state: "stopped",
        });
        await patchHistory({
          script_assembly_id: saId,
          validation_status: valStatus,
          pipeline_status: "failed",
          current_step: "viral_evaluator",
          progress_pct: 75,
          error_message: message,
          finished_at: new Date().toISOString(),
        });
        if (!options.quiet) toast.error("Sem aprovação do Avaliador Viral, o roteiro não pode ser promovido.");
        return { status: "failed", message };
      }

      updateRun({ pipeline_message: "Aprovado! Promovendo versão final...", progress_pct: 85, last_step: "promote" });

      // Step 5: Promote
      const { data: promData, error: promErr } = await supabase.functions.invoke("promote-script-final", { body: { script_assembly_id: saId } });
      const promotedId = promData?.promoted_script_id ?? promData?.video_script_id;
      if (promErr || !promotedId || !["promoted", "already_promoted"].includes(promData?.status)) {
        throw new Error(promErr?.message || promData?.status_reason || "Falha ao promover");
      }

      updateRun({
        promoted_script_id: promotedId,
        last_step: "promote",
        overall_state: "completed",
        progress_pct: 100,
        pipeline_message: "Roteiro final pronto!",
        auto_run: false,
      });

      // Fetch promoted
      const { data: promRow } = await supabase.from("promoted_scripts").select("*").eq("id", promotedId).single();
      setPromoted(promRow);
      // Reload assembly
      const { data: freshAsm } = await supabase.from("script_assemblies").select("*").eq("id", saId).single();
      setAssembly(freshAsm);
      setAgentReport(reportFromAssembly(freshAsm) ?? asViralAgentReport(asmData?.writer_evaluator_loop));

      await patchHistory({
        generation_context_id: gcId,
        script_assembly_id: saId,
        promoted_script_id: promotedId,
        validation_status: valStatus,
        pipeline_status: "completed",
        current_step: "completed",
        progress_pct: 100,
        error_message: null,
        finished_at: new Date().toISOString(),
      });
      if (!options.quiet) toast.success("Roteiro gerado e promovido com sucesso!");
      return { status: "completed", promotedScriptId: promotedId };
    } catch (err: unknown) {
      if (cancelRef.current) return finishCancelled();
      const message = readablePipelineError(err);
      updateRun({ pipeline_message: `Erro: ${message}`, overall_state: "error", auto_run: false });
      await patchHistory({
        pipeline_status: "failed",
        current_step: "error",
        error_message: message,
        finished_at: new Date().toISOString(),
      });
      if (!options.quiet) toast.error(message);
      return { status: "failed", message };
    } finally {
      setRunning(null);
    }
  };

  const handleAutoRun = () => {
    void executePipeline(mode, inputData);
  };

  const patchBatchItem = (clientId: string, patch: Partial<BatchGenerationItem>) => {
    setBatchItems((items) => items.map((item) => (
      item.clientId === clientId ? { ...item, ...patch } : item
    )));
  };

  const handleBatchGenerate = async () => {
    if (!user) {
      toast.error("Faça login primeiro");
      return;
    }
    if (readyReferenceCandidates.length === 0) {
      toast.error("Nenhum vídeo da fila terminou a análise visual ainda.");
      return;
    }
    if (batchRunning || running) return;

    const batchInput = { ...inputData };
    const initialItems = readyReferenceCandidates.map((candidate): BatchGenerationItem => ({
      clientId: candidate.clientId,
      referenceVideoId: candidate.referenceVideoId,
      label: candidate.canonicalUrl,
      status: "pending",
    }));
    setBatchItems(initialItems);
    setBatchRunning(true);
    cancelRef.current = false;

    let completed = 0;
    let failed = 0;
    try {
      // Intentionally sequential: each AI writer/evaluator loop is expensive,
      // and concurrency here would compete for provider limits and make retries
      // less deterministic. A failure is converted to an item result and the
      // next reference always continues.
      for (const candidate of readyReferenceCandidates) {
        if (cancelRef.current) break;
        patchBatchItem(candidate.clientId, { status: "running", error: undefined });
        const candidateInput: GenerationInput = {
          ...batchInput,
          reference_video_id: candidate.referenceVideoId,
          reference_video_ready: true,
        };
        setInputData(candidateInput);
        const result = await executePipeline("video", candidateInput, { fromBatch: true, quiet: true });
        if (result.status === "completed") completed += 1;
        if (result.status === "failed") failed += 1;
        patchBatchItem(candidate.clientId, {
          status: result.status,
          promotedScriptId: result.promotedScriptId,
          error: result.status === "failed" ? result.message : undefined,
        });
        if (result.status === "cancelled") break;
      }

      if (cancelRef.current) {
        setBatchItems((items) => items.map((item) => (
          item.status === "pending" ? { ...item, status: "cancelled" } : item
        )));
        toast.info(`Lote cancelado. ${completed} roteiro${completed === 1 ? "" : "s"} concluído${completed === 1 ? "" : "s"}.`);
      } else if (failed > 0) {
        toast.warning(`${completed} roteiro${completed === 1 ? "" : "s"} concluído${completed === 1 ? "" : "s"}; ${failed} falharam sem interromper o lote.`);
      } else {
        toast.success(`${completed} roteiro${completed === 1 ? "" : "s"} gerado${completed === 1 ? "" : "s"} e salvo${completed === 1 ? "" : "s"} no histórico.`);
      }
    } finally {
      setBatchRunning(false);
      setRunning(null);
      updateRun({ auto_run: false });
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
    updateRun({ auto_run: false, pipeline_message: "Execução cancelada pelo usuário." });
  };

  const handleReset = (nextMode: EngineMode = mode) => {
    cancelRef.current = true;
    setRun({ ...initialRun, mode: nextMode });
    setAssembly(null);
    setPromoted(null);
    setAgentReport(null);
    setGenContext(null);
    setRunning(null);
    setInputData((previous) => ({
      dna_preset_id: previous.dna_preset_id,
      hook_apelao: previous.hook_apelao,
      language: previous.language,
    }));
  };

  const handleInputChange = (nextInput: GenerationInput) => {
    const contextSensitiveKeys = [
      "reference_video_id", "reference_video_ready", "theme", "niche", "objective",
      "original_script", "preserve_meaning", "language", "notes", "dna_preset_id", "hook_apelao",
    ];
    const changed = contextSensitiveKeys.some((key) => inputData[key] !== nextInput[key]);
    setInputData(nextInput);

    if (changed && (run.generation_context_id || run.overall_state !== "idle")) {
      cancelRef.current = true;
      setRun({
        ...initialRun,
        mode,
        pipeline_message: "Entrada alterada — gere um novo roteiro com o vídeo selecionado.",
      });
      setAssembly(null);
      setPromoted(null);
      setAgentReport(null);
      setGenContext(null);
      setRunning(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Geração de Roteiros Virais</h1>
      </div>

      {/* Mode Selection */}
      <ModeSelector mode={mode} onModeChange={(m) => { setMode(m); handleReset(m); }} />

      {/* Input Panel */}
      <InputPanel
        key={mode}
        mode={mode}
        inputData={inputData}
        onChange={handleInputChange}
        onReferenceQueueChange={setReferenceQueue}
      />

      {mode === "video" && readyReferenceCandidates.length > 0 && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ListVideo className="h-4 w-4 text-primary" />
                Geração em lote
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {readyReferenceCandidates.length} vídeo{readyReferenceCandidates.length === 1 ? "" : "s"} com análise visual pronta. O processamento é sequencial e cada resultado fica salvo no Histórico.
              </p>
            </div>
            <Button
              type="button"
              className="shrink-0 gap-2"
              onClick={() => void handleBatchGenerate()}
              disabled={batchRunning || running !== null}
            >
              {batchRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListVideo className="h-4 w-4" />}
              {batchRunning ? "Gerando lote..." : "Gerar para todos os vídeos prontos"}
            </Button>
          </div>

          {batchItems.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {batchItems.map((item, index) => (
                <div key={item.clientId} className="flex items-start gap-2 rounded-md border bg-background/70 px-3 py-2 text-xs">
                  {item.status === "running" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                  {item.status === "completed" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  {item.status === "failed" && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                  {(item.status === "pending" || item.status === "cancelled") && <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{index + 1}. {item.label}</p>
                    <p className={item.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                      {item.status === "pending" && "Aguardando sua vez"}
                      {item.status === "running" && "Escritor e Avaliador Viral trabalhando"}
                      {item.status === "completed" && "Roteiro aprovado e salvo"}
                      {item.status === "cancelled" && "Não processado: lote cancelado"}
                      {item.status === "failed" && (item.error || "Falha isolada neste vídeo")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Action Button */}
      <div className="flex gap-3">
        {!run.auto_run && run.overall_state !== "completed" && (
          <Button size="lg" className="gap-2" onClick={handleAutoRun} disabled={batchRunning || running !== null}>
            <Play className="h-4 w-4" />
            Gerar Roteiro Automaticamente
          </Button>
        )}
        {run.auto_run && (
          <Button size="lg" variant="destructive" className="gap-2" onClick={handleCancel}>
            <Square className="h-4 w-4" />
            Cancelar
          </Button>
        )}
        {run.overall_state === "completed" && !batchRunning && (
          <Button size="lg" variant="outline" onClick={() => handleReset(mode)}>
            Nova Geração
          </Button>
        )}
      </div>

      {/* Progress */}
      {(run.auto_run || run.progress_pct > 0) && (
        <div className="space-y-2">
          <Progress value={run.progress_pct} className="h-3" />
          <p className="text-sm text-muted-foreground">{run.pipeline_message}</p>
        </div>
      )}

      {/* Status Card */}
      {run.generation_context_id && <RunStatusCard run={run} />}

      {/* Explicit Writer/Evaluator quality loop */}
      {agentReport && <ViralAgentReport report={agentReport} inputMode={mode} />}

      {/* Result */}
      {promoted && (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-6">
          <h2 className="text-lg font-semibold text-primary">Roteiro Final</h2>
          <ScriptPreview assembly={assembly} promoted={promoted} />
        </div>
      )}

      {assembly && !promoted && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Roteiro em Construção</h2>
          <ScriptPreview assembly={assembly} promoted={null} />
        </div>
      )}
    </div>
  );
}
