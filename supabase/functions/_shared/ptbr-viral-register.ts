import { hasMatchingDirectedBetrayal } from "./local-claim-grounding.ts";

export interface ConversationalRegisterAssessment {
  required: boolean;
  passed: boolean;
  formal_terms: Array<{ id: string; found: string; preferred: string }>;
}

export interface SafePtBrRegisterRepair {
  required: boolean;
  changed: boolean;
  text: string;
  replacements: Array<{ id: string; found: string; replacement: string }>;
}

export interface GroundedControversyAssessment {
  required: boolean;
  passed: boolean;
  detected_claims: Array<{
    id: string;
    risk: "behavioral_opinion" | "sensitive_allegation";
    found: string;
    supported: boolean;
    support_reason: string;
  }>;
  unsupported_claim_ids: string[];
}

const FORMAL_REGISTER_RULES = [
  { id: "caused_that_calque", pattern: /\b(?:e\s+)?isso causou que\b/giu, preferred: "por isso" },
  {
    id: "promoting_pronoun_awkward",
    pattern: /\b(?:acab(?:ou|ava)\s+)?promovendo\s+(?:ele|ela)\b/giu,
    preferred: "ele/ela virou [cargo] / o chefe deu o cargo para ele/ela",
  },
  { id: "immediately", pattern: /\bimediatamente\b/giu, preferred: "na mesma hora / assim que" },
  { id: "performed_experiment_formal", pattern: /\brealizou um experimento\b/giu, preferred: "fez um experimento" },
  { id: "show_formal", pattern: /\b(?:exibe|exibiu|exibia|exibir)\b/giu, preferred: "mostra / mostrou / mostrar" },
  { id: "abstract_consequence_question", pattern: /\bqual\s+(?:(?:e|é)\s+)?a\s+consequ[eê]ncia\b/giu, preferred: "o que isso vai mudar? / o que isso vai causar?" },
  { id: "food_container_formal", pattern: /\brecipiente de comida\b/giu, preferred: "pote de comida / comida" },
  { id: "continuous_medicine_formal", pattern: /\bmedicamentos? cont[ií]nuos?\b/giu, preferred: "remédio / remédios" },
  { id: "living_condition_formal", pattern: /\bcondi[cç][aã]o em que (?:viviam|vivem|vivia)\b/giu, preferred: "situação / jeito em que viviam" },
  { id: "reports_formal", pattern: /\bdivulgaram reportagens\b/giu, preferred: "espalharam a notícia" },
  { id: "formal_protest_chain", pattern: /\bprovocando manifesta[cç][oõ]es que condenavam\b/giu, preferred: "e isso gerou protestos contra" },
  { id: "without_supervision_formal", pattern: /\bsem supervis[aã]o\b/giu, preferred: "sozinho / sozinhos" },
  { id: "buried_dirt_mound_awkward", pattern: /\bmonte de terra enterrad[oa]\b/giu, preferred: "monte de terra / túmulo" },
  { id: "intrigued", pattern: /\bintrigad[oa]s?\b/giu, preferred: "curioso / querendo entender" },
  { id: "subsequently", pattern: /\bposteriormente\b/giu, preferred: "depois" },
  { id: "consequently", pattern: /\bconsequentemente\b/giu, preferred: "por isso" },
  { id: "however_formal", pattern: /\b(?:entretanto|contudo|todavia)\b/giu, preferred: "mas / só que" },
  { id: "gradually_formal", pattern: /\b(?:gradualmente|progressivamente)\b/giu, preferred: "aos poucos / com o tempo" },
  { id: "ascend_formal", pattern: /\b(?:ascender|ascendeu|ascendido)\b/giu, preferred: "subir de cargo / ser promovido" },
  { id: "entered_formal", pattern: /\b(?:adentrou|adentrar)\b/giu, preferred: "entrou" },
  { id: "returned_formal", pattern: /\b(?:retornou|retornar)\b/giu, preferred: "voltou / devolveu (conforme o sentido)" },
  { id: "acquired_formal", pattern: /\b(?:adquiriu|adquirir)\b/giu, preferred: "comprou / conseguiu" },
  { id: "saw_formal", pattern: /\b(?:avistou|avistar)\b/giu, preferred: "viu / ver" },
  { id: "asked_formal", pattern: /\b(?:indagou|indagar)\b/giu, preferred: "perguntou / perguntar" },
  { id: "said_formal", pattern: /\b(?:proferiu|proferir)\b/giu, preferred: "falou / dizer" },
  { id: "lived_formal", pattern: /\b(?:residia|residir)\b/giu, preferred: "morava / morar" },
  { id: "persisted_formal", pattern: /\b(?:persistia|persistiram|persistiu|persistir)\b/giu, preferred: "continuava / continuaram" },
  { id: "remained_formal", pattern: /\b(?:permanece|permanecem|permanecia|permaneceram|permaneceu|permanecer)\b/giu, preferred: "fica / ficam / continuava / ficou / ainda era" },
  { id: "objective_phrase_formal", pattern: /\bcom o objetivo de\b/giu, preferred: "para" },
  { id: "purpose_phrase_formal", pattern: /\bcom o prop[oó]sito de\b/giu, preferred: "para" },
  { id: "awaken_formal", pattern: /\b(?:despertar|despertava|despertou)\b/giu, preferred: "acordar / acordava / acordou" },
  { id: "prolong_formal", pattern: /\b(?:prolongar|prolongava|prolongou)\b/giu, preferred: "ficar mais / dormir mais / durar mais (conforme o sentido)" },
  { id: "workday_formal", pattern: /\bexpediente\b/giu, preferred: "trabalho" },
  { id: "attended_formal", pattern: /\b(?:compareceu|comparecer)\b/giu, preferred: "foi / ir" },
  { id: "enclitic_drag_formal", pattern: /\b(?:arrastava|arrastou|arrastando)-se\b/giu, preferred: "se arrastava / se arrastou / se arrastando" },
  { id: "enclitic_get_up_formal", pattern: /\blevantar-se\b/giu, preferred: "se levantar" },
  { id: "enclitic_promote_formal", pattern: /\bpromov[eê]-l[oa]s?\b/giu, preferred: "promover ele/ela / dar o cargo para ele/ela" },
  { id: "synthetic_future_arrive_formal", pattern: /\bchegar[aá]\b/giu, preferred: "vai chegar" },
  { id: "biological_fusion_formal", pattern: /\bfus[aã]o biol[oó]gica\b/giu, preferred: "corpos costurados / juntar os dois no mesmo corpo" },
  {
    id: "biological_viability_formal",
    pattern: /\bviabilidade biol[oó]gica\b/giu,
    preferred: "será que esse corpo costurado ia aguentar? / o que aconteceria com esse corpo costurado?",
  },
  {
    id: "generic_creature_risk_hook",
    pattern: /\bqual\s+(?:(?:e|é)\s+)?o\s+risco\s+(?:dess[ae]|daquel[ae])\s+(?:criatura|corpo|animal)\b/giu,
    preferred: "será que esse corpo costurado ia aguentar? / o que aconteceria com esse corpo costurado?",
  },
  { id: "by_means_of_formal", pattern: /\bpor meio de\b/giu, preferred: "com / usando" },
  {
    id: "biological_organism_formal",
    pattern: /\borganismos?\b(?!\s+(?:p[uú]blicos?|internacionais?|governamentais?|reguladores?|federais?|estaduais?|municipais?|estatais?|oficiais?|multilaterais?|intergovernamentais?|da\s+administra[cç][aã]o\s+p[uú]blica|de\s+(?:governo|estado|fiscaliza[cç][aã]o|regula[cç][aã]o)|das\s+na[cç][oõ]es\s+unidas))/giu,
    preferred: "corpo / corpos",
  },
  { id: "before_the_press_formal", pattern: /\bdiante da imprensa\b/giu, preferred: "para os jornalistas / na frente dos jornalistas" },
  { id: "resulting_formal", pattern: /\bresultando(?:\s+em)?\b/giu, preferred: "e isso causou / e terminou em" },
  {
    id: "feline_noun_formal",
    pattern: /\b(?:(?:o|um|do|ao|no|desse|daquele)\s+felino|(?:os|uns|dos|aos|nesses|naqueles)\s+felinos)\b/giu,
    preferred: "gato / gatos",
  },
  {
    id: "conflict_installed_formal",
    pattern: /\b(?:o|a)\s+(?:conflito|tens[aã]o|medo|caos|revolta|confus[aã]o|problema|briga|viol[eê]ncia)\s+(?:finalmente\s+)?se instalou\b/giu,
    preferred: "começou / tomou conta",
  },
  {
    id: "conflict_emerging_filler",
    pattern: /\b(?:o|a)\s+(?:conflito|tens[aã]o|caos|confus[aã]o|problema|briga)\s+come[cç]ou\s+a\s+surgir\b/giu,
    preferred: "remova o filler e termine no último fato local comprovado",
  },
  {
    id: "routine_summary_filler",
    pattern: /\bbuscava\s+(?:descanso|conforto|facilidade)\s+em\s+cada\s+(?:momento|parte)\s+da\s+rotina\b/giu,
    preferred: "diga a ação concreta mostrada nessa parte, sem resumir a personalidade",
  },
  {
    id: "unique_style_summary_filler",
    pattern: /\bmantendo\s+(?:seu|o)\s+(?:estilo|jeito)\s+(?:[uú]nico|peculiar)(?:\s+de\s+se\s+\p{L}+)?(?:\s+sempre)?\b/giu,
    preferred: "diga a ação concreta seguinte, sem elogio ou resumo genérico",
  },
  {
    id: "unexpected_charm_summary_filler",
    pattern: /\b(?:seu|esse|aquele)\s+jeito\s+peculiar\s+(?:tinha|tem|teve)\s+um\s+charme\s+inesperado\b/giu,
    preferred: "termine no comportamento e na reação visível, sem conclusão abstrata",
  },
  {
    id: "physical_inertia_summary_filler",
    pattern: /\b(?:mantendo|seguindo)\s+(?:sua|a)\s+(?:rotina|postura)\s+de\s+(?:total\s+)?in[eé]rcia(?:\s+f[ií]sica)?\b/giu,
    preferred: "diga a posição ou ação concreta mostrada, sem resumir como inércia",
  },
  {
    id: "unique_way_payoff_filler",
    pattern: /\b(?:ap[oó]s|depois de)\s+verem\s+(?:seu|o)\s+jeito\s+(?:[uú]nico|peculiar|inusitado)\b/giu,
    preferred: "diga a reação visível ou falada, sem concluir com 'jeito único'",
  },
  { id: "aircraft_story_formal", pattern: /\baeronaves?\b/giu, preferred: "avião / aviões" },
  {
    id: "thought_bubble_redundancy",
    pattern: /\brevelando em (?:seus|os) pensamentos que (?:ele|ela) (?:cozinha|cozinhava|est[aá] cozinhando) na cozinha\b/giu,
    preferred: "um balão mostra ele/ela cozinhando",
  },
] as const;

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function assessPtBrConversationalRegister(
  generatedText: unknown,
  targetLanguage: unknown,
  localEvidenceText?: unknown,
): ConversationalRegisterAssessment {
  const required = /^pt(?:-br)?$/i.test(String(targetLanguage || "pt").trim());
  if (!required) return { required: false, passed: true, formal_terms: [] };
  const text = String(generatedText ?? "");
  const formalTerms: Array<{ id: string; found: string; preferred: string }> = FORMAL_REGISTER_RULES.flatMap((rule) => {
    const matches = [...text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))];
    return matches.map((match) => ({
      id: rule.id,
      found: String(match[0] || "").toLowerCase(),
      preferred: rule.preferred,
    }));
  });
  const generatedNormalized = normalized(text);
  const evidenceNormalized = normalized(localEvidenceText);
  const officeContext = /\b(?:office|office building|office desk|escritorio|predio de escritorios?)\b/u.test(evidenceNormalized);
  const workshopContext = /\b(?:workshop|repair shop|garage|mechanic shop|taller|oficina mecanica|conserto|reparo)\b/u.test(evidenceNormalized);
  if (/\boficina\b/u.test(generatedNormalized) && officeContext && !workshopContext) {
    formalTerms.push({
      id: "spanish_office_false_friend",
      found: "oficina",
      preferred: "escritório",
    });
  }
  return {
    required: true,
    passed: formalTerms.length === 0,
    formal_terms: formalTerms,
  };
}

