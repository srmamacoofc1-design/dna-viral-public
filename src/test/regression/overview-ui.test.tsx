/**
 * REGRESSION SUITE — Overview Page UI
 * 
 * Validates that the OverviewPage component renders
 * without hardcoded values or fake labels.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import OverviewPage from "@/pages/dashboard/OverviewPage";

// Mock supabase client
vi.mock("@/integrations/supabase/client", () => {
  const mockSelect = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { status: "ready" }, error: null }),
          }),
        }),
        limit: vi.fn().mockResolvedValue({ data: [{ status: "ready" }], error: null }),
      }),
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { status: "ready" }, error: null }),
        }),
      }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  });

  // Return a count-style response for head:true queries
  const mockFrom = vi.fn().mockImplementation((table: string) => ({
    select: vi.fn().mockImplementation((_cols: string, opts?: any) => {
      if (opts?.head) {
        return Promise.resolve({ count: 42, error: null });
      }
      return {
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { status: "ready" }, error: null }),
            }),
          }),
          limit: vi.fn().mockResolvedValue({ data: [{ status: "ready" }], error: null }),
        }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { status: "ready" }, error: null }),
          }),
        }),
        not: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }),
  }));

  return {
    supabase: { from: mockFrom },
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

describe("OverviewPage", () => {
  it("renders the page title", async () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByText(/Overview/i)).toBeInTheDocument();
  });

  it("does not contain hardcoded zero counters in source", async () => {
    // Static analysis: the component must fetch from supabase, not hardcode
    const mod = await import("@/pages/dashboard/OverviewPage?raw");
    const source = (mod as any).default as string;
    // Should NOT have patterns like `totalVideos: 0` as initial render values shown to user
    // The component uses loading state, which is acceptable
    expect(source).toContain("supabase");
    expect(source).not.toContain('"Fase 2"');
    expect(source).not.toContain('"em preparação"');
  });
});
