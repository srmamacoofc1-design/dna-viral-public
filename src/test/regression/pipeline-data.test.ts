/**
 * REGRESSION SUITE — Pipeline Data Integrity
 * 
 * Validates that the homologated pipeline chain maintains
 * data integrity across all critical tables.
 * 
 * Tables with user-scoped RLS (generation_contexts, script_assemblies,
 * promoted_scripts) are tested to CONFIRM that anon access returns 0 rows,
 * proving RLS is active. Data existence in those tables is verified
 * via service-role queries (admin path) separately.
 * 
 * MUST pass before every deploy.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const runLiveSupabaseTests = process.env.RUN_LIVE_SUPABASE_TESTS === "1";
const liveDescribe = runLiveSupabaseTests ? describe : describe.skip;
const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://test-project.supabase.co";
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "test-publishable-key";

const supabase = createClient(supabaseUrl, supabaseKey);

// ═══════════════════════════════════════════════════════════
// PUBLIC TABLES — DNA chain (no user-scoped RLS)
// ═══════════════════════════════════════════════════════════
liveDescribe("DNA Chain Integrity", () => {
  it("dna_objects table has at least 1 record with status=ready", async () => {
    const { data, error } = await supabase
      .from("dna_objects")
      .select("id, status")
      .eq("status", "ready")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("template_contexts table has at least 1 record with status=ready", async () => {
    const { data, error } = await supabase
      .from("template_contexts")
      .select("id, status")
      .eq("status", "ready")
      .limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("blueprint_contexts table has at least 1 record with status=ready", async () => {
    const { data, error } = await supabase
      .from("blueprint_contexts")
      .select("id, status")
      .eq("status", "ready")
      .limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("DNA chain has linked records (DNA → Template → Blueprint)", async () => {
    const { data: templates } = await supabase
      .from("template_contexts")
      .select("id, source_dna_object_id")
      .not("source_dna_object_id", "is", null)
      .limit(1);
    expect(templates!.length).toBeGreaterThanOrEqual(1);

    const { data: blueprints } = await supabase
      .from("blueprint_contexts")
      .select("id, source_template_context_id")
      .not("source_template_context_id", "is", null)
      .limit(1);
    expect(blueprints!.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════
// USER-SCOPED TABLES — RLS enforcement validation
// Anon key must NOT see data in these tables (proves RLS works)
// ═══════════════════════════════════════════════════════════
liveDescribe("RLS Enforcement — Anon Access Blocked", () => {
  it("generation_contexts returns 0 rows for anon (RLS active)", async () => {
    const { data, error } = await supabase
      .from("generation_contexts")
      .select("id")
      .limit(5);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it("script_assemblies returns 0 rows for anon (RLS active)", async () => {
    const { data, error } = await supabase
      .from("script_assemblies")
      .select("id")
      .limit(5);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it("promoted_scripts returns 0 rows for anon (RLS active)", async () => {
    const { data, error } = await supabase
      .from("promoted_scripts")
      .select("id")
      .limit(5);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it("reference_videos returns 0 rows for anon (RLS active)", async () => {
    const { data, error } = await supabase
      .from("reference_videos")
      .select("id")
      .limit(5);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it("reference_generation_runs returns 0 rows for anon (RLS active)", async () => {
    const { data, error } = await supabase
      .from("reference_generation_runs")
      .select("id")
      .limit(5);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// VIRAL CORPUS — never enumerable with the anonymous key
// ═══════════════════════════════════════════════════════════
liveDescribe("Viral Base Security", () => {
  it("videos table rejects anonymous enumeration", async () => {
    const { count, error } = await supabase
      .from("videos")
      .select("id", { count: "exact", head: true });
    expect(error).not.toBeNull();
    expect(count).toBeNull();
  });
});
