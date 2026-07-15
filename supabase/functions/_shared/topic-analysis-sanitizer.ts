type TopicAnalysisRecord = Record<string, any>;

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface InferenceRule {
  id: string;
  claim: RegExp;
  explicitEvidence: RegExp;
  neutralReplacement: string;
}

const INFERENCE_RULES: InferenceRule[] = [
  {
    id: "new_family",
    claim: /\b(?:nova fam[ií]lia|formaram? (?:uma )?fam[ií]lia|viraram? (?:uma )?fam[ií]lia)\b/giu,
    explicitEvidence: /\b(?:nova familia|formaram? (?:uma )?familia|new family|became a family|nueva familia)\b/iu,
    neutralReplacement: "duas pessoas com um bebe",
  },
  {
    id: "family",
    claim: /\b(?:fam[ií]lia|familiar(?:es)?)\b/giu,
    explicitEvidence: /\b(?:familia|family|families)\b/iu,
    neutralReplacement: "grupo de pessoas",
  },
  {
    id: "couple",
    claim: /\b(?:casal|casais|par romantico)\b/giu,
    explicitEvidence: /\b(?:casal|casais|couple|couples|pareja|parejas)\b/iu,
    neutralReplacement: "duas pessoas",
  },
  {
    id: "new_partner",
    claim: /\b(?:nov[oa] parceir[oa]|nov[oa] companheir[oa]|parceir[oa] romantic[oa])\b/giu,
    explicitEvidence: /\b(?:nov[oa] parceir[oa]|nov[oa] companheir[oa]|new partner|new companion|nuev[oa] parej[oa])\b/iu,
    neutralReplacement: "outro adulto",
  },
  {
    id: "emotional_support",
    claim: /\b(?:apoio emocional|acolhimento(?: emocional)?|conforto emocional|deu suporte emocional|(?:encontra|encontrou|recebe|recebeu) apoio em (?:um|uma|o|a) [\p{L}-]+)\b/giu,
    explicitEvidence: /\b(?:apoio emocional|emotional support|soporte emocional|acolhimento(?: emocional)?|conforto emocional)\b/iu,
    neutralReplacement: "interacao visivel",
  },
  {
    id: "marriage_relationship",
    claim: /\b(?:fim (?:de|do|da) (?:seu|sua|o|a)?\s*casamento|conflito conjugal|casamento (?:acabou|terminou)|separacao (?:do casal|conjugal))\b/giu,
    explicitEvidence: /\b(?:casamento|marriage|matrimonio|marido|esposa|husband|wife)\b/iu,
    neutralReplacement: "documento de divorcio visivel",
  },
  {
    id: "ex_partner",
    claim: /\b(?:ex[- ]?parceir[oa]|ex[- ]?companheir[oa]|antig[oa] parceir[oa])\b/giu,
    explicitEvidence: /\b(?:ex[- ]?parceir[oa]|ex[- ]?companheir[oa]|ex[- ]?partner|former partner|ex pareja)\b/iu,
    neutralReplacement: "outro adulto",
  },
  {
    id: "relationship_change",
    claim: /\b(?:mudan[cç]a de (?:relacionamento|rela[cç][aã]o)|novo relacionamento|recome[cç]ando sua vida|recome[cç]a(?:r|ndo)? (?:a|sua) vida)\b/giu,
    explicitEvidence: /\b(?:mudanca de relacionamento|novo relacionamento|relationship change|new relationship|recomecando sua vida|starting a new life)\b/iu,
    neutralReplacement: "mudanca na sequencia visual",
  },
  {
    id: "abandonment_conclusion",
    claim: /\b(?:(?:foi|ser|ap[oó]s ser) deixad[oa] para tr[aá]s|abandonad[oa] pel[oa] parceir[oa])\b/giu,
    explicitEvidence: /\b(?:foi deixad[oa] para tras|abandonad[oa]|left behind|abandoned|dejado atras|abandonad[oa])\b/iu,
    neutralReplacement: "aparece sozinha em outra cena",
  },
  {
    id: "celebration_conclusion",
    claim: /\b(?:celebra[cç][aã]o|comemora[cç][aã]o|celebram?\b|comemoram?\b)/giu,
    explicitEvidence: /\b(?:celebracao|celebram?|comemoracao|comemoram?|celebrat(?:e|es|ed|ing|ion)|festej(?:a|am|aram|ando))\b/iu,
    neutralReplacement: "momento final",
  },
];

