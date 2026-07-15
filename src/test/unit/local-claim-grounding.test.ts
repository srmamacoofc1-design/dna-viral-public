import { describe, expect, it } from "vitest";
import {
  assessLocalClaimGrounding,
  hasMatchingDirectedBetrayal,
} from "../../../supabase/functions/_shared/local-claim-grounding.ts";

describe("same-slot relationship, intent and conclusion grounding", () => {
  it("rejects the unsupported conclusions produced for the reaction video", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Uma mão amiga acolheu a soldado, e os três formaram uma nova família cheia de esperança.",
      localEvidenceText: "Um mecânico oferece a mão. Depois ele aparece segurando um bebê ao lado da mulher.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining([
      "helping_hand_conclusion",
      "emotional_support_conclusion",
      "family_relation",
      "hope_or_new_beginning_conclusion",
    ]));
  });

  it("rejects a prior-slot identity, mission, plan and motive without local wording", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "O mesmo oficial que a confrontou lá no início voltou naquela missão porque esse era o plano.",
      localEvidenceText: "O oficial olha para o lado enquanto um avião passa.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining([
      "prior_slot_identity_claim",
      "mission_claim",
      "plan_claim",
    ]));
  });

  it("rejects the unsupported future intention asserted by the v7 hook question", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Este homem preguicoso desliza escada abaixo, mas ate onde ele pretende chegar assim deitado?",
      localEvidenceText: "Este hombre era tan vago que queria pasar todo el dia acostado y no tenia ganas de levantarse.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("motive_claim");
  });

  it("rejects an invented payoff moral while preserving the concrete romantic outcome", () => {
    const generatedText = "Muitas garotas se apaixonaram por ele, provando que seu jeito peculiar funcionava muito bem.";
    const evidence = "Su actitud perezosa volvio locas a las chicas y muchas terminaron enamorandose de el.";
    const result = assessLocalClaimGrounding({ generatedText, localEvidenceText: evidence });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("editorial_proof_conclusion");
    expect(result.unsupported_claim_ids).not.toContain("romantic_relation");
  });

  it("allows a payoff proof conclusion only when the same slot states it", () => {
    const text = "Muitas se apaixonaram por ele, provando que seu jeito funcionava.";
    expect(assessLocalClaimGrounding({
      generatedText: text,
      localEvidenceText: `Transcricao local: ${text}`,
    }).passed).toBe(true);
  });

  it("does not turn an offered hand or two adults with a baby into a relationship", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "O casal recebeu uma mão amiga e virou uma família.",
      localEvidenceText: "A man offers his open hand. Later, two adults stand beside a baby.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining([
      "couple_relation",
      "helping_hand_conclusion",
      "family_relation",
    ]));
  });

  it("does not turn adults holding a baby into inferred parents or a shared child", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "A mae e o pai seguram o filho. O bebe deles uniu os dois.",
      localEvidenceText: "Two adults stand together and hold a baby wrapped in a white blanket.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining([
      "mother_relation",
      "father_relation",
      "child_relation",
      "shared_baby_relation",
    ]));
  });

  it("blocks becoming a mother, assuming a child and raising a baby without local wording", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Ela virou mae, ele assumiu a crianca e os dois criaram o bebe juntos.",
      localEvidenceText: "A woman and a man stand beside a baby. The man points at a plane.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining([
      "mother_relation",
      "parenting_outcome",
    ]));
  });

  it("allows parenthood only when the same slot states it explicitly", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "A mae e o pai criaram o filho juntos.",
      localEvidenceText: "Transcript: the mother and father raised their son together.",
    });

    expect(result.passed).toBe(true);
  });

  it("allows strong relationship wording when the same slot states it explicitly", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "A esposa descobriu a traição do marido.",
      localEvidenceText: "Transcrição: su esposa descubrió que su marido la engañó. OCR: INFIDELITY.",
    });

    expect(result.passed).toBe(true);
    expect(result.unsupported_claim_ids).toEqual([]);
  });

  it("rejects a directed betrayal when local evidence reverses perpetrator and victim", () => {
    const generatedText = "A mulher traiu o soldado.";
    const invertedEvidence = "O soldado traiu a mulher.";
    const result = assessLocalClaimGrounding({
      generatedText,
      localEvidenceText: invertedEvidence,
    });

    expect(hasMatchingDirectedBetrayal(generatedText, invertedEvidence)).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("betrayal_relation");
  });

  it("accepts a directed betrayal only with matching local roles", () => {
    const generatedText = "A mulher traiu o soldado.";
    const matchingEvidence = "Transcript: a mulher traiu o soldado.";

    expect(hasMatchingDirectedBetrayal(generatedText, matchingEvidence)).toBe(true);
    expect(assessLocalClaimGrounding({
      generatedText,
      localEvidenceText: matchingEvidence,
    }).passed).toBe(true);
  });

  it("allows family and mission only from explicit translated local evidence", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "A família se reencontrou depois da missão.",
      localEvidenceText: "Transcript: the family reunited after the mission.",
    });

    expect(result.passed).toBe(true);
  });

  it("does not infer an offer of help from an extended hand", () => {
    const generatedText = "O mecânico estende a mão para oferecer ajuda imediata.";
    const unsupported = assessLocalClaimGrounding({
      generatedText,
      localEvidenceText: "The mechanic extends his hand toward the woman.",
    });

    expect(unsupported.passed).toBe(false);
    expect(unsupported.unsupported_claim_ids).toContain("help_intent_conclusion");

    const explicit = assessLocalClaimGrounding({
      generatedText,
      localEvidenceText: "Transcript: he extends his hand to offer immediate help.",
    });
    expect(explicit.passed).toBe(true);
  });

  it("does not turn exchanged or stern glances into defiant looks", () => {
    const generatedText = "Eles trocam olhares desafiadores.";
    const unsupported = assessLocalClaimGrounding({
      generatedText,
      localEvidenceText: "They exchange glances. The soldier looks sternly.",
    });

    expect(unsupported.passed).toBe(false);
    expect(unsupported.unsupported_claim_ids).toContain("defiant_gaze_conclusion");

    const explicit = assessLocalClaimGrounding({
      generatedText,
      localEvidenceText: "Transcript: they exchange defiant glances.",
    });
    expect(explicit.passed).toBe(true);
  });

  it("does not confuse a negated action after an explicit relationship with a negated relationship", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "A esposa não abriu a porta.",
      localEvidenceText: "A esposa não abriu a porta.",
    });

    expect(result.passed).toBe(true);
  });

  it("does not treat negated local wording as affirmative support", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Eles viraram um casal e formaram uma família.",
      localEvidenceText: "A narração explica que eles não são um casal e nunca foram uma família.",
    });

    expect(result.passed).toBe(false);
    expect(result.detected_claims.every((claim) => claim.support_reason === "local_evidence_negates_claim")).toBe(true);
  });

  it("does not mistake plano de fundo for a plan claim", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Um avião cruza o plano de fundo.",
      localEvidenceText: "Um avião cruza o céu ao fundo.",
    });

    expect(result.passed).toBe(true);
    expect(result.detected_claims).toEqual([]);
  });

  it("rejects a pronoun that transfers papers and a test to a different subject_id", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "O homem no chao sofre enquanto a mulher de branco observa. Ela segura papeis de divorcio e um teste de gravidez.",
      localEvidenceText: JSON.stringify({
        frames: [
          {
            subject_id: "woman_in_white",
            description: "A woman in white watches a man lying on the floor.",
            main_action: "observes the man",
          },
          {
            subject_id: "blonde_soldier",
            description: "A blonde woman in military uniform holds divorce papers and a pregnancy test.",
            main_action: "holds papers and test",
          },
        ],
      }),
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("pronoun_subject_transfer");
  });

  it("accepts an explicit descriptor that keeps the action on its real subject_id", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "A mulher de branco observa o homem. A militar loira segura os papeis e o teste.",
      localEvidenceText: JSON.stringify({
        frames: [
          {
            subject_id: "woman_in_white",
            description: "A woman in white watches a man on the floor.",
          },
          {
            subject_id: "blonde_soldier",
            description: "A blonde soldier holds divorce papers and a pregnancy test.",
          },
        ],
      }),
    });

    expect(result.passed).toBe(true);
    expect(result.unsupported_claim_ids).not.toContain("pronoun_subject_transfer");
  });

  it("requires a collective action to be explicit for both subjects", () => {
    const unsupported = assessLocalClaimGrounding({
      generatedText: "Os dois olham para o aviao.",
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "mechanic", description: "The mechanic looks at the airplane." },
          { subject_id: "soldier", description: "The soldier stands beside him." },
        ],
      }),
    });
    expect(unsupported.passed).toBe(false);
    expect(unsupported.unsupported_claim_ids).toContain("collective_action_not_grounded_for_each_subject");

    const explicit = assessLocalClaimGrounding({
      generatedText: "Os dois olham para o aviao.",
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "mechanic", description: "The mechanic looks at the airplane." },
          { subject_id: "soldier", description: "The soldier looks at the airplane." },
        ],
      }),
    });
    expect(explicit.passed).toBe(true);

    const unrelatedCollective = assessLocalClaimGrounding({
      generatedText: "Os dois olham para o aviao.",
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "mechanic", description: "Two adults stand together. The mechanic looks at the airplane." },
          { subject_id: "soldier", description: "The soldier remains beside him." },
        ],
      }),
    });
    expect(unrelatedCollective.passed).toBe(false);
  });

  it.each([
    "Eles olham para o aviao.",
    "Juntos, olham para o aviao.",
    "Todos olham para o aviao.",
    "A mulher e o mecanico olham para o aviao.",
  ])("does not let alternate collective wording bypass per-subject evidence: %s", (generatedText) => {
    const result = assessLocalClaimGrounding({
      generatedText,
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "mechanic", description: "The mechanic looks at the airplane." },
          { subject_id: "soldier", description: "The soldier stands beside him." },
        ],
      }),
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("collective_action_not_grounded_for_each_subject");
  });

  it("does not borrow a later comma-separated action for explicit collective support", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Os dois olham para o aviao.",
      localEvidenceText: JSON.stringify({
        frames: [
          {
            subject_id: "mechanic",
            description: "Both adults stand together, the mechanic looks at the airplane.",
          },
          { subject_id: "soldier", description: "The soldier stands beside the mechanic." },
        ],
      }),
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("collective_action_not_grounded_for_each_subject");
  });

  it("accepts a coordinated action when each subject_id proves the same action and object", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "A mulher e o mecanico seguram o bebe.",
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "soldier", description: "The woman holds the baby." },
          { subject_id: "mechanic", description: "The mechanic holds the baby." },
        ],
      }),
    });

    expect(result.passed).toBe(true);
    expect(result.unsupported_claim_ids).not.toContain("collective_action_not_grounded_for_each_subject");
  });

  it("does not use both-look-happy as proof that both look up", () => {
    const unsupported = assessLocalClaimGrounding({
      generatedText: "Enquanto os dois olham para cima.",
      localEvidenceText: JSON.stringify({
        frames: [
          {
            subject_id: "woman",
            description: "The woman and mechanic both look happy. The woman stands beside him.",
          },
          {
            subject_id: "mechanic",
            description: "The mechanic holds the baby and looks up at the sky.",
          },
        ],
      }),
    });

    expect(unsupported.passed).toBe(false);
    expect(unsupported.unsupported_claim_ids)
      .toContain("collective_action_not_grounded_for_each_subject");

    const supported = assessLocalClaimGrounding({
      generatedText: "Enquanto os dois olham para cima.",
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "woman", description: "The woman looks up." },
          { subject_id: "mechanic", description: "The mechanic looks up." },
        ],
      }),
    });

    expect(supported.passed).toBe(true);
    expect(supported.unsupported_claim_ids)
      .not.toContain("collective_action_not_grounded_for_each_subject");

    const explicitCollective = assessLocalClaimGrounding({
      generatedText: "Enquanto os dois olham para cima.",
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "woman", description: "They both look upward." },
          { subject_id: "mechanic", description: "The mechanic stands beside her." },
        ],
      }),
    });

    expect(explicitCollective.passed).toBe(true);
    expect(explicitCollective.unsupported_claim_ids)
      .not.toContain("collective_action_not_grounded_for_each_subject");
  });

  it("does not treat a temporal conjunction as a material collective action", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Enquanto os dois sorriem.",
      localEvidenceText: JSON.stringify({
        frames: [
          { subject_id: "woman", description: "They both smile." },
          { subject_id: "mechanic", description: "The mechanic stands beside her." },
        ],
      }),
    });

    expect(result.passed).toBe(true);
    expect(result.unsupported_claim_ids)
      .not.toContain("collective_action_not_grounded_for_each_subject");
  });

  it("rejects interpretive filler that is absent from the local evidence", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Isso mostra um lado inesperado de sua vida cotidiana agora, enquanto ela observa a cena toda.",
      localEvidenceText: "A mulher olha para o homem e segura um papel.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining([
      "unexpected_private_life_filler",
      "omniscient_scene_observation_filler",
    ]));
  });

  it("rejects a new partner and emotional support inferred from an extended hand", () => {
    const result = assessLocalClaimGrounding({
      generatedText: "Ela encontrou um novo parceiro e recebeu apoio emocional.",
      localEvidenceText: "Um homem estende a mao para a mulher.",
    });

    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining([
      "new_partner_relation",
      "emotional_support_conclusion",
    ]));
  });
});
