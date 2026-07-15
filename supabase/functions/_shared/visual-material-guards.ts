import { normalizeGuardWords } from "./dna-guards.ts";

const DECOMPOSITION_ACTION = /\b(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten)\b/u;
const DECOMPOSED_ANIMAL_BODY = /\b(?:(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten).{0,90}(?:gato|gata|corpo|cat|body)|(?:gato|gata|corpo|cat|body).{0,90}(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten))\b/u;
const NON_ASSERTED_DECOMPOSITION: ReadonlyArray<RegExp> = [
  /\b(?:nao|not|nunca|never|jamais|nem|sem|without)\b(?:\s+\p{L}+){0,6}\s+(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten)\b/u,
  /\b(?:talvez|perhaps|possibly|possivelmente|supostamente|alegadamente|quase|almost|poderia|pode|possa|pudesse|iria|vai|deveria|deve|might|may|could|would|will)\b(?:\s+\p{L}+){0,6}\s+(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten)\b/u,
  /\b(?:antes|before|risco|risk|evitou|evitar|impediu|impedir|avoided|prevented)\b(?:\s+\p{L}+){0,6}\s+(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten)\b/u,
  /\b(?:caso|if)\b(?:\s+\p{L}+){0,10}\s+(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten)\b/u,
  /\bse\s+(?:o|a|os|as|um|uma|esse|essa|este|esta|aquele|aquela|ele|ela|isso|aquilo|corpo|gato|gata|body|cat)\b(?:\s+\p{L}+){0,8}\s+(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*|rotten)\b/u,
  /^se\s+(?:decomp(?:o(?:r|n|e|s|m)\p{L}*|u(?:s|nh)\p{L}*)|apodrec\p{L}*|decay\p{L}*)\b/u,
];

const MATERIAL_TEMPORAL_OCR = /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+later|(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|\d+)\s+(?:segundo|minuto|hora|dia|semana|mes|ano)s?\s+(?:depois|mais\s+tarde)|(?:un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+(?:segundo|minuto|hora|dia|semana|mes|ano)s?\s+despues|(?:later|depois|mais\s+tarde|antes|before|earlier)\s+(?:that|disso|disto|eso))\b/u;

/** OCR such as "ONE YEAR LATER" changes chronology and is story evidence. */
export function isMaterialTemporalTransitionText(value: unknown): boolean {
  return MATERIAL_TEMPORAL_OCR.test(normalizeGuardWords(value).join(" "));
}

function hasAssertedDecomposedAnimalBody(generatedText: string): boolean {
  return String(generatedText || "")
    .split(/[.!?;:\n]+/u)
    .some((clause) => {
      const normalizedClause = normalizeGuardWords(clause).join(" ");
      if (!DECOMPOSED_ANIMAL_BODY.test(normalizedClause) || !DECOMPOSITION_ACTION.test(normalizedClause)) {
        return false;
      }
      return !NON_ASSERTED_DECOMPOSITION.some((pattern) => pattern.test(normalizedClause));
    });
}

