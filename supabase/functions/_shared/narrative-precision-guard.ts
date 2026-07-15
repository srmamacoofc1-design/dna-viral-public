export type NarrativePrecisionIssueType =
  | "unsupported_duration_absolutizer"
  | "explicit_duration_qualifier_omitted"
  | "unsupported_direct_transition"
  | "cross_scene_locative_fusion"
  | "unsupported_no_getting_up_claim"
  | "adjacent_concrete_action_redundancy";

export interface NarrativePrecisionBlock {
  index: number;
  slot_type?: unknown;
  generated_text?: unknown;
  /** Evidence for this exact slot only: selected frames, local transcript and OCR. */
  local_evidence_text?: unknown;
}

export interface NarrativePrecisionIssue {
  type: NarrativePrecisionIssueType;
  rule_id: string;
  script_slot_index: number;
  related_slot_indexes: number[];
  found: string;
  support_reason: string;
  required_change: string;
  action_signature?: string;
}

export interface NarrativePrecisionAssessment {
  required: true;
  passed: boolean;
  issues: NarrativePrecisionIssue[];
  affected_block_indexes: number[];
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isHook(block: NarrativePrecisionBlock): boolean {
  return normalize(block.slot_type) === "hook";
}

function fresh(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

function allMatches(value: string, pattern: RegExp): RegExpMatchArray[] {
  return [...value.matchAll(fresh(pattern))];
}

function affirmativeMatch(value: string, pattern: RegExp): boolean {
  return allMatches(value, pattern).some((match) => {
    const start = Number(match.index || 0);
    const prefix = value.slice(Math.max(0, start - 42), start);
    const genericNegation = /\b(?:nao|nunca|jamais|sem|not|never|without|sin)\b[^.!?;:]{0,36}$/u.test(prefix);
    // Spanish "no" negates a following verb; Portuguese "no" is usually
    // the preposition in ordinary phrases such as "no trem" or "no quarto".
    // Treating every `no` as negation made valid PT-BR duration evidence look
    // absent whenever its clause happened inside a location.
    const spanishNoNegation = /\bno\s+(?:era|estaba|estuvo|fue|iba|hizo|hacia|durmio|dormia|quiso|queria|pudo|podria|siguio|salio|llego|entro|volvio)\b[^.!?;:]{0,36}$/u.test(prefix);
    return !genericNegation && !spanishNoNegation;
  });
}

interface LocalEvidenceChannels {
  all: string;
  transcript: string;
  ocr: string;
  visual: string;
}

function evidenceTextFragments(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => evidenceTextFragments(item, depth + 1));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((item) => evidenceTextFragments(item, depth + 1));
  }
  return [];
}

