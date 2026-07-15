import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260713210000_server_owned_generation_outputs.sql"),
  "utf8",
);

describe("server-owned generation outputs", () => {
  it("removes member mutation policies from approval-bearing assemblies", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "sa_insert_own_or_admin"');
    expect(migration).toContain('DROP POLICY IF EXISTS "sa_update_own_or_admin"');
    expect(migration).toContain('CREATE POLICY "sa_insert_admin_only"');
    expect(migration).toContain('CREATE POLICY "sa_update_admin_only"');
    expect(migration).toContain('DROP POLICY IF EXISTS "sa_insert_admin_only"');
    expect(migration).toContain('DROP POLICY IF EXISTS "sa_update_admin_only"');
  });

  it("keeps member reads but makes final-script mutation server/admin owned", () => {
    expect(migration).toContain('CREATE POLICY "ps_select_own_or_admin"');
    expect(migration).toContain('DROP POLICY IF EXISTS "ps_insert_own_or_admin"');
    expect(migration).toContain('CREATE POLICY "ps_insert_admin_only"');
    expect(migration).toContain('CREATE POLICY "ps_update_admin_only"');
    expect(migration).toContain('DROP POLICY IF EXISTS "ps_insert_admin_only"');
    expect(migration).toContain('DROP POLICY IF EXISTS "ps_update_admin_only"');
  });

  it("keeps regular members read-only while preserving explicitly trusted admin tooling", () => {
    expect(migration).toContain('CREATE POLICY "sa_select_own_or_admin"');
    expect(migration).toContain("WITH CHECK (public.has_role(auth.uid(), 'admin'))");
    expect(migration).not.toContain('CREATE POLICY "sa_insert_own_or_admin"');
    expect(migration).not.toContain('CREATE POLICY "sa_update_own_or_admin"');
    expect(migration).not.toContain('CREATE POLICY "ps_insert_own_or_admin"');
    expect(migration).not.toContain('CREATE POLICY "ps_update_own_or_admin"');
  });
});