const MATERIAL_VISUAL_ACTION_RULES: ReadonlyArray<{
  id: string;
  evidence: RegExp;
  generated: RegExp;
  generatedAssertion?: (generatedText: string) => boolean;
}> = [
  {
    id: "material_temporal_transition",
    evidence: MATERIAL_TEMPORAL_OCR,
    generated: MATERIAL_TEMPORAL_OCR,
  },
  {
    id: "sniff_or_smell",
    evidence: /\b(?:sniff\p{L}*|farej\p{L}*|cheir\p{L}*|olfat\p{L}*)\b/u,
    generated: /\b(?:farej\p{L}*|cheir\p{L}*|sniff\p{L}*|smell\p{L}*|olfat\p{L}*)\b/u,
  },
  {
    id: "physical_inspection",
    evidence: /\b(?:inspect\p{L}*|inspec\p{L}*|examin\p{L}*)\b/u,
    generated: /\b(?:inspec\p{L}*|examin\p{L}*|inspect\p{L}*)\b/u,
  },
  {
    id: "body_on_ground",
    evidence: /\b(?:(?:man|person|body|homem|pessoa|corpo).{0,48}(?:lies flat|lying motionless|on the ground|caid\p{L}*|deitad\p{L}*|imovel|no chao)|(?:lies flat|lying motionless|caid\p{L}*|deitad\p{L}*).{0,48}(?:man|person|body|homem|pessoa|corpo))\b/u,
    generated: /\b(?:(?:homem|pessoa|corpo|man|person|body).{0,48}(?:caid\p{L}*|deitad\p{L}*|imovel|chao|solo|jaz|lying|motionless)|(?:caid\p{L}*|deitad\p{L}*|imovel|jaz|lying|motionless).{0,48}(?:homem|pessoa|corpo|man|person|body))\b/u,
  },
  {
    id: "crawl_or_all_fours",
    evidence: /\b(?:crawl\p{L}*|scurri\p{L}*|all fours|rastej\p{L}*|engatinh\p{L}*|quatro apoios)\b/u,
    generated: /\b(?:crawl\p{L}*|rastej\p{L}*|engatinh\p{L}*|quatro apoios|de quatro)\b/u,
  },
  {
    id: "muzzle_reveal",
    evidence: /\b(?:(?:muzzle|snout|focinh\p{L}*).{0,56}(?:emerg\p{L}*|stretch\p{L}*|reveal\p{L}*|mouth|boca)|(?:emerg\p{L}*|reveal\p{L}*).{0,56}(?:muzzle|snout|focinh\p{L}*))\b/u,
    generated: /\b(?:(?:focinh\p{L}*|muzzle|snout).{0,80}(?:surg\p{L}*|emerg\p{L}*|revel\p{L}*|sai\p{L}*).{0,80}(?:boca|mouth)|(?:focinh\p{L}*|muzzle|snout).{0,80}(?:boca|mouth).{0,80}(?:surg\p{L}*|emerg\p{L}*|revel\p{L}*|sai\p{L}*)|(?:surg\p{L}*|emerg\p{L}*|revel\p{L}*|sai\p{L}*).{0,80}(?:focinh\p{L}*|muzzle|snout).{0,80}(?:boca|mouth)|(?:surg\p{L}*|emerg\p{L}*|revel\p{L}*|sai\p{L}*).{0,80}(?:boca|mouth).{0,80}(?:focinh\p{L}*|muzzle|snout)|(?:boca|mouth).{0,80}(?:surg\p{L}*|emerg\p{L}*|revel\p{L}*|sai\p{L}*).{0,80}(?:focinh\p{L}*|muzzle|snout)|(?:boca|mouth).{0,80}(?:focinh\p{L}*|muzzle|snout).{0,80}(?:surg\p{L}*|emerg\p{L}*|revel\p{L}*|sai\p{L}*))\b/u,
  },
  {
    id: "meat_or_blood_on_documents",
    evidence: /\b(?:(?:raw meat|carne crua|blood|sangu\p{L}*).{0,72}(?:chart\p{L}*|report\p{L}*|document\p{L}*|graf\p{L}*|relatori\p{L}*)|(?:chart\p{L}*|report\p{L}*|document\p{L}*|graf\p{L}*|relatori\p{L}*).{0,72}(?:raw meat|carne crua|blood|sangu\p{L}*))\b/u,
    generated: /\b(?:(?:carne crua|raw meat|sangu\p{L}*|blood).{0,72}(?:graf\p{L}*|relatori\p{L}*|document\p{L}*|chart\p{L}*|report\p{L}*)|(?:graf\p{L}*|relatori\p{L}*|document\p{L}*|chart\p{L}*|report\p{L}*).{0,72}(?:carne crua|raw meat|sangu\p{L}*|blood))\b/u,
  },
  {
    id: "pursuit",
    evidence: /\b(?:chas\p{L}*|pursu\p{L}*|persegu\p{L}*|run\p{L}* after|correr\p{L}* atras)\b/u,
    generated: /\b(?:persegu\p{L}*|correr\p{L}* atras|chas\p{L}*|pursu\p{L}*)\b/u,
  },
  {
    // A directed lunge is not a pose: it begins an interaction that can
    // explain the next reaction, conflict or consequence. This deliberately
    // names no species or object so it applies to every operational video.
    id: "directed_pounce_or_lunge",
    evidence: /\b(?:pounc\p{L}*|lung\p{L}*|spring\p{L}*\s+(?:at|toward)|abalan[cç]\p{L}*|dar\p{L}*\s+(?:um\s+)?bote|bote\s+(?:em|contra|sobre)|salt\p{L}*\s+(?:em\s+cima|contra|sobre)|avanc\p{L}*\s+(?:contra|sobre))\b/u,
    generated: /\b(?:dar\p{L}*\s+(?:um\s+)?bote|bote\s+(?:em|contra|sobre)|abalan[cç]\p{L}*|salt\p{L}*\s+(?:em\s+cima|contra|sobre)|avanc\p{L}*\s+(?:contra|sobre)|pounc\p{L}*|lung\p{L}*|spring\p{L}*\s+(?:at|toward))\b/u,
  },
  {
    // Capturing or consuming a concrete object is a material state change,
    // even when local speech jumps directly to its later consequence.
    id: "capture_or_consume_object",
    evidence: /\b(?:catch\p{L}*|captur\p{L}*|grab\p{L}*|seiz\p{L}*|pick\p{L}*\s+up|eat\p{L}*|ate|consum\p{L}*|swallow\p{L}*|devour\p{L}*|peg\p{L}*|agarr\p{L}*|apanh\p{L}*|retir\p{L}*|com(?:e|em|eu|ia|iam|endo|er|eram)|engol\p{L}*|devor\p{L}*)\b/u,
    generated: /\b(?:peg\p{L}*|agarr\p{L}*|apanh\p{L}*|retir\p{L}*|captur\p{L}*|com(?:e|em|eu|ia|iam|endo|er|eram)|engol\p{L}*|devor\p{L}*|catch\p{L}*|grab\p{L}*|seiz\p{L}*|pick\p{L}*\s+up|eat\p{L}*|ate|consum\p{L}*|swallow\p{L}*|devour\p{L}*)\b/u,
  },
  {
    // A visible trace can be the missing bridge between an earlier action and
    // a later reaction. A generic statement that "something happened" is not
    // coverage for the physical aftermath itself.
    id: "visible_physical_aftermath",
    evidence: /\b(?:skeleton\p{L}*|bones?|remains?|carcass\p{L}*|esquelet\p{L}*|oss\p{L}*|restos?|carca[cç]\p{L}*)\b/u,
    generated: /\b(?:esquelet\p{L}*|oss\p{L}*|restos?|carca[cç]\p{L}*|skeleton\p{L}*|bones?|remains?|carcass\p{L}*)\b/u,
  },
  {
    id: "animal_in_carrier_or_cage",
    evidence: /\b(?:(?:cat|gato|gata|animal).{0,72}(?:carrier|cage|transport\p{L}*|caixa|gaiola)|(?:carrier|cage|transport\p{L}*|caixa|gaiola).{0,72}(?:cat|gato|gata|animal))\b/u,
    generated: /\b(?:(?:gato|gata|animal|cat).{0,72}(?:caixa|gaiola|transport\p{L}*|carrier|cage)|(?:caixa|gaiola|transport\p{L}*|carrier|cage).{0,72}(?:gato|gata|animal|cat))\b/u,
  },
  {
    id: "decomposed_animal_body",
    evidence: DECOMPOSED_ANIMAL_BODY,
    generated: DECOMPOSED_ANIMAL_BODY,
    generatedAssertion: hasAssertedDecomposedAnimalBody,
  },
  {
    id: "flower_on_dirt_mound",
    evidence: /\b(?:(?:flower|flor).{0,90}(?:mound|dirt|soil|monte|montinho|terra)|(?:mound|dirt|soil|monte|montinho|terra).{0,90}(?:flower|flor))\b/u,
    generated: /\b(?:(?:flor|flower).{0,90}(?:monte|montinho|terra|solo|mound|dirt|soil)|(?:monte|montinho|terra|solo|mound|dirt|soil).{0,90}(?:flor|flower))\b/u,
  },
];