/**
 * Applies only substitutions whose meaning is stable without model judgment.
 * Callers must always recalculate word contracts because a safe phrase repair
 * may shorten the text (for example, `por meio de` -> `com`).
 */
export function repairSafePtBrConversationalTerms(
  generatedText: unknown,
  targetLanguage: unknown,
): SafePtBrRegisterRepair {
  const required = /^pt(?:-br)?$/i.test(String(targetLanguage || "pt").trim());
  const source = String(generatedText ?? "");
  if (!required) return { required: false, changed: false, text: source, replacements: [] };

  const replacements: SafePtBrRegisterRepair["replacements"] = [];
  const preserveWordCase = (found: string, replacement: string): string => {
    const foundWords = found.match(/\p{L}+/gu) || [];
    const foundLetters = found.replace(/[^\p{L}]/gu, "");
    const entireSourceIsUpper = Boolean(foundLetters)
      && foundLetters === foundLetters.toLocaleUpperCase("pt-BR");
    let wordIndex = 0;
    return replacement.replace(/\p{L}+/gu, (word) => {
      const sourceWord = foundWords[wordIndex] || "";
      wordIndex += 1;
      if (entireSourceIsUpper) {
        return word.toLocaleUpperCase("pt-BR");
      }
      if (sourceWord && /^\p{Lu}/u.test(sourceWord)) {
        return `${word[0].toLocaleUpperCase("pt-BR")}${word.slice(1)}`;
      }
      return word;
    });
  };
  const replaceSafely = (value: string, pattern: RegExp, id: string, plainReplacement: string) =>
    value.replace(pattern, (found) => {
      const replacement = preserveWordCase(found, plainReplacement);
      replacements.push({ id, found, replacement });
      return replacement;
    });

  let text = replaceSafely(source, /\bpor meio de\b/giu, "by_means_of_formal", "com");
  text = replaceSafely(text, /\bimediatamente\b/giu, "immediately", "na mesma hora");
  text = replaceSafely(text, /\bposteriormente\b/giu, "subsequently", "depois");
  text = replaceSafely(text, /\bconsequentemente\b/giu, "consequently", "por isso");
  text = replaceSafely(text, /\b(?:entretanto|contudo|todavia)\b/giu, "however_formal", "mas");
  text = replaceSafely(text, /\bcom o prop[oó]sito de\b/giu, "purpose_phrase_formal", "para");
  text = replaceSafely(text, /\brealizou um experimento\b/giu, "performed_experiment_formal", "fez um experimento");
  text = replaceSafely(text, /\bexibe\b/giu, "show_formal", "mostra");
  text = replaceSafely(text, /\bexibiu\b/giu, "show_formal", "mostrou");
  text = replaceSafely(text, /\bexibia\b/giu, "show_formal", "mostrava");
  text = replaceSafely(text, /\bexibir\b/giu, "show_formal", "mostrar");
  text = replaceSafely(text, /\brecipiente de comida\b/giu, "food_container_formal", "pote de comida");
  text = replaceSafely(text, /\bmonte de terra enterrad[oa]\b/giu, "buried_dirt_mound_awkward", "monte de terra");
  const organismPattern = /\borganismos?\b(?!\s+(?:p[uú]blicos?|internacionais?|governamentais?|reguladores?|federais?|estaduais?|municipais?|estatais?|oficiais?|multilaterais?|intergovernamentais?|da\s+administra[cç][aã]o\s+p[uú]blica|de\s+(?:governo|estado|fiscaliza[cç][aã]o|regula[cç][aã]o)|das\s+na[cç][oõ]es\s+unidas))/giu;
  text = text.replace(organismPattern, (found) => {
    const normalizedFound = normalized(found);
    const plainReplacement = normalizedFound.endsWith("s") ? "corpos" : "corpo";
    const replacement = preserveWordCase(found, plainReplacement);
    replacements.push({ id: "biological_organism_formal", found, replacement });
    return replacement;
  });
  text = replaceSafely(text, /\bdo felino\b/giu, "feline_noun_formal", "do gato");
  text = replaceSafely(text, /\bo felino\b/giu, "feline_noun_formal", "o gato");

  return {
    required: true,
    changed: text !== source,
    text,
    replacements,
  };
}