function localEvidenceChannels(value: unknown): LocalEvidenceChannels {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      all: normalize(evidenceTextFragments(record).join(" ")),
      transcript: normalize(evidenceTextFragments(record.transcript).join(" ")),
      ocr: normalize(evidenceTextFragments(record.ocr ?? record.on_screen_text).join(" ")),
      visual: normalize(evidenceTextFragments(record.frames ?? record.evidence_text ?? record.visual_facts).join(" ")),
    };
  }
  const raw = String(value ?? "").trim();
  if (/^[\[{]/u.test(raw)) {
    try {
      return localEvidenceChannels(JSON.parse(raw));
    } catch {
      // A malformed/unstructured value remains usable as undifferentiated
      // explicit evidence; it must never make the guard throw open.
    }
  }
  const normalized = normalize(raw);
  return { all: normalized, transcript: normalized, ocr: "", visual: "" };
}

interface DurationRule {
  id: string;
  generated: RegExp;
  evidence: RegExp;
}

// These rules intentionally cover only explicit whole-span claims. Ordinary
// chronology ("depois", "por alguns minutos", "durante a viagem") is not an
// absolutizer and therefore remains untouched.
const DURATION_RULES: DurationRule[] = [
  {
    id: "entire_trip_span",
    generated: /\b(?:durante\s+(?:toda\s+a|todo\s+o)\s+(?:viagem|trajeto|percurso|voo|passeio|caminho)|(?:a\s+viagem|o\s+(?:trajeto|percurso|voo|passeio|caminho))\s+inteir[oa]|do\s+comeco\s+ao\s+fim\s+d[ao]\s+(?:viagem|trajeto|percurso|voo|passeio|caminho)|throughout\s+the\s+(?:trip|journey|ride|flight)|the\s+(?:entire|whole)\s+(?:trip|journey|ride|flight)|during\s+the\s+(?:entire|whole)\s+(?:trip|journey|ride|flight)|durante\s+todo\s+el\s+(?:viaje|trayecto|recorrido|vuelo)|(?:el\s+(?:viaje|trayecto|recorrido|vuelo))\s+entero)\b/gu,
    evidence: /\b(?:durante\s+(?:toda\s+a|todo\s+o)\s+(?:viagem|trajeto|percurso|voo|passeio|caminho)|(?:a\s+viagem|o\s+(?:trajeto|percurso|voo|passeio|caminho))\s+inteir[oa]|do\s+comeco\s+ao\s+fim\s+d[ao]\s+(?:viagem|trajeto|percurso|voo|passeio|caminho)|throughout\s+the\s+(?:trip|journey|ride|flight)|the\s+(?:entire|whole)\s+(?:trip|journey|ride|flight)|during\s+the\s+(?:entire|whole)\s+(?:trip|journey|ride|flight)|durante\s+todo\s+el\s+(?:viaje|trayecto|recorrido|vuelo)|(?:el\s+(?:viaje|trayecto|recorrido|vuelo))\s+entero)\b/gu,
  },
  {
    id: "whole_time_span",
    generated: /\b(?:o\s+tempo\s+todo|esse\s+tempo\s+todo|todo\s+esse\s+tempo|the\s+whole\s+time|all\s+the\s+time|todo\s+el\s+tiempo)\b/gu,
    evidence: /\b(?:o\s+tempo\s+todo|esse\s+tempo\s+todo|todo\s+esse\s+tempo|the\s+whole\s+time|all\s+the\s+time|todo\s+el\s+tiempo)\b/gu,
  },
];

const SOME_MINUTES_DURATION = /\b(?:(?:por|durante)\s+)?(?:mais\s+)?(?:alguns|uns|poucos)\s+minutos(?:\s+a\s+mais)?\b|\b(?:for\s+)?(?:a\s+)?few\s+(?:more\s+)?minutes\b|\b(?:por|durante)?\s*unos\s+minutos\s+mas\b/gu;

const DIRECT_TRANSITION_CLAIM = /\b(?:foi|vai|ia|seguiu|partiu|saiu|correu|volt(?:ou|ava)|entrou|chegou|lev(?:ou|ava)|went|goes|was\s+going|headed|left|ran|returned|arrived|fue|iba|siguio|partio|salio|corrio|volvio|llego)\b[^.!?;\n]{0,34}\b(?:direto|direta|diretos|diretas|straight|directly|directo|directa)\s+(?:para|pra|pro|ao|a|ate|to|toward|towards|al|hacia)\b[^.!?;\n]{0,70}/gu;

const DIRECT_TRANSITION_EVIDENCE = /\b(?:foi|vai|ia|seguiu|partiu|saiu|correu|volt(?:ou|ava)|entrou|chegou|lev(?:ou|ava)|went|goes|was\s+going|headed|left|ran|returned|arrived|fue|iba|siguio|partio|salio|corrio|volvio|llego)\b[^.!?;\n]{0,34}\b(?:direto|direta|diretos|diretas|straight|directly|directo|directa)\s+(?:para|pra|pro|ao|a|ate|to|toward|towards|al|hacia)\b|\b(?:sem\s+parar|without\s+stopping|sin\s+parar)\b/gu;

// A fluent rewrite can accidentally carry the location from one microevent
// into the next one (for example, being "in bed" while physically descending
// stairs). Permit it only when the local evidence explicitly says that the
// bed itself moves on the stairs; otherwise the two events need a transition.
const BED_TO_STAIRS_LOCATIVE_FUSION = /\b(?:na|sobre\s+a|deitad[oa]\s+n[ao])\s+cama\b[^.!?;\n]{0,90}\b(?:desc(?:e|ia|eu|endo|er)|desliz(?:a|ava|ou|ando)|escorreg(?:a|ava|ou|ando))\b[^.!?;\n]{0,48}\bescadas?\b/gu;
const MOVING_BED_ON_STAIRS_EVIDENCE = /(?:\b(?:cama|bed)\b[^.!?;\n]{0,64}\b(?:desc(?:e|ia|eu|endo|er)|desliz(?:a|ava|ou|ando)|escorreg(?:a|ava|ou|ando)|slid(?:e|ing)?|descend(?:s|ed|ing)?)\b[^.!?;\n]{0,48}\b(?:escadas?|stairs?)\b|\b(?:escadas?|stairs?)\b[^.!?;\n]{0,48}\b(?:cama|bed)\b[^.!?;\n]{0,64}\b(?:desc(?:e|ia|eu|endo|er)|desliz(?:a|ava|ou|ando)|escorreg(?:a|ava|ou|ando)|slid(?:e|ing)?|descend(?:s|ed|ing)?)\b)/gu;

// Remaining in bed/lying in one frame is not proof that the person never got
// up between actions. This continuity claim is accepted only from literal
// transcript or OCR wording in the same slot.
const NO_GETTING_UP_CLAIM = /\b(?:sem\s+(?:nem\s+)?(?:se\s+)?levantar(?:-?se)?|sem\s+sair\s+d[aeo]\s+(?:cama|chao)|without\s+(?:ever\s+)?getting\s+up|without\s+(?:leaving|rising\s+from)\s+(?:the\s+)?(?:bed|floor)|sin\s+levantarse|sin\s+salir\s+de\s+(?:la\s+)?(?:cama|suelo))\b/gu;

interface ActionRule {
  id: string;
  verbs: RegExp;
}

// A deliberately small list of visible, transitive actions. Repetition is
// blocked only when both the canonical verb family and the concrete object
// match. This avoids treating thematic repetition as a duplicate action.
const ACTION_RULES: ActionRule[] = [
  { id: "vestir", verbs: /\b(?:veste|vestem|vestia|vestiam|vestiu|vestiram|vestindo|vestir|vestido|vestida|wears?|wore|wearing|puts?\s+on|putting\s+on|viste|vestia|vistio|vistiendo)\b/gu },
  { id: "colocar", verbs: /\b(?:coloca|colocam|colocava|colocavam|colocou|colocaram|colocando|bota|botou|botava|poe|pos|put|puts|placing|placed|pone|ponia|ponian|poniendo|puso|coloco)\b/gu },
  { id: "tirar", verbs: /\b(?:tira|tiram|tirava|tirou|tiraram|tirando|remove|removed|removing|takes?\s+off|took\s+off|quita|quito|saca|saco)\b/gu },
  { id: "abrir", verbs: /\b(?:abre|abrem|abria|abriu|abriram|abrindo|opens?|opened|opening|abre|abrio|abriendo)\b/gu },
  { id: "fechar", verbs: /\b(?:fecha|fecham|fechava|fechou|fecharam|fechando|closes?|closed|closing|cierra|cerro|cerrando)\b/gu },
  { id: "pegar", verbs: /\b(?:pega|pegam|pegava|pegou|pegaram|pegando|agarra|agarrou|grabs?|grabbed|grabbing|takes?|took|toma|tomo|agarro)\b/gu },
  { id: "entregar", verbs: /\b(?:entrega|entregam|entregava|entregou|entregaram|entregando|gives?|gave|giving|hands?|handed|entrega|entrego)\b/gu },
  { id: "carregar", verbs: /\b(?:carrega|carregam|carregava|carregou|carregaram|carregando|carries|carried|carrying|carga|cargo|llevaba|llevo)\b/gu },
  { id: "empurrar", verbs: /\b(?:empurra|empurram|empurrava|empurrou|empurraram|empurrando|pushes?|pushed|pushing|empuja|empujo)\b/gu },
  { id: "puxar", verbs: /\b(?:puxa|puxam|puxava|puxou|puxaram|puxando|pulls?|pulled|pulling|jala|jalo|tira|tiro)\b/gu },
  { id: "cortar", verbs: /\b(?:corta|cortam|cortava|cortou|cortaram|cortando|cuts?|cutting|corta|corto)\b/gu },
  { id: "comer", verbs: /\b(?:come|comem|comia|comeu|comeram|comendo|eats?|ate|eating|come|comio)\b/gu },
  { id: "beber", verbs: /\b(?:bebe|bebem|bebia|bebeu|beberam|bebendo|drinks?|drank|drinking|bebe|bebio)\b/gu },
  { id: "abracar", verbs: /\b(?:abraca|abracam|abracava|abracou|abracaram|abracando|hugs?|hugged|hugging|abraza|abrazo)\b/gu },
  { id: "beijar", verbs: /\b(?:beija|beijam|beijava|beijou|beijaram|beijando|kisses?|kissed|kissing|besa|beso)\b/gu },
];

const OBJECT_STOP_WORDS = new Set([
  "ele", "ela", "eles", "elas", "isso", "isto", "aquilo", "alguem", "algo",
  "him", "her", "them", "it", "this", "that", "someone", "something",
  "lo", "la", "los", "las", "esto", "eso", "algo", "alguien",
  "rapidamente", "devagar", "cuidadosamente", "imediatamente", "direto", "direta",
]);

const SUBJECT_ALIASES: Record<string, string> = {
  ele: "male", homem: "male", garoto: "male", menino: "male", rapaz: "male", cara: "male", man: "male", boy: "male", he: "male", hombre: "male", chico: "male",
  ela: "female", mulher: "female", garota: "female", menina: "female", moca: "female", woman: "female", girl: "female", she: "female", mujer: "female", chica: "female",
  eles: "plural", elas: "plural", they: "plural", ellos: "plural", ellas: "plural",
};

const OBJECT_ALIASES: Record<string, string> = {
  calcas: "calca",
  pantalone: "calca",
  pantalones: "calca",
  pant: "calca",
  pants: "calca",
  trouser: "calca",
  trousers: "calca",
  jeans: "calca",
};

const CLOTHING_OBJECTS = new Set([
  "calca", "camisa", "camiseta", "blusa", "casaco", "vestido", "saia", "short",
  "roupa", "uniforme", "sapato", "tenis", "bota", "meia", "chapeu", "bone",
  "jacket", "shirt", "dress", "skirt", "shoe", "sock", "clothe", "clothing",
]);

function canonicalObject(raw: string): string {
  const value = raw.replace(/[^a-z0-9-]/g, "");
  if (!value || OBJECT_STOP_WORDS.has(value)) return "";
  const singular = value.length > 4 && value.endsWith("s") ? value.slice(0, -1) : value;
  return OBJECT_ALIASES[value] || OBJECT_ALIASES[singular] || singular;
}

function canonicalActionSignature(ruleId: string, object: string): string {
  // "colocar a calca" and "vestir as calcas" are the same concrete event.
  // Keep generic colocar separate so placing a document/object is unaffected.
  const actionId = ruleId === "colocar" && CLOTHING_OBJECTS.has(object) ? "vestir" : ruleId;
  return `${actionId}:${object}`;
}

function subjectBefore(text: string, actionStart: number): string | null {
  const prefix = text.slice(Math.max(0, actionStart - 64), actionStart).split(/[.!?;:]/u).pop() || "";
  const matches = [...prefix.matchAll(/\b(ele|ela|eles|elas|homem|mulher|garoto|garota|menino|menina|rapaz|cara|moca|man|woman|boy|girl|he|she|they|hombre|mujer|chico|chica|ellos|ellas)\b/gu)];
  const raw = String(matches.at(-1)?.[1] || "");
  return raw ? SUBJECT_ALIASES[raw] || null : null;
}

interface ConcreteAction {
  signature: string;
  found: string;
  start: number;
  subject: string | null;
}

function concreteActions(value: unknown): ConcreteAction[] {
  const text = normalize(value);
  const actions: ConcreteAction[] = [];
  for (const rule of ACTION_RULES) {
    for (const match of allMatches(text, rule.verbs)) {
      const start = Number(match.index || 0);
      const end = start + String(match[0] || "").length;
      const remainder = text.slice(end, end + 84);
      const objectMatch = remainder.match(/^\s+(?:(?:de\s+novo|outra\s+vez|novamente|again|once\s+more)\s+)?(?:(?:bem|mais|muito|rapidamente|devagar|cuidadosamente)\s+){0,2}(?:(?:a|as|o|os|um|uma|uns|umas|seu|sua|seus|suas|the|his|her|their|el|la|los|las|un|una|su)\s+)?([a-z][a-z0-9-]{2,})\b/u);
      const object = canonicalObject(String(objectMatch?.[1] || ""));
      if (!object) continue;
      actions.push({
        signature: canonicalActionSignature(rule.id, object),
        found: `${String(match[0] || "").trim()} ${String(objectMatch?.[0] || "").trim()}`.trim(),
        start,
        subject: subjectBefore(text, start),
      });
    }
  }
  return actions;
}

function explicitlyRecurring(text: unknown, actionStart: number): boolean {
  const value = normalize(text);
  const nearby = value.slice(Math.max(0, actionStart - 42), actionStart + 42);
  return /\b(?:novamente|de\s+novo|outra\s+vez|mais\s+uma\s+vez|volt(?:a|ou|ava)\s+a|again|once\s+more|otra\s+vez|nuevamente)\b/u.test(nearby);
}

function uniqueIssues(issues: NarrativePrecisionIssue[]): NarrativePrecisionIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.script_slot_index}:${issue.rule_id}:${issue.found}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deterministic, fail-closed guard for three narrow precision errors that a
 * fluent Writer can otherwise introduce. Hook blocks are intentionally out of
 * scope: their dedicated 0-5s grounding/preview path remains unchanged.
 */
