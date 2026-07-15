import { describe, expect, it } from "vitest";
import {
  assessNarrativePrecision,
} from "../../../supabase/functions/_shared/narrative-precision-guard.ts";

describe("narrative precision guard", () => {
  it("rejects an entire-trip claim when the local evidence says only some minutes", () => {
    const result = assessNarrativePrecision([{
      index: 2,
      slot_type: "development",
      generated_text: "Ele se manteve deitado durante toda a viagem.",
      local_evidence_text: "Depois de alguns minutos deitado, ele se levanta.",
    }]);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "unsupported_duration_absolutizer",
        rule_id: "entire_trip_span",
        script_slot_index: 2,
      }),
    ]));
  });

  it("rejects omitting an explicit some-minutes duration", () => {
    const result = assessNarrativePrecision([{
      index: 4,
      slot_type: "tension",
      generated_text: "Ele usava o trajeto para dormir no trem.",
      local_evidence_text: "Al subir al tren, usaba el viaje para dormir unos minutos mas.",
    }]);

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      type: "explicit_duration_qualifier_omitted",
      rule_id: "some_minutes_must_remain_some_minutes",
    }));
  });

  it("accepts the exact bounded duration in everyday Portuguese", () => {
    expect(assessNarrativePrecision([{
      index: 4,
      slot_type: "tension",
      generated_text: "No trem, ele dormia por mais alguns minutos.",
      local_evidence_text: "Al subir al tren, usaba el viaje para dormir unos minutos mas.",
    }]).passed).toBe(true);
  });

  it("rejects a direct jump to a party when the evidence proves only sequence", () => {
    const result = assessNarrativePrecision([{
      index: 4,
      slot_type: "escalation",
      generated_text: "Ao sair do trabalho, ele foi direto para uma festa.",
      local_evidence_text: "Depois do trabalho, ele foi a uma festa.",
    }]);

    expect(result.passed).toBe(false);
    expect(result.issues[0]).toEqual(expect.objectContaining({
      type: "unsupported_direct_transition",
      script_slot_index: 4,
    }));
  });

  it("rejects carrying the bed location into a later stair action", () => {
    const result = assessNarrativePrecision([{
      index: 3,
      slot_type: "development",
      generated_text: "Na cama, ele descia as escadas deslizando.",
      local_evidence_text: "He puts on pants while lying in bed. Later, the man slides down the stairs on his back.",
    }]);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "cross_scene_locative_fusion",
        rule_id: "bed_location_carried_into_stair_action",
        script_slot_index: 3,
      }),
    ]));
  });

  it("allows a bed to move on stairs only when that physical event is explicit", () => {
    expect(assessNarrativePrecision([{
      index: 3,
      slot_type: "development",
      generated_text: "Na cama, ele descia as escadas deslizando.",
      local_evidence_text: "The bed is sliding down the stairs with the man still lying on it.",
    }]).passed).toBe(true);
  });

  it("rejects the same pants action in adjacent non-hook blocks", () => {
    const result = assessNarrativePrecision([
      {
        index: 1,
        slot_type: "setup",
        generated_text: "Antes de sair, ele veste a calça.",
      },
      {
        index: 2,
        slot_type: "development",
        generated_text: "No quarto, ele vestia as calças enquanto olhava a porta.",
      },
    ]);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "adjacent_concrete_action_redundancy",
        script_slot_index: 2,
        related_slot_indexes: [1, 2],
        action_signature: "vestir:calca",
      }),
    ]));
  });

  it("treats colocar calca and vestir calcas as the same action and repairs the visual spillover", () => {
    const result = assessNarrativePrecision([
      {
        index: 2,
        slot_type: "setup",
        generated_text: "Na cama, ele coloca a calca sem se levantar.",
        local_evidence_text: JSON.stringify({
          transcript: ["Cada manana salia arrastrandose de la cama y se cepillaba los dientes."],
          ocr: ["SIN LEVANTARSE"],
          frames: [{ description: "Man putting on pants while lying down." }],
        }),
      },
      {
        index: 3,
        slot_type: "development",
        generated_text: "Depois, ele vestia as calcas sem se levantar e descia as escadas.",
        local_evidence_text: JSON.stringify({
          transcript: ["Despues se ponia los pantalones sin levantarse de la cama y bajaba las escaleras."],
        }),
      },
    ]);

    expect(result.issues).toContainEqual(expect.objectContaining({
      type: "adjacent_concrete_action_redundancy",
      script_slot_index: 2,
      related_slot_indexes: [2, 3],
      action_signature: "vestir:calca",
      support_reason: "same_concrete_action_repeated_and_only_later_slot_transcript_owns_it",
    }));
    expect(result.issues.filter((issue) => issue.type === "unsupported_no_getting_up_claim")).toEqual([]);
  });

  it("rejects sem se levantar when only a lying pose suggests continuity", () => {
    const result = assessNarrativePrecision([{
      index: 2,
      slot_type: "setup",
      generated_text: "Ele coloca a calca sem se levantar.",
      local_evidence_text: JSON.stringify({
        transcript: ["Ele coloca a calca."],
        frames: [{ description: "The man is lying on a bed with pants nearby." }],
      }),
    }]);

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      type: "unsupported_no_getting_up_claim",
      rule_id: "no_getting_up_requires_literal_local_support",
      script_slot_index: 2,
    }));
  });

  it.each([
    { transcript: ["Se ponia los pantalones sin levantarse de la cama."], ocr: [] },
    { transcript: ["Ele coloca a calca."], ocr: ["SIN LEVANTARSE"] },
  ])("accepts sem se levantar only with literal local transcript or OCR: %j", (evidence) => {
    expect(assessNarrativePrecision([{
      index: 2,
      slot_type: "setup",
      generated_text: "Ele coloca a calca sem se levantar.",
      local_evidence_text: JSON.stringify(evidence),
    }]).issues.filter((issue) => issue.type === "unsupported_no_getting_up_claim")).toEqual([]);
  });

  it("flags only the earlier duplicate in the v6 sequence and preserves por mais alguns minutos", () => {
    const result = assessNarrativePrecision([
      {
        index: 2,
        slot_type: "setup",
        generated_text: "Todo dia ele sai da cama se arrastando. De olhos fechados, escova os dentes na pia e coloca a calca sem se levantar.",
        local_evidence_text: JSON.stringify({
          transcript: ["Cada manana salia arrastrandose de la cama y se cepillaba los dientes sin siquiera abrir los ojos."],
          ocr: ["SIN LEVANTARSE"],
        }),
      },
      {
        index: 3,
        slot_type: "development",
        generated_text: "Depois, ele vestia as calcas sem se levantar e descia as escadas deslizando.",
        local_evidence_text: JSON.stringify({
          transcript: ["Despues se ponia los pantalones sin levantarse de la cama y bajaba las escaleras deslizandose."],
        }),
      },
      {
        index: 4,
        slot_type: "tension",
        generated_text: "No trem, ele dormia por mais alguns minutos.",
        local_evidence_text: JSON.stringify({
          transcript: ["Al subir al tren, usaba el viaje para dormir unos minutos mas."],
        }),
      },
    ]);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual(expect.objectContaining({
      type: "adjacent_concrete_action_redundancy",
      script_slot_index: 2,
      action_signature: "vestir:calca",
    }));
  });

  it("accepts whole-span and direct-transition wording when each is explicit locally", () => {
    const result = assessNarrativePrecision([
      {
        index: 1,
        slot_type: "setup",
        generated_text: "Ele ficou deitado durante toda a viagem.",
        local_evidence_text: "O narrador diz que ele dormiu durante toda a viagem.",
      },
      {
        index: 2,
        slot_type: "development",
        generated_text: "Depois, ele foi direto para a festa.",
        local_evidence_text: "Sem parar em casa, ele foi direto para a festa.",
      },
    ]);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("does not confuse looking directly at the camera with a direct transition", () => {
    expect(assessNarrativePrecision([{
      index: 3,
      slot_type: "development",
      generated_text: "Ele olhou direto para a camera e sorriu.",
      local_evidence_text: "O homem olha para a camera.",
    }]).passed).toBe(true);
  });

  it("keeps hook previews outside this guard", () => {
    const result = assessNarrativePrecision([
      {
        index: 0,
        slot_type: "hook",
        generated_text: "Ele veste a calca durante toda a viagem e vai direto para a festa.",
        local_evidence_text: "Ele pega uma calca.",
      },
      {
        index: 1,
        slot_type: "setup",
        generated_text: "Ele veste a calca antes de sair.",
        local_evidence_text: "Ele veste a calca antes de sair.",
      },
    ]);

    expect(result.passed).toBe(true);
  });

  it("does not flag the same verb with different concrete objects", () => {
    expect(assessNarrativePrecision([
      { index: 1, slot_type: "setup", generated_text: "Ele veste a camisa." },
      { index: 2, slot_type: "development", generated_text: "Ele veste a calca." },
    ]).passed).toBe(true);
  });

  it("allows an explicitly repeated action", () => {
    expect(assessNarrativePrecision([
      { index: 1, slot_type: "setup", generated_text: "Ele veste a calca." },
      { index: 2, slot_type: "development", generated_text: "Depois, ele veste a calca de novo." },
    ]).passed).toBe(true);
  });

  it("does not compare non-adjacent actions or different explicit subjects", () => {
    expect(assessNarrativePrecision([
      { index: 1, slot_type: "setup", generated_text: "Ele veste a calca." },
      { index: 2, slot_type: "development", generated_text: "Ele abre a porta." },
      { index: 3, slot_type: "escalation", generated_text: "Ele vestia as calcas." },
    ]).passed).toBe(true);

    expect(assessNarrativePrecision([
      { index: 1, slot_type: "setup", generated_text: "Ele veste a calca." },
      { index: 2, slot_type: "development", generated_text: "Ela vestia as calcas." },
    ]).passed).toBe(true);
  });
});
