import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("narrative precision fail-closed wiring", () => {
  it("repairs initial and revision Writer output before promotion", () => {
    const assembler = source("supabase/functions/assemble-script/index.ts");
    expect(assembler).toContain("NARRATIVE_PRECISION_WRITER_RULES");
    expect(assembler).toContain("batch_writer_narrative_precision_failed");
    expect(assembler).toContain("collectRevisionPrecisionIssues");
    expect(assembler).toContain("revisionPrecisionIssues = collectRevisionPrecisionIssues(proposed)");
    expect(assembler).toContain("narrative_precision:${issue.type}:${issue.found}");
  });

  it("caps the viral evaluator and publishes precision feedback", () => {
    const assembler = source("supabase/functions/assemble-script/index.ts");
    const conversationalGateAt = assembler.indexOf("const conversationallyReconciledValue = enforceConversationalAndControversyGate({");
    const precisionGateAt = assembler.indexOf("const precisionReconciledValue = enforceNarrativePrecisionGate({");
    expect(conversationalGateAt).toBeGreaterThan(0);
    expect(precisionGateAt).toBeGreaterThan(conversationalGateAt);
    expect(assembler).toContain("__narrative_precision_gate: assessment");
    expect(assembler).toContain("overall_score: Math.min(Number(source?.overall_score) || 0, 8.4)");
  });

  it("recomputes the same critical criterion in formal validation", () => {
    const validator = source("supabase/functions/validate-script-against-dna/index.ts");
    expect(validator).toContain('from "../_shared/narrative-precision-guard.ts"');
    expect(validator).toContain("const narrativePrecisionAssessment = inputMode === \"video\"");
    expect(validator).toContain("criteria as any).narrative_precision = criterion(");
    expect(validator).toContain("narrative_precision?.value === false");
    expect(validator).toContain('statusReason = "narrative_precision_gate_failed"');
  });
});
