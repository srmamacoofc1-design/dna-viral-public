import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edge = readFileSync(
  resolve(process.cwd(), "supabase/functions/migrate-legacy-reference-videos/index.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260713211500_legacy_reference_storage_migration.sql"),
  "utf8",
);
const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
const privateBucketMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260713130000_private_reference_video_imports.sql"),
  "utf8",
);

describe("legacy public reference migration contract", () => {
  it("uses an admin-only durable ledger and an atomic skip-locked lease", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.reference_video_storage_migrations");
    expect(migration).toContain("REVOKE ALL ON public.reference_video_storage_migrations FROM anon, authenticated");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });

  it("seeds only legacy reference rows and sends ownerless data to quarantine", () => {
    expect(migration).toContain("WHERE rv.storage_bucket = 'videos'");
    expect(migration).toContain("COALESCE(legacy.user_id::text, 'unowned')");
    expect(migration).toContain("ON CONFLICT (reference_video_id) DO NOTHING");
  });

  it("copies server-side, verifies destination, swaps the row, then removes the source", () => {
    expect(edge).toContain("requireLibraryAdminOrService");
    expect(edge).toContain("destinationBucket: PRIVATE_REFERENCE_DESTINATION_BUCKET");
    expect(edge).toContain("verifyLegacyReferenceCopy");
    expect(edge).toContain("pointReferenceAtPrivateCopy");
    expect(edge).toContain("countLibraryReferences");
    expect(edge).toContain("legacySourceRemovalDecision");
    expect(edge).toContain("removeSourceAndVerify");

    const verifyIndex = edge.indexOf("const copy = await ensurePrivateCopy");
    const swapIndex = edge.indexOf("await pointReferenceAtPrivateCopy");
    const removeIndex = edge.indexOf("await removeSourceAndVerify");
    expect(verifyIndex).toBeGreaterThan(0);
    expect(swapIndex).toBeGreaterThan(verifyIndex);
    expect(removeIndex).toBeGreaterThan(swapIndex);
  });

  it("configures gateway JWT verification for the admin function", () => {
    expect(config).toContain("[functions.migrate-legacy-reference-videos]");
    expect(config).toMatch(/\[functions\.migrate-legacy-reference-videos\][\s\S]*verify_jwt\s*=\s*true/);
  });

  it("reserves the private legacy destination namespace to the service worker", () => {
    const reservedNamespaceChecks = privateBucketMigration.match(
      /COALESCE\(\(storage\.foldername\(name\)\)\[3\], ''\) <> 'legacy'/g,
    ) ?? [];
    expect(reservedNamespaceChecks.length).toBeGreaterThanOrEqual(4);
  });
});
