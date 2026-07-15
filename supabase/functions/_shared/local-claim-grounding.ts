export type LocalClaimRisk =
  | "relationship"
  | "intent"
  | "editorial_conclusion"
  | "subject_attribution"
  | "collective_quantifier";

export interface LocalClaimGroundingMatch {
  id: string;
  risk: LocalClaimRisk;
  found: string;
  supported: boolean;
  support_reason: "explicit_local_evidence" | "local_evidence_negates_claim" | "explicit_local_support_missing";
}

export interface LocalClaimGroundingAssessment {
  required: true;
  passed: boolean;
  detected_claims: LocalClaimGroundingMatch[];
  unsupported_claim_ids: string[];
}

interface LocalClaimRule {
  id: string;
  risk: LocalClaimRisk;
  generated: RegExp;
  evidence: RegExp;
}

interface StructuredSubjectEvidence {
  subject_id: string;
  text: string;
  identity_tokens: string[];
  action_tokens: string[];
}

type BetrayalActor =
  | "woman"
  | "man"
  | "soldier"
  | "wife"
  | "husband"
  | "girlfriend"
  | "boyfriend";

interface DirectedBetrayalClaim {
  subject: BetrayalActor;
  object: BetrayalActor;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const SUBJECT_IDENTITY_WORDS = new Set([
  "adult", "adulta", "adulto", "barbado", "barbuda", "blanca", "blanco",
  "branca", "branco", "criança", "crianca", "garota", "garoto", "girl",
  "homem", "hombre", "jovem", "loira", "loiro", "man", "mecanica",
  "mecanico", "menina", "menino", "militar", "mulher", "mujer", "oficial",
  "rapaz", "soldada", "soldado", "soldier", "uniforme", "white", "woman",
]);

const SUBJECT_ACTION_STOP_WORDS = new Set([
  "agora", "ainda", "alguma", "algum", "antes", "aquele", "aquela", "aqui",
  "assim", "com", "como", "contra", "deixa", "depois", "dessa", "desse",
  "diante", "durante", "enquanto", "entao", "entre", "essa", "esse", "esta", "este",
  "fica", "ficam", "mais", "mesma", "mesmo", "muito", "nessa", "nesse",
  "outra", "outro", "para", "pela", "pelo", "perto", "porque", "quando",
  "sobre", "toda", "todo", "todos", "tudo", "uma", "umas", "with", "that",
  "this", "then", "while", "mientras", "from", "into", "toward", "towards", "junto",
  "juntos", "junto", "lado", "cena", "visivelmente", "parece", "revela",
  "verdade", "inesperada", "inesperado", "chocante", "local", "lugar",
]);

const CANONICAL_ACTION_TOKEN: Record<string, string> = {
  adult: "adulto", adulta: "adulto", adulto: "adulto",
  airplane: "plane", aviao: "plane", plane: "plane",
  ambas: "collective", ambos: "collective", both: "collective",
  baby: "baby", bebe: "baby",
  blonde: "loira", loira: "loira", loiro: "loira",
  branca: "branco", blanco: "branco", blanca: "branco", branco: "branco", white: "branco",
  caminha: "walk", caminham: "walk", caminhando: "walk", walk: "walk", walking: "walk",
  chora: "cry", choram: "cry", chorando: "cry", cries: "cry", crying: "cry",
  estende: "extend", estendem: "extend", estendendo: "extend", extends: "extend", extending: "extend",
  gravidez: "pregnancy", pregnancy: "pregnancy",
  homem: "homem", hombre: "homem", man: "homem",
  olha: "look", olham: "look", olhando: "look", observa: "look", observam: "look",
  observando: "look", look: "look", looks: "look", watches: "look", watching: "look",
  mao: "hand", mano: "hand", hand: "hand",
  mechanic: "mecanico", mecanica: "mecanico", mecanico: "mecanico",
  military: "soldado", militar: "soldado", soldada: "soldado", soldado: "soldado", soldier: "soldado",
  mujer: "mulher", mulher: "mulher", woman: "mulher",
  papeis: "paper", papel: "paper", papers: "paper",
  segura: "hold", seguram: "hold", segurando: "hold", holds: "hold", holding: "hold",
  sorri: "smile", sorriem: "smile", sorrindo: "smile", smile: "smile", smiles: "smile", smiling: "smile",
  teste: "test", test: "test",
  cima: "up", upward: "up", upwards: "up", up: "up",
  vida: "life", life: "life",
};

function normalizedTokens(value: unknown): string[] {
  return normalize(value)
    .replace(/[^a-z0-9\s]/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3 || token === "up")
    .map((token) => CANONICAL_ACTION_TOKEN[token] || token);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function collectStructuredEvidenceObjects(value: unknown, result: any[] = []): any[] {
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredEvidenceObjects(item, result);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  const record = value as Record<string, unknown>;
  if (String(record.subject_id || "").trim()) result.push(record);
  for (const nested of Object.values(record)) collectStructuredEvidenceObjects(nested, result);
  return result;
}

function parseStructuredSubjectEvidence(localEvidenceText: unknown): StructuredSubjectEvidence[] {
  let parsed: unknown = null;
  try {
    parsed = typeof localEvidenceText === "string" ? JSON.parse(localEvidenceText) : localEvidenceText;
  } catch {
    return [];
  }
  const grouped = new Map<string, string[]>();
  for (const record of collectStructuredEvidenceObjects(parsed)) {
    const subjectId = normalize(record?.subject_id);
    if (!subjectId || /^(?:unknown|null|none|na)$/u.test(subjectId)) continue;
    const text = [
      record?.description,
      record?.main_action,
      record?.evidence_text,
      record?.text_on_screen,
      subjectId.replace(/[_-]+/gu, " "),
    ].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
    grouped.set(subjectId, [...(grouped.get(subjectId) || []), text]);
  }
  return [...grouped.entries()].map(([subjectId, texts]) => {
    const text = normalize(texts.join(" "));
    const tokens = normalizedTokens(`${subjectId.replace(/[_-]+/gu, " ")} ${text}`);
    return {
      subject_id: subjectId,
      text,
      identity_tokens: unique(tokens.filter((token) => SUBJECT_IDENTITY_WORDS.has(token))),
      action_tokens: unique(tokens.filter((token) =>
        !SUBJECT_IDENTITY_WORDS.has(token) && !SUBJECT_ACTION_STOP_WORDS.has(token)
      )),
    };
  });
}

function localEvidenceStrings(localEvidenceText: unknown): string[] {
  let parsed: unknown = localEvidenceText;
  try {
    parsed = typeof localEvidenceText === "string" ? JSON.parse(localEvidenceText) : localEvidenceText;
  } catch {
    return [normalize(localEvidenceText)].filter(Boolean);
  }
  const values: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const text = normalize(value);
      if (text) values.push(text);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(parsed);
  return values;
}

function sentenceClauses(value: string): string[] {
  return normalize(value).split(/(?<=[.!?;:])\s+|\s+[—–-]\s+/u).map((item) => item.trim()).filter(Boolean);
}

function lastExplicitSubject(
  priorText: string,
  subjects: StructuredSubjectEvidence[],
): StructuredSubjectEvidence | null {
  let best: { subject: StructuredSubjectEvidence; score: number; last: number } | null = null;
  for (const subject of subjects) {
    const candidates = unique([
      ...subject.identity_tokens,
      ...normalizedTokens(subject.subject_id.replace(/[_-]+/gu, " "))
        .filter((token) => SUBJECT_IDENTITY_WORDS.has(token)),
    ]);
    const matches = candidates.flatMap((token) => {
      const index = priorText.lastIndexOf(token);
      return index >= 0 ? [{ token, index }] : [];
    });
    if (matches.length === 0) continue;
    const score = matches.length;
    const last = Math.max(...matches.map((match) => match.index));
    if (!best || score > best.score || (score === best.score && last > best.last)) {
      best = { subject, score, last };
    }
  }
  return best?.subject || null;
}

function actionOverlapScore(clause: string, subject: StructuredSubjectEvidence): number {
  const clauseTokens = unique(normalizedTokens(clause).filter((token) =>
    !SUBJECT_IDENTITY_WORDS.has(token)
      && !SUBJECT_ACTION_STOP_WORDS.has(token)
      && token !== "collective"
  ));
  return clauseTokens.filter((token) => subject.action_tokens.includes(token)).length;
}

const NAMED_COLLECTIVE_SUBJECT = /(?:a|o|uma|um|the)?\s*(?:mulher|homem|mecanica|mecanico|militar|oficial|soldada|soldado|garota|garoto|menina|menino|woman|man|mechanic|soldier|officer|girl|boy)\s+e\s+(?:(?:a|o|uma|um|the)\s+)?(?:mulher|homem|mecanica|mecanico|militar|oficial|soldada|soldado|garota|garoto|menina|menino|woman|man|mechanic|soldier|officer|girl|boy)/u;
const COLLECTIVE_PATTERN = new RegExp(
  `(?:\\b(?:ambos|ambas|os dois|as duas|os tres|as tres|todos eles|todas elas|juntos|juntas|both|both of them|the two|together)\\b|^(?:eles|elas)\\b|\\b(?:todos|todas)(?=\\s+(?!os?\\b|as?\\b)[a-z])|\\b${NAMED_COLLECTIVE_SUBJECT.source}\\b)`,
  "u",
);
const EXPLICIT_COLLECTIVE_EVIDENCE_PATTERN = new RegExp(
  `(?:\\b(?:ambos|ambas|os dois|as duas|os tres|as tres|todos eles|todas elas|juntos|juntas|both|both of them|the two|together|duas pessoas|dois adultos|duas adultas|two adults|dois animais|two animals)\\b|\\b${NAMED_COLLECTIVE_SUBJECT.source}\\b)`,
  "u",
);

/**
 * Deterministic, evidence-driven checks for two common multimodal role errors:
 * a pronoun inheriting an action that belongs to another stable subject_id,
 * and a collective action asserted without support for every participant.
 */
export function assessSubjectAttributionGrounding(options: {
  generatedText: unknown;
  localEvidenceText: unknown;
}): LocalClaimGroundingMatch[] {
  const generated = normalize(options.generatedText);
  const subjects = parseStructuredSubjectEvidence(options.localEvidenceText);
  if (!generated || subjects.length < 2) return [];
  const clauses = sentenceClauses(generated);
  const issues: LocalClaimGroundingMatch[] = [];

  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (/^(?:ele|ela|eles|elas)\b/u.test(clause) && index > 0) {
      const antecedent = lastExplicitSubject(clauses.slice(0, index).join(" "), subjects);
      if (antecedent) {
        const ranked = subjects
          .map((subject) => ({ subject, score: actionOverlapScore(clause, subject) }))
          .sort((left, right) => right.score - left.score);
        const strongest = ranked[0];
        const antecedentScore = ranked.find((item) => item.subject.subject_id === antecedent.subject_id)?.score || 0;
        if (strongest
          && strongest.subject.subject_id !== antecedent.subject_id
          && strongest.score >= 2
          && strongest.score >= antecedentScore + 2) {
          issues.push({
            id: "pronoun_subject_transfer",
            risk: "subject_attribution",
            found: clause,
            supported: false,
            support_reason: "explicit_local_support_missing",
          });
        }
      }
    }

    const collectiveMatch = clause.match(COLLECTIVE_PATTERN);
    if (!collectiveMatch) continue;
    // The collective marker may come before the action ("eles comemoram"),
    // after it ("seguram o bebe juntos") or be a coordinated subject
    // ("a mulher e o mecanico seguram"). Remove only the marker and audit the
    // complete remaining proposition so postposed "juntos" cannot hide the
    // unsupported shared action.
    const actionClause = clause.replace(COLLECTIVE_PATTERN, " ");
    const actionTokens = unique(normalizedTokens(actionClause).filter((token) =>
      !SUBJECT_ACTION_STOP_WORDS.has(token) && !SUBJECT_IDENTITY_WORDS.has(token) && token !== "collective"
    ));
    // A shared verb alone cannot prove a materially narrower proposition. For
    // example, "they both look happy" proves a collective look/expression, but
    // not "os dois olham para cima". When the generated action contains an
    // object, direction or state token, require that material complement too.
    const requiredActionOverlap = actionTokens.length > 0
      ? Math.min(2, actionTokens.length)
      : Number.POSITIVE_INFINITY;
    const explicitCollectiveAction = localEvidenceStrings(options.localEvidenceText)
      // A comma can change the acting subject inside one long frame
      // description. Keep the collective quantifier and action in the same
      // short evidence clause instead of borrowing an action after a comma.
      .flatMap((value) => sentenceClauses(value).flatMap((item) => item.split(/\s*,\s*/u)))
      .some((evidenceClause) => {
        if (!EXPLICIT_COLLECTIVE_EVIDENCE_PATTERN.test(evidenceClause)) return false;
        const evidenceTokens = new Set(normalizedTokens(evidenceClause));
        const overlap = actionTokens.filter((token) => evidenceTokens.has(token)).length;
        return overlap >= requiredActionOverlap;
      });
    const supportedSubjects = subjects.filter((subject) =>
      actionOverlapScore(actionClause, subject) >= requiredActionOverlap
    );
    if (!explicitCollectiveAction && supportedSubjects.length < 2) {
      issues.push({
        id: "collective_action_not_grounded_for_each_subject",
        risk: "collective_quantifier",
        found: clause,
        supported: false,
        support_reason: "explicit_local_support_missing",
      });
    }
  }
  return issues;
}

const BETRAYAL_ACTOR_SOURCE = [
  "mulher", "mujer", "woman",
  "homem", "hombre", "man",
  "soldado", "soldier",
  "esposa", "wife",
  "marido", "esposo", "husband",
  "namorada", "novia", "girlfriend",
  "namorado", "novio", "boyfriend",
].join("|");

const DIRECTED_BETRAYAL_PATTERN = new RegExp(
  `\\b(?:o|a|um|uma|el|la|un|una|the|seu|sua|su)?\\s*(${BETRAYAL_ACTOR_SOURCE})`
    + `\\s+(?:traiu|traia|traindo|traiciono|enganou|betrayed|cheated\\s+on)`
    + `\\s+(?:o|a|um|uma|ao|aos|el|la|al|un|una|the|seu|sua|su)?\\s*(${BETRAYAL_ACTOR_SOURCE})\\b`,
  "gu",
);

function canonicalBetrayalActor(value: string): BetrayalActor | null {
  if (/^(?:mulher|mujer|woman)$/u.test(value)) return "woman";
  if (/^(?:homem|hombre|man)$/u.test(value)) return "man";
  if (/^(?:soldado|soldier)$/u.test(value)) return "soldier";
  if (/^(?:esposa|wife)$/u.test(value)) return "wife";
  if (/^(?:marido|esposo|husband)$/u.test(value)) return "husband";
  if (/^(?:namorada|novia|girlfriend)$/u.test(value)) return "girlfriend";
  if (/^(?:namorado|novio|boyfriend)$/u.test(value)) return "boyfriend";
  return null;
}

function directedBetrayalClaims(value: string): DirectedBetrayalClaim[] {
  return [...value.matchAll(new RegExp(DIRECTED_BETRAYAL_PATTERN.source, DIRECTED_BETRAYAL_PATTERN.flags))]
    .flatMap((match) => {
      const subject = canonicalBetrayalActor(String(match[1] || ""));
      const object = canonicalBetrayalActor(String(match[2] || ""));
      return subject && object ? [{ subject, object }] : [];
    });
}

/**
 * A directed allegation needs the same subject/object direction in local
 * evidence. A bare keyword or the inverse allegation is not factual support.
 */
export function hasMatchingDirectedBetrayal(
  generatedText: unknown,
  evidenceText: unknown,
): boolean {
  const generatedClaims = directedBetrayalClaims(normalize(generatedText));
  if (generatedClaims.length === 0) return true;
  const evidenceClaims = directedBetrayalClaims(normalize(evidenceText));
  return generatedClaims.every((generated) => evidenceClaims.some((evidence) =>
    evidence.subject === generated.subject && evidence.object === generated.object
  ));
}

// These rules deliberately require literal, same-slot support. Seeing two
// adults and a baby, an offered hand, a uniform or an emotional reaction does
// not by itself establish a family, romance, mission, motive or symbolic
// conclusion. Translated equivalents are accepted because the operational
// evidence can be Portuguese, Spanish or English.
const LOCAL_CLAIM_RULES: LocalClaimRule[] = [
  {
    id: "family_relation",
    risk: "relationship",
    generated: /\b(?:familia|familias|nova familia|formaram? (?:uma )?familia)\b/gu,
    evidence: /\b(?:familia|familias|family|families)\b/gu,
  },
  {
    id: "mother_relation",
    risk: "relationship",
    generated: /\b(?:mae|mamae|virou (?:a )?mae|se tornou (?:a )?mae)\b/gu,
    evidence: /\b(?:mae|mamae|madre|mama|mother|mom)\b/gu,
  },
  {
    id: "father_relation",
    risk: "relationship",
    generated: /\b(?:pai|papai|virou (?:o )?pai|se tornou (?:o )?pai)\b/gu,
    evidence: /\b(?:pai|papai|padre|papa|father|dad)\b/gu,
  },
  {
    id: "child_relation",
    risk: "relationship",
    generated: /\bfilh[oa]s?\b/gu,
    evidence: /\b(?:filh[oa]s?|hij[oa]s?|son|daughter)\b/gu,
  },
  {
    id: "shared_baby_relation",
    risk: "relationship",
    generated: /\b(?:(?:o |a )?bebe (?:deles|dos dois|do casal)|(?:o |a )?filh[oa] (?:deles|dos dois|do casal))\b/gu,
    evidence: /\b(?:(?:o |a )?bebe (?:deles|dos dois|do casal)|(?:o |a )?filh[oa] (?:deles|dos dois|do casal)|su bebe|su hij[oa]|their baby|their child|their son|their daughter)\b/gu,
  },
  {
    id: "parenting_outcome",
    risk: "relationship",
    generated: /\b(?:assumiu (?:o|a|essa|esse)?\s*(?:bebe|crianca)|passou a criar (?:o|a|um|uma)?\s*(?:bebe|crianca)|criaram (?:o|a|um|uma)?\s*(?:bebe|crianca)(?: juntos?)?)\b/gu,
    evidence: /\b(?:assumiu (?:o|a|essa|esse)?\s*(?:bebe|crianca)|passou a criar (?:o|a|um|uma)?\s*(?:bebe|crianca)|criaram (?:o|a|um|uma)?\s*(?:bebe|crianca)(?: juntos?)?|asumio (?:al|el|la)?\s*(?:bebe|nino|nina)|raised? (?:the|a)?\s*(?:baby|child)|started raising (?:the|a)?\s*(?:baby|child))\b/gu,
  },
  {
    id: "couple_relation",
    risk: "relationship",
    generated: /\b(?:casal|casais|viraram? (?:um )?casal)\b/gu,
    evidence: /\b(?:casal|casais|pareja|parejas|couple|couples)\b/gu,
  },
  {
    id: "wife_relation",
    risk: "relationship",
    generated: /\b(?:esposa|mulher dele|sua mulher)\b/gu,
    evidence: /\b(?:esposa|mujer de el|su mujer|wife)\b/gu,
  },
  {
    id: "husband_relation",
    risk: "relationship",
    generated: /\b(?:marido|esposo)\b/gu,
    evidence: /\b(?:marido|esposo|husband)\b/gu,
  },
  {
    id: "girlfriend_relation",
    risk: "relationship",
    generated: /\b(?:namorada|noiva)\b/gu,
    evidence: /\b(?:namorada|noiva|novia|girlfriend|fiancee)\b/gu,
  },
  {
    id: "boyfriend_relation",
    risk: "relationship",
    generated: /\b(?:namorado|noivo)\b/gu,
    evidence: /\b(?:namorado|noivo|novio|boyfriend|fiance)\b/gu,
  },
  {
    id: "lover_relation",
    risk: "relationship",
    generated: /\b(?:amante|amantes)\b/gu,
    evidence: /\b(?:amante|amantes|lover|lovers|mistress)\b/gu,
  },
  {
    id: "romantic_relation",
    risk: "relationship",
    generated: /\b(?:se apaixon(?:ou|aram)|comecaram? a namorar|romance|relacionamento amoroso|ficaram juntos como casal|novo amor)\b/gu,
    evidence: /\b(?:se apaixon(?:ou|aram)|enamor(?:o|aron|ado|ada|andose)|fell in love|started dating|romance|relacionamento amoroso|romantic relationship|novo amor|new love)\b/gu,
  },
  {
    id: "new_partner_relation",
    risk: "relationship",
    generated: /\b(?:nov[oa] parceir[oa]|nov[oa] companheir[oa]|parceir[oa] romantic[oa])\b/gu,
    evidence: /\b(?:nov[oa] parceir[oa]|nov[oa] companheir[oa]|parceir[oa] romantic[oa]|nuev[oa] parej[oa]|new partner|new companion|romantic partner)\b/gu,
  },
  {
    id: "betrayal_relation",
    risk: "relationship",
    generated: /\b(?:traicao|traiu|traindo|infiel|corn[oa])\b/gu,
    evidence: /\b(?:traicao|traiu|traindo|infiel|corn[oa]|betrayal|cheat(?:ed|ing)?|infidelity)\b/gu,
  },
  {
    id: "helping_hand_conclusion",
    risk: "editorial_conclusion",
    generated: /\b(?:mao amiga|uma mao que a acolheu|uma mao que o acolheu)\b/gu,
    evidence: /\b(?:mao amiga|mano amiga|helping hand)\b/gu,
  },
  {
    id: "help_intent_conclusion",
    risk: "intent",
    generated: /\b(?:(?:para|pra) (?:oferecer|dar|prestar) ajuda(?: imediata)?|oferece(?:u|r|ndo)? ajuda(?: imediata)?|tent(?:ou|ava) ajudar|foi ajudar|ajud(?:ou|ava|ando))\b/gu,
    evidence: /\b(?:ajuda(?: imediata)?|ajud(?:ou|ava|ando|ar)|auxili(?:ou|ava|ando|ar)|ayud(?:a|ar|o|ando)|help(?:ed|ing)?|offers? help|offering help|to help|assistance)\b/gu,
  },
  {
    id: "emotional_support_conclusion",
    risk: "editorial_conclusion",
    generated: /\b(?:acolh(?:eu|er|endo|id[oa])|se sentiu acolhid[oa]|confort(?:ar|ava|ou|ando|a-la|a-lo)|preocupacao genuina|apoio emocional)\b/gu,
    evidence: /\b(?:acolh(?:eu|er|endo|id[oa])|acogid[oa]|welcomed|confort(?:ar|ava|ou|ando|a-la|a-lo)|consol(?:ar|ou|ando)|comfort(?:ed|ing)?|preocupacao genuina|genuine concern|apoio emocional|emotional support)\b/gu,
  },
  {
    id: "unexpected_private_life_filler",
    risk: "editorial_conclusion",
    generated: /\b(?:um |o )?lado (?:inesperado|desconhecido|surpreendente) (?:da |de )?(?:sua |dele |dela )?(?:vida )?(?:cotidiana|pessoal|particular)(?: agora)?\b/gu,
    evidence: /\b(?:um |o )?lado (?:inesperado|desconhecido|surpreendente|unexpected|unknown|surprising) (?:da |de |of )?(?:sua |dele |dela |his |her )?(?:vida |life )?(?:cotidiana|pessoal|particular|everyday|private|personal)(?: agora| now)?\b/gu,
  },
  {
    id: "omniscient_scene_observation_filler",
    risk: "editorial_conclusion",
    generated: /\b(?:observa|observou|observando|olha|olhou|olhando|acompanha|acompanhou) (?:a )?cena (?:toda|inteira|por completo)\b/gu,
    evidence: /\b(?:observa|observou|observando|olha|olhou|olhando|acompanha|acompanhou|watches|watched|watching|observes|observed) (?:a |the )?cena (?:toda|inteira|por completo|whole|entire)\b/gu,
  },
  {
    id: "determination_conclusion",
    risk: "editorial_conclusion",
    generated: /\b(?:determinacao|determinad[oa])\b/gu,
    evidence: /\b(?:determinacao|determinad[oa]|determinacion|determined)\b/gu,
  },
  {
    id: "defiant_gaze_conclusion",
    risk: "editorial_conclusion",
    generated: /\b(?:olhar(?:es)? desafiador(?:es|as)?|encar(?:a|ou|ava|ando) de forma desafiadora|desafi(?:a|ou|ava|ando) com o olhar)\b/gu,
    evidence: /\b(?:olhar(?:es)? desafiador(?:es|as)?|mirada(?:s)? desafiante(?:s)?|defiant (?:look|looks|gaze|glance|glances)|challenging (?:look|looks|gaze|glance|glances)|encar(?:a|ou|ava|ando) de forma desafiadora|desafi(?:a|ou|ava|ando) com o olhar)\b/gu,
  },
  {
    id: "hope_or_new_beginning_conclusion",
    risk: "editorial_conclusion",
    generated: /\b(?:esperanca|novo comeco|nova vida juntos?)\b/gu,
    evidence: /\b(?:esperanca|esperanza|hope|hopeful|novo comeco|nuevo comienzo|new beginning|nova vida juntos?|new life together)\b/gu,
  },
  {
    id: "mission_claim",
    risk: "intent",
    generated: /\b(?:missao|missoes)\b/gu,
    evidence: /\b(?:missao|missoes|mision|misiones|mission|missions)\b/gu,
  },
  {
    id: "plan_claim",
    risk: "intent",
    generated: /\b(?:plano(?! de fundo)|planos|planej(?:ava|ou|ado|ada)|tinha planos?)\b/gu,
    evidence: /\b(?:plano(?! de fundo)|planos|planej(?:ava|ou|ado|ada)|plan(?:eaba|eo|ifico|ned|ning)?|plans?)\b/gu,
  },
  {
    id: "motive_claim",
    risk: "intent",
    generated: /\b(?:(?:o|esse|um) motivo (?:era|foi|seria)|motiv(?:o|ada|ado) por|a intencao (?:era|foi)|pretend(?:e|ia|eu|endo))\b/gu,
    evidence: /\b(?:motivo|motiv(?:ada|ado) por|intencao|intencion|intention|motive|pretend(?:e|ia|eu|endo)|intended|intento)\b/gu,
  },
  {
    id: "deception_intent",
    risk: "intent",
    generated: /\b(?:para|pra|tent(?:ou|ava) (?:de|a)?) (?:enganar|iludir|manipular)\b/gu,
    evidence: /\b(?:enganar|iludir|manipular|enganar|engano|deceive|deceived|deception|trick(?:ed|ing)?)\b/gu,
  },
  {
    id: "editorial_proof_conclusion",
    risk: "editorial_conclusion",
    generated: /\b(?:provando|mostrando|demonstrando) que\b[^.!?;]{0,140}\b(?:funcion(?:a|ava|ou|aria)|deu certo|da certo|valeu a pena|era a escolha certa|foi a escolha certa)\b/gu,
    evidence: /\b(?:provando|mostrando|demonstrando|demostrando|proving|showing|demonstrating)\s+(?:que|that)\b[^.!?;]{0,140}\b(?:funcion(?:a|ava|ou|aria)|deu certo|da certo|valeu a pena|worked|works|worth it|eleccion correcta)\b/gu,
  },
  {
    id: "prior_slot_identity_claim",
    risk: "editorial_conclusion",
    generated: /\b(?:(?:o|a) mesm[oa] (?:homem|mulher|soldado|oficial|mecanico|mecanica)|(?:homem|mulher|soldado|oficial|mecanico|mecanica) que .{0,70}(?:antes|no inicio|la no inicio|daquela vez))\b/gu,
    evidence: /\b(?:(?:o|a) mesm[oa]|(?:the|that) same|(?:el|la) mism[oa]|que .{0,70}(?:antes|no inicio|la no inicio|daquela vez|earlier|at the beginning|al principio))\b/gu,
  },
];

function supportState(evidence: string, rule: LocalClaimRule): "supported" | "negated" | "missing" {
  const matches = [...evidence.matchAll(new RegExp(rule.evidence.source, rule.evidence.flags))];
  if (matches.length === 0) return "missing";
  let sawNegated = false;
  for (const match of matches) {
    const index = Number(match.index || 0);
    const prefix = evidence.slice(Math.max(0, index - 48), index);
    const negated = /\b(?:nao|nunca|jamais|sem|no|not|never|without)\b[^.!?;:]{0,42}$/u.test(prefix);
    if (!negated) return "supported";
    sawNegated = true;
  }
  return sawNegated ? "negated" : "missing";
}

export function assessLocalClaimGrounding(options: {
  generatedText: unknown;
  /** Only evidence_text, local transcript and local OCR for this exact slot. */
  localEvidenceText: unknown;
}): LocalClaimGroundingAssessment {
  const generated = normalize(options.generatedText);
  const localEvidence = normalize(options.localEvidenceText);
  const patternClaims = LOCAL_CLAIM_RULES.flatMap((rule): LocalClaimGroundingMatch[] => {
    const matches = [...generated.matchAll(new RegExp(rule.generated.source, rule.generated.flags))];
    if (matches.length === 0) return [];
    let state = supportState(localEvidence, rule);
    if (rule.id === "betrayal_relation"
      && state === "supported"
      && !hasMatchingDirectedBetrayal(generated, localEvidence)) {
      state = "missing";
    }
    return matches.map((match) => ({
      id: rule.id,
      risk: rule.risk,
      found: String(match[0] || "").trim(),
      supported: state === "supported",
      support_reason: state === "supported"
        ? "explicit_local_evidence"
        : state === "negated"
        ? "local_evidence_negates_claim"
        : "explicit_local_support_missing",
    }));
  });
  const attributionClaims = assessSubjectAttributionGrounding(options);
  const detectedClaims = [...patternClaims, ...attributionClaims];
  const unsupportedIds = [...new Set(
    detectedClaims.filter((claim) => !claim.supported).map((claim) => claim.id),
  )];
  return {
    required: true,
    passed: unsupportedIds.length === 0,
    detected_claims: detectedClaims,
    unsupported_claim_ids: unsupportedIds,
  };
}

export const LOCAL_CLAIM_GROUNDING_WRITER_RULES = [
  "A relationship or relationship outcome is a fact, not a stylistic flourish. Use family, couple, spouse, dating, lover, betrayal, mother, father, son or daughter wording only when this exact block's evidence_text, transcript or OCR states it explicitly.",
  "Two adults holding or standing beside a baby prove only those visible actions. Never turn that image into parenthood, 'their baby', 'became a mother/father', adoption, assuming the child or raising the baby unless the same block states it explicitly.",
  "An offered hand proves only an offered hand. It does not prove a helping hand, emotional welcome, comfort, love or a new family unless this exact block's local evidence says so.",
  "Extending a hand does not prove an offer of help, immediate assistance or an intent to help. Likewise, exchanged or stern glances do not prove defiant/challenging looks unless this exact block explicitly states the help or defiance.",
  "Mission, plan, motive, deception intent, determination, hope and a new beginning require explicit support inside the same block. Never import them from an earlier or later slot.",
  "Never append 'provando/mostrando que isso funcionou/deu certo/valeu a pena' as a payoff moral unless the same-slot transcript or OCR explicitly states that conclusion. End on the evidenced concrete outcome instead.",
  "Keep each action attached to its stable subject_id. After naming more than one character, never use a pronoun to transfer another subject's action or object. Repeat the exact visible descriptor when needed to keep roles unambiguous.",
  "Collective claims such as both, the two or all of them require the local evidence to state that action for both/every participant, or separate evidence with that same action for each subject_id.",
  "Do not pad a block with interpretive phrases about an unexpected/private side of someone's everyday life or someone observing the whole scene unless the local evidence literally supports that conclusion.",
] as const;
