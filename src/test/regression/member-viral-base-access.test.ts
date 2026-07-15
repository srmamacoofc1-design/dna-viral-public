import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

describe("Authenticated Viral Base access contract", () => {
  it("keeps member uploads owner-scoped and outside the shared global corpus", () => {
    const upload = read("../../components/VideoUploadForm.tsx");

    expect(upload).toContain("created_by: user.id");
    expect(upload).toContain("approved_for_global: isAdmin");
    expect(upload).toContain("library/${user.id}/${video.id}");
    expect(upload).not.toContain("VITE_SUPABASE_ANON_KEY");
  });

  it("processes member-owned videos without writing private analysis into global aggregates", () => {
    const pipeline = read("../../../supabase/functions/process-video-pipeline/index.ts");

    expect(pipeline).toContain("requireUserOrService");
    expect(pipeline).toContain("requireResourceOwnerAdminOrService");
    expect(pipeline).toContain("includeGlobalAggregation");
    expect(pipeline).toContain("video.approved_for_global === true");
    expect(pipeline).toContain("error instanceof EdgeAuthError");
    expect(pipeline).toContain("error.status");
  });

  it("builds the global DNA only from approved videos", () => {
    const stylePack = read("../../lib/dna-style-pack.ts");
    expect(stylePack).toContain('.eq("approved_for_global", true)');

    const globalFunctions = [
      "analyze-narrative-sequences",
      "build-complete-generation-context",
      "calculate-pattern-correlations",
      "calculate-pattern-weights",
      "calculate-performance-normalization",
      "consolidate-block-patterns",
      "consolidate-verbal-intelligence",
      "extract-viral-combinations",
      "formalize-dna-v2",
      "generate-dna-base",
      "generate-dna-base-v2",
      "judge-narrative",
      "update-viral-lexicon",
    ];
    for (const functionName of globalFunctions) {
      const source = read(`../../../supabase/functions/${functionName}/index.ts`);
      expect(source, functionName).toContain("approved_for_global");
    }
  });

  it("ships owner RLS for videos, child analyses, presets and Storage", () => {
    const migration = read(
      "../../../supabase/migrations/20260714123000_authenticated_viral_base_access.sql",
    );

    expect(migration).toContain("videos_member_insert_own");
    expect(migration).toContain("videos_read_authenticated");
    expect(migration).toContain("authenticated_video_rows_read");
    expect(migration).toContain("member_own_video_rows");
    expect(migration).toContain("dataset_cohort_member_preset_insert");
    expect(migration).toContain("dataset_cohort_videos_read_authenticated");
    expect(migration).toContain("videos_storage_member_library_insert");
    expect(migration).toContain("audit_trail_read_admin");
    expect(migration).toContain("REVOKE SELECT ON TABLE public.videos FROM PUBLIC, anon");

    const manageHelper = migration.slice(
      migration.indexOf("FUNCTION public.can_manage_viral_video"),
      migration.indexOf("FUNCTION public.can_read_viral_video"),
    );
    const memberDelete = migration.slice(
      migration.indexOf("CREATE POLICY videos_member_delete_own"),
      migration.indexOf("-- Replace the historical anonymous corpus reads"),
    );
    expect(manageHelper).toContain("video.approved_for_global = false");
    expect(memberDelete).toContain("approved_for_global = false");
  });

  it("keeps the member guide on the automatic private flow and exposes preset prerequisites", () => {
    const guide = read("../../../docs/GUIA-AUTOMACAO-DNA-VIRAL-2026-07-15.md");
    const library = read("../../components/VideoLibrary.tsx");

    expect(guide).toContain("Nos vídeos pessoais, essas etapas são automáticas");
    expect(guide).toContain("exclusiva de administrador");
    expect(guide).not.toContain("Se houver análises pendentes, abra [DNA Viral]");
    expect(library).toContain("selected.size < 3");
    expect(library).toContain("Selecione pelo menos 3 vídeos concluídos com visualizações.");
  });
});
