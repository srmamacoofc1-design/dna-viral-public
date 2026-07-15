import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessFrozenHookLoopGrounding,
  assessHookFirstWindowGrounding,
  assessHookOpenLoopStructure,
  assessHookSpokenPremiseContractCoverage,
  assessHookVisualActionCarrier,
  buildFrozenSpokenPremiseExtensionLoop,
  buildHookSpokenPremiseContract,
  composeFrozenHookClauses,
  reconcileHookOpenLoopVerdict,
} from "../../../supabase/functions/_shared/dna-guards";

const root = path.resolve(__dirname, "../../..");
const assembleSource = fs.readFileSync(
  path.join(root, "supabase/functions/assemble-script/index.ts"),
  "utf8",
);
const validatorSource = fs.readFileSync(
  path.join(root, "supabase/functions/validate-script-against-dna/index.ts"),
  "utf8",
);

const wolfOpeningEvidence = {
  method: "opening_hook",
  time_range: { start: 0, end: 5 },
  frames: [
    {
      timestamp_seconds: 0,
      description: "Um lobo faminto encontra uma pele humana abandonada no bosque.",
      main_action: "O lobo observa e cheira a pele humana.",
    },
    {
      timestamp_seconds: 2.1,
      description: "Intrigado, o lobo levanta a pele humana do chao.",
      main_action: "O lobo segura a pele.",
    },
    {
      timestamp_seconds: 4.7,
      description: "O lobo veste a pele humana como um disfarce.",
      main_action: "O lobo veste a pele para parecer humano.",
    },
  ],
};

const wolfRealOpeningEvidence = {
  method: "opening_hook",
  time_range: { start: 0, end: 5 },
  frames: [
    { timestamp_seconds: 0, description: "Um lobo aparece no bosque.", main_action: "O lobo se aproxima." },
    { timestamp_seconds: 1.5, description: "Um homem está imóvel no chão.", main_action: "O homem permanece caído." },
    { timestamp_seconds: 3.2, description: "O lobo fareja a cabeça e o corpo no chão.", main_action: "O lobo fareja o corpo." },
    { timestamp_seconds: 5, description: "Um focinho começa a surgir pela boca humana.", main_action: "O focinho emerge da boca." },
  ],
};

