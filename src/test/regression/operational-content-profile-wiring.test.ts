import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, `../../../${relativePath}`), "utf8");
}

describe("wiring do perfil operacional e do registro viral PT-BR", () => {
  const topicAnalyzer = source("supabase/functions/analyze-reference-topics/index.ts");
  const contextBuilder = source("supabase/functions/build-complete-generation-context/index.ts");
  const assembler = source("supabase/functions/assemble-script/index.ts");
  const validator = source("supabase/functions/validate-script-against-dna/index.ts");

  it("classifica a origem narrativa multimodal antes da geração", () => {
    expect(topicAnalyzer).toContain('input_profile: {');
    expect(topicAnalyzer).toContain('enum: ["direct", "reaction", "split_screen_reaction", "unknown"]');
    expect(topicAnalyzer).toContain('enum: ["narration", "dialogue", "mixed", "music_only", "silent"]');
    expect(topicAnalyzer).toContain('enum: ["preserve_spoken_story", "reaction_reframe", "construct_visual_story", "behavioral_reframe"]');
    expect(topicAnalyzer).toContain("construct_visual_story ou reaction_reframe");
    expect(topicAnalyzer).toContain("Se for react/dueto, diferencie o reagente");
    expect(topicAnalyzer).toContain("alignmentRules.input_profile = {");
    expect(topicAnalyzer).toContain("TOPIC_OPERATIONAL_CONTRACT_VERSION = 5");
    expect(topicAnalyzer).toContain("reusableOperationalContractReady");
    expect(topicAnalyzer).toContain("&& reusableOperationalContractReady");
    expect(topicAnalyzer).toContain('from "../_shared/grounded-polemic-opportunity.ts"');
    expect(topicAnalyzer).toContain('from "../_shared/operational-transcript-evidence.ts"');
    expect(topicAnalyzer).toContain("factualTranscriptSegmentsForOperationalProfile(");
    expect(topicAnalyzer).toContain("groundPolemicOpportunity(item, factualSegments, frames");
    expect(topicAnalyzer).toContain("deriveGroundedPolemicOpportunities(\n      factualSegments,");
    expect(topicAnalyzer).not.toContain("groundPolemicOpportunity(item, segments, frames");
  });

  it("persiste o perfil resolvido no contexto completo do vídeo", () => {
    expect(contextBuilder).toContain('from "../_shared/video-content-mode.ts"');
    expect(contextBuilder).toContain("video_reference_context.content_profile = resolveOperationalVideoContentProfile(video_reference_context)");
    expect(contextBuilder).toContain("subject_role: f.subject_role");
    expect(contextBuilder).toContain("layer: f.layer");
    expect(contextBuilder).toContain("region: f.region");
    expect(contextBuilder).toContain("subject_id: f.subject_id");
    expect(contextBuilder).toContain("Em react, nunca misturar o reagente com os personagens");
    expect(contextBuilder).toContain("construir a conex");
  });

  it("aplica perfil, linguagem coloquial e polêmica fundamentada em todas as passagens do loop", () => {
    const narrativeGateAt = assembler.indexOf("const reconciledValue = enforceNarrativeFidelityGate(");
    const conversationalGateAt = assembler.indexOf("const conversationallyReconciledValue = enforceConversationalAndControversyGate({");

    expect(assembler).toContain('from "../_shared/video-content-mode.ts"');
    expect(assembler).toContain('from "../_shared/operational-transcript-evidence.ts"');
    expect(assembler).toContain("function operationalFactualTranscriptSegments(payload: any)");
    expect(assembler).toContain("transcriptionSegments: operationalFactualTranscriptSegments(options.payload)");
    expect(assembler.match(/subject_role: \["reactor", "embedded", "unknown"\]/g) ?? []).toHaveLength(3);
    expect((assembler.match(/subject_id: String\(frame\?\.subject_id \|\| ""\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
    expect(assembler).toContain('from "../_shared/ptbr-viral-register.ts"');
    expect(assembler).toContain("allowed_polemic_opportunities: polemicOpportunitiesForSelection");
    expect(assembler).toContain("if (!hasRange) return [];");
    expect(assembler).toContain("timestamp >= start - 0.25");
    expect(assembler).toContain("When content_profile says reaction_reframe");
    expect(assembler).toContain("When it says construct_visual_story, music/lyrics never supply facts");
    expect(assembler).toContain("assessPtBrConversationalRegister(");
    expect(assembler).toContain("repairSafePtBrConversationalTerms(");
    expect(assembler).toContain("ptbr_deterministic_safe_repair: deterministicPtBrRepair");
    expect(assembler).toContain("localClaimEvidenceForSelection(options.payload, slot?.visual_evidence_selection)");
    expect(assembler).toContain("item.found} -> ${item.preferred}");
    expect(assembler).toContain("Trocar somente esses termos por equivalentes cotidianos");
    expect(assembler).toContain("assessGroundedControversyClaims({");
    expect(assembler).toContain("forbiddenLabels: forbiddenControversyLabels(payload)");
    expect(assembler).toContain("explicitEvidenceText: JSON.stringify({");
    expect(narrativeGateAt).toBeGreaterThan(0);
    expect(conversationalGateAt).toBeGreaterThan(narrativeGateAt);
    expect(assembler).toContain("...conversationallyReconciledValue");
    expect(assembler).toContain("operational_content_profile: inputMode === \"video\"");
    expect(assembler).toContain("conversationalAndControversyRulesForTarget(options.targetLang)");
  });

  it("normaliza o draft inicial antes de checklist, contagem, estrategia, copia e avaliador", () => {
    const normalizeAt = assembler.indexOf("const normalizeWriterProposalMetadata =");
    const normalizeEnd = assembler.indexOf("const auditWriterValue =", normalizeAt);
    const normalization = assembler.slice(normalizeAt, normalizeEnd);
    const repairAt = normalization.indexOf("repairSafePtBrConversationalTerms(sourceText, options.targetLang)");
    const evidenceAt = normalization.indexOf("event_text_evidence: authoritativeEventIds.map");
    const checklistAt = assembler.indexOf("const narrativeChecklistAssessment =", normalizeEnd);
    const wordCountAt = assembler.indexOf("const words = text.split", normalizeEnd);
    const strategyAt = assembler.indexOf("const compliance = evaluateStrategy", normalizeEnd);
    const copyAt = assembler.indexOf("guardCandidates.push", normalizeEnd);

    expect(normalizeAt).toBeGreaterThan(0);
    expect(repairAt).toBeGreaterThan(0);
    expect(normalization).toContain("generated_text: text");
    expect(normalization).toContain("declared_word_count: text.split");
    expect(normalization).toContain("ptbr_deterministic_safe_repair: deterministicPtBrRepair");
    expect(normalization).toContain("ptbr_conversational_register: conversationalRegister");
    expect(evidenceAt).toBeGreaterThan(repairAt);
    expect(checklistAt).toBeGreaterThan(normalizeEnd);
    expect(wordCountAt).toBeGreaterThan(checklistAt);
    expect(strategyAt).toBeGreaterThan(wordCountAt);
    expect(copyAt).toBeGreaterThan(strategyAt);
    expect(assembler).toContain("generated_text_fingerprint: textGuardFingerprint(text)");
  });

  it("repete os dois gates no validador final e os trata como críticos", () => {
    expect(validator).toContain('from "../_shared/ptbr-viral-register.ts"');
    expect(validator).toContain('from "../_shared/operational-transcript-evidence.ts"');
    expect(validator).toContain('from "../_shared/video-content-mode.ts"');
    expect(validator).toContain("function operationalFactualTranscriptSegments(payloadOrVideoContext: any)");
    expect(validator.match(/transcriptionSegments: operationalFactualTranscriptSegments/g) ?? []).toHaveLength(4);
    expect(validator).toContain("const transcriptSegments = operationalFactualTranscriptSegments(payload)");
    expect(validator).toContain("const factualTranscript = operationalFactualTranscriptSegments(payload)");
    expect(validator).toContain("criteria as any).ptbr_conversational_register = criterion(");
    expect(validator).toContain("JSON.stringify({ frames: localFrames || [], transcript: localTranscript || [] })");
    expect(validator).toContain("criteria as any).grounded_controversy_claims = criterion(");
    expect(validator).toContain("sensitive_allegation_requires_explicit_local_support: true");
    expect(validator).toContain("appearance_music_reaction_are_never_sufficient: true");
    expect(validator).toContain("forbiddenLabels: forbiddenControversyLabels(payload)");
    expect(validator).toContain("controversyEvidenceForValidation(payload");
    expect(validator).toContain('request?.name === "visual_sync_alignment"');
    expect(validator).toContain('if (inputMode === "video") {');
    expect(validator).toContain('frame?.subject_role ? `subject_role=${frame.subject_role}`');
    expect(validator).toContain("subject_id: frame.subject_id || null");
    expect(validator).toContain("ptbr_conversational_register?.value === false");
    expect(validator).toContain("grounded_controversy_claims?.value === false");
  });
});
