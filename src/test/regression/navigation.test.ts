/**
 * REGRESSION SUITE — Dashboard Navigation
 * 
 * Validates that the sidebar only contains real, functional routes.
 * No placeholders, no redirects, no dead links.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Dashboard Sidebar — No Placeholders", () => {
  let sidebarSource: string;

  beforeAll(() => {
    sidebarSource = fs.readFileSync(
      path.resolve(__dirname, "../../components/DashboardSidebar.tsx"),
      "utf-8"
    );
  });

  const bannedRoutes = [
    "/dashboard/dna-engine/compare",
    "/dashboard/reports/viral",
    "/dashboard/reports/dna",
    "/dashboard/reports/performance",
    "/dashboard/database",
    "/dashboard/settings",
    "/dashboard/templates/create",
    "/dashboard/templates/edit",
    "/dashboard/blueprints/generate",
  ];

  it.each(bannedRoutes)(
    "sidebar does NOT contain placeholder route: %s",
    (route) => {
      expect(sidebarSource).not.toContain(`"${route}"`);
      expect(sidebarSource).not.toContain(`'${route}'`);
    }
  );

  const requiredRoutes = [
    "/dashboard",
    "/dashboard/dna-engine/build",
    "/dashboard/dna-engine/view",
    "/dashboard/templates",
    "/dashboard/blueprints/view",
    "/dashboard/blueprints/history",
    "/dashboard/script-engine",
    "/dashboard/promoted",
    "/dashboard/generation",
    "/dashboard/generation/history",
    "/dashboard/script-assembly",
    "/dashboard/validation/results",
  ];

  it.each(requiredRoutes)(
    "sidebar contains production route: %s",
    (route) => {
      expect(sidebarSource).toContain(route);
    }
  );
});

describe("User Sidebar — Correct Routes", () => {
  let userSidebarSource: string;

  beforeAll(() => {
    userSidebarSource = fs.readFileSync(
      path.resolve(__dirname, "../../components/UserSidebar.tsx"),
      "utf-8"
    );
  });

  const requiredUserRoutes = [
    "/app",
    "/app/history",
    "/app/scripts",
    "/old-home",
    "/queue",
    "/library",
    "/dashboard",
  ];

  it.each(requiredUserRoutes)(
    "user sidebar contains route: %s",
    (route) => {
      expect(userSidebarSource).toContain(route);
    }
  );

  const bannedAdminRoutes = [
    "/dashboard/dna-engine",
    "/dashboard/templates",
    "/dashboard/blueprints",
    "/dashboard/generation",
    "/dashboard/script-engine",
    "/dashboard/database",
    "/dashboard/settings",
  ];

  it.each(bannedAdminRoutes)(
    "user sidebar does NOT contain admin route: %s",
    (route) => {
      expect(userSidebarSource).not.toContain(route);
    }
  );

  it("shows Viral Base to every login and keeps only Administration admin-only", () => {
    const basePosition = userSidebarSource.indexOf("Base Viral");
    const adminGuardPosition = userSidebarSource.indexOf("{isAdmin && (", basePosition);
    const administrationPosition = userSidebarSource.indexOf("Administração", adminGuardPosition);

    expect(basePosition).toBeGreaterThanOrEqual(0);
    expect(adminGuardPosition).toBeGreaterThan(basePosition);
    expect(administrationPosition).toBeGreaterThan(adminGuardPosition);
    expect(userSidebarSource).toContain("Adicionar vídeos");
    expect(userSidebarSource).toContain("Fila de processamento");
    expect(userSidebarSource).toContain("Biblioteca e Presets");
    expect(userSidebarSource).toContain("Painel administrativo");
  });
});

describe("Auth Infrastructure", () => {
  it("allows every authenticated member into the Viral Base workspace", () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, "../../App.tsx"),
      "utf-8"
    );
    const memberBoundary = appSource.slice(
      appSource.indexOf("{/* Viral Base workspace (every authenticated user). */}"),
      appSource.indexOf("{/* Advanced corpus administration and system analysis remain admin-only. */}")
    );
    expect(memberBoundary).toContain("<ProtectedRoute>");
    expect(memberBoundary).not.toContain("requiredRole");

    const memberRoutes = [
      "/old-home",
      "/queue",
      "/library",
      "/video/:id",
    ];
    memberRoutes.forEach((route) => {
      expect(memberBoundary).toContain(`path="${route}"`);
    });
  });

  it("keeps advanced corpus and system routes admin-only", () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, "../../App.tsx"),
      "utf-8"
    );
    const adminBoundary = appSource.slice(
      appSource.indexOf("{/* Advanced corpus administration and system analysis remain admin-only. */}"),
      appSource.indexOf('<Route path="*"')
    );
    expect(adminBoundary).toContain('<ProtectedRoute requiredRole="admin">');

    const protectedAdminRoutes = [
      "/report",
      "/dna-viral",
      "/backup",
      "/import",
      "/validation",
      "/system-xray",
    ];
    protectedAdminRoutes.forEach((route) => {
      expect(adminBoundary).toContain(`path="${route}"`);
    });
  });

  it("AuthProvider exists and exports useAuth", () => {
    const authSource = fs.readFileSync(
      path.resolve(__dirname, "../../hooks/useAuth.tsx"),
      "utf-8"
    );
    expect(authSource).toContain("AuthProvider");
    expect(authSource).toContain("useAuth");
    expect(authSource).toContain("signIn");
    expect(authSource).toContain("signOut");
    expect(authSource).toContain("signUp");
    expect(authSource).toContain("role");
    expect(authSource).toContain("isAdmin");
  });

  it("ProtectedRoute exists with role support", () => {
    const prSource = fs.readFileSync(
      path.resolve(__dirname, "../../components/ProtectedRoute.tsx"),
      "utf-8"
    );
    expect(prSource).toContain("requiredRole");
    expect(prSource).toContain("admin");
    expect(prSource).toContain("/login");
    expect(prSource).toContain("/app");
  });

  it("LoginPage exists", () => {
    const loginSource = fs.readFileSync(
      path.resolve(__dirname, "../../pages/LoginPage.tsx"),
      "utf-8"
    );
    expect(loginSource).toContain("signIn");
    expect(loginSource).toContain("signUp");
  });
});