export function assessNarrativePrecision(
  rawBlocks: NarrativePrecisionBlock[],
): NarrativePrecisionAssessment {
  const blocks = (Array.isArray(rawBlocks) ? rawBlocks : [])
    .filter((block) => Number.isInteger(Number(block?.index)))
    .map((block) => ({ ...block, index: Number(block.index) }))
    .sort((left, right) => left.index - right.index);
  const issues: NarrativePrecisionIssue[] = [];

  for (const block of blocks) {
    if (isHook(block)) continue;
    const generated = normalize(block.generated_text);
    if (!generated) continue;
    const evidenceChannels = localEvidenceChannels(block.local_evidence_text);
    const evidence = evidenceChannels.all;
    for (const rule of DURATION_RULES) {
      if (affirmativeMatch(evidence, rule.evidence)) continue;
      for (const match of allMatches(generated, rule.generated)) {
        issues.push({
          type: "unsupported_duration_absolutizer",
          rule_id: rule.id,
          script_slot_index: block.index,
          related_slot_indexes: [block.index],
          found: String(match[0] || "").trim(),
          support_reason: "whole_span_wording_missing_from_same_slot_evidence",
          required_change: "Preserve the exact evidenced duration. Replace the whole-span claim with the local duration (for example, 'por alguns minutos') or neutral chronology.",
        });
      }
    }
    if (affirmativeMatch(evidence, SOME_MINUTES_DURATION)
      && !affirmativeMatch(generated, SOME_MINUTES_DURATION)) {
      issues.push({
        type: "explicit_duration_qualifier_omitted",
        rule_id: "some_minutes_must_remain_some_minutes",
        script_slot_index: block.index,
        related_slot_indexes: [block.index],
        found: "explicit bounded duration omitted",
        support_reason: "same_slot_evidence_explicitly_says_some_minutes",
        required_change: "Restore the bounded duration in everyday target-language wording (for example, 'por mais alguns minutos'). Do not omit it or widen it to the full trip.",
      });
    }
    if (!affirmativeMatch(evidence, DIRECT_TRANSITION_EVIDENCE)) {
      for (const match of allMatches(generated, DIRECT_TRANSITION_CLAIM)) {
        issues.push({
          type: "unsupported_direct_transition",
          rule_id: "direct_destination_transition",
          script_slot_index: block.index,
          related_slot_indexes: [block.index],
          found: String(match[0] || "").trim(),
          support_reason: "direct_or_without_stopping_transition_missing_from_same_slot_evidence",
          required_change: "Remove 'direto/straight/directo' and state only the evidenced order or destination. A later scene does not prove an immediate, uninterrupted transition.",
        });
      }
    }
    if (!affirmativeMatch(evidence, MOVING_BED_ON_STAIRS_EVIDENCE)) {
      for (const match of allMatches(generated, BED_TO_STAIRS_LOCATIVE_FUSION)) {
        issues.push({
          type: "cross_scene_locative_fusion",
          rule_id: "bed_location_carried_into_stair_action",
          script_slot_index: block.index,
          related_slot_indexes: [block.index],
          found: String(match[0] || "").trim(),
          support_reason: "local_evidence_does_not_show_the_bed_moving_on_the_stairs",
          required_change: "Separate the bed action from the stair action with explicit chronology (for example, 'depois'). Do not attach the bed location to the person while they descend the stairs.",
        });
      }
    }
    const explicitContinuityEvidence = `${evidenceChannels.transcript} ${evidenceChannels.ocr}`.trim();
    if (!fresh(NO_GETTING_UP_CLAIM).test(explicitContinuityEvidence)) {
      for (const match of allMatches(generated, NO_GETTING_UP_CLAIM)) {
        issues.push({
          type: "unsupported_no_getting_up_claim",
          rule_id: "no_getting_up_requires_literal_local_support",
          script_slot_index: block.index,
          related_slot_indexes: [block.index],
          found: String(match[0] || "").trim(),
          support_reason: "same_slot_transcript_or_ocr_does_not_prove_continuous_no_getting_up_state",
          required_change: "Remove 'sem se levantar' (or equivalent) unless the same slot's transcript/OCR explicitly says it. A lying pose alone does not prove continuity between actions.",
        });
      }
    }
  }

  for (let position = 1; position < blocks.length; position++) {
    const prior = blocks[position - 1];
    const current = blocks[position];
    if (isHook(prior) || isHook(current)) continue;
    const priorActions = concreteActions(prior.generated_text);
    const currentActions = concreteActions(current.generated_text);
    for (const currentAction of currentActions) {
      const duplicate = priorActions.find((priorAction) =>
        priorAction.signature === currentAction.signature
        && !(priorAction.subject && currentAction.subject && priorAction.subject !== currentAction.subject)
      );
      if (!duplicate || explicitlyRecurring(current.generated_text, currentAction.start)) continue;
      const priorTranscriptSignatures = new Set(
        concreteActions(localEvidenceChannels(prior.local_evidence_text).transcript)
          .map((action) => action.signature),
      );
      const currentTranscriptSignatures = new Set(
        concreteActions(localEvidenceChannels(current.local_evidence_text).transcript)
          .map((action) => action.signature),
      );
      const priorTranscriptOwnsAction = priorTranscriptSignatures.has(currentAction.signature);
      const currentTranscriptOwnsAction = currentTranscriptSignatures.has(currentAction.signature);
      // When only the later slot's local speech explicitly owns the event,
      // repair the earlier visual spillover. Targeting the later block would
      // fight its immutable transcript checklist and create a no-progress loop.
      const repairIndex = currentTranscriptOwnsAction && !priorTranscriptOwnsAction
        ? prior.index
        : current.index;
      issues.push({
        type: "adjacent_concrete_action_redundancy",
        rule_id: "same_verb_object_in_adjacent_non_hook_blocks",
        script_slot_index: repairIndex,
        related_slot_indexes: [prior.index, current.index],
        found: `${duplicate.found} -> ${currentAction.found}`,
        action_signature: currentAction.signature,
        support_reason: currentTranscriptOwnsAction && !priorTranscriptOwnsAction
          ? "same_concrete_action_repeated_and_only_later_slot_transcript_owns_it"
          : "same_concrete_action_repeated_without_local_recurrence_marker",
        required_change: currentTranscriptOwnsAction && !priorTranscriptOwnsAction
          ? "Remove this action from the earlier block and keep it once in the later block whose local transcript explicitly owns it. Advance the earlier block only through its own evidence."
          : "Narrate this concrete action once. In the later block, advance to the next evidenced action; repeat it only when local evidence explicitly says it happened again.",
      });
    }
  }

  const dedupedIssues = uniqueIssues(issues);
  return {
    required: true,
    passed: dedupedIssues.length === 0,
    issues: dedupedIssues,
    affected_block_indexes: [...new Set(dedupedIssues.flatMap((issue) => issue.related_slot_indexes))]
      .sort((left, right) => left - right),
  };
}

