export type OperationalTranscriptSegmentLike = {
  start?: unknown;
  end?: unknown;
  text?: unknown;
};

export type OperationalTranscriptProfileLike = {
  audio_mode?: unknown;
  narrative_mode?: unknown;
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NON_SPEECH_LABEL = /^(?:[\[(]\s*)?(?:musica|music|instrumental|song|audio|som ambiente|background music|music playing|aplausos?|applause)(?:\s+(?:de fundo|playing|continues?|continua))?(?:\s*[\])])?[.!…]*$/u;
const SUNG_CONTENT_MARKER = /^(?:(?:[\[(]\s*(?:musica|music|cantando|canto|singing|sung|lyrics?|letra da musica|vocais?|vocals?)(?:\s+de fundo|\s+playing)?\s*[\])])|(?:(?:cantando|singing|sung|lyrics?|vocals?)\s*:))/u;
const MUSICAL_NOTE = /[♪♫♬♩]/u;

/**
 * Detects explicit provider markers for music/singing without guessing from
 * ordinary prose. A sentence such as "ele estava cantando quando saiu" stays
 * usable; "[cantando] ...", "singing: ..." and musical-note captions do not.
 */
export function isExplicitMusicOrSungText(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return true;
  const text = normalized(raw);
  return NON_SPEECH_LABEL.test(text)
    || SUNG_CONTENT_MARKER.test(text)
    || MUSICAL_NOTE.test(raw);
}

export function filterExplicitMusicOrSungSegments<T extends OperationalTranscriptSegmentLike>(
  segments: T[] | null | undefined,
): T[] {
  return (Array.isArray(segments) ? segments : []).filter((segment) =>
    !isExplicitMusicOrSungText(segment?.text)
  );
}

/**
 * Returns transcript rows that may serve as factual story authority.
 *
 * In visual-story mode the pixels own the story. A reaction layout, however,
 * is only a presentation format: it may contain either music or genuine
 * spoken commentary/narration. Keep real speech in a spoken/mixed reaction so
 * the Writer can preserve it while the content-profile policy keeps the
 * reactor and embedded subjects separate. Explicit music/singing markers are
 * always discarded, and music-only profiles remain fail-closed.
 */
export function factualTranscriptSegmentsForOperationalProfile<T extends OperationalTranscriptSegmentLike>(
  segments: T[] | null | undefined,
  profile: OperationalTranscriptProfileLike | null | undefined,
): T[] {
  const audioMode = String(profile?.audio_mode || "").trim();
  const narrativeMode = String(profile?.narrative_mode || "").trim();
  if (audioMode === "music_or_silent"
    || narrativeMode === "construct_visual_story") {
    return [];
  }
  return filterExplicitMusicOrSungSegments(segments);
}
