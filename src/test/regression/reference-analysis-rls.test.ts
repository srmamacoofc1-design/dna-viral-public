import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260713213000_server_owned_reference_analysis.sql"),
  "utf8",
);

describe("server-owned reference analysis", () => {
  it("lets members reserve only raw private references", () => {
    expect(migration).toContain('CREATE POLICY "rv_insert_raw_own_or_admin"');
    expect(migration).toContain("storage_bucket = 'reference-videos'");
    expect(migration).toContain("status IN ('uploading', 'pending', 'error')");
    expect(migration).toContain("AND transcription IS NULL");
    expect(migration).toContain("COALESCE(frames, '[]'::jsonb) = '[]'::jsonb");
    expect(migration).not.toContain('CREATE POLICY "rv_insert_own_or_admin"');
  });

  it("keeps derived evidence readable by its owner but writable only by trusted backends/admins", () => {
    for (const prefix of ["rvf", "rvt", "rvtp"]) {
      expect(migration).toContain(`CREATE POLICY "${prefix}_select_own_or_admin"`);
      expect(migration).toContain(`CREATE POLICY "${prefix}_insert_admin_only"`);
      expect(migration).toContain(`CREATE POLICY "${prefix}_update_admin_only"`);
      expect(migration).not.toContain(`CREATE POLICY "${prefix}_insert_own_or_admin"`);
      expect(migration).not.toContain(`CREATE POLICY "${prefix}_update_own_or_admin"`);
    }
  });

  it("removes every legacy public child-table policy", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Allow public all reference_video_frames"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Allow public all reference_video_transcripts"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Allow public all reference_video_topics"');
  });
});
