import { describe, expect, it } from "vitest";
import {
  applyDeterministicNarrativeQualifierGate,
  assessWriterNarrativeChecklist,
  assertIndependentNarrativeClaimedExcerptContract,
  buildIndependentNarrativeAuditPlan,
  buildWriterRevisionNarrativeChecklist,
  failClosedIndependentNarrativeFidelity,
  independentAuditToNarrativeFidelity,
  independentNarrativeInvalidClaimedExcerptEventIds,
  independentNarrativePlanFingerprint,
  mergeIndependentNarrativeAuditsFailClosed,
  parseIndependentNarrativeAudit,
  type IndependentNarrativeAuditPlan,
} from "../../../supabase/functions/_shared/independent-narrative-auditor";

function wolfPlan(): IndependentNarrativeAuditPlan {
  return buildIndependentNarrativeAuditPlan({
    blocks: [
      {
        index: 5,
        slot_type: "revelacao",
        generated_text: "Ele levou o gato para casa e mentiu.",
        visual_evidence_trace: { time_range: { start: 30, end: 37 } },
      },
      {
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: "Depois os funcionarios perceberam o perigo.",
        visual_evidence_trace: { time_range: { start: 37, end: 40 } },
      },
    ],
    slots: [
      { index: 5, slot_type: "revelacao", visual_evidence_selection: { time_range: { start: 30, end: 37 } } },
      { index: 6, slot_type: "desenvolvimento", visual_evidence_selection: { time_range: { start: 37, end: 40 } } },
    ],
    transcriptionSegments: [
      { start: 30, end: 33, text: "Ele levou o gato para casa a fim de devora-lo." },
      { start: 34, end: 36, text: "Para a filha, mentiu dizendo que o gato era um presente." },
      { start: 37, end: 39, text: "Os funcionarios correram atras dele para dete-lo." },
    ],
    visualFrames: [],
  });
}

function exactCoveredRaw(plan: IndependentNarrativeAuditPlan): any {
  return {
    slot_audits: plan.slots.map((slot) => ({
      script_slot_index: slot.script_slot_index,
      event_results: slot.events.map((event) => ({
        event_id: event.event_id,
        coverage: "covered",
        causal_relation: "preserved",
        reason: "A proposicao completa permanece no texto local.",
      })),
      visual_event_results: slot.visual_event_candidates.map((event) => ({
        event_id: event.event_id,
        materiality: "redundant",
        coverage: "not_required",
        causal_relation: "not_applicable",
        reason: "A proposicao visual repete integralmente a evidencia falada local.",
      })),
      unsupported_claims: [],
      cross_boundary_claims: [],
    })),
  };
}

