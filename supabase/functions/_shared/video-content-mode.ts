import { isExplicitMusicOrSungText } from "./operational-transcript-evidence.ts";

export type OperationalPresentationMode = "direct" | "reaction";
export type OperationalAudioMode = "spoken_narration" | "mixed_speech" | "music_or_silent";
export type OperationalNarrativeMode =
  | "preserve_spoken_story"
  | "reaction_reframe"
  | "construct_visual_story"
  | "behavioral_reframe";

export interface OperationalVideoContentProfile {
  contract_version: 1;
  presentation_mode: OperationalPresentationMode;
  audio_mode: OperationalAudioMode;
  narrative_mode: OperationalNarrativeMode;
  spoken_word_count: number;
  speech_density_words_per_second: number;
  reaction_cue_count: number;
  confidence: number;
  classification_reasons: string[];
  writer_policy: string[];
}

type SegmentLike = { start?: unknown; end?: unknown; text?: unknown };
type FrameLike = {
  description?: unknown;
  main_action?: unknown;
  scene_type?: unknown;
  visual_elements?: unknown;
  text_on_screen?: unknown;
  subject_role?: unknown;
  layer?: unknown;
  region?: unknown;
  subject_id?: unknown;
};

const REACTION_CUE_PATTERNS = [
  /\b(?:reaction|react) (?:layout|video|window|panel|face\s*cam)\b/,
  /\bduet(?:o)?\b/,
  /\bstitch\b/,
  /\bface\s*cam\b|\bfacecam\b/,
  /\bweb\s*cam\b|\bwebcam\b/,
  /\bsplit[ -]?screen\b/,
  /\b(?:tela|pantalla) dividida\b/,
  /\bvideo (?:sobreposto|incorporado|embutido)\b/,
  /\bjanela (?:do|de um|da) (?:criador|reagente|comentarista)\b/,
  /\b(?:criador|host|comentarista|apresentador|pessoa|homem|mulher)\b.{0,45}\b(?:reagindo ao|reage ao|reacting to|reaccionando al)\b.{0,35}\b(?:video|clip|animacao|animation)\b/,
  /\b(?:top|bottom|upper|lower|left|right|superior|inferior)\s+(?:layer|panel|window|overlay|corner|camada|painel|janela|canto)\b.{0,100}\b(?:reacting|reacts?|reaction|reagindo|reage|reacao|reaccionando)\b/,
  /\b(?:reacting|reacts?|reaction|reagindo|reage|reacao|reaccionando)\b.{0,100}\b(?:top|bottom|upper|lower|left|right|superior|inferior)\s+(?:layer|panel|window|overlay|corner|camada|painel|janela|canto)\b/,
] as const;

const NON_SPEECH_ONLY = /^(?:\[?\s*(?:musica|music|song|instrumental|som ambiente|audio)\s*\]?|♪+|♫+)$/u;
const VALID_AI_MODES = new Set<OperationalNarrativeMode>([
  "preserve_spoken_story",
  "reaction_reframe",
  "construct_visual_story",
  "behavioral_reframe",
]);

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: unknown): number {
  return normalized(value).match(/[a-z0-9]+/g)?.length || 0;
}

function meaningfulSegmentText(segment: SegmentLike): string {
  const text = normalized(segment?.text);
  return !text || NON_SPEECH_ONLY.test(text) || isExplicitMusicOrSungText(segment?.text) ? "" : text;
}

function frameCorpus(frames: FrameLike[]): string {
  return frames.map((frame) => [
    frame?.description,
    frame?.main_action,
    frame?.scene_type,
    Array.isArray(frame?.visual_elements) ? frame.visual_elements.join(" ") : frame?.visual_elements,
    frame?.text_on_screen,
  ].map(normalized).filter(Boolean).join(" ")).join(" ");
}

function structuredFrameRole(value: unknown): "reactor" | "embedded" | "unknown" | null {
  const role = normalized(value);
  return role === "reactor" || role === "embedded" || role === "unknown" ? role : null;
}

