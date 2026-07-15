import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const functionsRoot = path.resolve(__dirname, "../../../supabase/functions");

const adminGuarded = [
  "analyze-narrative",
  "analyze-narrative-sequences",
  "audit-cta-dedup",
  "backup-export",
  "backup-restore",
  "batch-extract-block-semantics",
  "calculate-pattern-correlations",
  "calculate-pattern-weights",
  "calculate-performance-normalization",
  "calculate-text-image-compatibility",
  "calculate-text-visual-alignment",
  "consolidate-block-patterns",
  "consolidate-verbal-intelligence",
  "data-readiness-check",
  "detect-cross-patterns",
  "detect-micro-events",
  "extract-block-semantics",
  "extract-cta-deep",
  "extract-cta-deep-v2",
  "extract-verbal-dna",
  "extract-viral-combinations",
  "extract-visual-blocks",
  "formalize-dna-v2",
  "gemini-key-health",
  "generate-cohort",
  "generate-cohort-summary",
  "generate-dna-base",
  "generate-dna-base-v2",
  "import-spreadsheet",
  "judge-narrative",
  "process-temporal-profile",
  "recalculate-viral-scores",
  "reprocess-v2-cancel",
  "reprocess-v2-create-job",
  "reprocess-v2-worker",
  "rescrape-engagement",
  "update-viral-lexicon",
  "validate-data-consistency",
  "validate-mvp-layers",
] as const;

const userGuarded = [
  "generate-early-event",
  "generate-hook-suggestions",
  "translate",
] as const;

const alreadyResourceGuarded = [
  "analyze-reference-topics",
  "assemble-script",
  "build-complete-generation-context",
  "download-video",
  "import-reference-video",
  "migrate-legacy-reference-videos",
  "process-reference-video",
  "process-video-pipeline",
  "promote-script-final",
  "revise-script-assembly",
  "transcribe-video",
  "validate-script-against-dna",
] as const;

const readFunction = (name: string) =>
  fs.readFileSync(path.join(functionsRoot, name, "index.ts"), "utf8");

describe("Edge Function authentication coverage", () => {
  it.each(adminGuarded)("protects %s as shared-library admin/service", (name) => {
    const source = readFunction(name);
    const optionsReturn = source.indexOf('req.method === "OPTIONS"');
    const guard = source.indexOf("await authorizeLibraryAdminOrServiceRequest(");
    const bodyRead = source.search(/await\s+req\.json\s*\(/);

    expect(guard).toBeGreaterThan(optionsReturn);
    if (bodyRead >= 0) expect(guard).toBeLessThan(bodyRead);
  });

  it.each(userGuarded)("requires a real user/service for %s", (name) => {
    const source = readFunction(name);
    const optionsReturn = source.indexOf('req.method === "OPTIONS"');
    const guard = source.indexOf("await authorizeUserOrServiceRequest(");
    const bodyRead = source.search(/await\s+req\.json\s*\(/);

    expect(guard).toBeGreaterThan(optionsReturn);
    if (bodyRead >= 0) expect(guard).toBeLessThan(bodyRead);
  });

  it.each(alreadyResourceGuarded)("keeps explicit resource auth in %s", (name) => {
    const source = readFunction(name);
    expect(source).toMatch(/requireUserOrService\s*\(|requireLibraryAdminOrService\s*\(/);
  });

  it("covers every deployed function directory", () => {
    const deployed = fs
      .readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
      .map((entry) => entry.name)
      .sort();
    const classified = [
      ...adminGuarded,
      ...userGuarded,
      ...alreadyResourceGuarded,
    ].sort();

    expect(classified).toEqual(deployed);

    const config = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/config.toml"),
      "utf8",
    );
    for (const name of deployed) {
      expect(config).toContain(`[functions.${name}]\nverify_jwt = true`);
    }
    expect(config.match(/^\[functions\./gm)).toHaveLength(deployed.length);
  });

  it.each([
    "analyze-narrative",
    "batch-extract-block-semantics",
    "process-video-pipeline",
    "reprocess-v2-create-job",
    "reprocess-v2-worker",
    "revise-script-assembly",
  ])("uses service credentials for internal calls from %s", (name) => {
    const source = readFunction(name);
    expect(source).not.toContain('Deno.env.get("SUPABASE_ANON_KEY")');
    expect(source).not.toContain('Deno.env.get("SUPABASE_PUBLISHABLE_KEY")');
    expect(source).toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    expect(source).toContain("internalFunctionHeaders(");
  });

  it("returns auth failures with their original HTTP status", () => {
    const helper = fs.readFileSync(
      path.join(functionsRoot, "_shared", "edge-auth.ts"),
      "utf8",
    );
    expect(helper).toContain("status = error.status");
    expect(helper).toContain("authorizeLibraryAdminOrServiceRequest");
    expect(helper).toContain("authorizeUserOrServiceRequest");
    expect(helper).toContain('Deno.env.get("EDGE_INTERNAL_SERVICE_TOKEN")');
    expect(helper).toContain("token === internalToken");
    expect(helper).not.toContain('claims?.role === "service_role"');
  });
});
