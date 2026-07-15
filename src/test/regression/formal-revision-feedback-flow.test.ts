import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");

describe("formal validation feedback regeneration flow", () => {
  it("passes the persisted validation result from revise into the internal assembler", () => {
    const reviser = source("../../../supabase/functions/revise-script-assembly/index.ts");
    expect(reviser).toContain("revision_feedback: {");
    expect(reviser).toContain("validation_result: assembly.validation_result");
    expect(reviser).toContain("source_validation_version: assembly.validation_version");
    expect(reviser).toContain("formal_feedback_fingerprint");
  });

  it("accepts feedback only from service calls, sanitizes it and persists traceability", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    const serviceGate = assembler.indexOf('revisionFeedbackProvided && actor.kind !== "service"');
    const sanitizer = assembler.indexOf("sanitizeFormalRevisionFeedback(body.revision_feedback)");
    const prompt = assembler.indexOf("FEEDBACK FORMAL SANITIZADO DA VALIDAÇÃO ANTERIOR");
    const trace = assembler.indexOf("formal_revision_feedback: formalRevisionFeedback");
    expect(serviceGate).toBeGreaterThan(-1);
    expect(sanitizer).toBeGreaterThan(serviceGate);
    expect(prompt).toBeGreaterThan(sanitizer);
    expect(trace).toBeGreaterThan(prompt);
  });
});
