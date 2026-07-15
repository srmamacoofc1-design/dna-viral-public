import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("local relationship/intent/conclusion guard wiring", () => {
  it("repairs and then fails closed in the assembler", () => {
    const assembler = source("supabase/functions/assemble-script/index.ts");
    expect(assembler).toContain("unsupported_local_relationship_intent_or_conclusion");
    expect(assembler).toContain("batch_writer_local_claim_grounding_failed");
    expect(assembler).toContain("localClaimEvidenceForWriterContract(contract)");
    expect(assembler).toContain("LOCAL_CLAIM_GROUNDING_WRITER_RULES");
    expect(assembler).toContain("local_claim_grounding: localClaims");
    expect(assembler).toContain("localClaimRepairInstruction");
    expect(assembler).toContain("pronoun_subject_transfer");
    expect(assembler).toContain("collective_action_not_grounded_for_each_subject");
    expect(assembler).toContain("previousCopyRepairRejections");
    expect(assembler).toContain("Prior candidate rejections that must also be fixed");
    expect(assembler).toContain("prioritizeCopyRepairRejectionReasons");
    expect(assembler).toContain("local_claim|collective_action|pronoun_subject");
    expect(assembler).toContain("required_change: localClaimRepairInstruction(failure.local_claim_grounding.unsupported_claim_ids)");
  });

  it("rechecks the claim deterministically in formal validation", () => {
    const validator = source("supabase/functions/validate-script-against-dna/index.ts");
    expect(validator).toContain("assessLocalClaimGrounding");
    expect(validator).toContain("local_relationship_intent_conclusion_grounding");
    expect(validator).toContain("same_slot_evidence_only: true");
    expect(validator).toContain("topic_metadata_is_not_factual_authority: true");
    expect(validator).toContain("local_relationship_intent_conclusion_grounding?.value === false");
  });

  it("keeps topic analysis as navigation metadata, never story evidence", () => {
    const assembler = source("supabase/functions/assemble-script/index.ts");
    const truthStart = assembler.indexOf("function operationalVideoTruth");
    const truthEnd = assembler.indexOf("function operationalContentProfile", truthStart);
    const truthBody = assembler.slice(truthStart, truthEnd);
    expect(truthBody).toContain("navigation_only: true");
    expect(truthBody).toContain("factual_authority: false");
    expect(truthBody).not.toContain("central_topic:");
    expect(truthBody).not.toContain("semantic_summary:");
    expect(truthBody).not.toContain("narrative_progression:");
  });
});
