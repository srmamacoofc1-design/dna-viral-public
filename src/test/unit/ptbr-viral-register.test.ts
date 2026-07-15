import { describe, expect, it } from "vitest";
import {
  assessGroundedControversyClaims,
  assessPtBrConversationalRegister,
  repairSafePtBrConversationalTerms,
} from "../../../supabase/functions/_shared/ptbr-viral-register";

describe("PT-BR conversational viral register", () => {
  it("rejects needlessly formal narration", () => {
    const result = assessPtBrConversationalRegister(
      "Imediatamente, ele adentrou o local; posteriormente, retornou.",
      "pt",
    );
    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(
      expect.arrayContaining(["immediately", "entered_formal", "subsequently", "returned_formal"]),
    );
  });

  it("troca construcoes corretas mas formais por fala cotidiana", () => {
    const result = assessPtBrConversationalRegister(
      "Ele arrastava-se ao despertar e compareceu após o expediente com o objetivo de prolongar o descanso.",
      "pt-BR",
    );
    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "enclitic_drag_formal",
      "awaken_formal",
      "attended_formal",
      "workday_formal",
      "objective_phrase_formal",
      "prolong_formal",
    ]));
  });

  it("troca enclise escrita por ordem natural da fala", () => {
    const result = assessPtBrConversationalRegister(
      "Ele fez isso para evitar levantar-se, e o chefe decidiu promovê-lo.",
      "pt-BR",
    );
    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "enclitic_get_up_formal",
      "enclitic_promote_formal",
    ]));
  });

  it("rejeita os dois decalques artificiais do bloco de promocao v7", () => {
    const result = assessPtBrConversationalRegister(
      "Isso causou que seu chefe acabasse promovendo ele a gerente geral.",
      "pt-BR",
    );

    expect(result.passed).toBe(false);
    expect(result.formal_terms).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "caused_that_calque", preferred: "por isso" }),
      expect.objectContaining({ id: "promoting_pronoun_awkward" }),
    ]));
  });

  it("aceita a promocao em PT-BR cotidiano", () => {
    expect(assessPtBrConversationalRegister(
      "Por isso, ele virou gerente geral.",
      "pt-BR",
    ).passed).toBe(true);
  });

  it("troca futuro sintetico por fala cotidiana", () => {
    const result = assessPtBrConversationalRegister(
      "Ele nao sabe aonde chegara depois da festa.",
      "pt-BR",
    );
    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toContain("synthetic_future_arrive_formal");
    expect(result.formal_terms.find((item) => item.id === "synthetic_future_arrive_formal")?.preferred)
      .toBe("vai chegar");
  });

  it("accepts everyday spoken wording", () => {
    expect(assessPtBrConversationalRegister(
      "Na mesma hora, ele entrou no lugar. Depois, voltou correndo.",
      "pt-BR",
    ).passed).toBe(true);
  });

  it("rejeita as construcoes formais reais do roteiro do gato e cachorro", () => {
    const result = assessPtBrConversationalRegister(
      "A fusao biologica aconteceu por meio de uma cirurgia. Qual a viabilidade biologica dessa criatura? Eles dividiam o mesmo organismo. "
        + "O cientista mostrou a criatura diante da imprensa. O conflito terminou resultando na morte do felino. "
        + "Depois, o caos finalmente se instalou.",
      "pt-BR",
    );

    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "biological_fusion_formal",
      "biological_viability_formal",
      "by_means_of_formal",
      "biological_organism_formal",
      "before_the_press_formal",
      "resulting_formal",
      "feline_noun_formal",
      "conflict_installed_formal",
    ]));
    expect(result.formal_terms.find((item) => item.id === "biological_fusion_formal")?.preferred)
      .toContain("mesmo corpo");
    expect(result.formal_terms.find((item) => item.id === "biological_organism_formal")?.preferred)
      .toBe("corpo / corpos");
    expect(result.formal_terms.find((item) => item.id === "biological_viability_formal")?.preferred)
      .toContain("ia aguentar");
  });

  it("aceita a pergunta do gancho em PT-BR popular", () => {
    const result = assessPtBrConversationalRegister(
      "Ele costurou os dois no mesmo corpo, mas sera que esse corpo costurado ia aguentar?",
      "pt-BR",
    );

    expect(result.passed).toBe(true);
    expect(result.formal_terms).toEqual([]);
  });

  it("rejeita o risco generico da criatura e o filler de conflito do v6", () => {
    const result = assessPtBrConversationalRegister(
      "Qual o risco dessa criatura com carne costurada? Depois, o conflito começou a surgir.",
      "pt-BR",
    );

    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "generic_creature_risk_hook",
      "conflict_emerging_filler",
    ]));
    expect(result.formal_terms.find((item) => item.id === "generic_creature_risk_hook")?.preferred)
      .toContain("corpo costurado ia aguentar");
  });

  it("rejeita os resumos artificiais encontrados no corpo da prova v13", () => {
    const result = assessPtBrConversationalRegister(
      "O homem buscava descanso em cada momento da rotina. "
        + "Ele dançou deitado, mantendo seu estilo único de se mover sempre. "
        + "Seu jeito peculiar tinha um charme inesperado.",
      "pt-BR",
    );

    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "routine_summary_filler",
      "unique_style_summary_filler",
      "unexpected_charm_summary_filler",
    ]));
  });

  it("rejeita os novos fillers artificiais encontrados na prova v15", () => {
    const result = assessPtBrConversationalRegister(
      "Ele deslizava com o propósito de não caminhar, mantendo sua rotina de total inércia física. "
        + "As mulheres se apaixonaram após verem seu jeito único.",
      "pt-BR",
    );
    const repaired = repairSafePtBrConversationalTerms(
      "Ele fez isso com o propósito de não caminhar.",
      "pt-BR",
    );

    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "purpose_phrase_formal",
      "physical_inertia_summary_filler",
      "unique_way_payoff_filler",
    ]));
    expect(repaired.text).toBe("Ele fez isso para não caminhar.");
  });

  it("repara organismo biologico de forma deterministica sem mudar a contagem", () => {
    const source = "O organismo dividia comportamentos; os organismos dependiam de remédios.";
    const repaired = repairSafePtBrConversationalTerms(source, "pt-BR");

    expect(repaired.changed).toBe(true);
    expect(repaired.text).toBe("O corpo dividia comportamentos; os corpos dependiam de remédios.");
    expect(repaired.replacements.map((item) => item.id)).toEqual([
      "biological_organism_formal",
      "biological_organism_formal",
    ]);
    expect(repaired.text.split(/\s+/u)).toHaveLength(source.split(/\s+/u).length);
    expect(assessPtBrConversationalRegister(repaired.text, "pt-BR").passed).toBe(true);
  });

  it("repara os termos seguros do draft literal v7 preservando caixa e recalculando palavras", () => {
    const source = "Ele conectou partes dos dois animais por meio de uma cirurgia. "
      + "O gato e o cachorro dividiam o mesmo organismo. "
      + "A briga terminou com a morte do felino. "
      + "O corpo do gato começou a decompor e, como compartilhavam o organismo, o cachorro morreu.";
    const repaired = repairSafePtBrConversationalTerms(source, "pt-BR");

    expect(repaired.text).toBe(
      "Ele conectou partes dos dois animais com uma cirurgia. "
        + "O gato e o cachorro dividiam o mesmo corpo. "
        + "A briga terminou com a morte do gato. "
        + "O corpo do gato começou a decompor e, como compartilhavam o corpo, o cachorro morreu.",
    );
    expect(repaired.replacements.map((item) => item.id)).toEqual([
      "by_means_of_formal",
      "biological_organism_formal",
      "biological_organism_formal",
      "feline_noun_formal",
    ]);
    expect(repaired.text.split(/\s+/u).filter(Boolean).length)
      .toBe(source.split(/\s+/u).filter(Boolean).length - 2);
    expect(assessPtBrConversationalRegister(repaired.text, "pt-BR").passed).toBe(true);

    expect(repairSafePtBrConversationalTerms(
      "POR MEIO DE TESTES, O FELINO DIVIDIU O ORGANISMO.",
      "pt-BR",
    ).text).toBe("COM TESTES, O GATO DIVIDIU O CORPO.");
  });

  it("simplifica automaticamente as construcoes formais encontradas nos tres formatos reais", () => {
    const source = "Imediatamente, o soldado exibe um teste e o cientista realizou um experimento. "
      + "Entretanto, o mecânico ofereceu um recipiente de comida. Depois surgiu um monte de terra enterrado.";
    const repaired = repairSafePtBrConversationalTerms(source, "pt-BR");

    expect(repaired.text).toBe(
      "Na mesma hora, o soldado mostra um teste e o cientista fez um experimento. "
        + "Mas, o mecânico ofereceu um pote de comida. Depois surgiu um monte de terra.",
    );
    expect(repaired.replacements.map((item) => item.id)).toEqual(expect.arrayContaining([
      "immediately",
      "show_formal",
      "performed_experiment_formal",
      "however_formal",
      "food_container_formal",
      "buried_dirt_mound_awkward",
    ]));
    expect(assessPtBrConversationalRegister(repaired.text, "pt-BR").passed).toBe(true);
  });

  it("rejeita as abstrações e cadeias formais dos resultados manuais", () => {
    const result = assessPtBrConversationalRegister(
      "Qual a consequência desse teste? Medicamentos contínuos sustentavam a condição em que viviam. "
        + "Depois divulgaram reportagens, provocando manifestações que condenavam tudo, enquanto ficaram sem supervisão.",
      "pt-BR",
    );
    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "abstract_consequence_question",
      "continuous_medicine_formal",
      "living_condition_formal",
      "reports_formal",
      "formal_protest_chain",
      "without_supervision_formal",
    ]));
  });

  it("nao altera organismo publico nem texto fora de PT-BR", () => {
    expect(repairSafePtBrConversationalTerms(
      "O organismo público publicou a decisão.",
      "pt-BR",
    ).changed).toBe(false);
    expect(repairSafePtBrConversationalTerms(
      "The organism survived.",
      "en",
    )).toEqual(expect.objectContaining({ required: false, changed: false }));
    expect(repairSafePtBrConversationalTerms(
      "Os organismos internacionais e o organismo da administração pública responderam.",
      "pt-BR",
    ).changed).toBe(false);
    expect(assessPtBrConversationalRegister(
      "Os organismos internacionais e o organismo da administração pública responderam.",
      "pt-BR",
    ).passed).toBe(true);
  });

  it("aceita a mesma historia reescrita com palavras do dia a dia", () => {
    const result = assessPtBrConversationalRegister(
      "O pesquisador costurou os dois no mesmo corpo usando uma cirurgia. "
        + "Depois, mostrou o animal para os jornalistas. A briga terminou com a morte do gato, e a confusao comecou.",
      "pt-BR",
    );

    expect(result.passed).toBe(true);
    expect(result.formal_terms).toEqual([]);
  });

  it("rejeita aeronave, permanece e a construcao redundante do balao de pensamento", () => {
    const result = assessPtBrConversationalRegister(
      "A aeronave permanece no ar enquanto os passageiros permanecem parados. "
        + "Um balao aparece, revelando em seus pensamentos que ele cozinha na cozinha.",
      "pt-BR",
    );

    expect(result.passed).toBe(false);
    expect(result.formal_terms.map((item) => item.id)).toEqual(expect.arrayContaining([
      "aircraft_story_formal",
      "remained_formal",
      "thought_bubble_redundancy",
    ]));
    expect(result.formal_terms.filter((item) => item.id === "remained_formal")).toHaveLength(2);
  });

  it("aceita a versao cotidiana e nao bloqueia pensamento legitimo", () => {
    const result = assessPtBrConversationalRegister(
      "O aviao fica no ar. Um balao mostra ele cozinhando, mas o pensamento dele continua confuso.",
      "pt-BR",
    );

    expect(result.passed).toBe(true);
    expect(result.formal_terms).toEqual([]);
  });

  it("traduz o falso cognato oficina quando os frames mostram um escritorio", () => {
    const result = assessPtBrConversationalRegister(
      "Ele entrou deslizando na oficina.",
      "pt-BR",
      "The man slides into an office building. Later he lies on an office desk beside a laptop.",
    );

    expect(result.passed).toBe(false);
    expect(result.formal_terms).toContainEqual({
      id: "spanish_office_false_friend",
      found: "oficina",
      preferred: "escritório",
    });
  });

  it("mantem oficina quando a evidencia mostra um local de conserto", () => {
    const result = assessPtBrConversationalRegister(
      "Ele entrou na oficina.",
      "pt-BR",
      "The mechanic enters a repair shop workshop full of tools.",
    );
    expect(result.passed).toBe(true);
  });

  it("nao confunde organismos publicos, fusao empresarial, resultado, software ou nome proprio", () => {
    const result = assessPtBrConversationalRegister(
      "O organismo publico analisou a fusao empresarial. O resultado final saiu. "
        + "O aplicativo se instalou sozinho, e a marca Felino abriu uma loja.",
      "pt-BR",
    );

    expect(result.passed).toBe(true);
    expect(result.formal_terms).toEqual([]);
  });

  it("nao aplica o registro PT-BR a outro idioma", () => {
    const result = assessPtBrConversationalRegister(
      "The biological fusion happened by means of surgery.",
      "en",
    );
    expect(result.required).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("allows a lazy label when the local action supports it", () => {
    const result = assessGroundedControversyClaims({
      generatedText: "Esse homem era tão preguiçoso que deixou todo mundo trabalhando sozinho.",
      localEvidenceText: "O homem fica deitado enquanto os outros trabalham e ele não ajuda.",
    });
    expect(result.passed).toBe(true);
  });

  it("does not let a vision model's lazy or shameless adjective prove itself", () => {
    for (const scenario of [
      {
        generatedText: "Esse homem era preguicoso.",
        behavioralEvidenceText: "Vision description: a lazy man stands beside a desk.",
        expectedId: "lazy_or_loafing",
      },
      {
        generatedText: "Isso foi vagabundagem.",
        behavioralEvidenceText: "Descricao visual: homem em vagabundagem ao lado da porta.",
        expectedId: "lazy_or_loafing",
      },
      {
        generatedText: "Que cara de pau.",
        behavioralEvidenceText: "Vision description: a shameless man points at a door.",
        expectedId: "shameless_behavior",
      },
    ]) {
      const result = assessGroundedControversyClaims({
        generatedText: scenario.generatedText,
        behavioralEvidenceText: scenario.behavioralEvidenceText,
        explicitEvidenceText: "",
      });
      expect(result.passed, scenario.behavioralEvidenceText).toBe(false);
      expect(result.unsupported_claim_ids).toContain(scenario.expectedId);
    }
  });

  it("accepts the real Spanish vago construction but rejects ordinary Portuguese vago", () => {
    expect(assessGroundedControversyClaims({
      generatedText: "Esse homem era preguiçoso.",
      explicitEvidenceText: "Este hombre era tan vago que no tenía ganas de levantarse.",
      behavioralEvidenceText: "Este hombre era tan vago que no tenía ganas de levantarse.",
    }).passed).toBe(true);

    for (const evidence of [
      "O narrador usou um termo vago e mandou o personagem andar.",
      "A descrição vaga fez o leitor andar em círculos.",
      "A vaga de emprego exige andar pelo depósito.",
    ]) {
      expect(assessGroundedControversyClaims({
        generatedText: "Esse homem era preguiçoso.",
        explicitEvidenceText: evidence,
        behavioralEvidenceText: evidence,
      }).passed).toBe(false);
    }
  });

  it("blocks invented betrayal and sex-work allegations", () => {
    const result = assessGroundedControversyClaims({
      generatedText: "A traição começou porque ela era do job.",
      localEvidenceText: "Uma mulher dança ao som de música em uma sala.",
    });
    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toEqual(expect.arrayContaining(["betrayal", "sex_work"]));
  });

  it("allows betrayal only when local relationship evidence is explicit", () => {
    const result = assessGroundedControversyClaims({
      generatedText: "A traição aconteceu na frente da própria esposa.",
      localEvidenceText: "A narração diz que ele traiu a esposa; ele beijou outra mulher.",
    });
    expect(result.passed).toBe(true);
  });

  it("does not accept a betrayal keyword when explicit local roles are reversed", () => {
    const inverted = assessGroundedControversyClaims({
      generatedText: "A mulher traiu o soldado.",
      explicitEvidenceText: "Transcricao: o soldado traiu a mulher.",
      behavioralEvidenceText: "O soldado e a mulher aparecem na sala.",
    });
    expect(inverted.passed).toBe(false);
    expect(inverted.unsupported_claim_ids).toContain("betrayal");

    const bareKeyword = assessGroundedControversyClaims({
      generatedText: "A mulher traiu o soldado.",
      explicitEvidenceText: "OCR: TRAICAO",
      behavioralEvidenceText: "O soldado e a mulher aparecem na sala.",
    });
    expect(bareKeyword.passed).toBe(false);
    expect(bareKeyword.unsupported_claim_ids).toContain("betrayal");

    const matching = assessGroundedControversyClaims({
      generatedText: "A mulher traiu o soldado.",
      explicitEvidenceText: "Transcricao: a mulher traiu o soldado.",
      behavioralEvidenceText: "O soldado e a mulher aparecem na sala.",
    });
    expect(matching.passed).toBe(true);
  });

  it("allows an evidenced visual betrayal but not appearance-only labels", () => {
    expect(assessGroundedControversyClaims({
      generatedText: "Ela pegou o marido no meio de uma traição.",
      localEvidenceText: "A esposa abre a porta e flagra o marido com a mão na perna de outra mulher.",
    }).passed).toBe(true);
  });

  it("does not treat a vision-model appearance description as explicit sensitive evidence", () => {
    const result = assessGroundedControversyClaims({
      generatedText: "Ela era do job.",
      behavioralEvidenceText: "Frame: mulher com roupa que parece do job, dancando ao som de musica.",
      explicitEvidenceText: "",
    });
    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("sex_work");
  });

  it("accepts sensitive exact wording only from local transcript or on-screen text", () => {
    expect(assessGroundedControversyClaims({
      generatedText: "A propria fala dizia que ela era do job.",
      behavioralEvidenceText: "Uma mulher aparece na sala.",
      explicitEvidenceText: "Transcricao local: ela era do job.",
    }).passed).toBe(true);
  });

  it("does not use negated wording as support for betrayal or sex-work allegations", () => {
    const betrayal = assessGroundedControversyClaims({
      generatedText: "Isso foi traição.",
      explicitEvidenceText: "Ele nunca traiu a esposa; não houve traição.",
      behavioralEvidenceText: "O casal conversa na sala.",
    });
    expect(betrayal.passed).toBe(false);
    expect(betrayal.detected_claims[0]?.support_reason).toBe("local_evidence_negates_claim");

    const sexWork = assessGroundedControversyClaims({
      generatedText: "Ela era do job.",
      explicitEvidenceText: "Ela não era do job.",
      behavioralEvidenceText: "A mulher conversa na sala.",
    });
    expect(sexWork.passed).toBe(false);
    expect(sexWork.detected_claims[0]?.support_reason).toBe("local_evidence_negates_claim");
  });

  it("requires relationship plus an unambiguous action for visually inferred betrayal", () => {
    expect(assessGroundedControversyClaims({
      generatedText: "Isso foi traicao.",
      behavioralEvidenceText: "Um homem abraca outra mulher.",
      explicitEvidenceText: "",
    }).passed).toBe(false);
  });

  it("blocks video-specific forbidden labels outside the hardcoded families", () => {
    const result = assessGroundedControversyClaims({
      generatedText: "Esse homem era um golpista.",
      behavioralEvidenceText: "O homem entrega uma caixa.",
      explicitEvidenceText: "",
      forbiddenLabels: ["golpista", "psicopata"],
    });
    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("forbidden_label:golpista");
  });

  it("does not call ordinary sleep laziness and treats vagabunda as a sensitive insult", () => {
    const ordinarySleep = assessGroundedControversyClaims({
      generatedText: "Esse homem era um vagabundo preguicoso.",
      behavioralEvidenceText: "O homem esta deitado dormindo na propria cama durante a noite.",
      explicitEvidenceText: "",
    });
    expect(ordinarySleep.passed).toBe(false);
    expect(ordinarySleep.unsupported_claim_ids).toContain("lazy_or_loafing");

    const sexualizedInsult = assessGroundedControversyClaims({
      generatedText: "Ela era uma vagabunda.",
      behavioralEvidenceText: "A mulher conversa com outra pessoa.",
      explicitEvidenceText: "",
    });
    expect(sexualizedInsult.passed).toBe(false);
    expect(sexualizedInsult.unsupported_claim_ids).toContain("sexualized_insult");
  });

  it("detects inflected murder allegations instead of letting them escape", () => {
    const result = assessGroundedControversyClaims({
      generatedText: "Ele assassinou o animal de proposito.",
      behavioralEvidenceText: "Os animais brigam e um deles morre.",
      explicitEvidenceText: "",
    });
    expect(result.passed).toBe(false);
    expect(result.unsupported_claim_ids).toContain("murder_intent");
  });

  it("allows grounded moral framing of a cruel experiment and blocks invented murder intent", () => {
    const allowed = assessGroundedControversyClaims({
      generatedText: "Esse cientista brincou de Deus, mas o experimento cruel escondia um erro fatal.",
      localEvidenceText: "Cientista costurou um gato a um cachorro durante uma cirurgia e aplicou descarga elétrica.",
    });
    expect(allowed.passed).toBe(true);
    expect(assessGroundedControversyClaims({
      generatedText: "O cientista era um assassino.",
      localEvidenceText: "O pesquisador realizou uma cirurgia experimental.",
    }).passed).toBe(false);
  });

  it("rejects neutral or explicitly non-cruel experiments", () => {
    for (const evidence of [
      "Este foi um experimento científico controlado.",
      "Foi um experimento, mas não foi cruel e não houve sofrimento.",
      "A cirurgia terminou sem sofrimento nem dano.",
    ]) {
      expect(assessGroundedControversyClaims({
        generatedText: "Foi um experimento cruel.",
        explicitEvidenceText: evidence,
        behavioralEvidenceText: evidence,
      }).passed).toBe(false);
    }
  });

  it("requires an affirmative shameless action instead of matching mente or the victim", () => {
    for (const evidence of [
      "A mente humana processa imagens.",
      "A esposa flagrou o marido com outra mulher.",
    ]) {
      expect(assessGroundedControversyClaims({
        generatedText: "Que cara de pau.",
        behavioralEvidenceText: evidence,
        explicitEvidenceText: "",
      }).passed).toBe(false);
    }

    expect(assessGroundedControversyClaims({
      generatedText: "Que cara de pau.",
      behavioralEvidenceText: "Ele mentiu para todos e tentou esconder a caixa.",
      explicitEvidenceText: "",
    }).passed).toBe(true);
  });
});