describe("auditor narrativo independente", () => {
  it("cataloga cada segmento pertencente ao slot sem reduzir a uma contagem", () => {
    const plan = wolfPlan();

    expect(plan.total_events).toBe(3);
    expect(plan.slots[0].events.map((event) => event.event_id)).toEqual([
      "slot:5:transcript:0",
      "slot:5:transcript:1",
    ]);
    expect(plan.slots[0].events.map((event) => event.evidence_text)).toEqual([
      "Ele levou o gato para casa a fim de devora-lo.",
      "Para a filha, mentiu dizendo que o gato era um presente.",
    ]);
    expect(plan.slots[1].events.map((event) => event.event_id)).toEqual([
      "slot:6:transcript:2",
    ]);
  });

  it("preserva o plano e o sujeito estruturado de um frame de react", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "hook",
        generated_text: "A piloto ergueu o teste e congelou.",
        visual_evidence_trace: { time_range: { start: 0, end: 5 } },
      }],
      slots: [{ index: 1, slot_type: "hook", visual_evidence_selection: { time_range: { start: 0, end: 5 } } }],
      transcriptionSegments: [],
      visualFrames: [{
        timestamp_seconds: 1,
        subject_role: "embedded",
        layer: "embedded",
        region: "bottom",
        subject_id: "pilot_1",
        description: "A piloto segura um teste e para surpresa.",
        main_action: "A piloto ergue o teste.",
      }],
    });

    expect(plan.slots[0].events[0].evidence_text).toContain("subject_role=embedded");
    expect(plan.slots[0].events[0].evidence_text).toContain("region=bottom");
    expect(plan.slots[0].events[0].evidence_text).toContain("subject_id=pilot_1");
  });

  it("no hook de react musical exige o evento embedded mais concreto sem narrar baseline ou poses intermediarias", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "hook",
        generated_text: "O oficial ergueu um teste, mas ate onde aquele teste levaria a piloto?",
        visual_evidence_trace: { time_range: { start: 0, end: 5 } },
      }],
      slots: [{ index: 1, slot_type: "hook", visual_evidence_selection: { time_range: { start: 0, end: 5 } } }],
      transcriptionSegments: [],
      visualFrames: [
        {
          timestamp_seconds: 0,
          subject_role: "reactor",
          layer: "reactor",
          subject_id: "reactor_1",
          main_action: "The reactor watches silently with a neutral face.",
        },
        {
          timestamp_seconds: 0,
          subject_role: "embedded",
          layer: "embedded",
          subject_id: "embedded_subject_1",
          main_action: "O oficial segura um teste de gravidez.",
        },
        {
          timestamp_seconds: 2,
          subject_role: "embedded",
          layer: "embedded",
          subject_id: "embedded_subject_2",
          main_action: "A mulher parece angustiada.",
        },
        {
          timestamp_seconds: 2,
          subject_role: "reactor",
          layer: "reactor",
          subject_id: "reactor_1",
          main_action: "The reactor keeps watching with the same neutral face.",
        },
        {
          timestamp_seconds: 5,
          subject_role: "embedded",
          layer: "embedded",
          subject_id: "embedded_subject_1",
          main_action: "O oficial aponta para a pista.",
        },
        {
          timestamp_seconds: 6,
          subject_role: "embedded",
          layer: "embedded",
          subject_id: "embedded_subject_3",
          main_action: "Uma porta se fecha mais tarde.",
        },
      ],
    });

    expect(plan.slots[0].events).toHaveLength(1);
    expect(plan.slots[0].events[0]).toEqual(expect.objectContaining({
      event_id: "slot:1:frame:1",
      start_seconds: 0,
      evidence_text: expect.stringContaining("O oficial segura um teste de gravidez"),
    }));
    expect(plan.slots[0].events[0].evidence_text).toContain("subject_role=embedded");
    expect(plan.slots[0].events[0].evidence_text).not.toContain("reactor_1");
    expect(plan.slots[0].visual_context).toHaveLength(5);
    expect(plan.slots[0].visual_context.map((frame) => frame.timestamp_seconds)).not.toContain(6);
  });

  it("extrai a clausula exata somente do checklist persistido do Writer", () => {
    const generatedText = "Sem perceber, ele terminou em uma entrevista de emprego.";
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "setup",
        generated_text: generatedText,
        // A copia no topo nao e uma fonte autorizada e deve ser ignorada.
        event_text_evidence: [{
          event_id: "slot:1:transcript:0",
          text_excerpt: "terminou em uma entrevista de emprego",
        }],
        narrative_event_checklist: {
          event_text_evidence: [{
            event_id: "slot:1:transcript:0",
            text_excerpt: "Sem perceber, ele terminou em uma entrevista de emprego",
          }],
        },
        visual_evidence_trace: { time_range: { start: 0, end: 4 } },
      }],
      slots: [{ index: 1, visual_evidence_selection: { time_range: { start: 0, end: 4 } } }],
      transcriptionSegments: [{
        start: 0,
        end: 3,
        text: "Sin darse cuenta, terminó en una entrevista de trabajo.",
      }],
      visualFrames: [],
    });

    expect(plan.slots[0].events[0].claimed_text_excerpt).toBe(
      "Sem perceber, ele terminou em uma entrevista de emprego",
    );
    expect(() => assertIndependentNarrativeClaimedExcerptContract(plan)).not.toThrow();
  });

  it("rejeita antes do modelo clausula ausente, duplicada ou que nao seja literal", () => {
    const makePlan = (eventTextEvidence: any[]) => buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "setup",
        generated_text: "Ele terminou em uma entrevista.",
        narrative_event_checklist: { event_text_evidence: eventTextEvidence },
        visual_evidence_trace: { time_range: { start: 0, end: 4 } },
      }],
      slots: [{ index: 1, visual_evidence_selection: { time_range: { start: 0, end: 4 } } }],
      transcriptionSegments: [{ start: 0, end: 3, text: "Sem perceber, terminou em uma entrevista." }],
      visualFrames: [],
    });
    const id = "slot:1:transcript:0";

    expect(() => assertIndependentNarrativeClaimedExcerptContract(makePlan([])))
      .toThrow("independent_narrative_claimed_excerpt_missing_or_invalid");
    expect(() => assertIndependentNarrativeClaimedExcerptContract(makePlan([
      { event_id: id, text_excerpt: "frase inexistente" },
    ]))).toThrow("independent_narrative_claimed_excerpt_missing_or_invalid");
    expect(() => assertIndependentNarrativeClaimedExcerptContract(makePlan([
      { event_id: id, text_excerpt: "terminou em uma entrevista" },
      { event_id: id, text_excerpt: "Ele terminou em uma entrevista" },
    ]))).toThrow("independent_narrative_claimed_excerpt_missing_or_invalid");

    const twoSlotPlan = buildIndependentNarrativeAuditPlan({
      blocks: [
        {
          index: 1,
          slot_type: "hook",
          generated_text: "O lobo farejou um homem caido.",
          narrative_event_checklist: {
            event_text_evidence: [{
              event_id: "slot:1:transcript:0",
              text_excerpt: "O lobo farejou um homem caido",
            }],
          },
          visual_evidence_trace: { time_range: { start: 0, end: 4 } },
        },
        {
          index: 2,
          slot_type: "setup",
          generated_text: "Ele terminou em uma entrevista.",
          narrative_event_checklist: {
            event_text_evidence: [{
              event_id: "slot:2:transcript:1",
              text_excerpt: "frase obsoleta",
            }],
          },
          visual_evidence_trace: { time_range: { start: 4, end: 8 } },
        },
      ],
      slots: [
        { index: 1, visual_evidence_selection: { time_range: { start: 0, end: 4 } } },
        { index: 2, visual_evidence_selection: { time_range: { start: 4, end: 8 } } },
      ],
      transcriptionSegments: [
        { start: 0, end: 3, text: "O lobo farejou um homem caido." },
        { start: 4, end: 7, text: "Ele terminou em uma entrevista." },
      ],
      visualFrames: [],
    });
    expect(independentNarrativeInvalidClaimedExcerptEventIds(twoSlotPlan))
      .toEqual(["slot:2:transcript:1"]);
  });

  it("mantem a distorcao adversarial quando o auditor amplo aceita um atalho do lobo", () => {
    const generatedText = "Ele seguiu o homem ate a empresa, terminando em uma entrevista de emprego.";
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "setup",
        generated_text: generatedText,
        narrative_event_checklist: {
          event_text_evidence: [{
            event_id: "slot:2:transcript:0",
            text_excerpt: "terminando em uma entrevista de emprego",
          }],
        },
        visual_evidence_trace: { time_range: { start: 10, end: 13 } },
      }],
      slots: [{ index: 2, visual_evidence_selection: { time_range: { start: 10, end: 13 } } }],
      transcriptionSegments: [{
        start: 10,
        end: 13,
        text: "Lo siguio hasta una gran empresa y, sin darse cuenta, termino en una entrevista de trabajo.",
      }],
      visualFrames: [],
    });
    const broadRaw = exactCoveredRaw(plan);
    broadRaw.slot_audits[0].event_results[0].reason = "The text confirms ending up in the interview.";
    const adversarialRaw = exactCoveredRaw(plan);
    adversarialRaw.slot_audits[0].event_results[0] = {
      event_id: "slot:2:transcript:0",
      coverage: "distorted",
      causal_relation: "altered",
      reason: "A clausula declarada preserva o resultado, mas apaga que ele terminou ali sem perceber.",
    };

    const merged = mergeIndependentNarrativeAuditsFailClosed(
      plan,
      parseIndependentNarrativeAudit(broadRaw, plan),
      parseIndependentNarrativeAudit(adversarialRaw, plan),
    );
    const fidelity = independentAuditToNarrativeFidelity(plan, merged) as any;

    expect(merged.slot_audits[0].event_results[0]).toEqual(expect.objectContaining({
      coverage: "distorted",
      causal_relation: "altered",
      reason: expect.stringContaining("fail_closed_disagreement"),
    }));
    expect(fidelity.complete_narrative_gaps).toContainEqual(expect.objectContaining({
      event_id: "slot:2:transcript:0",
      coverage: "distorted",
    }));
    expect(fidelity.causal_links_preserved).toBe(false);
  });

  it("reprova deterministicamente todos os qualificadores apagados no rascunho v12 do lobo", () => {
    const sourceEvents = [
      { start: 2, end: 5, text: "Intrigado, decidio vestirse con la piel como disfraz." },
      { start: 10, end: 13, text: "Lo siguio hasta una gran empresa y, sin darse cuenta, termino en una entrevista." },
      { start: 16, end: 17, text: "Para su sorpresa, consiguio el empleo." },
      { start: 20, end: 22, text: "Su jefe, impresionado por su esfuerzo, decidio promoverlo." },
      { start: 22, end: 24, text: "Poco a poco gano dinero." },
      { start: 30, end: 33, text: "Un dia llevo un gato a casa para devorarlo." },
      { start: 36, end: 38, text: "Dias despues, durante una reunion, ya no pudo contenerse." },
      { start: 38, end: 41, text: "Ataco a un companero ante todos." },
      { start: 41, end: 44, text: "Llenos de miedo, los empleados corrieron tras el." },
      { start: 44, end: 46, text: "Huyo desesperado hacia la mansion." },
      { start: 46, end: 49, text: "Al ver su apariencia real, quedaron completamente paralizadas." },
      { start: 52, end: 53, text: "Corrio a toda velocidad hacia el bosque." },
    ];
    const claimed = [
      "Encontrou a pele e decidiu vesti-la.",
      "Seguiu o homem ate a empresa e terminou em uma entrevista.",
      "Conseguiu o emprego.",
      "O chefe o promoveu.",
      "Ganhou dinheiro.",
      "Levou um gato para casa.",
      "Na reuniao, perdeu o controle.",
      "Atacou um colega.",
      "Os funcionarios correram atras dele.",
      "Fugiu para a mansao.",
      "A familia o viu e ficou paralisada.",
      "Correu para a floresta.",
    ];
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "desenvolvimento",
        generated_text: claimed.join(" "),
        narrative_event_checklist: {
          event_text_evidence: claimed.map((textExcerpt, index) => ({
            event_id: `slot:1:transcript:${index}`,
            text_excerpt: textExcerpt,
          })),
        },
        visual_evidence_trace: { time_range: { start: 0, end: 56 } },
      }],
      slots: [{
        index: 1,
        slot_type: "desenvolvimento",
        visual_evidence_selection: { time_range: { start: 0, end: 56 } },
      }],
      transcriptionSegments: sourceEvents,
      visualFrames: [],
    });
    const parsed = parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan);
    const gated = applyDeterministicNarrativeQualifierGate(plan, parsed);
    const verdicts = gated.slot_audits[0].event_results;
    const fidelity = independentAuditToNarrativeFidelity(plan, gated) as any;

    expect(verdicts.map((verdict) => verdict.coverage)).toEqual(Array(12).fill("distorted"));
    expect(verdicts[0].deterministic_missing_qualifiers).toEqual(["opening_intrigued"]);
    expect(verdicts[1].deterministic_missing_qualifiers).toEqual([
      "accidental_mode",
      "large_company",
    ]);
    expect(verdicts[2].deterministic_missing_qualifiers).toEqual(["surprise"]);
    expect(verdicts[3].deterministic_missing_qualifiers).toEqual(["boss_impressed_by_effort"]);
    expect(verdicts[4].deterministic_missing_qualifiers).toEqual(["graduality"]);
    expect(verdicts[5].deterministic_missing_qualifiers).toEqual(["purpose", "one_day"]);
    expect(verdicts[6].deterministic_missing_qualifiers).toEqual([
      "days_later_delay",
      "unable_to_contain",
    ]);
    expect(verdicts[7].deterministic_missing_qualifiers).toEqual(["in_front_of_everyone"]);
    expect(verdicts[8].deterministic_missing_qualifiers).toEqual(["fear"]);
    expect(verdicts[9].deterministic_missing_qualifiers).toEqual(["desperation"]);
    expect(verdicts[10].deterministic_missing_qualifiers).toEqual([
      "true_appearance",
      "complete_intensity",
    ]);
    expect(verdicts[11].deterministic_missing_qualifiers).toEqual(["full_speed"]);
    expect(verdicts[3].causal_relation).toBe("altered");
    expect(verdicts[5].causal_relation).toBe("altered");
    expect(verdicts[1].causal_relation).toBe("preserved");
    expect(verdicts[6].causal_relation).toBe("preserved");
    expect(verdicts.every((verdict) =>
      verdict.reason.startsWith("deterministic_missing_qualifiers=[")
    )).toBe(true);
    expect(fidelity.complete_narrative_gaps[1]).toEqual(expect.objectContaining({
      event_id: "slot:1:transcript:1",
      deterministic_missing_qualifiers: ["accidental_mode", "large_company"],
    }));
    expect(fidelity.causal_errors).toContainEqual(expect.objectContaining({
      event_id: "slot:1:transcript:3",
      deterministic_missing_qualifiers: ["boss_impressed_by_effort"],
    }));
  });

  it("rejeita trocar a ação de vestir por entrar na boca no gancho", () => {
    const eventId = "slot:1:transcript:0";
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "hook",
        generated_text: "Intrigado, entra na boca humana como disfarce.",
        narrative_event_checklist: {
          event_text_evidence: [{ event_id: eventId, text_excerpt: "Intrigado, entra na boca humana como disfarce" }],
        },
        visual_evidence_trace: { time_range: { start: 2, end: 5 } },
      }],
      slots: [{ index: 1, slot_type: "hook", visual_evidence_selection: { time_range: { start: 2, end: 5 } } }],
      transcriptionSegments: [{ start: 2, end: 5, text: "Intrigado, decidio ponersela como si fuera un disfraz." }],
      visualFrames: [],
    });
    const gated = applyDeterministicNarrativeQualifierGate(plan, parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan));

    expect(gated.slot_audits[0].event_results[0]).toEqual(expect.objectContaining({
      coverage: "distorted",
      causal_relation: "altered",
      deterministic_missing_qualifiers: ["wear_action"],
    }));

    expect(assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 1,
        generated_text: "Intrigado, vestiu a pele como disfarce.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Intrigado, vestiu a pele como disfarce" }],
      }],
    })).toEqual({ passed: true, issues: [] });
  });

  it("aceita equivalentes explicitos entre portugues, espanhol e ingles sem inventar causalidade", () => {
    const sourceEvents = [
      {
        start: 0,
        end: 4,
        text: "Intrigado, sem perceber e para sua surpresa, entrou numa grande empresa.",
      },
      {
        start: 10,
        end: 14,
        text: "One day, days later, he could not contain himself and fled desperately at full speed.",
      },
      {
        start: 20,
        end: 24,
        text: "The boss, impressed by his hard work, promoted him in front of everyone to protect him.",
      },
    ];
    const claimed = [
      "Curious, without realizing it and unexpectedly, he entered a large company.",
      "Un dia, dias despues, ya no pudo contenerse y huyo desesperado a toda velocidad.",
      "O chefe, impressionado com seu esforco, promoveu-o diante de todos para protege-lo.",
    ];
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "hook",
        generated_text: claimed.join(" "),
        narrative_event_checklist: {
          event_text_evidence: claimed.map((textExcerpt, index) => ({
            event_id: `slot:1:transcript:${index}`,
            text_excerpt: textExcerpt,
          })),
        },
        visual_evidence_trace: { time_range: { start: 0, end: 25 } },
      }],
      slots: [{ index: 1, slot_type: "hook", visual_evidence_selection: { time_range: { start: 0, end: 25 } } }],
      transcriptionSegments: sourceEvents,
      visualFrames: [],
    });
    const parsed = parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan);
    parsed.slot_audits[0].event_results[0].causal_relation = "not_applicable";
    const gated = applyDeterministicNarrativeQualifierGate(plan, parsed);

    expect(gated).toEqual(parsed);
    expect(gated.slot_audits[0].event_results[0].causal_relation).toBe("not_applicable");
    expect(gated.slot_audits[0].event_results.every((verdict) =>
      verdict.deterministic_missing_qualifiers === undefined
    )).toBe(true);
  });

  it("reprova os detalhes concretos que ainda desapareceram no rascunho v13 do lobo", () => {
    const sourceEvents = [
      { start: 5, end: 7, text: "Y al instante, parecia un humano de verdad." },
      { start: 28, end: 30, text: "Todas las noches sentia ganas de comer carne cruda." },
      { start: 36, end: 38, text: "Dias mas tarde, durante una reunion de trabajo, no pudo contenerse." },
      { start: 44, end: 46, text: "El lobo huyo desesperado hasta su mansion." },
      { start: 46, end: 49, text: "Su esposa y su hija quedaron completamente paralizadas." },
    ];
    const claimed = [
      "Parecia um humano de verdade.",
      "Sentia vontade de comer carne crua.",
      "Durante uma reuniao, nao conseguiu se conter.",
      "O lobo fugiu desesperado para casa.",
      "A familia ficou completamente paralisada.",
    ];
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: claimed.join(" "),
        narrative_event_checklist: {
          event_text_evidence: claimed.map((textExcerpt, index) => ({
            event_id: `slot:6:transcript:${index}`,
            text_excerpt: textExcerpt,
          })),
        },
        visual_evidence_trace: { time_range: { start: 5, end: 49 } },
      }],
      slots: [{ index: 6, slot_type: "desenvolvimento", visual_evidence_selection: { time_range: { start: 5, end: 49 } } }],
      transcriptionSegments: sourceEvents,
      visualFrames: [],
    });
    const gated = applyDeterministicNarrativeQualifierGate(
      plan,
      parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan),
    );
    const verdicts = gated.slot_audits[0].event_results;

    expect(verdicts[0].deterministic_missing_qualifiers).toEqual(["immediacy"]);
    expect(verdicts[1].deterministic_missing_qualifiers).toEqual(["nightly_frequency"]);
    expect(verdicts[2].deterministic_missing_qualifiers).toEqual([
      "days_later_delay",
      "work_meeting",
    ]);
    expect(verdicts[3].deterministic_missing_qualifiers).toEqual(["mansion_specificity"]);
    expect(verdicts[4].deterministic_missing_qualifiers).toEqual(["wife_and_daughter"]);
    expect(verdicts.every((verdict) => verdict.coverage === "distorted")).toBe(true);
  });

  it("nao aceita rastejar como substituto da vontade de comer carne crua", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 4,
        slot_type: "tensao",
        generated_text: "Toda noite, ele rastejava de quatro no gramado.",
        visual_evidence_trace: { time_range: { start: 28, end: 30 } },
      }],
      slots: [{ index: 4, slot_type: "tensao", visual_evidence_selection: { time_range: { start: 28, end: 30 } } }],
      transcriptionSegments: [{
        start: 28,
        end: 30,
        text: "Todas las noches sentia ganas incontrolables de comer carne cruda.",
      }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 4,
        generated_text: "Toda noite, ele rastejava de quatro no gramado.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Toda noite, ele rastejava de quatro no gramado" }],
      }],
    });
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      type: "writer_checklist_qualifiers_missing",
      details: [`${eventId}=raw_meat_craving`],
    }));
  });

  it("sinaliza vida dupla como interpretacao sem apoio na evidencia local", () => {
    const eventId = "slot:7:transcript:0";
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 7,
        slot_type: "payoff",
        generated_text: "Um caminhao o atropelou, encerrando sua vida dupla.",
        narrative_event_checklist: {
          event_text_evidence: [{
            event_id: eventId,
            text_excerpt: "Um caminhao o atropelou",
          }],
        },
        visual_evidence_trace: { time_range: { start: 53, end: 56 } },
      }],
      slots: [{
        index: 7,
        slot_type: "payoff",
        visual_evidence_selection: { time_range: { start: 53, end: 56 } },
      }],
      transcriptionSegments: [{
        start: 53,
        end: 56,
        text: "Mientras intentaba escapar, un camion lo atropello.",
      }],
      visualFrames: [],
    });
    const gated = applyDeterministicNarrativeQualifierGate(
      plan,
      parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan),
    );
    const fidelity = independentAuditToNarrativeFidelity(plan, gated) as any;

    expect(gated.slot_audits[0].unsupported_claims).toContainEqual({
      claim: "vida dupla",
      reason: "deterministic_unsupported_interpretive_filler:double_life",
    });
    expect(fidelity.causal_links_preserved).toBe(false);
    expect(fidelity.causal_errors).toContainEqual(expect.objectContaining({
      event: "unsupported_local_claim",
      script_claim: "vida dupla",
      reason: "deterministic_unsupported_interpretive_filler:double_life",
      script_slot_index: 7,
    }));
  });

  it("reprova uma moral geral acrescentada ao payoff sem apoio local", () => {
    const eventId = "slot:7:transcript:0";
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 7,
        slot_type: "payoff",
        generated_text: "Muitas se apaixonaram por ele, provando que o esforço não é tudo.",
        narrative_event_checklist: {
          event_text_evidence: [{
            event_id: eventId,
            text_excerpt: "Muitas se apaixonaram por ele",
          }],
        },
        visual_evidence_trace: { time_range: { start: 36, end: 42 } },
      }],
      slots: [{
        index: 7,
        slot_type: "payoff",
        visual_evidence_selection: { time_range: { start: 36, end: 42 } },
      }],
      transcriptionSegments: [{
        start: 36,
        end: 42,
        text: "Muchas terminaron enamorándose de él.",
      }],
      visualFrames: [],
    });
    const gated = applyDeterministicNarrativeQualifierGate(
      plan,
      parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan),
    );

    expect(gated.slot_audits[0].unsupported_claims).toContainEqual(expect.objectContaining({
      reason: "deterministic_unsupported_interpretive_filler:moral_generalization",
    }));
    expect(independentAuditToNarrativeFidelity(plan, gated)?.causal_links_preserved).toBe(false);
  });

  it("nao aceita finalidade ambigua quando a evidencia diz ocultar suspeitas da filha", () => {
    const eventId = "slot:5:transcript:0";
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 5,
        slot_type: "revelacao",
        generated_text: "Para nao suspeitar, ele disse que o gato era um presente.",
        narrative_event_checklist: {
          event_text_evidence: [{
            event_id: eventId,
            text_excerpt: "Para nao suspeitar, ele disse que o gato era um presente",
          }],
        },
        visual_evidence_trace: { time_range: { start: 33, end: 36 } },
      }],
      slots: [{ index: 5, slot_type: "revelacao", visual_evidence_selection: { time_range: { start: 33, end: 36 } } }],
      transcriptionSegments: [{
        start: 33,
        end: 36,
        text: "Para no levantar sospechas, le dijo a su hija que era un regalo.",
      }],
      visualFrames: [],
    });
    const gated = applyDeterministicNarrativeQualifierGate(
      plan,
      parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan),
    );

    expect(gated.slot_audits[0].event_results[0].deterministic_missing_qualifiers)
      .toContain("concealment_purpose");
    expect(gated.slot_audits[0].event_results[0].causal_relation).toBe("altered");
  });

  it("nao reduz a explicacao de presente a uma mentira generica", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 5,
        slot_type: "revelacao",
        generated_text: "Para nao levantar suspeitas, ele mentiu.",
        visual_evidence_trace: { time_range: { start: 34, end: 36 } },
      }],
      slots: [{ index: 5, slot_type: "revelacao", visual_evidence_selection: { time_range: { start: 34, end: 36 } } }],
      transcriptionSegments: [{
        start: 34,
        end: 36,
        text: "Para que no sospechara nada, le dijo que era un regalo.",
      }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 5,
        generated_text: "Para nao levantar suspeitas, ele mentiu.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Para nao levantar suspeitas, ele mentiu" }],
      }],
    });
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      type: "writer_checklist_qualifiers_missing",
      details: [`${eventId}=gift_explanation`],
    }));
  });

  it("rejeita checklist que declara corpo e farejo sem narrar a acao fisica", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "hook",
        generated_text: "O lobo encontrou uma pele humana.",
        visual_evidence_trace: { time_range: { start: 0, end: 5 } },
      }],
      slots: [{ index: 1, slot_type: "hook", visual_evidence_selection: { time_range: { start: 0, end: 5 } } }],
      transcriptionSegments: [{ start: 0, end: 2, text: "O lobo encontrou uma pele humana." }],
      visualFrames: [{
        timestamp_seconds: 1.5,
        description: "A man lies motionless on the ground while the wolf sniffs him.",
        main_action: "The wolf sniffs the man lying on the ground.",
      }],
    });
    const transcriptId = plan.slots[0].events[0].event_id;
    const visualId = plan.slots[0].visual_event_candidates[0].event_id;
    const result = assessWriterNarrativeChecklist({
      plan,
      priorMicroeventAudit: [{ event_id: visualId, coverage: "omitted", causal_relation: "not_applicable" }],
      proposedBlocks: [{
        index: 1,
        generated_text: "O lobo encontrou uma pele humana.",
        covered_event_ids: [transcriptId, visualId],
        event_text_evidence: [
          { event_id: transcriptId, text_excerpt: "O lobo encontrou uma pele humana" },
          { event_id: visualId, text_excerpt: "O lobo encontrou uma pele humana" },
        ],
      }],
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      script_slot_index: 1,
      type: "writer_checklist_material_visual_action_missing",
      event_ids: [visualId],
    }));
  });

  it("nao inventa erro causal quando os auditores so discordam sobre aplicabilidade", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "hook",
        generated_text: "O lobo encontrou uma pele na floresta.",
        narrative_event_checklist: {
          event_text_evidence: [{
            event_id: "slot:1:transcript:0",
            text_excerpt: "O lobo encontrou uma pele na floresta",
          }],
        },
        visual_evidence_trace: { time_range: { start: 0, end: 3 } },
      }],
      slots: [{ index: 1, visual_evidence_selection: { time_range: { start: 0, end: 3 } } }],
      transcriptionSegments: [{ start: 0, end: 3, text: "O lobo encontrou uma pele na floresta." }],
      visualFrames: [],
    });
    const comprehensive = exactCoveredRaw(plan);
    const adversarial = exactCoveredRaw(plan);
    adversarial.slot_audits[0].event_results[0].causal_relation = "not_applicable";

    const merged = mergeIndependentNarrativeAuditsFailClosed(
      plan,
      parseIndependentNarrativeAudit(comprehensive, plan),
      parseIndependentNarrativeAudit(adversarial, plan),
    );
    const fidelity = independentAuditToNarrativeFidelity(plan, merged) as any;

    expect(merged.slot_audits[0].event_results[0]).toEqual(expect.objectContaining({
      coverage: "covered",
      causal_relation: "preserved",
      reason: expect.stringContaining("fail_closed_disagreement"),
    }));
    expect(fidelity.causal_links_preserved).toBe(true);
    expect(fidelity.causal_errors).toEqual([]);
  });

  it("respeita os time_ranges canonicos recebidos sem recalcular fronteiras", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [
        { index: 6, slot_type: "desenvolvimento", generated_text: "A familia o viu.", visual_evidence_trace: { time_range: { start: 38, end: 49 } } },
        { index: 7, slot_type: "payoff", generated_text: "Ele foi expulso.", visual_evidence_trace: { time_range: { start: 49, end: 56.721 } } },
      ],
      slots: [
        { index: 6, visual_evidence_selection: { time_range: { start: 38, end: 49 } } },
        { index: 7, visual_evidence_selection: { time_range: { start: 49, end: 56.721 } } },
      ],
      transcriptionSegments: [
        { start: 46, end: 49, text: "Esposa e filha viram sua aparencia real." },
        { start: 49, end: 52, text: "Elas o expulsaram de casa." },
      ],
      visualFrames: [
        { timestamp_seconds: 48.5, description: "Esposa e filha encaram o lobo." },
        { timestamp_seconds: 51.5, description: "O lobo corre na rua." },
      ],
    });

    expect(plan.slots.map((slot) => slot.time_range)).toEqual([
      { start: 38, end: 49 },
      { start: 49, end: 56.721 },
    ]);
    expect(plan.slots[0].events.map((event) => event.evidence_text)).toEqual([
      "Esposa e filha viram sua aparencia real.",
    ]);
    expect(plan.slots[0].visual_context.map((frame) => frame.timestamp_seconds)).toContain(48.5);
    expect(plan.slots[1].events.map((event) => event.evidence_text)).toEqual([
      "Elas o expulsaram de casa.",
    ]);
  });

  it("reprova a perda da finalidade de devorar e do conteudo da mentira", () => {
    const plan = wolfPlan();
    const raw = exactCoveredRaw(plan);
    raw.slot_audits[0].event_results[0] = {
      event_id: "slot:5:transcript:0",
      coverage: "distorted",
      causal_relation: "altered",
      reason: "O texto manteve levar o gato, mas apagou a finalidade de devora-lo.",
    };
    raw.slot_audits[0].event_results[1] = {
      event_id: "slot:5:transcript:1",
      coverage: "distorted",
      causal_relation: "preserved",
      reason: "Dizer apenas que mentiu apaga a proposicao de que seria um presente.",
    };

    const parsed = parseIndependentNarrativeAudit(raw, plan);
    const fidelity = independentAuditToNarrativeFidelity(plan, parsed) as any;

    expect(fidelity.required_event_count).toBe(plan.total_events);
    expect(fidelity.microevent_audit.filter((event: any) => event.script_slot_index === 5))
      .toHaveLength(2);
    expect(fidelity.complete_narrative_gaps.map((gap: any) => gap.event_id)).toEqual([
      "slot:5:transcript:0",
      "slot:5:transcript:1",
    ]);
    expect(fidelity.causal_links_preserved).toBe(false);
    expect(fidelity.causal_errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_id: "slot:5:transcript:0",
        causal_relation: "altered",
        script_slot_index: 5,
      }),
    ]));
  });

  it("falha fechado para id/chave estrutural e converte enum invalido em omissao", () => {
    const plan = wolfPlan();

    const missing = exactCoveredRaw(plan);
    missing.slot_audits[0].event_results.pop();
    expect(() => parseIndependentNarrativeAudit(missing, plan))
      .toThrow("independent_narrative_audit_event_count_mismatch");

    const duplicate = exactCoveredRaw(plan);
    duplicate.slot_audits[0].event_results[1] = { ...duplicate.slot_audits[0].event_results[0] };
    expect(() => parseIndependentNarrativeAudit(duplicate, plan))
      .toThrow("independent_narrative_audit_duplicate_event_id");

    const extra = exactCoveredRaw(plan) as any;
    extra.slot_audits[0].event_results[0].passed = true;
    expect(() => parseIndependentNarrativeAudit(extra, plan))
      .toThrow("independent_narrative_audit_event_shape_invalid");

    const invalidEnum = exactCoveredRaw(plan);
    invalidEnum.slot_audits[0].event_results[0].coverage = "partial";
    invalidEnum.slot_audits[0].event_results[0].causal_relation = "unclear";
    const normalized = parseIndependentNarrativeAudit(invalidEnum, plan);
    expect(normalized.slot_audits[0].event_results[0]).toEqual(expect.objectContaining({
      coverage: "omitted",
      causal_relation: "unsupported",
      reason: expect.stringContaining("fail_closed_invalid_causality=unclear"),
    }));
  });

  it("aceita slots fora de ordem apenas quando os conjuntos exatos continuam completos", () => {
    const plan = wolfPlan();
    const raw = exactCoveredRaw(plan);
    raw.slot_audits.reverse();
    raw.slot_audits[1].event_results.reverse();

    const parsed = parseIndependentNarrativeAudit(raw, plan);
    expect(parsed.slot_audits.map((slot) => slot.script_slot_index)).toEqual([5, 6]);
    expect(parsed.slot_audits[0].event_results.map((event) => event.event_id)).toEqual([
      "slot:5:transcript:0",
      "slot:5:transcript:1",
    ]);
  });

  it("usa todos os frames locais como eventos quando o slot nao tem fala", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "tensao",
        generated_text: "O homem correu ate a porta.",
        visual_evidence_trace: { time_range: { start: 5, end: 10 } },
      }],
      slots: [{ index: 2, visual_evidence_selection: { time_range: { start: 5, end: 10 } } }],
      transcriptionSegments: [],
      visualFrames: [
        { timestamp_seconds: 5, description: "Homem comeca a correr" },
        { timestamp_seconds: 7.5, description: "Homem chega perto da porta" },
        { timestamp_seconds: 10, description: "Homem para diante da porta" },
      ],
    });

    expect(plan.slots[0].events).toHaveLength(3);
    expect(plan.slots[0].events.every((event) => event.evidence_kind === "visual_frame")).toBe(true);
  });

  it("atribui o frame exato de 5s somente ao hook em toda a auditoria", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [
        {
          index: 1,
          slot_type: "hook",
          generated_text: "O oficial aponta para a pista.",
          visual_evidence_trace: { time_range: { start: 0, end: 5 } },
        },
        {
          index: 2,
          slot_type: "setup",
          generated_text: "A mulher chega diante da porta.",
          visual_evidence_trace: { time_range: { start: 5, end: 10 } },
        },
      ],
      slots: [
        { index: 1, slot_type: "hook", visual_evidence_selection: { time_range: { start: 0, end: 5 } } },
        { index: 2, slot_type: "setup", visual_evidence_selection: { time_range: { start: 5, end: 10 } } },
      ],
      transcriptionSegments: [],
      visualFrames: [
        { timestamp_seconds: 2, description: "A mulher segura um teste." },
        { timestamp_seconds: 5, description: "O oficial aponta para a pista." },
        { timestamp_seconds: 8, description: "A mulher chega diante da porta." },
      ],
    });

    expect(plan.slots[0].events.map((event) => event.start_seconds)).toEqual([2, 5]);
    expect(plan.slots[1].events.map((event) => event.start_seconds)).toEqual([8]);
    expect(plan.total_events).toBe(3);
  });

  it("mantem frames como contexto de contradicao mesmo quando o slot tem fala", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "setup",
        generated_text: "O homem entrou sozinho.",
        visual_evidence_trace: { time_range: { start: 5, end: 10 } },
      }],
      slots: [{ index: 2, visual_evidence_selection: { time_range: { start: 5, end: 10 } } }],
      transcriptionSegments: [{ start: 6, end: 8, text: "Ele entrou no predio." }],
      visualFrames: [{
        timestamp_seconds: 7,
        description: "Dois homens entram juntos no predio.",
        main_action: "dois homens entram",
      }],
    });

    expect(plan.slots[0].events).toEqual([
      expect.objectContaining({ evidence_kind: "transcript", evidence_text: "Ele entrou no predio." }),
    ]);
    expect(plan.slots[0].visual_context).toEqual([
      expect.objectContaining({
        frame_id: "slot:2:visual-context:0",
        evidence_text: expect.stringContaining("Dois homens entram juntos"),
      }),
    ]);
    expect(plan.slots[0].visual_event_candidates).toEqual([
      expect.objectContaining({
        event_id: "slot:2:visual-candidate:0",
        evidence_text: expect.stringContaining("dois homens entram"),
      }),
    ]);

    const parsed = parseIndependentNarrativeAudit({
      slot_audits: [{
        script_slot_index: 2,
        event_results: [{
          event_id: "slot:2:transcript:0",
          coverage: "covered",
          causal_relation: "not_applicable",
          reason: "A entrada foi narrada.",
        }],
        visual_event_results: [{
          event_id: "slot:2:visual-candidate:0",
          materiality: "required",
          coverage: "distorted",
          causal_relation: "not_applicable",
          reason: "O texto troca duas pessoas por uma pessoa sozinha.",
        }],
        unsupported_claims: [{
          claim: "entrou sozinho",
          reason: "O frame local mostra duas pessoas entrando juntas.",
        }],
        cross_boundary_claims: [],
      }],
    }, plan);
    const fidelity = independentAuditToNarrativeFidelity(plan, parsed) as any;
    expect(fidelity.causal_links_preserved).toBe(false);
    expect(fidelity.causal_errors).toContainEqual(expect.objectContaining({
      event: "unsupported_local_claim",
      script_claim: "entrou sozinho",
      script_slot_index: 2,
    }));
  });

  it("falha fechado com lacuna e erro causal em cada slot quando o parser/chamada falha", () => {
    const plan = wolfPlan();
    const fidelity = failClosedIndependentNarrativeFidelity(plan, new Error("truncated_json")) as any;

    expect(fidelity.timeline_order_preserved).toBe(false);
    expect(fidelity.causal_links_preserved).toBe(false);
    expect(fidelity.complete_narrative_gaps.map((gap: any) => gap.script_slot_index)).toEqual([5, 6]);
    expect(fidelity.causal_errors.map((error: any) => error.script_slot_index)).toEqual([5, 6]);
    expect(fidelity.microevent_audit.every((event: any) =>
      event.coverage === "omitted" && event.causal_relation === "unsupported"
    )).toBe(true);
  });

  it("obriga o Writer a reconhecer todos os eventos sem trocar um coberto por outro", () => {
    const plan = wolfPlan();
    const complete = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [
        {
          index: 5,
          generated_text: "Ele levou o gato para casa a fim de devora-lo e disse que era um presente.",
          covered_event_ids: ["slot:5:transcript:1", "slot:5:transcript:0"],
          event_text_evidence: [
            { event_id: "slot:5:transcript:0", text_excerpt: "levou o gato para casa a fim de devora-lo" },
            { event_id: "slot:5:transcript:1", text_excerpt: "disse que era um presente" },
          ],
        },
        {
          index: 6,
          generated_text: "Os funcionarios correram atras dele para dete-lo.",
          covered_event_ids: ["slot:6:transcript:2"],
          event_text_evidence: [{
            event_id: "slot:6:transcript:2",
            text_excerpt: "funcionarios correram atras dele para dete-lo",
          }],
        },
      ],
    });
    expect(complete).toEqual({ passed: true, issues: [] });

    const oscillatingRevision = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [
        // Corrige o evento do gato, mas apaga o evento ja coberto da mentira.
        {
          index: 5,
          generated_text: "Ele levou o gato para devora-lo.",
          covered_event_ids: ["slot:5:transcript:0"],
          event_text_evidence: [{
            event_id: "slot:5:transcript:0",
            text_excerpt: "levou o gato para devora-lo",
          }],
        },
      ],
      expectedSlotIndexes: [5],
    });
    expect(oscillatingRevision.passed).toBe(false);
    expect(oscillatingRevision.issues).toContainEqual({
      script_slot_index: 5,
      type: "writer_checklist_ids_missing",
      event_ids: ["slot:5:transcript:1"],
    });
  });

  it("rejeita no Writer a perda de qualificadores antes da proxima auditoria", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "setup",
        generated_text: "Seguiu o homem e terminou numa entrevista.",
        visual_evidence_trace: { time_range: { start: 10, end: 13 } },
      }],
      slots: [{ index: 2, slot_type: "setup", visual_evidence_selection: { time_range: { start: 10, end: 13 } } }],
      transcriptionSegments: [{
        start: 10,
        end: 13,
        text: "Seguiu o homem ate uma grande empresa e, sem perceber, terminou numa entrevista.",
      }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const incomplete = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 2,
        generated_text: "Seguiu o homem ate uma empresa e terminou numa entrevista.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Seguiu o homem ate uma empresa e terminou numa entrevista" }],
      }],
    });

    expect(incomplete.issues).toContainEqual(expect.objectContaining({
      script_slot_index: 2,
      type: "writer_checklist_qualifiers_missing",
      event_ids: [eventId],
      details: [`${eventId}=accidental_mode,large_company`],
    }));
    expect(assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 2,
        generated_text: "Seguiu o homem ate uma empresa e terminou numa entrevista.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Seguiu o homem ate uma empresa e terminou numa entrevista" }],
      }],
      enforceDeterministicQualifiers: false,
    })).toEqual({ passed: true, issues: [] });

    const complete = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 2,
        generated_text: "Seguiu o homem ate uma grande empresa e, sem perceber, terminou numa entrevista.",
        covered_event_ids: [eventId],
        event_text_evidence: [{
          event_id: eventId,
          text_excerpt: "Seguiu o homem ate uma grande empresa e, sem perceber, terminou numa entrevista",
        }],
      }],
    });
    expect(complete).toEqual({ passed: true, issues: [] });
  });

  it("preserva deterministicamente o destino da corrida ao bosque", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 7,
        slot_type: "payoff",
        generated_text: "Ele correu a toda velocidade, mas foi perseguido.",
        visual_evidence_trace: { time_range: { start: 52, end: 53 } },
      }],
      slots: [{ index: 7, slot_type: "payoff", visual_evidence_selection: { time_range: { start: 52, end: 53 } } }],
      transcriptionSegments: [{
        start: 52,
        end: 53,
        text: "Corrio a toda velocidad hacia el bosque.",
      }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const incomplete = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 7,
        generated_text: "Ele correu a toda velocidade, mas foi perseguido.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Ele correu a toda velocidade" }],
      }],
    });

    expect(incomplete.issues).toContainEqual(expect.objectContaining({
      script_slot_index: 7,
      type: "writer_checklist_qualifiers_missing",
      event_ids: [eventId],
      details: [`${eventId}=forest_destination`],
    }));
  });

  it("nao troca entrevista de trabalho por reuniao de trabalho", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "setup",
        generated_text: "Por acidente, ele entrou em uma reuniao de trabalho.",
        visual_evidence_trace: { time_range: { start: 10, end: 13 } },
      }],
      slots: [{ index: 2, slot_type: "setup", visual_evidence_selection: { time_range: { start: 10, end: 13 } } }],
      transcriptionSegments: [{
        start: 10,
        end: 13,
        text: "Sin darse cuenta, termino en una entrevista de trabajo.",
      }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 2,
        generated_text: "Por acidente, ele entrou em uma reuniao de trabalho.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Por acidente, ele entrou em uma reuniao de trabalho" }],
      }],
    });

    expect(assessment.issues).toContainEqual(expect.objectContaining({
      script_slot_index: 2,
      type: "writer_checklist_qualifiers_missing",
      event_ids: [eventId],
      details: [`${eventId}=job_interview`],
    }));
  });

  it("aceita proposito explicito de devorar no proprio evento", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 5,
        slot_type: "revelacao",
        generated_text: "Levou o gato com o proposito de devora-lo.",
        visual_evidence_trace: { time_range: { start: 30, end: 33 } },
      }],
      slots: [{ index: 5, slot_type: "revelacao", visual_evidence_selection: { time_range: { start: 30, end: 33 } } }],
      transcriptionSegments: [{ start: 30, end: 33, text: "Llevo un gato para devorarlo." }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;

    expect(assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 5,
        generated_text: "Levou o gato com o proposito de devora-lo.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Levou o gato com o proposito de devora-lo" }],
      }],
    })).toEqual({ passed: true, issues: [] });
  });

  it("aceita panico e tentativa de deter como equivalentes explicitos de medo e finalidade", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: "Em panico, os funcionarios tentaram dete-lo.",
        visual_evidence_trace: { time_range: { start: 41, end: 44 } },
      }],
      slots: [{ index: 6, slot_type: "desenvolvimento", visual_evidence_selection: { time_range: { start: 41, end: 44 } } }],
      transcriptionSegments: [{
        start: 41,
        end: 44,
        text: "Los empleados, llenos de miedo, corrieron detras de el para detenerlo.",
      }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    expect(assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 6,
        generated_text: "Em panico, os funcionarios tentaram dete-lo.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "Em panico, os funcionarios tentaram dete-lo" }],
      }],
    })).toEqual({ passed: true, issues: [] });
  });

  it("reprova acknowledgement duplicado ou pertencente a outro slot", () => {
    const plan = wolfPlan();
    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 5,
        generated_text: "Ele levou o gato.",
        covered_event_ids: [
          "slot:5:transcript:0",
          "slot:5:transcript:0",
          "slot:6:transcript:2",
        ],
        event_text_evidence: [],
      }],
      expectedSlotIndexes: [5],
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.issues.map((issue) => issue.type)).toEqual(expect.arrayContaining([
      "writer_checklist_ids_missing",
      "writer_checklist_ids_duplicate",
      "writer_checklist_ids_unknown",
    ]));
  });

  it("exige trecho literal do texto para cada event_id reconhecido", () => {
    const plan = wolfPlan();
    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 5,
        generated_text: "Ele levou o gato para casa e mentiu.",
        covered_event_ids: ["slot:5:transcript:0", "slot:5:transcript:1"],
        event_text_evidence: [
          { event_id: "slot:5:transcript:0", text_excerpt: "para devora-lo" },
          { event_id: "slot:5:transcript:1", text_excerpt: "mentiu" },
        ],
      }],
      expectedSlotIndexes: [5],
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      script_slot_index: 5,
      type: "writer_checklist_text_evidence_invalid",
      event_ids: ["slot:5:transcript:0"],
      details: ["slot:5:transcript:0:excerpt_not_literal_substring"],
    }));
  });

  it("canonicaliza evidencia quando a unica diferenca e mecanica de acento e pontuacao", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "desenvolvimento",
        generated_text: "",
        visual_evidence_trace: { time_range: { start: 8, end: 11 } },
      }],
      slots: [{ index: 2, slot_type: "desenvolvimento", visual_evidence_selection: { time_range: { start: 8, end: 11 } } }],
      transcriptionSegments: [{ start: 8, end: 11, text: "O funcionario abriu a porta." }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const proposal = {
      index: 2,
      generated_text: "O funcion\u00e1rio abriu a porta; depois, entrou na sala.",
      covered_event_ids: [eventId],
      event_text_evidence: [{ event_id: eventId, text_excerpt: "O funcionario abriu a porta" }],
    };

    expect(assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [proposal],
      expectedSlotIndexes: [2],
    })).toEqual({ passed: true, issues: [] });
    expect(proposal.event_text_evidence[0].text_excerpt).toBe("O funcion\u00e1rio abriu a porta;");
  });

  it("rejeita evidencia antiga que apenas parafraseia semanticamente o texto final", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: "",
        visual_evidence_trace: { time_range: { start: 41, end: 44 } },
      }],
      slots: [{ index: 6, slot_type: "desenvolvimento", visual_evidence_selection: { time_range: { start: 41, end: 44 } } }],
      transcriptionSegments: [{
        start: 41,
        end: 44,
        text: "Os funcionarios, com medo, correram atras dele para dete-lo.",
      }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const staleExcerpt = "Em panico, os funcionarios tentaram dete-lo";
    const proposal = {
      index: 6,
      generated_text: "Os funcion\u00e1rios, com medo, correram atr\u00e1s dele para det\u00ea-lo.",
      covered_event_ids: [eventId],
      event_text_evidence: [{ event_id: eventId, text_excerpt: staleExcerpt }],
    };

    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [proposal],
      expectedSlotIndexes: [6],
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      type: "writer_checklist_text_evidence_invalid",
      event_ids: [eventId],
      details: [`${eventId}:excerpt_not_literal_substring`],
    }));
    expect(proposal.event_text_evidence[0].text_excerpt).toBe(staleExcerpt);
  });

  it("rejeita correspondencia normalizada ambigua entre duas clausulas", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "desenvolvimento",
        generated_text: "",
        visual_evidence_trace: { time_range: { start: 8, end: 11 } },
      }],
      slots: [{ index: 2, slot_type: "desenvolvimento", visual_evidence_selection: { time_range: { start: 8, end: 11 } } }],
      transcriptionSegments: [{ start: 8, end: 11, text: "O funcionario abriu a porta." }],
      visualFrames: [],
    });
    const eventId = plan.slots[0].events[0].event_id;
    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [{
        index: 2,
        generated_text: "O funcion\u00e1rio abriu a porta. Depois, o funcion\u00e1rio abriu a porta.",
        covered_event_ids: [eventId],
        event_text_evidence: [{ event_id: eventId, text_excerpt: "O funcionario abriu a porta" }],
      }],
      expectedSlotIndexes: [2],
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.issues).toContainEqual(expect.objectContaining({
      type: "writer_checklist_text_evidence_invalid",
      event_ids: [eventId],
    }));
  });

  it("expande excerpt curto para a menor clausula local com qualificadores", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: "",
        visual_evidence_trace: { time_range: { start: 40, end: 44 } },
      }],
      slots: [{ index: 6, slot_type: "desenvolvimento", visual_evidence_selection: { time_range: { start: 40, end: 44 } } }],
      transcriptionSegments: [{
        start: 40,
        end: 44,
        text: "The employees, full of fear, chased him in order to stop him.",
      }],
      visualFrames: [],
    });
    const proposal = {
      index: 6,
      generated_text: "Apavorados, os funcionarios o perseguiram para dete-lo.",
      covered_event_ids: ["slot:6:transcript:0"],
      event_text_evidence: [{
        event_id: "slot:6:transcript:0",
        text_excerpt: "os funcionarios o perseguiram",
      }],
    };

    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [proposal],
      expectedSlotIndexes: [6],
    });

    expect(assessment.passed).toBe(true);
    expect(proposal.event_text_evidence[0].text_excerpt).toBe(
      "Apavorados, os funcionarios o perseguiram para dete-lo.",
    );
  });

  it("nao usa a finalidade de uma clausula vizinha para outro evento", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 5,
        slot_type: "revelacao",
        generated_text: "",
        visual_evidence_trace: { time_range: { start: 30, end: 36 } },
      }],
      slots: [{ index: 5, slot_type: "revelacao", visual_evidence_selection: { time_range: { start: 30, end: 36 } } }],
      transcriptionSegments: [
        { start: 30, end: 33, text: "He took a cat home in order to devour it." },
        { start: 33, end: 36, text: "He said it was a gift so that she would not suspect." },
      ],
      visualFrames: [],
    });
    const proposal = {
      index: 5,
      generated_text: "Levou o gato para casa, mas disse ser presente para que ela nao suspeitasse.",
      covered_event_ids: ["slot:5:transcript:0", "slot:5:transcript:1"],
      event_text_evidence: [
        { event_id: "slot:5:transcript:0", text_excerpt: "Levou o gato para casa" },
        { event_id: "slot:5:transcript:1", text_excerpt: "disse ser presente" },
      ],
    };

    const assessment = assessWriterNarrativeChecklist({
      plan,
      proposedBlocks: [proposal],
      expectedSlotIndexes: [5],
    });

    expect(assessment.passed).toBe(false);
    expect(assessment.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "writer_checklist_qualifiers_missing",
        event_ids: expect.arrayContaining(["slot:5:transcript:0"]),
      }),
    ]));
  });

  it("protege a reacao ja coberta enquanto restaura a perseguicao omitida no mesmo slot", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: "A familia paralisou ao ve-lo, mas os funcionarios sumiram da narracao.",
        visual_evidence_trace: { time_range: { start: 41, end: 49 } },
      }],
      slots: [{ index: 6, visual_evidence_selection: { time_range: { start: 41, end: 49 } } }],
      transcriptionSegments: [
        { start: 41, end: 44, text: "Os funcionarios, com medo, correram atras dele para dete-lo." },
        { start: 46, end: 49, text: "A esposa e a filha ficaram paralisadas ao ver sua forma real." },
      ],
      visualFrames: [],
    });
    const checklist = buildWriterRevisionNarrativeChecklist(plan, [
      {
        event_id: "slot:6:transcript:0",
        coverage: "omitted",
        causal_relation: "preserved",
        reason: "A perseguicao dos funcionarios desapareceu.",
      },
      {
        event_id: "slot:6:transcript:1",
        coverage: "covered",
        causal_relation: "preserved",
        reason: "A reacao da familia foi preservada.",
      },
    ]);

    expect(checklist[0].events).toEqual([
      expect.objectContaining({
        event_id: "slot:6:transcript:0",
        revision_duty: "MUST_RESTORE_COMPLETELY",
        prior_reason: "A perseguicao dos funcionarios desapareceu.",
      }),
      expect.objectContaining({
        event_id: "slot:6:transcript:1",
        revision_duty: "MUST_PRESERVE",
        prior_reason: "A reacao da familia foi preservada.",
      }),
    ]);
  });

  it("promove uma acao visual silenciosa relevante sem duplicar a fala local", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 2,
        slot_type: "desenvolvimento",
        generated_text: "O homem conversou com o seguranca.",
        visual_evidence_trace: { time_range: { start: 0, end: 6 } },
      }],
      slots: [{ index: 2, visual_evidence_selection: { time_range: { start: 0, end: 6 } } }],
      transcriptionSegments: [{ start: 0, end: 2, text: "O homem conversou com o seguranca." }],
      visualFrames: [
        {
          timestamp_seconds: 1,
          main_action: "The man talks to the guard",
          description: "A man is talking to a uniformed guard.",
          text_on_screen: "O homem conversou com o seguranca.",
        },
        {
          timestamp_seconds: 4,
          main_action: "A mulher retira uma chave da mesa sem ser vista",
          description: "Enquanto os dois conversam, uma mulher pega a chave escondida.",
        },
      ],
    });

    expect(plan.slots[0].visual_event_candidates.map((event) => event.event_id)).toEqual([
      "slot:2:visual-candidate:0",
      "slot:2:visual-candidate:1",
    ]);
    const raw = exactCoveredRaw(plan);
    raw.slot_audits[0].visual_event_results[1] = {
      event_id: "slot:2:visual-candidate:1",
      materiality: "required",
      coverage: "omitted",
      causal_relation: "not_applicable",
      reason: "A retirada silenciosa da chave acrescenta uma acao narrativa ausente da fala e do roteiro.",
    };

    const parsed = parseIndependentNarrativeAudit(raw, plan);
    const fidelity = independentAuditToNarrativeFidelity(plan, parsed) as any;
    expect(fidelity.required_event_count).toBe(2);
    expect(fidelity.visual_candidate_count).toBe(2);
    expect(fidelity.required_visual_event_count).toBe(1);
    expect(fidelity.microevent_audit.map((event: any) => event.event_id)).toEqual([
      "slot:2:transcript:0",
      "slot:2:visual-candidate:1",
    ]);
    expect(fidelity.complete_narrative_gaps).toContainEqual(expect.objectContaining({
      event_id: "slot:2:visual-candidate:1",
      coverage: "omitted",
    }));

    const revisionChecklist = buildWriterRevisionNarrativeChecklist(plan, fidelity.microevent_audit);
    expect(revisionChecklist[0].events).toEqual([
      expect.objectContaining({
        event_id: "slot:2:transcript:0",
        revision_duty: "MUST_PRESERVE",
      }),
      expect.objectContaining({
        event_id: "slot:2:visual-candidate:1",
        revision_duty: "MUST_RESTORE_COMPLETELY",
      }),
    ]);

    const revised = assessWriterNarrativeChecklist({
      plan,
      priorMicroeventAudit: fidelity.microevent_audit,
      proposedBlocks: [{
        index: 2,
        generated_text: "O homem conversou com o seguranca enquanto uma mulher retirou a chave escondida.",
        covered_event_ids: ["slot:2:transcript:0", "slot:2:visual-candidate:1"],
        event_text_evidence: [
          { event_id: "slot:2:transcript:0", text_excerpt: "O homem conversou com o seguranca" },
          { event_id: "slot:2:visual-candidate:1", text_excerpt: "uma mulher retirou a chave escondida" },
        ],
      }],
    });
    expect(revised).toEqual({ passed: true, issues: [] });
  });

  it("nao deixa o auditor remover a ponte visual que explica uma consequencia posterior", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: "Os dois ficaram sozinhos e depois um atacou o outro.",
        visual_evidence_trace: { time_range: { start: 56, end: 64 } },
      }],
      slots: [{ index: 6, visual_evidence_selection: { time_range: { start: 56, end: 64 } } }],
      transcriptionSegments: [{
        start: 56,
        end: 64,
        text: "Os dois ficaram sozinhos e depois um atacou o outro.",
      }],
      visualFrames: [
        { timestamp_seconds: 57, main_action: "Animal pounces toward a small animal" },
        { timestamp_seconds: 59, main_action: "Animal catches and eats the small animal" },
        { timestamp_seconds: 61, main_action: "Another animal stares at the visible skeleton" },
        { timestamp_seconds: 63, main_action: "The second animal attacks the first animal" },
      ],
    });

    const raw = exactCoveredRaw(plan);
    const parsed = parseIndependentNarrativeAudit(raw, plan);
    const fidelity = independentAuditToNarrativeFidelity(plan, parsed) as any;

    expect(fidelity.visual_candidate_count).toBe(4);
    expect(fidelity.required_visual_event_count).toBe(3);
    expect(fidelity.microevent_audit.map((event: any) => event.event_id)).toEqual([
      "slot:6:transcript:0",
      "slot:6:visual-candidate:0",
      "slot:6:visual-candidate:1",
      "slot:6:visual-candidate:2",
    ]);
    expect(fidelity.complete_narrative_gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_id: "slot:6:visual-candidate:0" }),
      expect.objectContaining({ event_id: "slot:6:visual-candidate:1" }),
      expect.objectContaining({ event_id: "slot:6:visual-candidate:2" }),
    ]));
    expect(fidelity.visual_candidate_audit.slice(0, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ materiality: "required", reason: expect.stringContaining("deterministic_material_visual_action_missing") }),
    ]));
  });

  it("torna um cartao temporal visivel obrigatorio mesmo quando o auditor o chama de redundante", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 7,
        slot_type: "payoff",
        generated_text: "Depois, os dois seguram um bebe.",
        visual_evidence_trace: { time_range: { start: 52, end: 56 } },
      }],
      slots: [{ index: 7, visual_evidence_selection: { time_range: { start: 52, end: 56 } } }],
      transcriptionSegments: [],
      visualFrames: [{
        timestamp_seconds: 53,
        main_action: "A temporal title card appears",
        text_on_screen: "ONE YEAR LATER",
      }],
    });

    const parsed = parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan);
    const fidelity = independentAuditToNarrativeFidelity(plan, parsed) as any;
    expect(fidelity.required_event_count).toBe(1);
    expect(fidelity.complete_narrative_gaps).toContainEqual(expect.objectContaining({
      event_id: "slot:7:frame:0",
      coverage: "distorted",
      reason: expect.stringContaining("material_temporal_transition"),
    }));
  });

  it("falha fechado quando candidato visual falta e canonicaliza enums de quadro redundante", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 1,
        slot_type: "setup",
        generated_text: "Ele abriu a caixa.",
        visual_evidence_trace: { time_range: { start: 0, end: 4 } },
      }],
      slots: [{ index: 1, visual_evidence_selection: { time_range: { start: 0, end: 4 } } }],
      transcriptionSegments: [{ start: 0, end: 1, text: "Ele abriu a caixa." }],
      visualFrames: [{ timestamp_seconds: 2, main_action: "Uma luz sai da caixa" }],
    });

    const missing = exactCoveredRaw(plan);
    missing.slot_audits[0].visual_event_results.pop();
    expect(() => parseIndependentNarrativeAudit(missing, plan))
      .toThrow("independent_narrative_audit_visual_event_count_mismatch");

    const inconsistent = exactCoveredRaw(plan);
    inconsistent.slot_audits[0].visual_event_results[0].coverage = "covered";
    inconsistent.slot_audits[0].visual_event_results[0].causal_relation = "preserved";
    const canonicalized = parseIndependentNarrativeAudit(inconsistent, plan);
    expect(canonicalized.slot_audits[0].visual_event_results[0]).toEqual(expect.objectContaining({
      materiality: "redundant",
      coverage: "not_required",
      causal_relation: "not_applicable",
      reason: expect.stringContaining("canonicalized_redundant_visual_verdict"),
    }));

    const irrelevantCausality = exactCoveredRaw(plan);
    irrelevantCausality.slot_audits[0].visual_event_results[0].causal_relation = "preserved";
    const canonical = parseIndependentNarrativeAudit(irrelevantCausality, plan);
    expect(canonical.slot_audits[0].visual_event_results[0]).toEqual(expect.objectContaining({
      materiality: "redundant",
      coverage: "not_required",
      causal_relation: "not_applicable",
      reason: expect.stringContaining("canonicalized_redundant_visual_verdict"),
    }));
  });

  it("faz dedupe apenas de amostras visuais adjacentes e mantem recorrencia posterior", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 4,
        slot_type: "tensao",
        generated_text: "A porta abriu duas vezes.",
        visual_evidence_trace: { time_range: { start: 0, end: 10 } },
      }],
      slots: [{ index: 4, visual_evidence_selection: { time_range: { start: 0, end: 10 } } }],
      transcriptionSegments: [{ start: 0, end: 1, text: "Algo estranho aconteceu." }],
      visualFrames: [
        { timestamp_seconds: 1, main_action: "Homem abre a porta", text_on_screen: "NAO USE OCR COMO ACAO" },
        { timestamp_seconds: 2, main_action: "Homem abre a porta" },
        { timestamp_seconds: 8, main_action: "Homem abre a porta" },
      ],
    });

    expect(plan.slots[0].visual_event_candidates.map((event) => event.event_id)).toEqual([
      "slot:4:visual-candidate:0",
      "slot:4:visual-candidate:2",
    ]);
    expect(plan.slots[0].visual_event_candidates[0].evidence_text).not.toContain("NAO USE OCR");
  });

  it("nao infla 26 falas quando 23 candidatos visuais sao classificados como redundantes", () => {
    const plan = buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 6,
        slot_type: "desenvolvimento",
        generated_text: "Narrativa completa das vinte e seis falas.",
        visual_evidence_trace: { time_range: { start: 0, end: 60 } },
      }],
      slots: [{ index: 6, visual_evidence_selection: { time_range: { start: 0, end: 60 } } }],
      transcriptionSegments: Array.from({ length: 26 }, (_, index) => ({
        start: index * 2,
        end: index * 2 + 1,
        text: index < 23
          ? `O lobo executa a acao narrada objeto${index + 1}.`
          : `Proposicao falada final distinta objeto${index + 1}.`,
      })),
      visualFrames: Array.from({ length: 23 }, (_, index) => ({
        timestamp_seconds: index * 2 + 0.5,
        main_action: `The wolf performs the narrated action object${index + 1}`,
      })),
    });
    const parsed = parseIndependentNarrativeAudit(exactCoveredRaw(plan), plan);
    const fidelity = independentAuditToNarrativeFidelity(plan, parsed) as any;

    expect(plan.total_events).toBe(26);
    expect(plan.total_visual_event_candidates).toBe(23);
    expect(fidelity.required_event_count).toBe(26);
    expect(fidelity.microevent_audit).toHaveLength(26);
    expect(fidelity.required_visual_event_count).toBe(0);
  });

  it("nao aceita cobertura visual apenas no papel quando decomposicao e flor final sumiram", () => {
    const buildEndingPlan = (generatedText: string) => buildIndependentNarrativeAuditPlan({
      blocks: [{
        index: 7,
        slot_type: "payoff",
        generated_text: generatedText,
        visual_evidence_trace: { time_range: { start: 62, end: 74.5 } },
      }],
      slots: [{ index: 7, slot_type: "payoff", visual_evidence_selection: { time_range: { start: 62, end: 74.5 } } }],
      transcriptionSegments: [{
        start: 62,
        end: 74.5,
        text: "O gato morreu e depois o cachorro também não resistiu.",
      }],
      visualFrames: [
        {
          timestamp_seconds: 69,
          main_action: "dog standing over decomposed cat",
          description: "The cat's body is visibly decomposed while the dog stands beside it.",
        },
        {
          timestamp_seconds: 72,
          main_action: "flower growing on dirt mound",
          description: "A pink flower grows from a small dirt mound on the grass.",
        },
      ],
    });
    const auditAsCovered = (plan: IndependentNarrativeAuditPlan) => {
      const raw = exactCoveredRaw(plan);
      return independentAuditToNarrativeFidelity(
        plan,
        parseIndependentNarrativeAudit(raw, plan),
      ) as any;
    };

    const missing = auditAsCovered(buildEndingPlan(
      "O cachorro brigou com o gato. Depois, os dois morreram.",
    ));
    expect(missing.complete_narrative_gaps).toHaveLength(2);
    expect(missing.complete_narrative_gaps.map((gap: any) => gap.reason).join(" "))
      .toContain("decomposed_animal_body");
    expect(missing.complete_narrative_gaps.map((gap: any) => gap.reason).join(" "))
      .toContain("flower_on_dirt_mound");

    const complete = auditAsCovered(buildEndingPlan(
      "O corpo do gato se decompôs e o cachorro morreu. No fim, uma flor cresceu sobre um montinho de terra.",
    ));
    expect(complete.complete_narrative_gaps).toEqual([]);
    expect(complete.required_visual_event_count).toBe(2);

    const literalV7 = auditAsCovered(buildEndingPlan(
      "O cachorro entrou em conflito com o gato, e a briga terminou com a morte do felino. O corpo do gato começou a decompor e, como compartilhavam o organismo, o cachorro morreu. Uma flor cresce sobre o monte de terra.",
    ));
    expect(literalV7.complete_narrative_gaps).toEqual([]);
    expect(literalV7.required_visual_event_count).toBe(2);
  });

  it("gera fingerprint canonico e sensivel ao contrato exato do plano", () => {
    const plan = wolfPlan();
    const clone = JSON.parse(JSON.stringify(plan)) as IndependentNarrativeAuditPlan;
    expect(independentNarrativePlanFingerprint(plan)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(independentNarrativePlanFingerprint(clone)).toBe(independentNarrativePlanFingerprint(plan));

    clone.slots[0].generated_text += " alterado";
    expect(independentNarrativePlanFingerprint(clone)).not.toBe(independentNarrativePlanFingerprint(plan));
  });
});