function frameHasStructuredRole(frame: FrameLike, expected: "reactor" | "embedded"): boolean {
  return structuredFrameRole(frame?.subject_role) === expected || structuredFrameRole(frame?.layer) === expected;
}

function resolveAiInputProfile(context: any): any {
  const rules = context?.topic_analysis?.semantic_alignment_rules;
  return rules && typeof rules === "object" && rules.input_profile && typeof rules.input_profile === "object"
    ? rules.input_profile
    : null;
}

export function resolveOperationalVideoContentProfile(context: any): OperationalVideoContentProfile {
  const duration = Math.max(1, Number(context?.duration_seconds) || 1);
  const segments: SegmentLike[] = Array.isArray(context?.transcription_segments)
    ? context.transcription_segments
    : [];
  const frames: FrameLike[] = Array.isArray(context?.visual_frames) ? context.visual_frames : [];
  const fullTranscript = normalized(context?.transcription_full);
  const spokenText = segments.map(meaningfulSegmentText).filter(Boolean).join(" ") ||
    (!NON_SPEECH_ONLY.test(fullTranscript) && !isExplicitMusicOrSungText(context?.transcription_full)
      ? fullTranscript
      : "");
  const spokenWords = wordCount(spokenText);
  const speechDensity = Math.round((spokenWords / duration) * 100) / 100;
  const visuals = frameCorpus(frames);
  const aiProfile = resolveAiInputProfile(context);
  const aiPresentation = normalized(aiProfile?.presentation_format);
  const aiAudio = normalized(aiProfile?.audio_role);
  const aiNarrativeMaterial = normalized(aiProfile?.narrative_material);
  const aiNarrativeMode = String(aiProfile?.generation_mode || "").trim() as OperationalNarrativeMode;
  const textualReactionCueCount = REACTION_CUE_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(visuals) ? 1 : 0),
    0,
  );
  const structuredReactorFrameCount = frames.filter((frame) => frameHasStructuredRole(frame, "reactor")).length;
  const structuredEmbeddedFrameCount = frames.filter((frame) => frameHasStructuredRole(frame, "embedded")).length;
  // An explicit reactor role is itself compositing evidence; embedded alone is
  // not, because a direct/full-screen source must remain compatible with old
  // frame JSON and with conservative model output.
  const structuredReactionCueCount = structuredReactorFrameCount > 0
    ? 1 + Number(structuredEmbeddedFrameCount > 0)
    : 0;
  const reactionCueCount = textualReactionCueCount + structuredReactionCueCount;
  const reaction = structuredReactionCueCount > 0
    || textualReactionCueCount > 0
    || /^(?:reaction|split_screen_reaction)$/u.test(aiPresentation);
  const aiSaysMusicOnly = /music_only|musica|music|silent|silencio/u.test(aiAudio);
  const aiSaysSpokenAudio = /narration|dialogue|mixed|narracao|dialogo/u.test(aiAudio);
  const aiConfirmsSpokenStory = /complete_spoken_story|partial_spoken_story/u.test(aiNarrativeMaterial);
  const aiConfirmsVisualOnly = /visual_sequence_only|single_visible_behavior/u.test(aiNarrativeMaterial);
  const adaptiveSpokenWordMinimum = Math.min(12, Math.max(4, Math.ceil(duration * 0.45)));
  const hasCandidateSpeech = spokenWords >= adaptiveSpokenWordMinimum && speechDensity >= 0.32;
  // A short sentence can contain the decisive cause/reveal of a much longer
  // visual clip. Density alone must not erase it when the multimodal analysis
  // explicitly identifies both spoken audio and spoken narrative material.
  // Four real words is the same conservative floor used for very short clips;
  // the forensic transcriber has already removed song lyrics/singing markers.
  const hasAiConfirmedSparseSpeech = spokenWords >= 4
    && aiSaysSpokenAudio
    && aiConfirmsSpokenStory;
  const hasSubstantialSpeech = (hasCandidateSpeech || hasAiConfirmedSparseSpeech)
    && !(aiSaysMusicOnly && aiConfirmsVisualOnly && !aiConfirmsSpokenStory);
  const audioMode: OperationalAudioMode = !hasSubstantialSpeech
    ? "music_or_silent"
    : speechDensity >= 1.1
    ? "spoken_narration"
    : "mixed_speech";
  let narrativeMode: OperationalNarrativeMode;
  const reasons: string[] = [];

  if (reaction) {
    narrativeMode = "reaction_reframe";
    reasons.push(structuredReactionCueCount > 0
      ? "reaction_layout_detected_in_structured_frame_metadata"
      : textualReactionCueCount > 0
      ? "reaction_layout_detected_in_frames"
      : "reaction_format_detected_by_multimodal_topic_analysis");
  } else if (VALID_AI_MODES.has(aiNarrativeMode)
    && aiNarrativeMode !== "reaction_reframe"
    && !(aiNarrativeMode === "preserve_spoken_story" && !hasSubstantialSpeech)
    && !(aiNarrativeMode === "construct_visual_story" && hasSubstantialSpeech)
    && !(aiNarrativeMode === "behavioral_reframe" && hasSubstantialSpeech && !/single_visible_behavior/u.test(aiNarrativeMaterial))) {
    narrativeMode = aiNarrativeMode;
    reasons.push("multimodal_topic_generation_mode_accepted");
  } else if (hasSubstantialSpeech) {
    narrativeMode = "preserve_spoken_story";
    reasons.push("substantial_spoken_story_available");
  } else if (/single_visible_behavior|behavioral_reframe|comportamento/u.test(aiNarrativeMaterial)) {
    narrativeMode = "behavioral_reframe";
    reasons.push("single_visible_behavior_without_complete_story");
  } else {
    narrativeMode = "construct_visual_story";
    reasons.push("visual_timeline_is_primary_story_authority");
  }

  if (!hasSubstantialSpeech) reasons.push("spoken_story_absent_or_too_sparse");
  if (hasAiConfirmedSparseSpeech && !hasCandidateSpeech) {
    reasons.push("ai_confirmed_sparse_spoken_story");
  }
  if (reaction && hasSubstantialSpeech) reasons.push("spoken_commentary_available_in_reaction");
  if (frames.length > 0) reasons.push("time_bounded_visual_evidence_available");

  const writerPolicyByMode: Record<OperationalNarrativeMode, string[]> = {
    preserve_spoken_story: [
      "Preserve every locally spoken action, cause, relationship and consequence while improving hook, pacing and progression.",
      "Visual frames may correct or enrich the spoken story but never justify importing a fact from another time range.",
    ],
    reaction_reframe: [
      "Keep the reactor/commentator and the embedded source video as separate subjects; never merge their actions or identities.",
      hasSubstantialSpeech
        ? "Preserve locally spoken reactor/commentator narration as speech evidence, but never transfer the speaker's physical actions or identity to an embedded character; embedded actions must remain aligned with local pixels."
        : "When speech is absent, build the narration from the embedded visual sequence and use the reactor only when a visible reaction changes the beat.",
    ],
    construct_visual_story: [
      "Build a complete connective narration from the chronological visual actions because no reliable spoken story exists.",
      "Connect visible events with curiosity and tension, but never assert an off-screen identity, relationship, motive or ending.",
    ],
    behavioral_reframe: [
      "Turn the visible behavior into a clear everyday conflict and escalating commentary while preserving exactly what the person does.",
      "Popular criticism labels are optional and must be supported by the local action or explicit speech; sensitive allegations require explicit evidence.",
    ],
  };

  const confidenceBase = reaction
    ? 0.86
    : hasSubstantialSpeech
    ? 0.9
    : frames.length >= 5
    ? 0.84
    : 0.68;

  return {
    contract_version: 1,
    presentation_mode: reaction ? "reaction" : "direct",
    audio_mode: audioMode,
    narrative_mode: narrativeMode,
    spoken_word_count: spokenWords,
    speech_density_words_per_second: speechDensity,
    reaction_cue_count: reactionCueCount,
    confidence: Math.round(confidenceBase * 100) / 100,
    classification_reasons: [...new Set(reasons)],
    writer_policy: writerPolicyByMode[narrativeMode],
  };
}
