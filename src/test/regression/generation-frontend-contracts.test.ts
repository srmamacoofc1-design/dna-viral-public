import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  assertRequiredDnaInjection,
  buildGenerationContextPayload,
  generationInputError,
} from "@/services/generation-input";
import {
  ACTIVE_DNA_PRESET_STORAGE_KEY,
  DNA_PRESET_SELECTION_EVENT,
  presetGenerationUrl,
  readActiveDnaPresetId,
  setActiveDnaPresetId,
} from "@/services/dna-preset-selection";
import {
  LOCAL_REFERENCE_UPLOAD_THRESHOLD_BYTES,
  REFERENCE_VIDEO_INITIAL_STATUS,
  TUS_CHUNK_SIZE,
} from "@/components/script-engine/InputPanel";
import {
  MAX_REFERENCE_VIDEO_BYTES,
  referenceVideoValidationError,
} from "@/lib/reference-link-queue";
import {
  dnaEngineErrorMessage,
  normalizeDnaObjectStatus,
} from "@/pages/dashboard/DNAEngineViewPage";
import { dashboardWriterEvaluatorGate } from "@/pages/dashboard/ScriptEnginePage";

describe("Generation context input contract", () => {
  it("sends the transform field names accepted by the edge function", () => {
    const payload = buildGenerationContextPayload("transform", {
      original_script: "  Um roteiro original.  ",
      source_script: "campo legado incorreto",
      preserve_meaning: false,
      language: "pt-BR",
      notes: "Usar cenas reais",
      dna_preset_id: "preset-1",
    }, "user-1");

    expect(payload).toEqual({
      mode: "transform",
      user_id: "user-1",
      language: "pt-BR",
      notes: "Usar cenas reais",
      original_script: "Um roteiro original.",
      preserve_meaning: false,
      dna_preset_id: "preset-1",
    });
    expect(payload).not.toHaveProperty("source_script");
    expect(payload).toHaveProperty("dna_preset_id", "preset-1");
  });

  it("keeps all supported theme constraints", () => {
    expect(buildGenerationContextPayload("theme", {
      theme: "Cinema",
      niche: "curiosidades",
      objective: "retenção",
      duration_seconds: 45,
    })).toEqual({
      mode: "theme",
      theme: "Cinema",
      niche: "curiosidades",
      objective: "retenção",
      duration_seconds: 45,
    });
  });

  it("blocks video generation until processing is ready", () => {
    expect(generationInputError("video", {})).toContain("Envie e processe");
    expect(generationInputError("video", {
      reference_video_id: "ref-1",
      reference_video_ready: false,
    })).toContain("Aguarde");
    expect(generationInputError("video", {
      reference_video_id: "ref-1",
      reference_video_ready: true,
    })).toBeNull();
  });
});

describe("DNA application is fail-closed where required", () => {
  it("blocks every video-mode run when visual DNA was not injected", () => {
    expect(() => assertRequiredDnaInjection(
      { injected: false, reason: "modo vídeo sem topic_analysis" },
      "video",
    )).toThrow(/topic_analysis/);
  });

  it("blocks an explicit preset instead of silently falling back", () => {
    expect(() => assertRequiredDnaInjection(
      { injected: false, reason: "preset inválido" },
      "theme",
      "preset-1",
    )).toThrow(/preset DNA selecionado/);
  });

  it("allows the legacy global fallback only for theme/transform", () => {
    expect(() => assertRequiredDnaInjection({ injected: false }, "theme", null)).not.toThrow();
    expect(() => assertRequiredDnaInjection({ injected: false }, "transform", null)).not.toThrow();
  });
});

