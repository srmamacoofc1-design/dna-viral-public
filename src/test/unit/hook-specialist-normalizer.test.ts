import { describe, expect, it } from "vitest";
import {
  buildNeutralObjectOwnershipGapCandidate,
  normalizeHookSpecialistDeclarativeGap,
} from "../../../supabase/functions/_shared/hook-specialist-normalizer";

const baseOptions = {
  targetLanguage: "pt-BR",
  maxWords: 22,
  declarativePreferred: true,
};

const literalTestOwnershipPayoff = [{
  evidence_kind: "transcript_segment",
  evidence_text: "No fim, a militar confirma que o teste era dela.",
}];

describe("normalizador genérico do especialista de hook", () => {
  it("rejeita exatamente o hook declarativo sem loop da v8 para forçar reparo especializado", () => {
    const result = normalizeHookSpecialistDeclarativeGap(
      "Este homem era tão preguiçoso que passava o dia todo deslizando pelas escadas sem se levantar.",
      {
        ...baseOptions,
        events: [{
          evidence_text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse.",
        }, {
          evidence_text: "A man slides down the staircase on his back.",
        }],
      },
    );

    expect(result).toBe("");
  });

  it("preserva o reparo da v8 quando a premissa e o loop local estão completos", () => {
    const hook = "Este homem queria passar o dia deitado e deslizava escada abaixo; até onde aquelas escadas o levariam?";
    const result = normalizeHookSpecialistDeclarativeGap(hook, {
      ...baseOptions,
      events: [{
        evidence_text: "Este hombre quería pasar todo el día acostado y no tenía ganas de levantarse.",
      }, {
        evidence_text: "A man slides down the staircase on his back.",
      }],
    });

    expect(result).toBe(hook);
  });

  it("rejeita genericamente qualquer setup factual que termine sem lacuna", () => {
    const result = normalizeHookSpecialistDeclarativeGap(
      "Uma mulher abriu uma caixa vermelha e encontrou um relógio quebrado.",
      {
        ...baseOptions,
        events: [{ evidence_text: "A woman opens a red box and finds a broken watch." }],
      },
    );

    expect(result).toBe("");
  });

  it("rejeita mistério inventado quando a abertura já explica a preguiça", () => {
    const result = normalizeHookSpecialistDeclarativeGap(
      "Este homem descia as escadas deitado, mas o motivo de tanta preguiça ainda era um mistério.",
      {
        ...baseOptions,
        events: [{
          evidence_text: "Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse.",
        }],
      },
    );

    expect(result).toBe("");
  });

  it("preserva pergunta de extensão ancorada sem esconder a causa já dita", () => {
    const hook = "Esse homem tinha tanta preguiça que descia escadas deitado — até onde iria sem levantar?";
    const result = normalizeHookSpecialistDeclarativeGap(hook, {
      ...baseOptions,
      events: [{
        evidence_text: "Este hombre era tan vago que no tenía ganas de levantarse y bajaba las escaleras acostado.",
      }],
    });

    expect(result).toBe(hook);
  });

  it.each([
    "O oficial mostrou o teste. O que vai acontecer agora?",
    "O oficial mostrou o teste, mas qual será o destino dela?",
    "O oficial mostrou o teste. E agora?",
    "O oficial mostrou o teste. O que ele planeja agora?",
    "O oficial mostrou o teste. O que ela pretende agora?",
    "O oficial mostrou o teste. O que ele vai fazer agora?",
    "O oficial mostrou o teste, mas quem é?",
    "O oficial mostrou o teste, mas quem é afinal?",
    "O oficial mostrou o teste, só que quem era?",
    "O oficial mostrou o teste. Quem é essa pessoa afinal?",
  ])("rejeita pergunta futura vaga mesmo depois de uma abertura concreta: %s", (hook) => {
    const result = normalizeHookSpecialistDeclarativeGap(hook, {
      ...baseOptions,
      events: [{ evidence_text: "O oficial mostrou o teste e apontou para a saída." }],
    });

    expect(result).toBe("");
  });

  it("preserva pergunta de propriedade que repete o objeto concreto", () => {
    const hook = "O oficial mostrou um teste positivo, mas de quem era aquele teste?";
    const result = normalizeHookSpecialistDeclarativeGap(hook, {
      ...baseOptions,
      events: [{ evidence_text: "O oficial mostrou um teste positivo." }],
      payoffEvents: literalTestOwnershipPayoff,
    });

    expect(result).toBe(hook);
  });

  it("repairs the live generic/detached-risk loop into grounded neutral-object ownership", () => {
    const generic = buildNeutralObjectOwnershipGapCandidate(
      "Um soldado furioso exibe um teste de gravidez positivo para as mulheres. O que ele fará agora?",
      { targetLanguage: "pt", maxWords: 19, payoffEvents: literalTestOwnershipPayoff },
    );
    const detachedRisk = buildNeutralObjectOwnershipGapCandidate(
      "O soldado furioso exibe um teste de gravidez positivo para as mulheres, mas qual o risco desse avião?",
      { targetLanguage: "pt", maxWords: 19, payoffEvents: literalTestOwnershipPayoff },
    );

    for (const repaired of [generic, detachedRisk]) {
      expect(repaired).toMatch(/De quem era o teste\?$/);
      expect(repaired).not.toMatch(/fará agora|risco desse avião/i);
      expect(String(repaired).split(/\s+/u)).toHaveLength(17);
    }
  });

  it("rejects the exact v16 ownership gap when the final visuals never answer ownership", () => {
    const payoffEvents = [{
      evidence_kind: "visual_frame",
      evidence_text: "The blonde woman and mechanic hold a baby. The mechanic points to an airplane.",
    }];

    expect(buildNeutralObjectOwnershipGapCandidate(
      "O soldado grisalho exibe um teste positivo. O que ele fará agora?",
      { targetLanguage: "pt", maxWords: 19, payoffEvents },
    )).toBeNull();
    expect(normalizeHookSpecialistDeclarativeGap(
      "O soldado grisalho exibe um teste positivo; de quem seria esse teste?",
      { ...baseOptions, payoffEvents },
    )).toBe("");
  });

  it("does not turn a visible person or baby into an ownership object", () => {
    for (const candidate of [
      "A mulher segura um bebê perto da porta. O que ela fará agora?",
      "O homem segura um cachorro perto da porta. O que ele fará agora?",
    ]) {
      expect(buildNeutralObjectOwnershipGapCandidate(
        candidate,
        { targetLanguage: "pt", maxWords: 19 },
      )).toBeNull();
    }
  });

  it("skips an earlier living direct object and uses the later neutral object", () => {
    const result = buildNeutralObjectOwnershipGapCandidate(
      "O homem segura uma mulher e mostra um teste. O que ele fará agora?",
      { targetLanguage: "pt", maxWords: 19, payoffEvents: literalTestOwnershipPayoff },
    );

    expect(result).toBe("O homem segura uma mulher e mostra um teste. De quem era o teste?");
  });

  it("rejeita pergunta de motivo quando a abertura já fornece a causa", () => {
    const result = normalizeHookSpecialistDeclarativeGap(
      "Esse homem não levantava nem para descer a escada. Por que ele não levantava?",
      {
        ...baseOptions,
        events: [{
          evidence_text: "Era tan vago que no tenía ganas de levantarse para nada.",
        }],
      },
    );

    expect(result).toBe("");
  });

  it("mantém reagente e personagem incorporada separados em react só com música", () => {
    const hook = "O comandante ergueu um teste de gravidez — por que a piloto travou enquanto a reagente observava?";
    const result = normalizeHookSpecialistDeclarativeGap(hook, {
      ...baseOptions,
      events: [
        { evidence_text: "Embedded animation: commander raises a pregnancy test and the pilot freezes." },
        { evidence_text: "Separate reaction pane: a woman watches silently while music plays; no spoken narration." },
      ],
    });

    expect(result).toBe(hook);
    expect(result).toContain("piloto");
    expect(result).toContain("reagente");
  });

  it("não cria propósito novo em experimento cuja finalidade já foi narrada", () => {
    const result = normalizeHookSpecialistDeclarativeGap(
      "O cientista costurou dois animais. Por que ele fez isso?",
      {
        ...baseOptions,
        events: [{
          evidence_text: "O cientista costurou um gato a um cachorro porque queria testar se sobreviveriam juntos.",
        }],
      },
    );

    expect(result).toBe("");
  });

  it("mantém o caso do lobo factual sem injetar mistério nem reescrever entidades", () => {
    const hook = "Lobo faminto encontrou pele abandonada de homem caído e a farejou. Curioso, decidiu vesti-la — por que aquela pele?";
    const result = normalizeHookSpecialistDeclarativeGap(hook, {
      ...baseOptions,
      events: [
        { evidence_text: "Hungry wolf finds abandoned human skin beside a fallen man and sniffs it." },
        { evidence_text: "Curious, the wolf decides to wear the skin." },
      ],
    });

    expect(result).toBe(hook);
    expect(result).not.toContain("mistério");
  });

  it("rejeita mistério acrescentado ao caso do lobo quando a evidência não o afirma", () => {
    const result = normalizeHookSpecialistDeclarativeGap(
      "Lobo faminto encontrou uma pele e decidiu vesti-la: o motivo ainda era um mistério.",
      {
        ...baseOptions,
        events: [{ evidence_text: "Hungry wolf finds abandoned human skin and decides to wear it." }],
      },
    );

    expect(result).toBe("");
  });

  it("preserva marcador de desconhecido somente quando a própria abertura o afirma", () => {
    const hook = "A caixa apareceu trancada, e ninguém sabia quem a deixou ali: o motivo ainda seguia desconhecido.";
    const result = normalizeHookSpecialistDeclarativeGap(hook, {
      ...baseOptions,
      events: [{ evidence_text: "A caixa apareceu trancada e ninguém sabia quem a deixou ali." }],
    });

    expect(result).toBe(hook);
  });
});
