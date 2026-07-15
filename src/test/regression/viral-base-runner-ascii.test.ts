import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const runner = fs.readFileSync(
  path.resolve(__dirname, "../../../scripts/run-viral-base-pipeline.ps1"),
  "utf8",
);

describe("Windows PowerShell viral-base runner encoding", () => {
  it("keeps the source ASCII-only and constructs the preset em dash at runtime", () => {
    const nonAscii = [...runner].filter((character) => character.charCodeAt(0) > 0x7f);
    expect(nonAscii).toEqual([]);
    expect(runner).toContain("$EmDash = [char]0x2014");
    expect(runner).toContain("$PresetName = 'Base Viral {0} 50 Shorts Fornecidos (Jul 2026)' -f $EmDash");
  });

  it("keeps operational notes and messages readable without encoding-dependent literals", () => {
    expect(runner).toContain("$env:TARGET_NOTES = 'Prioridade visual absoluta. Modelar as estrategias");
    expect(runner).toContain("micro-revelacoes e payoff fiel ao video.");
  });

  it("does not turn a native console warning into a fatal PowerShell error", () => {
    const invokeAt = runner.indexOf("& npx.cmd vite-node $ScriptPath 2>&1");
    const continueAt = runner.lastIndexOf("$ErrorActionPreference = 'Continue'", invokeAt);
    const exitCaptureAt = runner.indexOf("$nativeExitCode = $LASTEXITCODE", invokeAt);
    expect(invokeAt).toBeGreaterThan(-1);
    expect(continueAt).toBeGreaterThan(-1);
    expect(continueAt).toBeLessThan(invokeAt);
    expect(exitCaptureAt).toBeGreaterThan(invokeAt);
    expect(runner).toContain("return [int]$nativeExitCode");
  });

  it("serializes provider work while the pool is quota constrained", () => {
    expect(runner).toContain("$env:VIRAL_CONCURRENCY = '1'");
  });
});