export const NARRATIVE_PRECISION_WRITER_RULES = [
  "Never widen a local duration into a whole-span claim. 'Alguns minutos' cannot become 'durante toda a viagem', 'o tempo todo' or an equivalent absolutizer unless this exact block's evidence explicitly states the full span.",
  "Preserve an explicit bounded duration from the same-slot evidence. 'Unos minutos mas/a few more minutes' must remain 'por mais alguns minutos' (or the natural equivalent); never omit it and never widen it to the whole trip.",
  "Never add 'direto', 'straight', 'directo' or 'sem parar' between events unless this exact block's evidence explicitly proves an immediate uninterrupted transition. Mere chronological order does not prove it.",
  "Never carry a location from one microevent into the next. If someone acts in bed and later descends stairs, separate the actions with explicit chronology; write that the bed descends only when the local evidence literally shows the bed moving on the stairs.",
  "Never say 'sem se levantar/without getting up/sin levantarse' from a lying pose alone. This continuity claim requires literal same-slot transcript or OCR support.",
  "Do not narrate the same concrete action in two adjacent non-hook blocks. 'Colocar/botar uma calca' and 'vestir a calca' are the same action. Keep it in the slot whose local transcript explicitly owns it; repeat only when later evidence proves recurrence and says 'de novo/novamente' or its target-language equivalent.",
] as const;
