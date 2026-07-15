import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Auth
import LoginPage from "./pages/LoginPage";

// User Dashboard
import { UserDashboardLayout } from "@/components/UserDashboardLayout";
import UserGeneratePage from "./pages/app/UserGeneratePage";
import UserHistoryPage from "./pages/app/UserHistoryPage";
import UserScriptsPage from "./pages/app/UserScriptsPage";

// Existing pages
import Index from "./pages/Index.tsx";
import QueuePage from "./pages/QueuePage.tsx";
import LibraryPage from "./pages/LibraryPage.tsx";
import VideoDetailPage from "./pages/VideoDetailPage.tsx";
import ReportPage from "./pages/ReportPage.tsx";
import DNAViralPage from "./pages/DNAViralPage.tsx";
import BackupPage from "./pages/BackupPage.tsx";
import ImportPage from "./pages/ImportPage.tsx";
import ValidationPage from "./pages/ValidationPage.tsx";
import LexiconPage from "./pages/LexiconPage.tsx";
import CohortsPage from "./pages/CohortsPage.tsx";
import CohortDetailPage from "./pages/CohortDetailPage.tsx";
import CTADeepPage from "./pages/CTADeepPage.tsx";
import DNAV2Page from "./pages/DNAV2Page.tsx";
import TemporalReportPage from "./pages/TemporalReportPage.tsx";
import MicroEventsPage from "./pages/MicroEventsPage.tsx";
import PatternLibraryPage from "./pages/PatternLibraryPage.tsx";
import CombinacoesPage from "./pages/CombinacoesPage.tsx";
import CostPredictionPage from "./pages/CostPredictionPage.tsx";
import CTAAuditPage from "./pages/CTAAuditPage.tsx";
import VerbalIntelligencePage from "./pages/VerbalIntelligencePage.tsx";
import SystemXRayPage from "./pages/SystemXRayPage.tsx";
import DataReadinessPage from "./pages/DataReadinessPage.tsx";
import MasterReadinessReportPage from "./pages/MasterReadinessReportPage.tsx";
import MasterSystemReportPage from "./pages/MasterSystemReportPage.tsx";
import NotFound from "./pages/NotFound.tsx";
import { ProcessingBootstrap } from "@/components/ProcessingBootstrap";

