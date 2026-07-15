/**
 * REGRESSION SUITE — Dashboard/App Pages Smoke Render
 *
 * Renders every protected page (admin dashboard + user app) with a
 * universally-chainable supabase mock. Catches render-time crashes
 * (bad imports, broken hooks, undefined access) in pages that need
 * auth and therefore can't be smoke-tested via anonymous browsing.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// jsdom lacks ResizeObserver (recharts) and scrollIntoView (cmdk)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * Universal supabase mock: any query-builder chain works and resolves
 * to empty data, so pages render their empty/zero states.
 */
function makeQueryResult() {
  const result: any = {
    data: [],
    count: 0,
    error: null,
  };
  const handler: ProxyHandler<any> = {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: any) => resolve(result);
      }
      if (prop === "single" || prop === "maybeSingle") {
        return () => Promise.resolve({ data: null, error: null });
      }
      if (prop === "csv") {
        return () => Promise.resolve({ data: "", error: null });
      }
      return () => proxy;
    },
  };
  const proxy: any = new Proxy({}, handler);
  return proxy;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: () => makeQueryResult(),
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: {
        invoke: () => Promise.resolve({ data: null, error: null }),
      },
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ data: null, error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "" }, error: null }),
        }),
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  };
});

// Fake authenticated admin so pages relying on useAuth render fully.
// The returned object must be referentially stable across renders,
// otherwise effects depending on `user` re-run forever.
vi.mock("@/hooks/useAuth", () => {
  const stableAuth = {
    user: { id: "test-user-id", email: "admin@test.local" },
    session: { access_token: "test" },
    loading: false,
    role: "admin",
    isAdmin: true,
    signUp: async () => ({ error: null }),
    signIn: async () => ({ error: null }),
    signOut: async () => {},
  };
  return {
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAuth: () => stableAuth,
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const dashboardPages: Array<[string, () => Promise<any>]> = [
  ["OverviewPage", () => import("@/pages/dashboard/OverviewPage")],
  ["DNAEnginePage", () => import("@/pages/dashboard/DNAEnginePage")],
  ["DNAEngineViewPage", () => import("@/pages/dashboard/DNAEngineViewPage")],
  ["TemplatesPage", () => import("@/pages/dashboard/TemplatesPage")],
  ["BlueprintsViewPage", () => import("@/pages/dashboard/BlueprintsViewPage")],
  ["BlueprintsHistoryPage", () => import("@/pages/dashboard/BlueprintsHistoryPage")],
  ["GenerationPage", () => import("@/pages/dashboard/GenerationPage")],
  ["GenerationHistoryPage", () => import("@/pages/dashboard/GenerationHistoryPage")],
  ["ScriptAssemblyPage", () => import("@/pages/dashboard/ScriptAssemblyPage")],
  ["ScriptEnginePage", () => import("@/pages/dashboard/ScriptEnginePage")],
  ["PromotedScriptsPage", () => import("@/pages/dashboard/PromotedScriptsPage")],
  ["ValidationResultsPage", () => import("@/pages/dashboard/ValidationResultsPage")],
  ["AdminUsersPage", () => import("@/pages/dashboard/AdminUsersPage")],
];

const userPages: Array<[string, () => Promise<any>]> = [
  ["UserGeneratePage", () => import("@/pages/app/UserGeneratePage")],
  ["UserHistoryPage", () => import("@/pages/app/UserHistoryPage")],
  ["UserScriptsPage", () => import("@/pages/app/UserScriptsPage")],
];

describe("Dashboard pages render without crashing (empty data)", () => {
  for (const [name, load] of dashboardPages) {
    it(`${name} renders`, async () => {
      const { default: Page } = await load();
      let container: HTMLElement | undefined;
      await act(async () => {
        ({ container } = renderWithProviders(<Page />));
      });
      expect(container!.innerHTML.length).toBeGreaterThan(0);
    });
  }
});

describe("User app pages render without crashing (empty data)", () => {
  for (const [name, load] of userPages) {
    it(`${name} renders`, async () => {
      const { default: Page } = await load();
      let container: HTMLElement | undefined;
      await act(async () => {
        ({ container } = renderWithProviders(<Page />));
      });
      expect(container!.innerHTML.length).toBeGreaterThan(0);
    });
  }
});
