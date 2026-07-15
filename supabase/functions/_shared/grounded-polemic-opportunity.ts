import { assessGroundedControversyClaims } from "./ptbr-viral-register.ts";

export interface GroundedPolemicOpportunity {
  term: string;
  support_type: "transcript" | "visible_action" | "on_screen_text";
  support_excerpt: string;
  timestamp_seconds: number;
  risk_level: "behavioral_opinion" | "sensitive_allegation";
}

function strictFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(value: unknown, maxChars: number): string {
  const text = String(value ?? "").trim();
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function groundPolemicOpportunity(
  item: any,
  segments: any[],
  frames: any[],
  duration: number | null,
): GroundedPolemicOpportunity | null {
  const timestamp = strictFiniteNumber(item?.timestamp_seconds);
  const boundedDuration = strictFiniteNumber(duration);
  const term = String(item?.term || "").trim().slice(0, 80);
  if (term.length < 2
    || timestamp === null
    || timestamp < 0
    || (boundedDuration !== null && timestamp > boundedDuration + 1)) return null;

  const localTranscript = segments.filter((segment: any) => {
    const start = strictFiniteNumber(segment?.start);
    const end = strictFiniteNumber(segment?.end);
    return start !== null && end !== null && timestamp >= start - 1 && timestamp <= end + 1;
  }).slice(0, 6).map((segment: any) => String(segment?.text || "").trim()).filter(Boolean);
  const localFrames = frames.filter((frame: any) => {
    const frameTimestamp = strictFiniteNumber(frame?.timestamp_seconds);
    return frameTimestamp !== null && Math.abs(frameTimestamp - timestamp) <= 2.5;
  }).slice(0, 6);
  const onScreenText = localFrames.map((frame: any) => String(frame?.text_on_screen || "").trim()).filter(Boolean);
  const visualActions = localFrames.flatMap((frame: any) => [
    String(frame?.main_action || "").trim(),
    String(frame?.description || "").trim(),
  ]).filter(Boolean);
  if (localTranscript.length === 0 && onScreenText.length === 0 && visualActions.length === 0) return null;

  const assessment = assessGroundedControversyClaims({
    generatedText: term,
    explicitEvidenceText: JSON.stringify({ transcript: localTranscript, on_screen_text: onScreenText }),
    behavioralEvidenceText: JSON.stringify({ transcript: localTranscript, visual_actions: visualActions }),
  });
  // The model proposes candidates, but only a term recognized and grounded by
  // the deterministic claim catalogue is allowed to reach the Writer.
  if (assessment.detected_claims.length === 0 || !assessment.passed) return null;

  const sensitive = assessment.detected_claims.some((claim) => claim.risk === "sensitive_allegation");
  const sourceCandidates = [
    { support_type: "transcript" as const, texts: localTranscript, explicit: true },
    { support_type: "on_screen_text" as const, texts: onScreenText, explicit: true },
    { support_type: "visible_action" as const, texts: visualActions, explicit: false },
  ].filter((candidate) => candidate.texts.length > 0);
  const individuallyGroundedSource = sourceCandidates.find((candidate) => {
    const candidateText = candidate.texts.join(" | ");
    const candidateAssessment = assessGroundedControversyClaims({
      generatedText: term,
      explicitEvidenceText: candidate.explicit ? candidateText : "",
      behavioralEvidenceText: candidateText,
    });
    return candidateAssessment.detected_claims.length > 0 && candidateAssessment.passed;
  });
  const fallbackSource = visualActions.length > 0
    ? { support_type: "visible_action" as const, texts: [...visualActions, ...localTranscript] }
    : sourceCandidates[0];
  const groundedSource = individuallyGroundedSource || fallbackSource;
  if (!groundedSource) return null;

  return {
    term,
    support_type: groundedSource.support_type,
    support_excerpt: bounded(groundedSource.texts.join(" | "), 300),
    timestamp_seconds: timestamp,
    risk_level: sensitive ? "sensitive_allegation" : "behavioral_opinion",
  };
}

type AutoPolemicRule = {
  term: string;
  transcript: RegExp;
  visual: RegExp;
};

// "Vago" also means imprecise in Portuguese. Treat it as Spanish laziness
// only with a Spanish human subject/copula and a nearby Spanish laziness cue.
const SPANISH_CONTEXTUAL_LAZY = /\b(?:(?:este|ese|aquel)\s+(?:hombre|mujer|chico|chica|nino|nina)|(?:el|ella))\s+(?:era|es|fue|estaba)\s+(?:tan\s+)?vag[oa]\b(?=.{0,140}\b(?:ganas|levantarse|acostad[oa]|caminar|trabajar)\b)/u;
const SPANISH_CONTEXTUAL_LAZY_SOURCE = SPANISH_CONTEXTUAL_LAZY.source;

const AUTO_POLEMIC_RULES: AutoPolemicRule[] = [
  {
    term: "preguiçoso",
    transcript: new RegExp(`(?:\\b(?:pregui(?:ca|cos[oa]s?)|vagabundagem|lazy|laziness|perez[ao]|perezos[oa]s?)\\b|${SPANISH_CONTEXTUAL_LAZY_SOURCE})`, "u"),
    visual: /\b(?:dormindo|cochilando|deitado)\b.{0,100}\b(?:trabalho|expediente|escritorio|mesa)\b/u,
  },
  {
    term: "vagabundagem",
    transcript: new RegExp(`(?:\\b(?:vagabundagem|pregui(?:ca|cos[oa]s?)|lazy|laziness|perez[ao]|perezos[oa]s?)\\b|${SPANISH_CONTEXTUAL_LAZY_SOURCE})`, "u"),
    visual: /\b(?:dormindo|cochilando|deitado)\b.{0,100}\b(?:trabalho|expediente|escritorio|mesa)\b/u,
  },
  {
    term: "experimento cruel",
    transcript: /\b(?:experimento cruel|cruel|sofrimento|costur(?:ou|ado|ada)|descarga eletrica|eletrocut(?:ou|ado|ada)|decompo|apodrec|mutil(?:ou|ado|ada))\b/u,
    visual: /\b(?:costur(?:ou|ado|ada)|descarga eletrica|eletrocut(?:ou|ado|ada)|decompo|apodrec|mutil(?:ou|ado|ada)|sofrimento)\b/u,
  },
  {
    term: "traição",
    transcript: /\b(?:traicao|traiu|traindo|infiel|amante|betrayal|cheat(?:ed|ing)?|infidelity)\b/u,
    visual: /\b(?:namorad[oa]|noiv[oa]|espos[oa]|marido|parceir[oa]|casal)\b.{0,120}\b(?:beij(?:ou|ando)|mao na perna|na cama|toque intimo)\b/u,
  },
  {
    term: "era do job",
    transcript: /\b(?:era do job|do job|garota de programa|prostitut[ao]|prostituicao|sex worker|sex work)\b/u,
    visual: /$a/u,
  },
  {
    term: "cara de pau",
    transcript: /\b(?:cara de pau|sem[- ]?vergonha|shameless)\b/u,
    visual: /(?:\bdorm(?:e|ia|iu|indo)\b.{0,60}\b(?:no trabalho|durante o expediente|na mesa do escritorio|enquanto (?:os )?outros trabalham)\b|\b(?:ele|ela|o homem|a mulher|o funcionario|a funcionaria)\s+(?:ment(?:e|ia|iu)|engan(?:a|ava|ou))\b|\b(?:foi|era)\s+flagrad[oa]\s+(?:mentindo|enganando|dormindo no trabalho)\b)/u,
  },
];

function normalized(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Adds only catalogue-backed opportunities that the model may have omitted.
 * Every candidate is passed through the same local/timestamp grounding gate as
 * model proposals, so this never turns a global theme or title into evidence.
 */
export function deriveGroundedPolemicOpportunities(
  segments: any[],
  frames: any[],
  duration: number | null,
): GroundedPolemicOpportunity[] {
  const candidates: GroundedPolemicOpportunity[] = [];
  for (const rule of AUTO_POLEMIC_RULES) {
    const matchingTimestamps = [
      ...segments.filter((item: any) => rule.transcript.test(normalized(item?.text))).flatMap((item: any) => {
        const start = strictFiniteNumber(item?.start);
        const end = strictFiniteNumber(item?.end);
        return start === null || end === null ? [] : [Math.max(0, (start + end) / 2)];
      }),
      ...frames.filter((item: any) => rule.visual.test(normalized([
        item?.description,
        item?.main_action,
        item?.text_on_screen,
      ].filter(Boolean).join(" ")))).flatMap((item: any) => {
        const timestamp = strictFiniteNumber(item?.timestamp_seconds);
        return timestamp === null ? [] : [timestamp];
      }),
    ].sort((left, right) => left - right);
    for (const timestamp of matchingTimestamps) {
      const grounded = groundPolemicOpportunity({
        term: rule.term,
        timestamp_seconds: timestamp,
      }, segments, frames, duration);
      if (!grounded) continue;
      candidates.push(grounded);
      break;
    }
  }
  return candidates.filter((item, index, all) => all.findIndex((candidate) =>
    candidate.term === item.term && Math.abs(candidate.timestamp_seconds - item.timestamp_seconds) < 0.01
  ) === index).slice(0, 12);
}