const CONTROVERSY_RULES = [
  {
    id: "lazy_or_loafing",
    risk: "behavioral_opinion" as const,
    generated: /\b(?:preguicos[oa]s?|preguica|vagabundagem|vagabundos?|folgad[oa]s?)\b/giu,
    exactEvidence: /(?:\b(?:preguicos[oa]s?|preguica|vagabundagem|vagabundos?|folgad[oa]s?|lazy|laziness|perezos[oa]s?|pereza)\b|\b(?:(?:este|ese|aquel)\s+(?:hombre|mujer|chico|chica|nino|nina)|(?:el|ella))\s+(?:era|es|fue|estaba)\s+(?:tan\s+)?vag[oa]\b(?=.{0,140}\b(?:ganas|levantarse|acostad[oa]|caminar|trabajar)\b))/u,
    behavioralEvidence: /(?:\b(?:nao (?:quer|queria|quis) trabalhar|evit(?:a|ou|ava) trabalhar|fing(?:e|iu|ia) trabalhar|recus(?:a|ou|ava) (?:o )?trabalho|deixa (?:os )?outros trabalhando|nao ajuda enquanto (?:os )?outros trabalham|sem fazer nada durante (?:o )?(?:trabalho|expediente))\b|\b(?:deitad[oa]|dormindo|cochilando)\b.{0,90}\b(?:no trabalho|durante o expediente|na mesa do escritorio|enquanto (?:os )?outros trabalham)\b)/u,
    negatedEvidence: /\b(?:nao|no|nunca|jamais|not|never)\b.{0,32}\b(?:preguicos[oa]s?|preguica|vagabundagem|vagabundos?|folgad[oa]s?|lazy|laziness|perezos[oa]s?|pereza|vag[oa])\b/u,
  },
  {
    id: "betrayal",
    risk: "sensitive_allegation" as const,
    generated: /\b(?:traicao|traiu|traindo|infiel|amante|corn[oa])\b/giu,
    exactEvidence: /\b(?:traicao|traiu|traindo|infiel|amante|corn[oa]|betrayal|cheat(?:ed|ing)?|infidelity|engano amoroso)\b/u,
    behavioralEvidence: /(?:\b(?:beij(?:ou|ando)|ficou com|dormiu com|mao na perna (?:de|da|do)|na cama com|toque intimo)\b.{0,100}\b(?:outr[oa]|amante|homem|mulher)\b|\b(?:outr[oa]|amante|homem|mulher)\b.{0,100}\b(?:beij(?:ou|ando)|mao na perna|na cama|toque intimo)\b)/u,
    relationshipEvidence: /\b(?:namorad[oa]|noiv[oa]|espos[oa]|marido|parceir[oa]|companheir[oa]|casal)\b/u,
    negatedEvidence: /(?:\b(?:nao|no|nunca|jamais|not|never)\b.{0,32}\b(?:houve\s+)?(?:traicao|traiu|traindo|infiel|amante|betrayal|cheat(?:ed|ing)?|infidelity)\b|\bsem\s+(?:qualquer\s+)?traicao\b)/u,
  },
  {
    id: "sex_work",
    risk: "sensitive_allegation" as const,
    generated: /\b(?:era do job|do job|garota de programa|prostitut[ao]|prostituicao)\b/giu,
    exactEvidence: /\b(?:era do job|do job|garota de programa|prostitut[ao]|prostituicao|sex worker|sex work)\b/u,
    behavioralEvidence: /$a/u,
    negatedEvidence: /\b(?:nao|no|nunca|jamais|not|never)\b.{0,32}\b(?:era\s+)?(?:do job|garota de programa|prostitut[ao]|prostituicao|sex worker|sex work)\b/u,
  },
  {
    id: "cruel_experiment",
    risk: "behavioral_opinion" as const,
    generated: /\b(?:brincou de deus|experimento cruel|ideia absurda|loucura (?:do|da|desse|dessa|daquele|daquela)|foi longe demais|sobrevivencia forcada|erro fatal)\b/giu,
    exactEvidence: /\b(?:brincou de deus|experimento cruel|ideia absurda|loucura|cruel|sofrimento|erro fatal)\b/u,
    behavioralEvidence: /\b(?:costur(?:ou|ado|ada)|descarga eletrica|eletrocut(?:ou|ado|ada)|decompo|apodrec|mutil(?:ou|ado|ada)|tortur(?:ou|ado|ada)|sofrimento)\b/u,
    negatedEvidence: /(?:\b(?:nao|no|nunca|jamais|not|never)\b.{0,32}\b(?:foi\s+|era\s+|e\s+)?(?:experimento cruel|cruel|sofrimento|erro fatal)|\b(?:sem|without)\s+(?:qualquer\s+|any\s+)?(?:crueldade|sofrimento|dano|suffering|harm)\b)/u,
  },
  {
    id: "shameless_behavior",
    risk: "behavioral_opinion" as const,
    generated: /\b(?:cara de pau|sem[- ]?vergonha)\b/giu,
    exactEvidence: /\b(?:cara de pau|sem[- ]?vergonha|shameless)\b/u,
    behavioralEvidence: /(?:\bdorm(?:e|ia|iu|indo)\b.{0,60}\b(?:no trabalho|durante o expediente|na mesa do escritorio|enquanto (?:os )?outros trabalham)\b|\b(?:ele|ela|o homem|a mulher|o funcionario|a funcionaria)\s+(?:ment(?:e|ia|iu)|engan(?:a|ava|ou))\b|\b(?:foi|era)\s+flagrad[oa]\s+(?:mentindo|enganando|dormindo no trabalho)\b)/u,
    negatedEvidence: /\b(?:nao|no|nunca|jamais|not|never)\b.{0,32}\b(?:cara de pau|sem[- ]?vergonha|shameless|ment(?:e|ia|iu)|engan(?:a|ava|ou))\b/u,
  },
  {
    id: "murder_intent",
    risk: "sensitive_allegation" as const,
    generated: /\b(?:assassin(?:o|a|os|as|ou|aram|ato|atos|ada|ado)|matou de proposito|tirou a vida de proposito|homicid(?:io|ios|a|as))\b/giu,
    exactEvidence: /\b(?:assassin(?:o|a|os|as|ou|aram|ato|atos|ada|ado)|matou de proposito|tirou a vida de proposito|homicid(?:io|ios|a|as)|murderer|murdered intentionally)\b/u,
    behavioralEvidence: /$a/u,
  },
  {
    id: "sexualized_insult",
    risk: "sensitive_allegation" as const,
    generated: /\b(?:vagabunda|vadia)\b/giu,
    exactEvidence: /\b(?:vagabunda|vadia)\b/u,
    behavioralEvidence: /$a/u,
  },
  {
    id: "fraud_or_theft",
    risk: "sensitive_allegation" as const,
    generated: /\b(?:golpista|aplicou um golpe|deu um golpe|ladrao|ladra|roubou|furtou)\b/giu,
    exactEvidence: /\b(?:golpista|aplicou um golpe|deu um golpe|ladrao|ladra|roubou|furtou|scammer|thief|stole)\b/u,
    behavioralEvidence: /$a/u,
  },
  {
    id: "mental_health_label",
    risk: "sensitive_allegation" as const,
    generated: /\b(?:psicopata|sociopata)\b/giu,
    exactEvidence: /\b(?:psicopata|sociopata|psychopath|sociopath)\b/u,
    behavioralEvidence: /$a/u,
  },
] as const;