describe("grounding anti-spoiler do gancho na janela visual de 0-5s", () => {
  it("rejeita resumo tardio com familia e sangue", () => {
    const result = assessHookFirstWindowGrounding(
      "Este lobo vestiu a pele de um homem e enganou uma familia inteira, ate seu instinto exigir sangue.",
      wolfOpeningEvidence,
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("late_outcome_summary");
  });

  it.each([
    "Este lobo vestiu uma pele humana para entrar em uma familia.",
    "Este lobo vestiu uma pele humana porque queria sangue.",
    "Este lobo vestiu uma pele humana e depois enganou sua esposa e sua filha.",
    "Este lobo vestiu uma pele humana, atacou um colega e revelou um focinho ensanguentado.",
    "Este lobo vestiu uma pele humana, mas no final foi atropelado por um caminhao.",
  ])("rejeita fatos posteriores: %s", (hook) => {
    const result = assessHookFirstWindowGrounding(hook, wolfOpeningEvidence);
    expect(result.blocked).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["late_outcome_summary"]));
  });

  it.each([
    "Este lobo vestiu uma pele humana como disfarce, mas ainda faltava descobrir ate onde ele conseguiria parecer humano.",
    "Uma pessoa abriu uma caixa com fumaca. Ate onde aquela fumaca poderia se espalhar?",
  ])("aceita open-loop concreto sem revelar a consequencia: %s", (hook) => {
    const result = assessHookFirstWindowGrounding(hook, wolfOpeningEvidence);
    expect(result.blocked).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it.each([
    "Este lobo faminto encontrou uma pele humana abandonada na floresta e decidiu vesti-la como roupa.",
    "Voce esta vendo um lobo vestir uma pele humana abandonada como se aquilo fosse um disfarce comum.",
  ])("rejeita abertura meramente declarativa: %s", (hook) => {
    const result = assessHookFirstWindowGrounding(hook, wolfOpeningEvidence);
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("hook_open_loop_missing");
  });

  it.each([
    "Este lobo faminto encontrou uma pele humana no bosque e decidiu vesti-la. O que acontecera apos essa transformacao?",
    "Este lobo encontrou uma pele humana e, intrigado, decidiu vesti-la como um disfarce. O que o lobo fara agora?",
    "Uma pessoa abriu uma caixa lacrada. O que vai acontecer depois desse acontecimento?",
    "Uma pessoa abriu uma caixa lacrada. Ate onde essa transformacao poderia chegar?",
    "Este lobo encontrou uma pele humana e decidiu vesti-la. Como o lobo vestira a pele?",
    "Uma pessoa abriu uma caixa lacrada. Ate onde isso vai?",
    "Uma pessoa abriu uma caixa lacrada. Como tudo terminara?",
    "Uma pessoa abriu uma caixa lacrada. Qual sera o proximo passo?",
    "Uma pessoa abriu uma caixa lacrada. O que podera acontecer?",
    "Este lobo encontrou uma pele humana e decidiu vesti-la. Qual sera o seu alcance?",
    "Este lobo encontrou uma pele humana; decidiu vesti-la, mas qual sera o resultado?",
    "Este lobo encontrou uma pele humana e decidiu vesti-la. Ate onde essa forma o levaria?",
  ])("rejeita pergunta generica ou ancorada so em abstracao: %s", (hook) => {
    const result = assessHookFirstWindowGrounding(hook, wolfOpeningEvidence);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((reason) => [
      "generic_open_loop",
      "hook_open_loop_concrete_anchor_missing",
    ].includes(reason))).toBe(true);
  });

  it("classifica diretamente o hook v27 como generico e sem ancora concreta", () => {
    const result = assessHookOpenLoopStructure(
      "Este lobo faminto encontrou uma pele humana no bosque e decidiu vesti-la. O que acontecera apos essa transformacao?",
    );
    expect(result.passed).toBe(false);
    expect(result.generic_open_loop).toBe(true);
    expect(result.concrete_anchor_terms).toEqual([]);
  });

  it("aceita lacuna declarativa natural ancorada na evidencia real da abertura", () => {
    const result = assessHookFirstWindowGrounding(
      "Lobo faminto farejou pele de homem caido e a vestiu. O motivo daquela pele ainda era um misterio.",
      wolfRealOpeningEvidence,
    );
    expect(result.blocked).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("não aceita mistério ou disfarce como se fossem âncoras visuais concretas", () => {
    const bareMystery = assessHookOpenLoopStructure(
      "Lobo faminto encontrou uma pele e decidiu vesti-la: o mistério.",
    );
    const abstractDisguise = assessHookOpenLoopStructure(
      "Lobo faminto encontrou uma pele e decidiu vesti-la: aquele disfarce ainda era mistério.",
    );
    expect(bareMystery.reasons).toContain("hook_open_loop_concrete_anchor_missing");
    expect(abstractDisguise.reasons).toContain("hook_open_loop_concrete_anchor_missing");
  });

  it("aceita o objeto visual repetido na lacuna declarativa", () => {
    const result = assessHookOpenLoopStructure(
      "Lobo faminto encontrou pele de homem caído e decidiu vesti-la: a pele permanecia um mistério.",
    );
    expect(result.passed).toBe(true);
    expect(result.concrete_anchor_terms).toContain("pele");
  });

  it("aceita pergunta curta sobre o objeto sem transformar o gancho em resumo", () => {
    const result = assessHookFirstWindowGrounding(
      "Lobo faminto encontrou pele abandonada de homem caído e a farejou. Intrigado, decidiu vesti-la — por que aquela pele?",
      wolfRealOpeningEvidence,
    );
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejeita nominalizacao artificial de uma acao ja declarada sem bloquear substantivo legitimo", () => {
    const wolf = assessHookOpenLoopStructure(
      "Este lobo decidiu vestir a pele. Ate onde esse vestir o levaria?",
    );
    const neutral = assessHookOpenLoopStructure(
      "Ele encontrou um olhar estranho. Ate onde aquele olhar o seguiria?",
    );
    expect(wolf.reasons).toContain("hook_unnatural_nominalization");
    expect(neutral.reasons).not.toContain("hook_unnatural_nominalization");
  });

  it("rejeita o open loop abstrato do hook v30 sobre destino", () => {
    const hook = "Este lobo encontrou uma pele humana abandonada na floresta e, intrigado, decidiu vesti-la. Qual sera o seu destino?";
    const structure = assessHookOpenLoopStructure(hook);
    const grounding = assessHookFirstWindowGrounding(hook, wolfOpeningEvidence);

    expect(structure.passed).toBe(false);
    expect(structure.concrete_anchor_terms).toEqual([]);
    expect(structure.reasons).toContain("hook_open_loop_concrete_anchor_missing");
    expect(grounding.blocked).toBe(true);
    expect(grounding.reasons).toContain("hook_open_loop_concrete_anchor_missing");
  });

  it("faz o deterministico prevalecer quando o juiz semantico aceita destino generico", () => {
    const result = reconcileHookOpenLoopVerdict(
      "O oficial exibiu um teste positivo, mas qual sera o destino dela?",
      {
        concrete_open_loop: true,
        open_loop_anchor_grounded: true,
        generic_open_loop: false,
      },
    );

    expect(result.generic_open_loop).toBe(true);
    expect(result.concrete_open_loop).toBe(false);
    expect(result.open_loop_anchor_grounded).toBe(false);
    expect(result.deterministic_reasons).toContain("generic_open_loop");
  });

  it.each([
    "O oficial mostrou o teste. O que ele planeja agora?",
    "O oficial mostrou o teste. O que ela pretende agora?",
    "O oficial mostrou o teste. O que ele vai fazer agora?",
  ])("rejeita plano ou intencao futura vaga apesar da abertura concreta: %s", (hook) => {
    const structure = assessHookOpenLoopStructure(hook);
    const reconciled = reconcileHookOpenLoopVerdict(hook, {
      concrete_open_loop: true,
      open_loop_anchor_grounded: true,
      generic_open_loop: false,
    });

    expect(structure.passed).toBe(false);
    expect(structure.generic_open_loop).toBe(true);
    expect(structure.reasons).toContain("generic_open_loop");
    expect(reconciled.concrete_open_loop).toBe(false);
    expect(reconciled.open_loop_anchor_grounded).toBe(false);
    expect(reconciled.generic_open_loop).toBe(true);
  });

  it("rejeita pergunta de risco solta para um objeto neutro da abertura", () => {
    const result = assessHookFirstWindowGrounding(
      "O soldado exibe um teste positivo para as militares, mas qual o risco desse aviao?",
      {
        method: "opening_hook",
        time_range: { start: 0, end: 5 },
        frames: [
          { timestamp_seconds: 0, description: "A soldier holds a positive pregnancy test.", main_action: "holding a test" },
          { timestamp_seconds: 4, description: "The soldier points. A thought bubble shows a plane.", main_action: "pointing" },
        ],
        transcript_support: [],
      },
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("hook_detached_risk_not_grounded");
  });

  it("mantem pergunta de risco quando a abertura mostra um mecanismo real de ferimento", () => {
    const result = assessHookFirstWindowGrounding(
      "Orgaos de dois animais foram costurados, mas qual o risco dessa cirurgia?",
      {
        method: "opening_hook",
        time_range: { start: 0, end: 5 },
        frames: [
          { timestamp_seconds: 0, description: "Exposed stitched flesh is visible.", main_action: "showing a stitched wound" },
          { timestamp_seconds: 4, description: "A gloved hand sews bloody organs with a needle.", main_action: "sewing organs" },
        ],
        transcript_support: [],
      },
    );

    expect(result.reasons).not.toContain("hook_detached_risk_not_grounded");
  });

  it("rejeita o risco ambiguo da criatura mesmo quando a costura aparece", () => {
    const evidence = {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [
        { timestamp_seconds: 0, description: "A conjoined cat-dog body has exposed stitched flesh.", main_action: "showing the stitched body" },
        { timestamp_seconds: 2, description: "Animal organs are joined with stitches.", main_action: "joining organs" },
        { timestamp_seconds: 4, description: "A gloved hand sews bloody organs.", main_action: "sewing organs" },
      ],
      transcript_support: [{ text: "Um pesquisador uniu um gato e um cachorro em um único corpo." }],
    };
    const genericRisk = assessHookFirstWindowGrounding(
      "Um pesquisador costurou dois animais, mas qual o risco dessa criatura com carne costurada?",
      evidence,
    );
    const popularGap = assessHookFirstWindowGrounding(
      "Dois animais foram costurados no mesmo corpo; será que esse corpo costurado ia aguentar?",
      evidence,
    );

    expect(genericRisk.passed).toBe(false);
    expect(genericRisk.reasons).toContain("hook_generic_creature_risk_question");
    expect(popularGap.passed).toBe(true);
    expect(popularGap.reasons).toEqual([]);
  });

  it("rejeita deslizar pelas escadas quando nenhum frame real da abertura mostra o mecanismo completo", () => {
    const result = assessHookFirstWindowGrounding(
      "Este homem desliza pelas escadas, mas ate onde aquelas escadas o levariam?",
      {
        method: "opening_hook",
        time_range: { start: 0, end: 5 },
        frames: [
          { timestamp_seconds: 0, description: "A man lies in bed.", main_action: "The man remains lying down." },
          { timestamp_seconds: 4, description: "A staircase is visible in an empty hall.", main_action: "No person is on the stairs." },
        ],
        transcript_support: [{ text: "Este hombre era muy vago." }],
      },
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("opening_stair_slide_not_grounded");
  });

  it("aceita o mecanismo de escadas apenas quando um mesmo frame o mostra", () => {
    const result = assessHookFirstWindowGrounding(
      "Este homem desliza pelas escadas, mas ate onde aquelas escadas o levariam?",
      {
        method: "opening_hook",
        time_range: { start: 0, end: 5 },
        frames: [
          { timestamp_seconds: 0, description: "A man is sliding down stairs on his back.", main_action: "The man slides down the staircase." },
        ],
        transcript_support: [{ text: "Este hombre era muy vago." }],
      },
    );

    expect(result.reasons).not.toContain("opening_stair_slide_not_grounded");
  });

  it("preserva a premissa falada de querer ficar deitado sem apagar a acao visual", () => {
    const evidence = {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [
        { timestamp_seconds: 0, description: "A man is sliding down stairs on his back.", main_action: "The man slides down the staircase." },
      ],
      transcript_support: [{
        text: "Este hombre era tan vago que queria pasar todo el dia acostado y no tenia ganas de levantarse.",
      }],
    };
    const distorted = assessHookFirstWindowGrounding(
      "Este homem desliza pelas escadas para evitar qualquer esforco, mas ate onde ele levara essa inercia extrema?",
      evidence,
    );
    const preserved = assessHookFirstWindowGrounding(
      "Este homem queria passar o dia deitado e deslizava pelas escadas; ate onde aquelas escadas o levariam?",
      evidence,
    );

    expect(distorted.reasons).toContain("opening_spoken_state_or_intent_distorted");
    expect(preserved.reasons).not.toContain("opening_spoken_state_or_intent_distorted");
    expect(preserved.reasons).not.toContain("opening_stair_slide_not_grounded");
  });

  it("rejeita a intencao futura vaga do hook v7 mesmo com deitado como ancora", () => {
    const hook = "Este homem preguicoso desliza escada abaixo sem se levantar, mas ate onde ele pretende chegar assim deitado?";
    const evidence = {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [
        { timestamp_seconds: 0, description: "A man is sliding down stairs on his back.", main_action: "The man slides down the staircase." },
      ],
      transcript_support: [{
        text: "Este hombre era tan vago que queria pasar todo el dia acostado y no tenia ganas de levantarse.",
      }],
    };
    const structure = assessHookOpenLoopStructure(hook);
    const grounding = assessHookFirstWindowGrounding(hook, evidence);

    expect(structure.passed).toBe(false);
    expect(structure.generic_open_loop).toBe(true);
    expect(structure.reasons).toContain("generic_open_loop");
    expect(grounding.reasons).toContain("generic_open_loop");
    expect(grounding.reasons).toContain("opening_spoken_state_or_intent_distorted");
  });

  it("aceita lacuna sem plano futuro quando preserva a premissa inicial literal", () => {
    const hook = "Este homem queria passar o dia deitado e deslizava escada abaixo; ate onde aquela preguica o levaria?";
    const result = assessHookFirstWindowGrounding(hook, {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [
        { timestamp_seconds: 0, description: "A man is sliding down stairs on his back.", main_action: "The man slides down the staircase." },
      ],
      transcript_support: [{
        text: "Este hombre era tan vago que queria pasar todo el dia acostado y no tenia ganas de levantarse.",
      }],
    });

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it.each([
    "Este homem era tão preguiçoso que passava o dia todo deslizando pelas escadas sem se levantar.",
    "Este homem era tão preguiçoso que preferia deslizar pelas escadas a ter que dar um passo.",
  ])("rejeita exatamente os hooks v12 que trocam o desejo falado e entregam tudo: %s", (hook) => {
    const evidence = {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [{
        timestamp_seconds: 0,
        description: "A man is sliding down stairs on his back.",
        main_action: "The man slides down the staircase.",
      }],
      transcript_support: [{
        text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse.",
      }],
    };

    const structure = assessHookOpenLoopStructure(hook);
    const grounding = assessHookFirstWindowGrounding(hook, evidence);

    expect(structure.passed).toBe(false);
    expect(structure.reasons).toContain("hook_open_loop_missing");
    expect(grounding.reasons).toEqual(expect.arrayContaining([
      "hook_open_loop_missing",
      "opening_spoken_state_or_intent_distorted",
    ]));
  });

  it("rejeita exatamente o hook v9 quando inércia abstrata substitui o desejo falado", () => {
    const hook = "Este homem preguiçoso desliza pelas escadas sem se levantar, mas qual o limite dessa sua inércia constante?";
    const result = assessHookFirstWindowGrounding(hook, {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [{
        timestamp_seconds: 0,
        description: "A man is sliding down stairs on his back.",
        main_action: "The man slides down the staircase.",
      }],
      transcript_support: [{
        start: 0,
        end: 4.67,
        text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse para nada.",
      }],
    });

    expect(result.blocked).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "opening_spoken_state_or_intent_distorted",
      "opening_spoken_material_intent_omitted",
      "opening_spoken_premise_replaced_by_abstraction",
    ]));
  });

  it.each([
    "Este homem era tão preguiçoso que deslizava pelas escadas, mas qual o risco de continuar deitado?",
    "Este homem era tão preguiçoso que deslizava pelas escadas, mas até onde esse comportamento extremo chegaria?",
    "Este homem era tão preguiçoso que deslizava pelas escadas, mas qual o risco dessa inércia constante?",
  ])("rejeita a tentativa v10 que omite a proposição falada material: %s", (hook) => {
    const result = assessHookFirstWindowGrounding(hook, {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [{
        timestamp_seconds: 0,
        description: "A man is sliding down stairs on his back.",
        main_action: "The man slides down the staircase.",
      }],
      transcript_support: [{
        start: 0,
        end: 4.67,
        text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse para nada.",
      }],
    });

    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("opening_spoken_material_intent_omitted");
  });

  it("materializa o contrato falado v10 sem fornecer frase fixa ao especialista", () => {
    const [contract] = buildHookSpokenPremiseContract([{
      event_id: "hook:transcript:0",
      evidence_kind: "transcript",
      evidence_text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse para nada.",
    }]);

    expect(contract).toMatchObject({
      event_id: "hook:transcript:0",
      material_relation: "desire_or_preference",
      preserve_semantics_not_source_word_order: true,
      abstract_label_is_not_coverage: true,
      failure_reason_if_missing: "opening_spoken_material_intent_omitted",
    });
    expect(contract.required_semantic_components).toEqual(expect.arrayContaining([
      "subject_or_speaker",
      "material_intent_relation",
      "intent_target_state_or_action",
      "temporal_scope",
    ]));
    expect(contract).not.toHaveProperty("suggested_generated_text");
  });

  it("rejeita a regressão v11 que preserva preferência mas troca o alvo falado pela ação visual", () => {
    const contracts = buildHookSpokenPremiseContract([{
      event_id: "hook:transcript:0",
      evidence_kind: "transcript",
      evidence_text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse para nada.",
    }]);
    const carriers = [{
      event_id: "hook:transcript:0",
      target_clause: "Este homem queria passar o dia deitado",
      source_subject_excerpt: "Este hombre",
      source_relation_excerpt: "quería",
      source_intent_target_excerpt: "pasar todo el día acostado",
      source_temporal_scope_excerpt: "todo el día",
      source_polarity_excerpt: "",
      target_subject_excerpt: "Este homem",
      target_relation_excerpt: "queria",
      target_intent_target_excerpt: "passar o dia deitado",
      target_temporal_scope_excerpt: "o dia",
      target_polarity_excerpt: "",
    }];
    const equivalences = [{
      event_id: "hook:transcript:0",
      subject_equivalent: true,
      relation_equivalent: true,
      intent_target_equivalent: true,
      temporal_scope_equivalent: true,
      polarity_equivalent: true,
      reason: "mesmos papéis semânticos",
    }];

    const substituted = assessHookSpokenPremiseContractCoverage(
      "Este homem prefere deslizar pelas escadas, mas até onde aquelas escadas o levariam?",
      contracts,
      carriers,
      equivalences,
    );
    const preserved = assessHookSpokenPremiseContractCoverage(
      "Este homem queria passar o dia deitado e deslizava escada abaixo; até onde aquelas escadas o levariam?",
      contracts,
      carriers,
      equivalences,
    );

    expect(substituted.passed).toBe(false);
    expect(substituted.reasons).toContain(
      "spoken_premise_target_clause_missing_from_hook:hook:transcript:0",
    );
    expect(preserved.passed).toBe(true);
    expect(preserved.covered_event_ids).toEqual(["hook:transcript:0"]);
  });

  it("transporta genericamente decisão entre idiomas e valida a cláusula no hook", () => {
    const contracts = buildHookSpokenPremiseContract([{
      event_id: "hook:spoken:pilot",
      evidence_kind: "transcript_segment",
      evidence_text: "The pilot decided to remain inside the car during the storm.",
    }]);
    const validCarrier = {
      event_id: "hook:spoken:pilot",
      target_clause: "A piloto decidiu ficar dentro do carro durante a tempestade",
      source_subject_excerpt: "The pilot",
      source_relation_excerpt: "decided",
      source_intent_target_excerpt: "to remain inside the car",
      source_temporal_scope_excerpt: "during the storm",
      source_polarity_excerpt: "",
      target_subject_excerpt: "A piloto",
      target_relation_excerpt: "decidiu",
      target_intent_target_excerpt: "ficar dentro do carro",
      target_temporal_scope_excerpt: "durante a tempestade",
      target_polarity_excerpt: "",
    };
    const equivalences = [{
      event_id: "hook:spoken:pilot",
      subject_equivalent: true,
      relation_equivalent: true,
      intent_target_equivalent: true,
      temporal_scope_equivalent: true,
      polarity_equivalent: true,
      reason: "same semantic roles",
    }];
    const result = assessHookSpokenPremiseContractCoverage(
      "A piloto decidiu ficar dentro do carro durante a tempestade; até quando aquele carro aguentaria?",
      contracts,
      [validCarrier],
      equivalences,
    );
    const sourceTargetSwapped = assessHookSpokenPremiseContractCoverage(
      "A piloto decidiu abrir a porta; até quando aquele carro aguentaria?",
      contracts,
      [{
        ...validCarrier,
        target_clause: "A piloto decidiu abrir a porta",
        source_intent_target_excerpt: "to open the door",
        target_intent_target_excerpt: "abrir a porta",
      }],
      equivalences,
    );

    expect(result.passed).toBe(true);
    expect(sourceTargetSwapped.passed).toBe(false);
    expect(sourceTargetSwapped.reasons).toContain(
      "spoken_premise_source_intent_target_not_literal:hook:spoken:pilot",
    );
  });

  it("falha fechado quando um carrier internamente consistente troca o alvo da intenção", () => {
    const contracts = buildHookSpokenPremiseContract([{
      event_id: "hook:transcript:0",
      evidence_kind: "transcript",
      evidence_text: "Este hombre quería pasar todo el día acostado y no tenía ganas de levantarse.",
    }]);
    const carrier = {
      event_id: "hook:transcript:0",
      target_clause: "Este homem queria deslizar pelas escadas o dia todo",
      source_subject_excerpt: "Este hombre",
      source_relation_excerpt: "quería",
      source_intent_target_excerpt: "pasar todo el día acostado",
      source_temporal_scope_excerpt: "todo el día",
      source_polarity_excerpt: "",
      target_subject_excerpt: "Este homem",
      target_relation_excerpt: "queria",
      target_intent_target_excerpt: "deslizar pelas escadas",
      target_temporal_scope_excerpt: "o dia todo",
      target_polarity_excerpt: "",
    };
    const result = assessHookSpokenPremiseContractCoverage(
      "Este homem queria deslizar pelas escadas o dia todo; até onde aquelas escadas o levariam?",
      contracts,
      [carrier],
      [{
        event_id: "hook:transcript:0",
        subject_equivalent: true,
        relation_equivalent: true,
        intent_target_equivalent: false,
        temporal_scope_equivalent: true,
        polarity_equivalent: true,
        reason: "o alvo deitado foi trocado pela ação visual",
      }],
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual([
      "spoken_premise_intent_target_not_equivalent:hook:transcript:0",
    ]);
  });

  it("extrai o mesmo contrato para outro sujeito e outra decisão, mas nunca de descrição visual", () => {
    const contracts = buildHookSpokenPremiseContract([{
      event_id: "hook:spoken:pilot",
      evidence_kind: "transcript_segment",
      evidence_text: "A piloto decidiu esperar durante a tempestade antes de sair do carro.",
    }, {
      event_id: "hook:visual:pilot",
      evidence_kind: "visual_frame",
      evidence_text: "The pilot wanted to open the door while the car was moving.",
    }]);

    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      event_id: "hook:spoken:pilot",
      material_relation: "decision",
    });
    expect(contracts[0].required_semantic_components).toContain("temporal_scope");
  });

  it("congela premissa e ação visual e aceita somente o loop concreto sem spoiler", () => {
    const openingEvidence = {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [{
        timestamp_seconds: 0,
        description: "A man is sliding down a wooden staircase on his back.",
        main_action: "The man slides down the staircase.",
      }],
      transcript_support: [{
        start: 0,
        end: 4.67,
        text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse para nada.",
      }],
    };
    const visualCarrier = {
      frame_timestamp_seconds: 0,
      target_clause: "ele deslizava pelas escadas",
      source_subject_excerpt: "A man",
      source_action_excerpt: "sliding down",
      source_object_or_state_excerpt: "wooden staircase",
      target_subject_excerpt: "ele",
      target_action_excerpt: "deslizava",
      target_object_or_state_excerpt: "escadas",
    };
    const visualAssessment = assessHookVisualActionCarrier(visualCarrier, openingEvidence);
    const wrongTimestamp = assessHookVisualActionCarrier(
      { ...visualCarrier, frame_timestamp_seconds: 1 },
      openingEvidence,
    );
    const hook = composeFrozenHookClauses({
      spokenClauses: ["Este homem queria passar o dia deitado"],
      visualActionClause: visualCarrier.target_clause,
      loopClause: "até onde aquelas escadas o levariam?",
      targetLanguage: "pt",
    });
    const result = assessHookFirstWindowGrounding(hook, openingEvidence);

    expect(visualAssessment).toEqual({ passed: true, reasons: [] });
    expect(wrongTimestamp.passed).toBe(false);
    expect(wrongTimestamp.reasons).toContain("hook_visual_action_source_frame_missing");
    expect(assessHookVisualActionCarrier({
      ...visualCarrier,
      target_clause: "homem deslizava pelas escadas",
      target_subject_excerpt: "homem",
    }, openingEvidence, "pt").reasons).toContain(
      "hook_visual_action_target_subject_not_standalone",
    );
    expect(hook).toBe(
      "Este homem queria passar o dia deitado. Ele deslizava pelas escadas; até onde aquelas escadas o levariam?",
    );
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(hook.split(/\s+/u).filter(Boolean)).toHaveLength(17);
  });

  it("monta cláusulas congeladas como frases sem criar 'e homem'", () => {
    const hook = composeFrozenHookClauses({
      spokenClauses: ["ele queria ficar deitado o dia todo"],
      visualActionClause: "homem desliza pela escada",
      loopClause: "até onde ficar deitado o levaria?",
      targetLanguage: "pt",
    });

    expect(hook).toBe(
      "Ele queria ficar deitado o dia todo. Homem desliza pela escada; até onde ficar deitado o levaria?",
    );
    expect(hook).not.toMatch(/\be homem\b/iu);
  });

  it("bloqueia loop da v13 que vaza atração ausente dos fatos congelados", () => {
    const frozenClauses = [
      "ele queria ficar deitado o dia todo",
      "homem desliza pela escada",
    ];
    const leaked = assessFrozenHookLoopGrounding(
      frozenClauses,
      "por que ficar deitado atrai tanto?",
    );
    const openingOnly = assessFrozenHookLoopGrounding(
      frozenClauses,
      "até onde ficar deitado o levaria?",
    );

    expect(leaked).toEqual({
      passed: false,
      unsupported_terms: ["atrai"],
      reasons: [
        "hook_loop_adds_unfrozen_story_terms",
        "hook_loop_causal_why_presupposition",
        "hook_loop_unanswered_dimension_missing",
      ],
    });
    expect(openingOnly).toEqual({ passed: true, unsupported_terms: [], reasons: [] });
  });

  it("não deixa pergunta causal usar wrappers abstratos para esconder pressuposto", () => {
    const frozenClauses = ["o lobo vestiu uma pele"];
    const result = assessFrozenHookLoopGrounding(
      frozenClauses,
      "por que essa pele causaria uma consequência?",
    );

    expect(result.passed).toBe(false);
    expect(result.unsupported_terms).toContain("consequencia");
    expect(result.reasons).toContain("hook_loop_causal_why_presupposition");
  });

  it("rejeita pergunta-fragmento que apenas repete os fatos congelados", () => {
    const result = assessFrozenHookLoopGrounding(
      ["ele queria ficar deitado o dia todo", "o homem desliza pela escada"],
      "o homem deitado na escada?",
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("hook_loop_unanswered_dimension_missing");
  });

  it("monta uma extensão PT-BR gramatical usando apenas trechos falados congelados", () => {
    const loop = buildFrozenSpokenPremiseExtensionLoop({
      targetIntentExcerpt: "ficar deitado",
      targetSubjectExcerpt: "esse homem",
      targetLanguage: "pt-BR",
      minWords: 5,
      maxWords: 7,
    });

    expect(loop).toBe("até onde ficar deitado levaria esse homem?");
    expect(assessFrozenHookLoopGrounding(
      ["esse homem queria ficar deitado", "o homem desliza pela escada"],
      loop,
    )).toEqual({ passed: true, unsupported_terms: [], reasons: [] });
    expect(buildFrozenSpokenPremiseExtensionLoop({
      targetIntentExcerpt: "ficar deitado o dia inteiro sem nunca levantar",
      targetSubjectExcerpt: "esse homem",
      targetLanguage: "pt-BR",
      maxWords: 7,
    })).toBe("");
    expect(buildFrozenSpokenPremiseExtensionLoop({
      targetIntentExcerpt: "ele ficava deitado",
      targetSubjectExcerpt: "esse homem",
      targetLanguage: "pt-BR",
      maxWords: 9,
    })).toBe("");
  });

  it("recusa montar lacuna interrogativa sem ponto de interrogação", () => {
    expect(composeFrozenHookClauses({
      spokenClauses: ["ele queria ficar deitado"],
      visualActionClause: "o homem desliza pela escada",
      loopClause: "até onde iria para ficar deitado",
      targetLanguage: "pt-BR",
    })).toBe("");
  });

  it("aceita o reparo factual da v8 com premissa falada e loop ancorado na abertura", () => {
    const hook = "Este homem queria passar o dia deitado e deslizava escada abaixo; até onde aquelas escadas o levariam?";
    const result = assessHookFirstWindowGrounding(hook, {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [{
        timestamp_seconds: 0,
        description: "A man is sliding down stairs on his back.",
        main_action: "The man slides down the staircase.",
      }],
      transcript_support: [{
        text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse.",
      }],
    });

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("não aceita mover o desejo de passar o dia deitado para a ação visual", () => {
    const result = assessHookFirstWindowGrounding(
      "Este homem queria passar o dia deslizando pelas escadas; até onde aquelas escadas o levariam?",
      {
        method: "opening_hook",
        time_range: { start: 0, end: 5 },
        frames: [{
          timestamp_seconds: 0,
          description: "A man is sliding down stairs on his back.",
          main_action: "The man slides down the staircase.",
        }],
        transcript_support: [{
          text: "Este hombre quería pasar todo el día acostado y no tenía ganas de levantarse.",
        }],
      },
    );

    expect(result.reasons).toContain("opening_spoken_state_or_intent_distorted");
  });

  it("aceita lacuna concreta de propriedade para objeto neutro visivel", () => {
    const hook = "Um soldado ergueu um teste positivo diante da tropa, mas de quem era aquele teste?";
    const structure = assessHookOpenLoopStructure(hook);
    const result = assessHookFirstWindowGrounding(hook, {
      method: "opening_hook",
      time_range: { start: 0, end: 5 },
      frames: [
        { timestamp_seconds: 0, description: "A soldier holds a positive pregnancy test.", main_action: "holding a test" },
        { timestamp_seconds: 4, description: "The soldier points. A thought bubble shows a plane.", main_action: "pointing" },
      ],
      transcript_support: [],
    });

    expect(structure.passed).toBe(true);
    expect(structure.concrete_anchor_terms).toContain("teste");
    expect(result.reasons).not.toContain("hook_detached_risk_not_grounded");
    expect(result.reasons).not.toContain("generic_open_loop");
  });

  it.each([
    "Um soldado mostrou um teste positivo e apontou para um aviao, mas quem e?",
    "Um soldado mostrou um teste positivo e apontou para um aviao. Quem era?",
    "Um soldado mostrou um teste positivo e apontou para um aviao, mas quem e afinal?",
    "Um soldado mostrou um teste positivo e apontou para um aviao, so que quem era?",
    "Um soldado mostrou um teste positivo. Quem e essa pessoa afinal?",
    "A soldier showed a positive test and pointed at a plane, but who is it?",
  ])("rejeita pergunta de identidade solta sem objeto ou pessoa ancorada: %s", (hook) => {
    const structure = assessHookOpenLoopStructure(hook);
    const reconciled = reconcileHookOpenLoopVerdict(hook, {
      concrete_open_loop: true,
      open_loop_anchor_grounded: true,
      generic_open_loop: false,
    });

    expect(structure.passed).toBe(false);
    expect(structure.generic_open_loop).toBe(true);
    expect(structure.reasons).toContain("generic_open_loop");
    expect(reconciled.concrete_open_loop).toBe(false);
    expect(reconciled.open_loop_anchor_grounded).toBe(false);
  });

  it("nao confunde pergunta de propriedade ancorada com identidade solta", () => {
    const structure = assessHookOpenLoopStructure(
      "Um soldado mostrou um teste positivo, mas de quem era aquele teste?",
    );

    expect(structure.passed).toBe(true);
    expect(structure.generic_open_loop).toBe(false);
    expect(structure.concrete_anchor_terms).toContain("teste");
  });

  it("rejeita endereco direto generico", () => {
    const result = assessHookFirstWindowGrounding(
      "Voce nao vai acreditar no que aconteceu com este lobo.",
      wolfOpeningEvidence,
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("generic_meta_teaser");
  });

  it("rejeita pergunta vaga que nao retoma acao ou objeto", () => {
    const result = assessHookFirstWindowGrounding(
      "Este lobo encontrou e vestiu uma pele humana. O que fara?",
      wolfOpeningEvidence,
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("generic_meta_teaser");
  });

  it("rejeita inversao da direcao fisica", () => {
    const result = assessHookFirstWindowGrounding(
      "Lobo faminto encontra um homem caido e entra em sua boca como disfarce. O que fara?",
      wolfOpeningEvidence,
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("opening_physical_direction_contradicted");
  });

  it("falha fechado sem evidencia visual da abertura", () => {
    const result = assessHookFirstWindowGrounding(
      "Este lobo vestiu uma pele humana. Ate onde esse disfarce o levaria?",
      { method: "insufficient", time_range: null, frames: [] },
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("opening_evidence_missing");
  });

  it("mantem o guarda deterministico nos caminhos de montar e validar", () => {
    const assembleCalls = assembleSource.match(/assessHookFirstWindowGrounding\s*\(/g) || [];
    const validatorCalls = validatorSource.match(/assessHookFirstWindowGrounding\s*\(/g) || [];
    expect(assembleCalls.length).toBeGreaterThanOrEqual(1);
    expect(validatorCalls.length).toBeGreaterThanOrEqual(1);
    expect((assembleSource.match(/authoritativeHookOpeningEvidence\(options\.payload/g) || []).length)
      .toBeGreaterThanOrEqual(6);
    expect(validatorSource).toContain("authoritativeHookOpeningEvidence(payload, openingSelection)");
    expect(validatorSource).toContain("{ openingHook: true, limit: 18 }");
    expect(assembleSource).toContain("assessHookOpenLoopStructure");
    expect(assembleSource).toContain("observedDirectAddressOpening");
    expect(assembleSource).toContain("Number(profile.direct_address_rate || 0) > 0");
    expect(assembleSource).toContain('sig.opening_pattern === "discovery"');
  });

  it("separa anti-copia do julgamento semantico exclusivo do hook", () => {
    expect(assembleSource).toContain("const antiCopyResponsePromise");
    expect(assembleSource).toContain("const hookGroundingResponsePromise");
    expect(assembleSource).toContain("HOOK OPENING GROUNDING AND CURIOSITY ONLY");
    expect(assembleSource).toContain("content verb, adjective and assumed effect");
    expect(assembleSource).toContain("Never use a later payoff to rescue an opening-only verdict");
    expect(assembleSource).toContain("hook_opening_guard_missing_or_invalid_result");
    expect(assembleSource).toContain("reconcileHookOpenLoopVerdict(pending.candidate.generated");
    expect(assembleSource).toContain("hook_deterministic_");
    expect(assembleSource).toContain("HOOK_SPECIALIST_GENERIC_GAP_PATTERNS");
    expect(assembleSource).toContain("rejectedHookCandidateFingerprints");
    expect(assembleSource).toContain("hook_specialist_candidate_repeated");
    expect(assembleSource).toContain("buildHookSpokenPremiseContract(hookChecklist.events)");
    expect(assembleSource).toContain("TRANSPORTADOR SEMÂNTICO REDUZIDO DA PREMISSA FALADA");
    expect(assembleSource).toContain("não recebe imagem, título, DNA nem história posterior");
    expect(assembleSource).toContain("TRANSPORTADOR VISUAL REDUZIDO DA AÇÃO DE ABERTURA");
    expect(assembleSource).toContain("AUDITOR BILÍNGUE INDEPENDENTE DE PAPÉIS");
    expect(assembleSource).toContain("ESPECIALISTA REDUZIDO DA LACUNA DO GANCHO");
    expect(assembleSource).toContain("Nunca retorne generated_text");
    expect(assembleSource).toContain("assessHookSpokenPremiseContractCoverage(");
    expect(assembleSource).toContain("candidateSpokenPremiseCoverage.passed === true");
    expect(assembleSource).toContain("hookVisualActionCarrierAssessment.passed === true");
    expect(assembleSource).toContain("intent_target_equivalent");
    expect(assembleSource).toContain("const loopClause = String(specialistResult.value?.loop_clause");
    expect(assembleSource).toContain("composeFrozenHookClauses({");
    expect(assembleSource).toContain("assessFrozenHookLoopGrounding(");
    expect(assembleSource).toContain("currentHookLoopGrounding?.passed !== true");
    expect(assembleSource).toContain("deterministic-frozen-spoken-extension");
    const loopSpecialistPrompt = assembleSource.slice(
      assembleSource.indexOf("systemPrompt: `Você é o ESPECIALISTA REDUZIDO DA LACUNA DO GANCHO"),
      assembleSource.indexOf("temperature: 0", assembleSource.indexOf("systemPrompt: `Você é o ESPECIALISTA REDUZIDO DA LACUNA DO GANCHO")),
    );
    expect(loopSpecialistPrompt).not.toContain("hookPayoffAnswerabilityEvents");
    expect(loopSpecialistPrompt).not.toContain("EVIDÊNCIA FINAL");
    expect(assembleSource.indexOf("hookSpokenPremiseCarrierPromise"))
      .toBeLessThan(assembleSource.indexOf("const initialChunkResults"));
    expect(assembleSource.indexOf("hookVisualActionCarrierPromise"))
      .toBeLessThan(assembleSource.indexOf("const initialChunkResults"));
  });

  it("exige loop, ancora e pressupostos semanticos separados", () => {
    expect(assembleSource).toContain("checks.hook_unresolved = sig.withheld_payoff");
    expect(assembleSource).toContain("checks.concrete_curiosity = sig.hook_open_loop_structure.passed");
    expect(assembleSource).toContain("hook_concrete_open_loop_missing");
    expect(assembleSource).toContain("hook_open_loop_anchor_not_grounded");
    expect(assembleSource).toContain("hook_question_presuppositions_not_grounded");
    expect(validatorSource).toContain("copyGuard?.hook_concrete_open_loop === true");
    expect(validatorSource).toContain("copyGuard?.hook_open_loop_anchor_grounded === true");
    expect(validatorSource).toContain("copyGuard?.hook_generic_open_loop === false");
  });
});
