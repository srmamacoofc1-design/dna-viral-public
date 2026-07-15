import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");

describe("video narrative sequence fail-closed gates", () => {
  it("blocks assembly before visual selection and generation when normalized order is invalid", () => {
    const assembler = source("../../../supabase/functions/assemble-script/index.ts");
    const assessment = assembler.indexOf("assessVideoNarrativeSequence(slots, structuralContract)");
    const rejection = assembler.indexOf('status: "invalid_narrative_sequence"');
    const generation = assembler.indexOf("for (let i = 0; i < slots.length; i++)");
    expect(assessment).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(assessment);
    expect(generation).toBeGreaterThan(rejection);
    expect(assembler).toContain("dominant_sequence_count: stylePack.dominant_sequence_count");
    expect(assembler).toContain("narrative_sequence_contract: narrativeSequenceAssessment");
  });

  it("independently rejects the same invalid slot order in formal validation", () => {
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    const assessment = validator.indexOf("assessVideoNarrativeSequence(slotSequence");
    const rejection = validator.indexOf("slot_sequence de vídeo viola a ordem abstrata");
    const slotLoop = validator.indexOf("for (const slot of slotSequence)");
    expect(assessment).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(assessment);
    expect(slotLoop).toBeGreaterThan(rejection);
  });

  it("recalcula e bloqueia regressao dos timestamps visuais no validador", () => {
    const validator = source("../../../supabase/functions/validate-script-against-dna/index.ts");
    const selection = validator.indexOf("const visualTimelineSelections = inputMode === \"video\"");
    const assessment = validator.indexOf("assessVisualEvidenceTimeline(visualTimelineSelections, {");
    const deterministicGate = validator.indexOf("visualTimelineAssessment?.passed === true");
    const rejection = validator.indexOf('statusReason = "visual_timeline_invalid"');
    const semanticBatch = validator.indexOf("const semanticPlans = deterministicGlobalContractsPassed");
    expect(selection).toBeGreaterThan(-1);
    expect(assessment).toBeGreaterThan(selection);
    expect(deterministicGate).toBeGreaterThan(assessment);
    expect(rejection).toBeGreaterThan(deterministicGate);
    expect(semanticBatch).toBeGreaterThan(deterministicGate);
    expect(validator).toContain("visual_timeline_contract: visualTimelineAssessment");
  });

  it("never compares slots to the literal dominant source sequence", () => {
    const helper = source("../../../supabase/functions/_shared/narrative-sequence-contract.ts");
    expect(helper).toContain("statistical_reference_only");
    expect(helper).toContain("literal_source_sequence_required");
    expect(helper).not.toContain("slots.join");
  });
});