// Dashboard layout & pages
import { DashboardLayout } from "@/components/DashboardLayout";
import OverviewPage from "./pages/dashboard/OverviewPage.tsx";
import DNAEnginePage from "./pages/dashboard/DNAEnginePage.tsx";
import DNAEngineViewPage from "./pages/dashboard/DNAEngineViewPage.tsx";
import DNAEngineComparePage from "./pages/dashboard/DNAEngineComparePage.tsx";
import TemplatesPage from "./pages/dashboard/TemplatesPage.tsx";
import TemplatesCreatePage from "./pages/dashboard/TemplatesCreatePage.tsx";
import TemplatesEditPage from "./pages/dashboard/TemplatesEditPage.tsx";
import BlueprintsGeneratePage from "./pages/dashboard/BlueprintsGeneratePage.tsx";
import BlueprintsViewPage from "./pages/dashboard/BlueprintsViewPage.tsx";
import BlueprintsHistoryPage from "./pages/dashboard/BlueprintsHistoryPage.tsx";
import GenerationPage from "./pages/dashboard/GenerationPage.tsx";
import GenerationHistoryPage from "./pages/dashboard/GenerationHistoryPage.tsx";
import ScriptAssemblyPage from "./pages/dashboard/ScriptAssemblyPage.tsx";
import ScriptEnginePage from "./pages/dashboard/ScriptEnginePage.tsx";
import ValidationDashPage from "./pages/dashboard/ValidationDashPage.tsx";
import ValidationResultsPage from "./pages/dashboard/ValidationResultsPage.tsx";
import ReportsViralPage from "./pages/dashboard/ReportsViralPage.tsx";
import ReportsDNAPage from "./pages/dashboard/ReportsDNAPage.tsx";
import ReportsPerformancePage from "./pages/dashboard/ReportsPerformancePage.tsx";
import DatabasePage from "./pages/dashboard/DatabasePage.tsx";
import SettingsPage from "./pages/dashboard/SettingsPage.tsx";
import PromotedScriptsPage from "./pages/dashboard/PromotedScriptsPage.tsx";
import AdminUsersPage from "./pages/dashboard/AdminUsersPage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <ProcessingBootstrap />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />

            {/* Root redirects to user dashboard */}
            <Route path="/" element={<Navigate to="/app" replace />} />

            {/* User Dashboard (member + admin) */}
            <Route path="/app" element={
              <ProtectedRoute>
                <UserDashboardLayout />
              </ProtectedRoute>
            }>
              <Route index element={<UserGeneratePage />} />
              <Route path="history" element={<UserHistoryPage />} />
              <Route path="scripts" element={<UserScriptsPage />} />
            </Route>

            {/* Admin Dashboard */}
            <Route path="/dashboard" element={
              <ProtectedRoute requiredRole="admin">
                <DashboardLayout />
              </ProtectedRoute>
            }>
              <Route index element={<OverviewPage />} />
              <Route path="dna-engine/build" element={<DNAEnginePage />} />
              <Route path="dna-engine/view" element={<DNAEngineViewPage />} />
              <Route path="dna-engine/compare" element={<DNAEngineComparePage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="templates/create" element={<TemplatesCreatePage />} />
              <Route path="templates/edit" element={<TemplatesEditPage />} />
              <Route path="blueprints/generate" element={<BlueprintsGeneratePage />} />
              <Route path="blueprints/view" element={<BlueprintsViewPage />} />
              <Route path="blueprints/history" element={<BlueprintsHistoryPage />} />
              <Route path="generation" element={<GenerationPage />} />
              <Route path="generation/history" element={<GenerationHistoryPage />} />
              <Route path="script-assembly" element={<ScriptAssemblyPage />} />
              <Route path="script-engine" element={<ScriptEnginePage />} />
              <Route path="promoted" element={<PromotedScriptsPage />} />
              <Route path="validation" element={<ValidationDashPage />} />
              <Route path="validation/results" element={<ValidationResultsPage />} />
              <Route path="reports/viral" element={<ReportsViralPage />} />
              <Route path="reports/dna" element={<ReportsDNAPage />} />
              <Route path="reports/performance" element={<ReportsPerformancePage />} />
              <Route path="database" element={<DatabasePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="users" element={<AdminUsersPage />} />
            </Route>

            {/* Viral Base workspace (every authenticated user). */}
            <Route element={
              <ProtectedRoute>
                <Outlet />
              </ProtectedRoute>
            }>
              <Route path="/old-home" element={<Index />} />
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/video/:id" element={<VideoDetailPage />} />
            </Route>

            {/* Advanced corpus administration and system analysis remain admin-only. */}
            <Route element={
              <ProtectedRoute requiredRole="admin">
                <Outlet />
              </ProtectedRoute>
            }>
              <Route path="/report" element={<ReportPage />} />
              <Route path="/dna-viral" element={<DNAViralPage />} />
              <Route path="/backup" element={<BackupPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/validation" element={<ValidationPage />} />
              <Route path="/lexicon" element={<LexiconPage />} />
              <Route path="/cohorts" element={<CohortsPage />} />
              <Route path="/cohorts/:id" element={<CohortDetailPage />} />
              <Route path="/cta-deep" element={<CTADeepPage />} />
              <Route path="/dna-v2" element={<DNAV2Page />} />
              <Route path="/temporal" element={<TemporalReportPage />} />
              <Route path="/micro-events" element={<MicroEventsPage />} />
              <Route path="/patterns" element={<PatternLibraryPage />} />
              <Route path="/combinacoes" element={<CombinacoesPage />} />
              <Route path="/costs" element={<CostPredictionPage />} />
              <Route path="/cta-audit" element={<CTAAuditPage />} />
              <Route path="/verbal-intelligence" element={<VerbalIntelligencePage />} />
              <Route path="/system-xray" element={<SystemXRayPage />} />
              <Route path="/data-readiness" element={<DataReadinessPage />} />
              <Route path="/master-readiness-report" element={<MasterReadinessReportPage />} />
              <Route path="/master-system-report" element={<MasterSystemReportPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