export function assessGroundedControversyClaims(options: {
  generatedText: unknown;
  /** Backward-compatible local action evidence. Never explicit proof for sensitive labels. */
  localEvidenceText?: unknown;
  /** Literal local transcript or OCR/on-screen text. */
  explicitEvidenceText?: unknown;
  /** Local visual actions/descriptions plus transcript, used for action/relationship support. */
  behavioralEvidenceText?: unknown;
  /** Video-level loaded labels that multimodal topic analysis found unsupported. */
  forbiddenLabels?: unknown;
}): GroundedControversyAssessment {
  // Controversy patterns are accent-insensitive so the same guard covers
  // "traição/traicao" and "preguiça/preguica" without fragile duplicates.
  const generatedText = normalized(options.generatedText);
  const behavioralEvidence = normalized(options.behavioralEvidenceText ?? options.localEvidenceText);
  const explicitEvidence = normalized(options.explicitEvidenceText);
  const allEvidence = `${explicitEvidence} ${behavioralEvidence}`.trim();
  const detectedClaims: GroundedControversyAssessment["detected_claims"] = CONTROVERSY_RULES.flatMap((rule) => {
    const matches = [...generatedText.matchAll(new RegExp(rule.generated.source, rule.generated.flags))];
    return matches.map((match) => {
      // A vision description such as "lazy man" or "roupa que parece do job"
      // is never literal proof of its own editorial label. Exact wording for
      // every claim family comes only from speech or OCR; visual descriptions
      // can support behavioral opinions solely through concrete actions.
      const exactCorpus = explicitEvidence;
      const negated = "negatedEvidence" in rule && rule.negatedEvidence.test(allEvidence);
      const directedBetrayalRequiresExplicitDirection = rule.id === "betrayal"
        && !hasMatchingDirectedBetrayal(generatedText, "");
      const betrayalDirectionSupported = rule.id !== "betrayal"
        || hasMatchingDirectedBetrayal(generatedText, explicitEvidence);
      const exact = !negated && betrayalDirectionSupported && rule.exactEvidence.test(exactCorpus);
      const behavior = !negated
        && !directedBetrayalRequiresExplicitDirection
        && rule.behavioralEvidence.test(behavioralEvidence);
      const relationship = "relationshipEvidence" in rule
        ? rule.relationshipEvidence.test(behavioralEvidence)
        : true;
      const supported = exact || (behavior && relationship);
      return {
        id: rule.id,
        risk: rule.risk,
        found: String(match[0] || "").toLowerCase(),
        supported,
        support_reason: negated
          ? "local_evidence_negates_claim"
          : exact
          ? "explicit_local_wording"
          : supported
          ? "explicit_local_behavior_and_relationship"
          : rule.risk === "sensitive_allegation"
          ? "sensitive_label_requires_explicit_local_support"
          : "behavioral_label_lacks_local_action_support",
      };
    });
  });
  const forbiddenLabels = Array.isArray(options.forbiddenLabels) ? options.forbiddenLabels : [];
  const forbiddenClaims = forbiddenLabels.flatMap((rawLabel) => {
    const label = normalized(rawLabel).slice(0, 80);
    if (label.length < 3) return [];
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const present = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "u").test(generatedText);
    return present
      ? [{
        id: `forbidden_label:${label}`,
        risk: "sensitive_allegation" as const,
        found: label,
        supported: false,
        support_reason: "forbidden_by_multimodal_topic_analysis",
      }]
      : [];
  });
  detectedClaims.push(...forbiddenClaims);
  const unsupportedIds = [...new Set(detectedClaims.filter((claim) => !claim.supported).map((claim) => claim.id))];
  return {
    required: true,
    passed: unsupportedIds.length === 0,
    detected_claims: detectedClaims,
    unsupported_claim_ids: unsupportedIds,
  };
}