function explicitEvidenceText(options: {
  factualTranscriptSegments?: any[];
  frames?: any[];
}): string {
  const transcript = (Array.isArray(options.factualTranscriptSegments)
    ? options.factualTranscriptSegments
    : []).map((segment: any) => String(segment?.text || ""));
  // Vision summaries may themselves infer a relationship. Only literal OCR
  // can authorize relationship labels in navigation metadata.
  const ocr = (Array.isArray(options.frames) ? options.frames : [])
    .map((frame: any) => String(frame?.text_on_screen || ""));
  return normalize([...transcript, ...ocr].join(" "));
}

function sanitizeText(value: unknown, evidence: string, removed: Set<string>): string {
  let text = String(value ?? "");
  for (const rule of INFERENCE_RULES) {
    if (rule.explicitEvidence.test(evidence)) continue;
    const before = text;
    text = text.replace(new RegExp(rule.claim.source, rule.claim.flags), rule.neutralReplacement);
    if (text !== before) removed.add(rule.id);
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

function sanitizeStringArray(value: unknown, evidence: string, removed: Set<string>): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeText(item, evidence, removed))
    .filter(Boolean);
}

/**
 * Topic analysis is navigation metadata, but inferred relationship labels can
 * still bias mode selection and later prompts. Scrub them unless literal local
 * speech/OCR proves them. Two adults plus a baby, or an extended hand, never
 * establishes a couple, family, new partner or emotional support.
 */
export function sanitizeTopicAnalysisRelationshipInferences(
  rawAnalysis: unknown,
  options: { factualTranscriptSegments?: any[]; frames?: any[] },
): TopicAnalysisRecord {
  const analysis = rawAnalysis && typeof rawAnalysis === "object"
    ? structuredClone(rawAnalysis as TopicAnalysisRecord)
    : {};
  const evidence = explicitEvidenceText(options);
  const removed = new Set<string>();

  analysis.central_topic = sanitizeText(analysis.central_topic, evidence, removed);
  analysis.key_topics = sanitizeStringArray(analysis.key_topics, evidence, removed);
  analysis.semantic_summary = sanitizeText(analysis.semantic_summary, evidence, removed);
  analysis.narrative_progression = (Array.isArray(analysis.narrative_progression)
    ? analysis.narrative_progression
    : []).map((phase: any) => ({
      ...phase,
      description: sanitizeText(phase?.description, evidence, removed),
    }));
  analysis.visual_anchor_points = (Array.isArray(analysis.visual_anchor_points)
    ? analysis.visual_anchor_points
    : []).map((anchor: any) => ({
      ...anchor,
      visual_description: sanitizeText(anchor?.visual_description, evidence, removed),
      narrative_role: sanitizeText(anchor?.narrative_role, evidence, removed),
    }));

  const rules = analysis.semantic_alignment_rules && typeof analysis.semantic_alignment_rules === "object"
    ? analysis.semantic_alignment_rules
    : {};
  rules.must_include_topics = sanitizeStringArray(rules.must_include_topics, evidence, removed);
  rules.tone_guidance = sanitizeText(rules.tone_guidance, evidence, removed);
  if (rules.input_profile && typeof rules.input_profile === "object") {
    rules.input_profile.evidence_reasons = sanitizeStringArray(
      rules.input_profile.evidence_reasons,
      evidence,
      removed,
    );
  }
  rules.relationship_inference_sanitizer = {
    applied: true,
    factual_authority: "literal_transcript_or_ocr_only",
    removed_claim_ids: [...removed],
  };
  analysis.semantic_alignment_rules = rules;
  return analysis;
}
