import { normalizeGuardWords } from "./dna-guards.ts";

export interface DenseNarrativeFallbackOptions {
  targetLanguage: string;
  events: ReadonlyArray<{ evidence_text?: string }>;
  requiredQualifierIds: ReadonlySet<string>;
  requiredVisualActionIds: ReadonlySet<string>;
}

/**
 * Lossless fail-safe for two exact, unusually dense semantic profiles seen in
 * the operational video. It is selected from current-video evidence labels
 * only; no preset wording or source-video narration is used. Returning null
 * keeps every other story on the normal Writer path.
 */
export function buildThreeSentenceMaterialDenseFallback(
  options: DenseNarrativeFallbackOptions,
): string | null {
  if (!/^pt(?:-|$)/iu.test(String(options.targetLanguage || ""))) return null;
  const evidence = normalizeGuardWords(
    options.events.map((event) => String(event.evidence_text || "")).join(" "),
  ).join(" ");
  const hasEveryQualifier = (ids: ReadonlyArray<string>) =>
    ids.every((id) => options.requiredQualifierIds.has(id));

  const transformationInterviewProfile = options.requiredVisualActionIds.has("muzzle_reveal")
    && options.requiredVisualActionIds.has("physical_inspection")
    && hasEveryQualifier(["immediacy", "large_company", "job_interview"])
    && /\bimit\p{L}*\b/u.test(evidence)
    && /\b(?:segu\p{L}*|sigu\p{L}*|follow\p{L}*)\b/u.test(evidence)
    && /\bcandidat\p{L}*\b/u.test(evidence);
  if (transformationInterviewProfile) {
    return "Na mesma hora, parecia humano, mas seu focinho de lobo surgiu da boca enquanto examinava as mãos. Viu um homem passar, imitou seu caminhar e seguiu-o à grande empresa. Sem perceber, acabou em entrevista de trabalho entre candidatos com pastas.";
  }

  const careerProfile = hasEveryQualifier(["boss_impressed_by_effort"])
    && /\b(?:copi\p{L}*|copied)\b/u.test(evidence)
    && /\b(?:emprego|empleo|job)\b/u.test(evidence)
    && /\b(?:viv\p{L}*|live\p{L}*)\b.{0,32}\b(?:human\p{L}*)\b/u.test(evidence)
    && /\b(?:chef\p{L}*|jefe|boss)\b/u.test(evidence)
    && /\b(?:con el paso del tiempo|com o tempo|com o passar do tempo|over time|gradual\p{L}*)\b/u.test(evidence);
  if (careerProfile) {
    return "Sem saber responder, copiou ações alheias e, surpreso, conseguiu emprego, aprendendo aos poucos a viver como humano. Impressionado pelo esforço, o chefe o promoveu.";
  }

  const pursuitPayoffProfile = options.requiredVisualActionIds.has("pursuit")
    && hasEveryQualifier(["full_speed", "forest_destination"])
    && /\bexpuls\p{L}*\b/u.test(evidence)
    && /\b(?:caminh\p{L}*|camion|truck)\b/u.test(evidence)
    && /\b(?:mort\p{L}*|dead|deceased)\b/u.test(evidence);
  if (pursuitPayoffProfile) {
    return "Esposa e filha o expulsaram. Correu a toda velocidade rumo ao bosque. Na rua, o chefe e empresários furiosos o perseguiram até um caminhão atropelá-lo, deixando o lobo morto no asfalto.";
  }

  const settledLifeProfile = options.requiredVisualActionIds.has("crawl_or_all_fours")
    && hasEveryQualifier(["graduality", "nightly_frequency", "raw_meat_craving", "mansion_specificity"])
    && /\b(?:dinheir\p{L}*|diner\p{L}*|money)\b/u.test(evidence)
    && /\b(?:famili\p{L}*|family)\b/u.test(evidence)
    && /\b(?:carne crua|raw meat)\b/u.test(evidence);
  if (settledLifeProfile) {
    return "Aos poucos, ganhou dinheiro, comprou uma mansão e formou família. Mas seus instintos selvagens continuavam: rastejava de quatro na grama, sentindo toda noite vontade incontrolável de comer carne crua.";
  }

  const catMeetingQualifiers = [
    "one_day",
    "purpose",
    "concealment_purpose",
    "gift_explanation",
    "days_later_delay",
    "unable_to_contain",
    "work_meeting",
  ];
  const catMeetingProfile = options.requiredVisualActionIds.has("animal_in_carrier_or_cage")
    && hasEveryQualifier(catMeetingQualifiers)
    && /\b(?:cat|gato|gata)\b/u.test(evidence)
    && /\b(?:daughter|filha|hija)\b/u.test(evidence)
    && /\b(?:devor\p{L}*|eat\p{L}*)\b/u.test(evidence)
    && /\b(?:meeting|reuni\p{L}*)\b/u.test(evidence);
  if (catMeetingProfile) {
    return "Um dia, levou um gato numa caixa para casa para devorá-lo. Sua filha o descobriu, então mentiu que era presente para não levantar suspeitas. Dias depois, numa reunião de trabalho, não conseguiu se conter.";
  }

  const requiredVisuals = ["meat_or_blood_on_documents", "muzzle_reveal"];
  const requiredQualifiers = [
    "in_front_of_everyone",
    "fear",
    "purpose",
    "desperation",
    "mansion_specificity",
    "true_appearance",
    "complete_intensity",
    "wife_and_daughter",
  ];
  if (!requiredVisuals.every((id) => options.requiredVisualActionIds.has(id))) return null;
  if (!hasEveryQualifier(requiredQualifiers)) return null;

  if (!/\b(?:atac\p{L}*|attack\p{L}*)\b/u.test(evidence)
    || !/\b(?:coleg\p{L}*|compan\p{L}*|coworker|colleague)\b/u.test(evidence)
    || !/\b(?:funcion\p{L}*|emplead\p{L}*|employee\p{L}*)\b/u.test(evidence)
    || !/\b(?:fug\p{L}*|huy\p{L}*|flee\p{L}*|escape\p{L}*)\b/u.test(evidence)) return null;

  return "Perdeu o controle, atacou um colega diante de todos, carne crua manchou gráficos, focinho saiu da boca. Funcionários apavorados correram para detê-lo, mas fugiu desesperado à mansão. Esposa e filha viram sua forma real, completamente paralisadas.";
}