export const PTBR_CONVERSATIONAL_WRITER_RULES = [
  "Write spoken Brazilian Portuguese with short everyday words and natural connective phrases.",
  "Never write the translation calques 'isso causou que' or 'acabou promovendo ele/ela'. Use 'por isso, ele/ela virou [cargo]' or 'o chefe deu o cargo para ele/ela'.",
  "Prefer 'na mesma hora/assim que' over 'imediatamente', 'curioso' over 'intrigado', 'depois' over 'posteriormente', 'por isso' over 'consequentemente', 'para' over 'com o objetivo de', 'acordar' over 'despertar', and 'mas/so que' over formal contrast words.",
  "Prefer spoken PT-BR pronoun order: write 'se levantar' instead of 'levantar-se' and 'promover ele/ela' or 'dar o cargo para ele/ela' instead of 'promove-lo/promove-la'.",
  "For everyday story narration, replace 'fusao biologica' with 'corpos costurados/juntar no mesmo corpo', never ask 'qual a viabilidade biologica' or 'qual o risco dessa criatura/corpo': when the opening visibly proves a stitched body, ask 'sera que esse corpo costurado ia aguentar?' or 'o que aconteceria com esse corpo costurado?', replace 'por meio de' with 'com/usando', biological 'organismo' with 'corpo', 'diante da imprensa' with 'para os jornalistas', 'resultando' with 'e isso causou/a briga terminou em', 'felino' with 'gato', 'aeronave' with 'aviao', 'permanece/permanecem' with 'fica/ficam', and conflict that 'se instalou' with 'comecou/tomou conta'.",
  "Never use transition filler such as 'o conflito comecou a surgir'. End on the last locally proven action/state or name the next concrete action only inside the slot where it occurs.",
  "Describe a visible thought bubble directly: write 'um balao mostra ele/ela cozinhando', never the formal and redundant 'revelando em seus pensamentos que ele/ela cozinha na cozinha'.",
  "When Spanish evidence says 'oficina' but the local frames show an office building, desks, computers or a meeting room, translate it as 'escritorio' in PT-BR; use 'oficina' only for a real workshop/repair setting.",
  "A popular criticism label may intensify a visible behavior, but it must be supported inside that block's local frames/transcript.",
  "Never infer betrayal, sex work, a romantic relationship, a crime or a hidden identity from appearance, clothing, music or reaction alone; sensitive labels require explicit local speech/on-screen text or an unambiguous locally evidenced relationship and action.",
] as const;
