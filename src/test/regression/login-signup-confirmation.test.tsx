import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  resend: vi.fn(),
  getSession: vi.fn(),
  roleQuery: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    signUp: mocks.signUp,
    signIn: mocks.signIn,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: mocks.roleQuery }),
    }),
    auth: {
      resend: mocks.resend,
      getSession: mocks.getSession,
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

import LoginPage from "@/pages/LoginPage";

function renderLogin() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<div>ÁREA DO USUÁRIO</div>} />
        <Route path="/dashboard" element={<div>PAINEL ADMIN</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitSignUp(email = "novo@exemplo.com") {
  fireEvent.click(screen.getByRole("button", { name: "Não tem conta? Cadastre-se" }));
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-segura" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
}

describe("LoginPage — confirmação de cadastro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.roleQuery.mockResolvedValue({ data: [], error: null });
    mocks.resend.mockResolvedValue({ data: {}, error: null });
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  it("não navega quando o Supabase exige confirmação por e-mail", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "user-pendente" }, session: null },
      error: null,
    });

    renderLogin();
    submitSignUp();

    expect(await screen.findByText("Cadastro recebido!")).toBeInTheDocument();
    expect(screen.getByText("novo@exemplo.com")).toBeInTheDocument();
    expect(screen.queryByText("ÁREA DO USUÁRIO")).not.toBeInTheDocument();
    expect(screen.getByText(/confirme o cadastro antes de entrar/i)).toBeInTheDocument();
  });

  it("permite reenviar a confirmação e voltar ao formulário de login", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "user-pendente" }, session: null },
      error: null,
    });

    renderLogin();
    submitSignUp("confirme@exemplo.com");
    await screen.findByText("Cadastro recebido!");

    fireEvent.click(screen.getByRole("button", { name: "Reenviar e-mail de confirmação" }));
    await waitFor(() => {
      expect(mocks.resend).toHaveBeenCalledWith({
        type: "signup",
        email: "confirme@exemplo.com",
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });

  it("navega imediatamente somente quando o cadastro já retorna uma sessão", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { id: "user-autenticado" },
        session: { user: { id: "user-autenticado" } },
      },
      error: null,
    });

    renderLogin();
    submitSignUp("ativo@exemplo.com");

    expect(await screen.findByText("ÁREA DO USUÁRIO")).toBeInTheDocument();
    expect(screen.queryByText("Cadastro recebido!")).not.toBeInTheDocument();
  });
});