export function isDeterministicMaterialVisualEvidence(evidenceText: string): boolean {
  return materialVisualActionRuleIds(evidenceText).length > 0;
}

export function materialVisualActionRuleIds(evidenceText: string): string[] {
  const evidence = normalizeGuardWords(evidenceText).join(" ");
  let ids = MATERIAL_VISUAL_ACTION_RULES
    .filter((rule) => rule.evidence.test(evidence))
    .map((rule) => rule.id);
  if (ids.includes("sniff_or_smell")) ids = ids.filter((id) => id !== "physical_inspection");
  return [...new Set(ids)];
}

/**
 * Returns true when a stable high-signal visual proposition is present in the
 * evidence but absent from the exact Writer clause. Null means this evidence
 * is outside the deterministic high-signal catalog and remains semantic-only.
 */
export function missingExplicitMaterialVisualAction(
  evidenceText: string,
  generatedText: string,
): boolean | null {
  const evidence = normalizeGuardWords(evidenceText).join(" ");
  const generated = normalizeGuardWords(generatedText).join(" ");
  const matchingRuleIds = new Set(materialVisualActionRuleIds(evidence));
  const matchingRules = MATERIAL_VISUAL_ACTION_RULES.filter((rule) => matchingRuleIds.has(rule.id));
  if (matchingRules.length === 0) return null;
  return matchingRules.some((rule) => {
    const covered = rule.generatedAssertion
      ? rule.generatedAssertion(generatedText)
      : rule.generated.test(generated);
    return !covered;
  });
}
