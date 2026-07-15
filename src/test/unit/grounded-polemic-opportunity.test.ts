import { describe, expect, it } from "vitest";
import {
  deriveGroundedPolemicOpportunities,
  groundPolemicOpportunity,
} from "../../../supabase/functions/_shared/grounded-polemic-opportunity";

describe("grounded polemic opportunities", () => {
  it("keeps a locally spoken laziness label and replaces the model excerpt with real evidence", () => {
    const result = groundPolemicOpportunity(
      { term: "preguicoso", timestamp_seconds: 4.9, support_excerpt: "invented excerpt" },
      [{ start: 0, end: 5, text: "Este hombre era el mas perezoso de todos." }],
      [],
      20,
    );
    expect(result?.support_type).toBe("transcript");
    expect(result?.support_excerpt).toContain("perezoso");
    expect(result?.support_excerpt).not.toContain("invented excerpt");
  });

  it("allows visual betrayal only with relationship and an unambiguous local action", () => {
    const result = groundPolemicOpportunity(
      { term: "traicao", timestamp_seconds: 12 },
      [],
      [{
        timestamp_seconds: 12,
        main_action: "A esposa flagra o marido com a mao na perna de outra mulher.",
        description: "A porta se abre e os tres aparecem juntos.",
      }],
      30,
    );
    expect(result?.risk_level).toBe("sensitive_allegation");
    expect(result?.support_type).toBe("visible_action");
  });

  it("rejects sex-work inference from appearance and unknown loaded labels", () => {
    expect(groundPolemicOpportunity(
      { term: "do job", timestamp_seconds: 3 },
      [],
      [{ timestamp_seconds: 3, description: "Mulher com roupa que parece do job." }],
      10,
    )).toBeNull();

    expect(groundPolemicOpportunity(
      { term: "golpista", timestamp_seconds: 3 },
      [],
      [{ timestamp_seconds: 3, description: "Homem entrega uma caixa." }],
      10,
    )).toBeNull();
  });

  it("rejects opportunities outside the video or without evidence in their local time", () => {
    expect(groundPolemicOpportunity(
      { term: "preguicoso", timestamp_seconds: 40 },
      [{ start: 0, end: 5, text: "perezoso" }],
      [],
      20,
    )).toBeNull();

    expect(groundPolemicOpportunity(
      { term: "preguicoso", timestamp_seconds: 15 },
      [{ start: 0, end: 5, text: "perezoso" }],
      [],
      20,
    )).toBeNull();
  });

  it("rejects null, blank and non-finite timestamps instead of coercing them to zero", () => {
    const evidence = [{ start: 0, end: 2, text: "Este hombre era perezoso." }];
    for (const timestamp of [null, "", "   ", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(groundPolemicOpportunity(
        { term: "preguiçoso", timestamp_seconds: timestamp },
        evidence,
        [],
        10,
      )).toBeNull();
    }
  });

  it("derives popular laziness terms from the real spoken evidence when the model omits them", () => {
    const result = deriveGroundedPolemicOpportunities(
      [{ start: 0, end: 5, text: "Este hombre era tan perezoso que no queria caminar." }],
      [{ timestamp_seconds: 2, description: "O homem se arrasta pelo chão." }],
      20,
    );
    expect(result.map((item) => item.term)).toEqual(expect.arrayContaining([
      "preguiçoso",
      "vagabundagem",
    ]));
    expect(result.every((item) => item.support_excerpt.includes("perezoso"))).toBe(true);
  });

  it("understands contextual Spanish vago as laziness in the opening, not as a title", () => {
    const result = deriveGroundedPolemicOpportunities(
      [{
        start: 0,
        end: 4.67,
        text: "Este hombre era tan vago que queria pasar todo el dia acostado y no tenia ganas de levantarse para nada.",
      }],
      [{ timestamp_seconds: 1, description: "O homem desce a escada deitado." }],
      20,
    );
    expect(result.map((item) => item.term)).toEqual(expect.arrayContaining([
      "preguiçoso",
      "vagabundagem",
    ]));
    expect(result.every((item) => item.timestamp_seconds <= 5)).toBe(true);
  });

  it("does not confuse ordinary Portuguese uses of vago or vaga with laziness", () => {
    for (const text of [
      "O narrador usou um termo vago e depois mandou o personagem andar.",
      "A descrição vaga fez o leitor andar em círculos.",
      "A vaga de emprego exige andar pelo depósito.",
    ]) {
      const result = deriveGroundedPolemicOpportunities(
        [{ start: 0, end: 4, text }],
        [],
        10,
      );
      expect(result.some((item) => ["preguiçoso", "vagabundagem"].includes(item.term))).toBe(false);
    }
  });

  it("derives catalogue terms from accented affirmative PT-BR evidence", () => {
    const laziness = deriveGroundedPolemicOpportunities(
      [{ start: 0, end: 4, text: "Este homem era tão preguiçoso que não queria trabalhar." }],
      [],
      10,
    );
    expect(laziness.map((item) => item.term)).toEqual(expect.arrayContaining([
      "preguiçoso",
      "vagabundagem",
    ]));

    const betrayal = deriveGroundedPolemicOpportunities(
      [{ start: 5, end: 8, text: "A traição do marido foi confirmada pela esposa." }],
      [],
      10,
    );
    expect(betrayal.some((item) => item.term === "traição")).toBe(true);
  });

  it("does not turn denied allegations into affirmative polemic opportunities", () => {
    const result = deriveGroundedPolemicOpportunities(
      [
        { start: 0, end: 2, text: "Ele nunca traiu a esposa; não houve traição." },
        { start: 3, end: 5, text: "Ela não era do job." },
        { start: 6, end: 9, text: "Foi um experimento, mas não foi cruel e não houve sofrimento." },
      ],
      [],
      10,
    );
    expect(result.some((item) => item.term === "traição")).toBe(false);
    expect(result.some((item) => item.term === "era do job")).toBe(false);
    expect(result.some((item) => item.term === "experimento cruel")).toBe(false);
  });

  it("requires harmful experimental evidence and rejects neutral experiments", () => {
    const neutral = deriveGroundedPolemicOpportunities(
      [{ start: 0, end: 4, text: "Este foi um experimento científico controlado e sem sofrimento." }],
      [],
      10,
    );
    expect(neutral.some((item) => item.term === "experimento cruel")).toBe(false);

    const harmful = deriveGroundedPolemicOpportunities(
      [{ start: 0, end: 4, text: "O cientista costurou os animais e aplicou uma descarga elétrica." }],
      [],
      10,
    );
    expect(harmful.some((item) => item.term === "experimento cruel")).toBe(true);
  });

  it("does not derive cara de pau from mente humana or from the victim who catches someone", () => {
    const falsePositives = deriveGroundedPolemicOpportunities(
      [],
      [
        { timestamp_seconds: 1, description: "A mente humana processa imagens." },
        { timestamp_seconds: 5, description: "A esposa flagrou o marido com outra mulher." },
      ],
      10,
    );
    expect(falsePositives.some((item) => item.term === "cara de pau")).toBe(false);

    const affirmative = deriveGroundedPolemicOpportunities(
      [],
      [{ timestamp_seconds: 2, description: "Ele mentiu para todos e tentou esconder a caixa." }],
      10,
    );
    expect(affirmative.some((item) => item.term === "cara de pau")).toBe(true);
  });

  it("never derives do job from appearance alone", () => {
    const result = deriveGroundedPolemicOpportunities(
      [],
      [{ timestamp_seconds: 2, description: "Mulher usando uma roupa chamativa." }],
      10,
    );
    expect(result.some((item) => item.term === "era do job")).toBe(false);
  });
});