describe("Reference video upload contract", () => {
  it("accepts exactly 300 MiB and rejects one byte above it", () => {
    expect(TUS_CHUNK_SIZE).toBe(6 * 1024 * 1024);
    expect(REFERENCE_VIDEO_INITIAL_STATUS).toBe("pending");
    const base = { name: "referencia.mp4", type: "video/mp4" };
    expect(referenceVideoValidationError({ ...base, size: MAX_REFERENCE_VIDEO_BYTES })).toBeNull();
    expect(referenceVideoValidationError({ ...base, size: MAX_REFERENCE_VIDEO_BYTES + 1 })).toContain("300 MB");
  });

  it("accepts a known video extension when the browser omits MIME type", () => {
    expect(referenceVideoValidationError({ name: "camera.MOV", type: "", size: 1024 })).toBeNull();
    expect(referenceVideoValidationError({ name: "payload.exe", type: "", size: 1024 })).toContain("vídeo válido");
  });
});

describe("One persisted preset selection across routes", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists, publishes and clears the active preset", () => {
    const listener = vi.fn();
    window.addEventListener(DNA_PRESET_SELECTION_EVENT, listener);

    setActiveDnaPresetId(" preset-123 ");
    expect(readActiveDnaPresetId()).toBe("preset-123");
    expect(window.localStorage.getItem(ACTIVE_DNA_PRESET_STORAGE_KEY)).toBe("preset-123");
    expect(listener).toHaveBeenCalledTimes(1);

    setActiveDnaPresetId(null);
    expect(readActiveDnaPresetId()).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_DNA_PRESET_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(DNA_PRESET_SELECTION_EVENT, listener);
  });

  it("builds links understood by both generation routes", () => {
    expect(presetGenerationUrl("/app", "id com espaço")).toBe("/app?preset=id%20com%20espa%C3%A7o");
    expect(presetGenerationUrl("/dashboard/script-engine", null)).toBe("/dashboard/script-engine");
  });
});

describe("DNA Engine null safety", () => {
  it("normalizes null/unknown statuses", () => {
    expect(normalizeDnaObjectStatus(null)).toBe("no_data");
    expect(normalizeDnaObjectStatus("stale")).toBe("no_data");
    expect(normalizeDnaObjectStatus("ready")).toBe("ready");
  });

  it("formats null rejections without reading .message", () => {
    expect(dnaEngineErrorMessage(null)).toBe("erro desconhecido");
    expect(dnaEngineErrorMessage(new Error("banco indisponível"))).toBe("banco indisponível");
  });
});

