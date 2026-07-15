import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/video-processing", () => ({ schedulePendingProcessing: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "member-1" }, isAdmin: false }),
}));

import { VideoUploadForm } from "@/components/VideoUploadForm";

describe("VideoUploadForm bulk links", () => {
  it("previews valid, duplicate and invalid lines before submitting", () => {
    render(<MemoryRouter><VideoUploadForm /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Links dos vídeos, um por linha"), {
      target: {
        value: [
          "https://youtube.com/shorts/vjqsNKq05iE",
          "https://youtu.be/vjqsNKq05iE",
          "https://youtube.com/shorts/adcOHqnTEZY",
          "link quebrado",
        ].join("\n"),
      },
    });

    expect(screen.getByText(/2 vídeos válidos para adicionar/)).toBeInTheDocument();
    expect(screen.getByText(/1 repetido/)).toBeInTheDocument();
    expect(screen.getByText(/Linha 4:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar 2 vídeos à fila" })).toBeEnabled();
  });

  it("does not duplicate one set of manual metrics across a link batch", () => {
    render(<MemoryRouter><VideoUploadForm /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Links dos vídeos, um por linha"), {
      target: {
        value: [
          "https://youtube.com/shorts/vjqsNKq05iE",
          "https://youtube.com/shorts/adcOHqnTEZY",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Dados reais de performance/ }));

    expect(screen.getByText(/cada vídeo precisa ter métricas próprias/)).toBeInTheDocument();
    for (const input of screen.getAllByRole("spinbutton")) {
      expect(input).toBeDisabled();
    }
  });
});
