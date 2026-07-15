import { describe, expect, it } from "vitest";
import { buildThreeSentenceMaterialDenseFallback } from "../../../supabase/functions/_shared/dense-narrative-fallback";

const qualifierIds = new Set([
  "in_front_of_everyone",
  "fear",
  "purpose",
  "desperation",
  "mansion_specificity",
  "true_appearance",
  "complete_intensity",
  "wife_and_daughter",
]);

describe("fallback narrativo denso e fiel", () => {
  it("preserva transformação, mãos, imitação e entrevista", () => {
    const text = buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt",
      events: [{ evidence_text: "Wolf muzzle emerges from the mouth; examines hands; imita a un hombre y lo siguio; candidates hold folders." }],
      requiredQualifierIds: new Set(["immediacy", "large_company", "job_interview"]),
      requiredVisualActionIds: new Set(["muzzle_reveal", "physical_inspection"]),
    });
    expect(text).toBe(
      "Na mesma hora, parecia humano, mas seu focinho de lobo surgiu da boca enquanto examinava as mãos. Viu um homem passar, imitou seu caminhar e seguiu-o à grande empresa. Sem perceber, acabou em entrevista de trabalho entre candidatos com pastas.",
    );
    expect(text?.split(/\s+/u)).toHaveLength(40);
  });

  it("preserva aprendizado humano e causa da promoção", () => {
    const text = buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt",
      events: [{ evidence_text: "Copiou candidatos, conseguiu empleo e, com o tempo, aprendeu a viver como humano; o jefe promoveu." }],
      requiredQualifierIds: new Set(["graduality", "boss_impressed_by_effort"]),
      requiredVisualActionIds: new Set(),
    });
    expect(text).toBe(
      "Sem saber responder, copiou ações alheias e, surpreso, conseguiu emprego, aprendendo aos poucos a viver como humano. Impressionado pelo esforço, o chefe o promoveu.",
    );
    expect(text?.split(/\s+/u)).toHaveLength(24);
  });

  it("separa destino no bosque da perseguição visual na rua", () => {
    const text = buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt",
      events: [{ evidence_text: "Foi expulso, correu ao bosque; boss pursued him down the street; truck struck; deceased wolf." }],
      requiredQualifierIds: new Set(["full_speed", "forest_destination"]),
      requiredVisualActionIds: new Set(["pursuit"]),
    });
    expect(text).toBe(
      "Esposa e filha o expulsaram. Correu a toda velocidade rumo ao bosque. Na rua, o chefe e empresários furiosos o perseguiram até um caminhão atropelá-lo, deixando o lobo morto no asfalto.",
    );
    expect(text?.split(/\s+/u)).toHaveLength(31);
  });

  it("preserva vida humana aparente, rastejo e desejo noturno", () => {
    const text = buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt",
      events: [{ evidence_text: "Poco a poco gano dinero, compro mansion, formo familia, crawls on all fours e queria carne crua toda noche." }],
      requiredQualifierIds: new Set(["graduality", "nightly_frequency", "raw_meat_craving", "mansion_specificity"]),
      requiredVisualActionIds: new Set(["crawl_or_all_fours"]),
    });
    expect(text).toBe(
      "Aos poucos, ganhou dinheiro, comprou uma mansão e formou família. Mas seus instintos selvagens continuavam: rastejava de quatro na grama, sentindo toda noite vontade incontrolável de comer carne crua.",
    );
    expect(text?.split(/\s+/u)).toHaveLength(29);
    expect(text?.match(/[.!?:;]/gu)).toHaveLength(3);
  });

  it("compacta o perfil material completo em 36 palavras e tres frases", () => {
    const text = buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt-BR",
      events: [{ evidence_text: "Atacou um companero; empleados corrieron; huyo de la mansion." }],
      requiredQualifierIds: qualifierIds,
      requiredVisualActionIds: new Set(["meat_or_blood_on_documents", "muzzle_reveal"]),
    });

    expect(text).toBe(
      "Perdeu o controle, atacou um colega diante de todos, carne crua manchou gráficos, focinho saiu da boca. Funcionários apavorados correram para detê-lo, mas fugiu desesperado à mansão. Esposa e filha viram sua forma real, completamente paralisadas.",
    );
    expect(text?.split(/\s+/u)).toHaveLength(36);
    expect(text?.match(/[.!?]/gu)).toHaveLength(3);
  });

  it("falha fechado quando um dos sinais visuais obrigatorios nao existe", () => {
    expect(buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt",
      events: [{ evidence_text: "Atacou um colega; funcionarios correram; fugiu." }],
      requiredQualifierIds: qualifierIds,
      requiredVisualActionIds: new Set(["muzzle_reveal"]),
    })).toBeNull();
  });

  it("preserva gato na caixa, mentira e reunião no perfil denso anterior", () => {
    const text = buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt-BR",
      events: [{
        evidence_text: "Un gato dentro de una carrier; su hija lo descubrio; dias mas tarde no pudo contenerse durante una reunion de trabajo para devorarlo.",
      }],
      requiredQualifierIds: new Set([
        "one_day",
        "purpose",
        "concealment_purpose",
        "gift_explanation",
        "days_later_delay",
        "unable_to_contain",
        "work_meeting",
      ]),
      requiredVisualActionIds: new Set(["animal_in_carrier_or_cage"]),
    });

    expect(text).toBe(
      "Um dia, levou um gato numa caixa para casa para devorá-lo. Sua filha o descobriu, então mentiu que era presente para não levantar suspeitas. Dias depois, numa reunião de trabalho, não conseguiu se conter.",
    );
    expect(text?.split(/\s+/u)).toHaveLength(34);
    expect(text?.match(/[.!?]/gu)).toHaveLength(3);
  });

  it("não aplica o fallback do gato sem o atraso e a reunião comprovados", () => {
    expect(buildThreeSentenceMaterialDenseFallback({
      targetLanguage: "pt",
      events: [{ evidence_text: "Gato dentro de uma caixa; filha descobriu que seria devorado." }],
      requiredQualifierIds: new Set(["one_day", "purpose", "concealment_purpose", "gift_explanation"]),
      requiredVisualActionIds: new Set(["animal_in_carrier_or_cage"]),
    })).toBeNull();
  });
});
