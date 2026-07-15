/**
 * REGRESSION SUITE — Promoted Scripts Page UI
 * 
 * Validates that PromotedScriptsPage renders scripts
 * from database without session dependency.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

// Mock supabase
vi.mock("@/integrations/supabase/client", () => {
  const mockScripts = [
    {
      id: "test-id-1",
      script_title: "Test Script Title",
      script_text: "Este é o texto completo do roteiro de teste para validação de regressão.",
      script_status: "final",
      validation_status: "approved",
      validation_version: 2,
      promoted_at: "2026-04-07T02:53:49.109Z",
      created_at: "2026-04-07T02:53:49.109Z",
      source_script_assembly_id: "sa-id-1",
      source_blueprint_id: null,
      source_generation_context_id: "gc-id-1",
      promotion_trace: {},
      script_blocks: [
        { index: 1, slot_type: "hook", generated_text: "Hook text" },
        { index: 2, slot_type: "setup", generated_text: "Setup text" },
      ],
    },
  ];

  return {
    supabase: {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: mockScripts, error: null }),
          }),
        }),
      })),
    },
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

describe("PromotedScriptsPage", () => {
  it("renders page title", async () => {
    const { default: Page } = await import("@/pages/dashboard/PromotedScriptsPage");
    renderWithProviders(<Page />);
    expect(screen.getByText(/Promoted Scripts/i)).toBeInTheDocument();
  });

  it("does not use localStorage or sessionStorage for script data", async () => {
    const mod = await import("@/pages/dashboard/PromotedScriptsPage?raw");
    const source = (mod as any).default as string;
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).toContain("supabase");
    expect(source).toContain("promoted_scripts");
  });
});
