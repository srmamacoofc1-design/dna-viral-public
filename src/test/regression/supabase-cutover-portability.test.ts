import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LEGACY_PROJECT_REF = "mjejbtsmrtakywgbsqwo";
const LEGACY_ADMIN_USER_ID = "8cf5804c-301d-467c-b8d0-ed56448a9244";
const JWT_LITERAL = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..", "..", "..");

interface SourceFile {
  relativePath: string;
  contents: string;
}

function repositoryPath(...segments: string[]): string {
  return path.join(repositoryRoot, ...segments);
}

function readSource(relativePath: string): SourceFile {
  const absolutePath = repositoryPath(...relativePath.split("/"));
  return {
    relativePath,
    contents: fs.readFileSync(absolutePath, "utf8"),
  };
}

function migrationSources(): SourceFile[] {
  const migrationsDirectory = repositoryPath("supabase", "migrations");
  return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => readSource(`supabase/migrations/${name}`));
}

function lineNumberAt(contents: string, offset: number): number {
  return contents.slice(0, offset).split(/\r?\n/).length;
}

function literalLocations(source: SourceFile, literal: string): string[] {
  const locations: string[] = [];
  const normalizedContents = source.contents.toLowerCase();
  const normalizedLiteral = literal.toLowerCase();
  let offset = normalizedContents.indexOf(normalizedLiteral);
  while (offset >= 0) {
    locations.push(`${source.relativePath}:${lineNumberAt(source.contents, offset)}`);
    offset = normalizedContents.indexOf(normalizedLiteral, offset + normalizedLiteral.length);
  }
  return locations;
}

describe("Supabase cutover portability", () => {
  const portableSources = [
    ...migrationSources(),
    readSource("scripts/test-style-pack-live.ts"),
    readSource("src/test/regression/pipeline-data.test.ts"),
    readSource("supabase/config.toml"),
  ];

  it("contains no binding or JWT literal from the legacy Supabase project", () => {
    const legacyReferenceLocations = portableSources.flatMap((source) =>
      literalLocations(source, LEGACY_PROJECT_REF),
    );
    const jwtLocations = portableSources.flatMap((source) =>
      Array.from(source.contents.matchAll(JWT_LITERAL), (match) =>
        `${source.relativePath}:${lineNumberAt(source.contents, match.index)}`,
      ),
    );

    expect(legacyReferenceLocations, "legacy project ref found at").toEqual([]);
    expect(jwtLocations, "hard-coded JWT found at").toEqual([]);
  });

  it("does not bootstrap an administrator through the legacy fixed UUID", () => {
    const locations = migrationSources().flatMap((source) =>
      literalLocations(source, LEGACY_ADMIN_USER_ID),
    );

    expect(locations, "legacy admin UUID found at").toEqual([]);
  });

  it("keeps local environment credentials ignored and config detached from the legacy project", () => {
    const gitignore = readSource(".gitignore").contents;
    const activePatterns = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    const config = readSource("supabase/config.toml");

    expect(activePatterns).toContain(".env");
    expect(activePatterns).not.toContain("!.env");
    expect(literalLocations(config, LEGACY_PROJECT_REF)).toEqual([]);
  });

  it("ships a fail-closed final RLS and portable member bootstrap migration", () => {
    const hardening = readSource(
      "supabase/migrations/20260713220000_final_rls_hardening.sql",
    ).contents;

    expect(hardening).toContain("CREATE OR REPLACE FUNCTION public.handle_new_user()");
    expect(hardening).not.toMatch(/[A-Z0-9._%+-]+@gmail\.com/i);
    expect(hardening).toContain("VALUES (NEW.id, 'member'::public.app_role)");
    expect(hardening).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(hardening).toContain(
      "RLS hardening failed: an unconditional public/anon mutation policy remains",
    );
    expect(hardening).toContain("Storage hardening failed: a public/anon object mutation policy remains");
    expect(hardening).toContain("every auth user must have one profile and exactly one role");
  });
});
