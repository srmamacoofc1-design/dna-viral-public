import { describe, expect, it } from "vitest";
import {
  normalizeTranscriptLanguageCode,
  reconcileTranscriptLanguage,
} from "../../../supabase/functions/_shared/transcript-language";

const REAL_SPANISH_TRANSCRIPT = `Este hombre era tan vago que quería pasar todo el día acostado y no tenía ganas de levantarse para nada. Cada mañana salía arrastrándose de la cama y se cepillaba los dientes sin siquiera abrir los ojos. Después se ponía los pantalones sin levantarse de la cama y bajaba las escaleras deslizándose en vez de caminar. Cuando iba al trabajo aprovechaba cualquier objeto para seguir deslizándose y evitar dar un solo paso. Al subir al tren usaba el viaje para dormir unos minutos más. Al llegar a la oficina también entraba deslizándose. Lo más increíble era que mientras dormía sobre su escritorio conseguía cerrar negocios de millones de dólares, por lo que su jefe terminó ascendiéndolo a gerente general. Al salir del trabajo fue a una fiesta y empezó a bailar acostado sobre el suelo. Para sorpresa de todos su actitud tan perezosa volvió locas a todas las chicas y muchas terminaron enamorándose de él.`;

describe("transcript language reconciliation", () => {
  it("overrides the wrong pt_br model label for the real Spanish transcript", () => {
    const original = REAL_SPANISH_TRANSCRIPT;
    const decision = reconcileTranscriptLanguage(original, "pt_br");

    expect(decision.language).toBe("es");
    expect(decision.model_language).toBe("pt");
    expect(decision.lexical_language).toBe("es");
    expect(decision.source).toBe("lexical_evidence");
    expect(REAL_SPANISH_TRANSCRIPT).toBe(original);
  });

  it("recognizes substantial Brazilian Portuguese even when the model says Spanish", () => {
    const transcript = `Este homem era tão preguiçoso que queria passar o dia todo deitado e não tinha vontade de levantar. Toda manhã ele saía se arrastando da cama e escovava os dentes sem nem abrir os olhos. Depois vestia a calça sem sair da cama e descia as escadas deslizando em vez de caminhar. Quando ia ao trabalho, aproveitava qualquer objeto para continuar deslizando. Ao chegar ao escritório, também entrava deslizando.`;
    const decision = reconcileTranscriptLanguage(transcript, "es-US");

    expect(decision.language).toBe("pt");
    expect(decision.model_language).toBe("es");
    expect(decision.source).toBe("lexical_evidence");
  });

  it("recognizes substantial English instead of trusting a wrong model label", () => {
    const transcript = `This man was so lazy that he wanted to spend the entire day lying down and never felt like getting up. Every morning, he crawled out of bed and brushed his teeth without even opening his eyes. Then he put on his pants and went to work while everyone watched him.`;
    const decision = reconcileTranscriptLanguage(transcript, "Portuguese (Brazil)");

    expect(decision.language).toBe("en");
    expect(decision.model_language).toBe("pt");
    expect(decision.source).toBe("lexical_evidence");
  });

  it("keeps the normalized model label for balanced mixed-language evidence", () => {
    const transcript = "Este hombre was very tired, pero he wanted to dormir because the viaje was long and ele precisava descansar.";
    const decision = reconcileTranscriptLanguage(transcript, "pt-BR");

    expect(decision.language).toBe("pt");
    expect(decision.lexical_language).toBeNull();
    expect(decision.source).toBe("model");
  });

  it("keeps the normalized model label when a short sample has too little evidence", () => {
    const decision = reconcileTranscriptLanguage("Hola, tudo bem?", "Spanish");

    expect(decision.language).toBe("es");
    expect(decision.lexical_language).toBeNull();
    expect(decision.source).toBe("model");
  });

  it("preserves unknown for empty audio even when the model emitted a language", () => {
    const decision = reconcileTranscriptLanguage("   ", "es-MX");

    expect(decision.language).toBe("unknown");
    expect(decision.source).toBe("empty_audio");
    expect(decision.scores).toEqual([]);
  });

  it.each([
    ["pt_BR", "pt"],
    ["Português", "pt"],
    ["es-US", "es"],
    ["Español", "es"],
    ["EN_us", "en"],
    ["English", "en"],
    ["French", "fr"],
    ["und", "unknown"],
    [null, "unknown"],
  ])("normalizes provider language label %j to %s", (input, expected) => {
    expect(normalizeTranscriptLanguageCode(input)).toBe(expected);
  });
});