describe("Pipeline wiring regressions", () => {
  const source = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

  it("runs visual analysis and fail-closed DNA before assembly in /app", () => {
    const page = source("../../pages/app/UserGeneratePage.tsx");
    const visual = page.indexOf('invoke("analyze-reference-topics"');
    const context = page.indexOf('invoke("build-complete-generation-context"');
    const apply = page.indexOf("applyDnaStylePack(");
    const guard = page.indexOf("assertRequiredDnaInjection(");
    const assemble = page.indexOf('invoke("assemble-script"');
    expect([visual, context, apply, guard, assemble].every((position) => position >= 0)).toBe(true);
    expect(visual).toBeLessThan(context);
    expect(context).toBeLessThan(apply);
    expect(apply).toBeLessThan(guard);
    expect(guard).toBeLessThan(assemble);
    expect(page).not.toContain("inputData.source_script");
  });

  it("keeps the admin Script Engine fail-closed too", () => {
    const page = source("../../pages/dashboard/ScriptEnginePage.tsx");
    const visual = page.indexOf('callEdge("analyze-reference-topics"');
    const context = page.indexOf('callEdge("build-complete-generation-context"');
    const apply = page.indexOf("applyDnaStylePack(");
    const guard = page.indexOf("assertRequiredDnaInjection(");
    expect([visual, context, apply, guard].every((position) => position >= 0)).toBe(true);
    expect(visual).toBeLessThan(context);
    expect(context).toBeLessThan(apply);
    expect(apply).toBeLessThan(guard);
  });

  it("uses Supabase resumable upload rather than the small standard upload", () => {
    const panel = source("../../components/script-engine/InputPanel.tsx");
    expect(panel).toContain("new tus.Upload");
    expect(panel).toContain("/storage/v1/upload/resumable");
    expect(panel).toContain("resumeFromPreviousUpload");
    expect(panel).not.toContain('.from("videos")\n        .upload(');
  });

  it("routes only large local uploads through the authenticated normalizer", () => {
    const panel = source("../../components/script-engine/InputPanel.tsx");
    expect(LOCAL_REFERENCE_UPLOAD_THRESHOLD_BYTES).toBe(45 * 1024 * 1024);
    expect(panel).toContain("file.size > LOCAL_REFERENCE_UPLOAD_THRESHOLD_BYTES");
    expect(panel).toContain('request.open("POST", "/api/local-reference-upload")');
    expect(panel).toContain('request.setRequestHeader("Authorization", `Bearer ${accessToken}`)');
    expect(panel).toContain('request.setRequestHeader("X-Reference-Video-Id", referenceVideoId)');
    expect(panel).toContain('request.setRequestHeader("X-Storage-Path", storagePath)');
    expect(panel).toContain("request.send(file)");
    expect(panel).toContain("uploadWithTus(file, initialPath, attempt)");
  });

  it("queues multiple reference links without putting them in the viral corpus", () => {
    const panel = source("../../components/script-engine/InputPanel.tsx");
    const userPage = source("../../pages/app/UserGeneratePage.tsx");
    const flow = panel.slice(
      panel.indexOf("async function processReferenceLink("),
      panel.indexOf("async function handleAddReferenceLinks()"),
    );
    const dedicatedImport = panel.indexOf('invoke("import-reference-video"');
    const analysis = panel.indexOf('invoke("process-reference-video"');

    expect(panel).toContain("Colar vários links");
    expect(panel).toContain("Usar neste roteiro");
    expect(panel).toContain("parseBulkVideoLinks(referenceLinksText)");
    expect(userPage).toContain("onChange={handleInputChange}");
    expect(userPage).toContain('"reference_video_id", "reference_video_ready"');
    expect(dedicatedImport).toBeGreaterThanOrEqual(0);
    expect(analysis).toBeGreaterThanOrEqual(0);
    expect(flow).not.toContain('.from("videos")');
    expect(flow).not.toContain('invoke("download-video"');
    expect(flow).toContain("reference_video_id");
  });

  it("generates every ready linked video sequentially and persists isolated outcomes", () => {
    const page = source("../../pages/app/UserGeneratePage.tsx");
    const batchStart = page.indexOf("const handleBatchGenerate = async () =>");
    const batchEnd = page.indexOf("const handleCancel", batchStart);
    const batch = page.slice(batchStart, batchEnd);

    expect(page).toContain("Gerar para todos os vídeos prontos");
    expect(page).toContain("referenceQueueReadyForGeneration(referenceQueue)");
    expect(batch).toContain("for (const candidate of readyReferenceCandidates)");
    expect(batch).toContain('await executePipeline("video", candidateInput');
    expect(batch).not.toContain("Promise.all");
    expect(page).toContain('.from("reference_generation_runs")');
    expect(page).toContain('pipeline_status: "completed"');
    expect(page).toContain('pipeline_status: "failed"');
    expect(batch).toContain("falharam sem interromper o lote");
  });

  it("lets quality-only failures reach validation and consumes bounded external revisions", () => {
    const page = source("../../pages/app/UserGeneratePage.tsx");
    expect(page).toContain('report.termination_reason === "max_iterations_reached"');
    expect(page).toContain("!isRetryableViralQualityFailure(currentAgentReport)");
    expect(page).toContain("isRetryableViralQualityFailure(revisionReport)");
    expect(page).toContain("attempt < maxRevisions");
    expect(page).toContain("continue;");
    expect(page).toContain('termination_reason === "evaluator_error"');
    expect(page).toContain('termination_reason === "writer_error"');
    expect(page).toContain("currentAgentReport?.passed !== true");
    expect(page.indexOf("currentAgentReport?.passed !== true"))
      .toBeLessThan(page.indexOf('invoke("promote-script-final"'));
  });

  it("keeps the manual dashboard fail-closed on Writer/Evaluator reports", () => {
    const validReport = {
      enabled: true,
      passed: true,
      termination_reason: "quality_gate_passed",
      thresholds: {
        continue_rate_percent_min: 86,
        skip_rate_percent_max_exclusive: 10,
        avg_view_percentage_min: 90,
        overall_score_min: 9,
        critical_criterion_score_min: 8.5,
        engagement_complement_tolerance_points: 1,
      },
      final_evaluation: {
        passed: true,
        overall_score: 9.2,
        failed_gates: [],
        estimated_metrics: {
          continue_rate_percent: 91,
          skip_rate_percent: 9,
          avg_view_percentage: 94,
        },
        criterion_scores: {
          hook: 9.1,
          development: 8.8,
          payoff: 8.7,
          visual_fidelity: 9.4,
        },
        narrative_fidelity_gate: {
          required: true,
          passed: true,
          audited_microevents: 8,
          required_audited_microevents: 8,
          reasons: [],
        },
      },
      audit_trail: [{ iteration: 1, evaluator: { passed: true } }],
    };

    expect(dashboardWriterEvaluatorGate("video", validReport).passed).toBe(true);
    expect(dashboardWriterEvaluatorGate("video", {
      ...validReport,
      passed: false,
      termination_reason: "writer_error",
    })).toMatchObject({ passed: false, message: expect.stringContaining("Escritor DNA") });
    expect(dashboardWriterEvaluatorGate("video", {
      ...validReport,
      thresholds: { ...validReport.thresholds, continue_rate_percent_min: 80 },
    }).passed).toBe(false);
    expect(dashboardWriterEvaluatorGate("theme", null).passed).toBe(true);

    const page = source("../../pages/dashboard/ScriptEnginePage.tsx");
    const assembleFlow = page.slice(page.indexOf("async function runAssemble"), page.indexOf("async function runValidate"));
    expect(assembleFlow.indexOf("dashboardWriterEvaluatorGate(mode, writerEvaluatorReport)"))
      .toBeLessThan(assembleFlow.indexOf('toast.success(mode === "video"'));
    expect(assembleFlow).toContain('overall_state: "rejected"');
    expect(page.slice(page.indexOf("async function runValidate"), page.indexOf("async function runRevise")))
      .toContain("dashboardWriterEvaluatorGate(");
    expect(page.slice(page.indexOf("function handleSelectAssembly"), page.indexOf("function handleModeChange")))
      .toContain("evaluatorRejected");

    const runner = source("../../components/script-engine/PipelineRunner.tsx");
    expect(runner).toContain('run.overall_state === "rejected"');
    expect(runner).toContain("Requer aprovação do Escritor/Avaliador Viral");
  });

  it("shows the independent factual microevent gate in the agent report", () => {
    const report = source("../../components/script-engine/ViralAgentReport.tsx");
    const userPage = source("../../pages/app/UserGeneratePage.tsx");
    const dashboardPage = source("../../pages/dashboard/ScriptEnginePage.tsx");
    expect(report).toContain("narrative_fidelity_gate");
    expect(report).toContain("Auditor factual independente");
    expect(report).toContain("Fidelidade factual por microevento");
    expect(report).toContain("audited_microevents");
    expect(report).toContain("required_audited_microevents");
    expect(report).toContain('inputMode === "video"');
    expect(userPage).toContain("<ViralAgentReport report={agentReport} inputMode={mode}");
    expect(dashboardPage).toContain("<ViralAgentReport");
    expect(dashboardPage).toContain("assembly.assembly_rules.input_mode || mode");
  });
});
