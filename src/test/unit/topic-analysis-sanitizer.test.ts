import { describe, expect, it } from "vitest";
import { sanitizeTopicAnalysisRelationshipInferences } from "../../../supabase/functions/_shared/topic-analysis-sanitizer.ts";

const inferredAnalysis = {
  central_topic: "Drama militar familiar",
  key_topics: ["novo parceiro", "apoio emocional", "nova familia", "mudança de relacionamento"],
  semantic_summary: "Após o fim de seu casamento e ser deixada para trás, ela encontra apoio em um mecânico, recomeçando sua vida. O casal forma uma nova familia.",
  narrative_progression: [
    { phase: "climax", description: "Ela confronta visualmente o ex-parceiro." },
    { phase: "resolution", description: "Ela encontra um novo parceiro, eles viram uma familia e terminam em celebração." },
  ],
  visual_anchor_points: [
    { visual_description: "Dois adultos seguram um bebe.", narrative_role: "formacao da nova familia" },
  ],
  semantic_alignment_rules: {
    must_include_topics: ["casal", "apoio emocional"],
    tone_guidance: "mostrar acolhimento do novo parceiro",
    input_profile: { evidence_reasons: ["um homem estende a mao para a mulher"] },
  },
};

describe("topic relationship inference sanitizer", () => {
  it("scrubs family, couple, partner and emotional-support labels from bare visuals", () => {
    const result = sanitizeTopicAnalysisRelationshipInferences(inferredAnalysis, {
      factualTranscriptSegments: [],
      frames: [
        { description: "Two adults hold a baby.", text_on_screen: "" },
        { description: "A man extends his hand toward a woman.", text_on_screen: "" },
      ],
    });
    const serialized = JSON.stringify(result).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    expect(serialized).not.toMatch(/casal|nova familia|novo parceiro|apoio emocional|familiar|fim de seu casamento|ex-parceiro|encontra apoio em|recomecando sua vida|celebracao|mudanca de relacionamento/);
    expect(result.semantic_alignment_rules.relationship_inference_sanitizer).toMatchObject({
      applied: true,
      factual_authority: "literal_transcript_or_ocr_only",
    });
    expect(result.semantic_alignment_rules.relationship_inference_sanitizer.removed_claim_ids)
      .toEqual(expect.arrayContaining([
        "family",
        "couple",
        "new_partner",
        "emotional_support",
        "marriage_relationship",
        "ex_partner",
        "relationship_change",
        "abandonment_conclusion",
        "celebration_conclusion",
      ]));
  });

  it("preserves relationship labels when literal factual speech proves them", () => {
    const result = sanitizeTopicAnalysisRelationshipInferences(inferredAnalysis, {
      factualTranscriptSegments: [{
        text: "Eles se tornaram um casal, formaram uma nova familia e ele virou o novo parceiro dela, dando apoio emocional.",
      }],
      frames: [],
    });

    expect(result.semantic_summary).toContain("casal");
    expect(result.semantic_summary).toContain("nova familia");
    expect(result.semantic_summary).toContain("encontra apoio em um mecânico");
    expect(result.key_topics).toContain("apoio emocional");
  });
});
