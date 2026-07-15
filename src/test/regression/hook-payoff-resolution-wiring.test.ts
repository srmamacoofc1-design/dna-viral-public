import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("hook/payoff semantic resolution wiring", () => {
  it("requires exact semantic closure in Writer and Evaluator", () => {
    const assembler = source("supabase/functions/assemble-script/index.ts");
    expect(assembler).toContain("Merely repeating the hook's person/object");
    expect(assembler).toContain("hook_payoff_resolution");
    expect(assembler).toContain("enforceHookPayoffResolutionGate");
    expect(assembler).toContain("object_overlap_alone_is_insufficient: true");
  });

  it("rechecks a current persisted gate and independently judges semantics in formal validation", () => {
    const validator = source("supabase/functions/validate-script-against-dna/index.ts");
    expect(validator).toContain("assessPersistedHookPayoffResolution");
    expect(validator).toContain("semantic_answer_to_exact_hook_open_loop");
    expect(validator).toContain("object_or_character_overlap_alone_is_insufficient: true");
    expect(validator).toContain("hookPayoffResolutionGatePassed");
    expect(validator).toContain("criteria.payoff_alignment?.value !== true");
  });
});

