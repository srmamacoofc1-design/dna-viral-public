import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViralAgentReport } from "@/components/script-engine/ViralAgentReport";

describe("ViralAgentReport", () => {
  it("shows the two agents, target estimates and audit disclaimer", () => {
    render(<ViralAgentReport report={{
      enabled: true,
      passed: true,
      iterations_completed: 2,
      thresholds: {
        continue_rate_percent_min: 86,
        skip_rate_percent_max_exclusive: 10,
        avg_view_percentage_min: 90,
      },
      metrics_disclaimer: "Estimativas pré-publicação; valide com dados reais após publicar.",
      final_evaluation: {
        passed: true,
        estimated_metrics: {
          continue_rate_percent: 87,
          skip_rate_percent: 9,
          avg_view_percentage: 92,
        },
        criterion_scores: {
          hook: 9.4,
          development: 9.0,
          payoff: 9.1,
          visual_fidelity: 9.6,
        },
      },
      audit_trail: [{ iteration: 1, evaluator: { passed: false, overall_score: 8.4 } }],
    }} />);

    expect(screen.getByText("Escritor DNA ↔ Avaliador Viral")).toBeInTheDocument();
    expect(screen.getByText("87.0%")).toBeInTheDocument();
    expect(screen.getByText("9.0%")).toBeInTheDocument();
    expect(screen.getByText("92.0%")).toBeInTheDocument();
    expect(screen.getByText("Aprovado pelo Avaliador")).toBeInTheDocument();
    expect(screen.getByText("9.4/10")).toBeInTheDocument();
    expect(screen.getByText(/nota 8.4/)).toBeInTheDocument();
    expect(screen.getByText(/Estimativas pré-publicação/)).toBeInTheDocument();
  });

  it("distinguishes evaluator errors from exhausted revisions", () => {
    render(<ViralAgentReport report={{
      enabled: true,
      passed: false,
      termination_reason: "evaluator_error",
      error: "O avaliador não respondeu.",
    }} />);

    expect(screen.getByText("Erro no Avaliador Viral")).toBeInTheDocument();
    expect(screen.getByText("O avaliador não respondeu.")).toBeInTheDocument();
  });

  it("never announces a video as approved without complete narrative evidence", () => {
    const { rerender } = render(<ViralAgentReport inputMode="video" report={{
      enabled: true,
      passed: true,
      final_evaluation: { passed: true },
    }} />);

    expect(screen.queryByText("Aprovado pelo Avaliador")).not.toBeInTheDocument();
    expect(screen.getByText("Reprovado pelo Avaliador")).toBeInTheDocument();
    expect(screen.getByText("Fidelidade factual por microevento")).toBeInTheDocument();

    rerender(<ViralAgentReport inputMode="video" report={{
      enabled: true,
      passed: true,
      final_evaluation: {
        passed: true,
        narrative_fidelity_gate: {
          required: true,
          passed: true,
          audited_microevents: 26,
          required_audited_microevents: 26,
          reasons: [],
        },
      },
    }} />);

    expect(screen.getByText("Aprovado pelo Avaliador")).toBeInTheDocument();
    expect(screen.getByText(/26\/26 eventos auditados/)).toBeInTheDocument();
  });

  it("does not render when the evaluator loop is disabled", () => {
    const { container } = render(<ViralAgentReport report={{ enabled: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
