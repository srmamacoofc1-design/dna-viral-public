import { describe, expect, it } from "vitest";
import { deriveGroundedPolemicOpportunities } from "../../../supabase/functions/_shared/grounded-polemic-opportunity";
import {
  factualTranscriptSegmentsForOperationalProfile,
  filterExplicitMusicOrSungSegments,
  isExplicitMusicOrSungText,
} from "../../../supabase/functions/_shared/operational-transcript-evidence";

describe("operational transcript factual authority", () => {
  it("recognizes provider music and singing markers without discarding ordinary narration", () => {
    expect(isExplicitMusicOrSungText("[Música de fundo]")).toBe(true);
    expect(isExplicitMusicOrSungText("[cantando] ela era do job e me traiu")).toBe(true);
    expect(isExplicitMusicOrSungText("♪ ela era do job ♪")).toBe(true);
    expect(isExplicitMusicOrSungText("Ele estava cantando quando abriu a porta.")).toBe(false);

    expect(filterExplicitMusicOrSungSegments([
      { start: 0, end: 2, text: "[Música]" },
      { start: 2, end: 4, text: "O homem abriu a porta." },
    ])).toEqual([{ start: 2, end: 4, text: "O homem abriu a porta." }]);
  });

  it("keeps music and sung rows out of reaction and visual-story authority", () => {
    const raw = [{ start: 0, end: 4, text: "[cantando] ela era do job e me traiu" }];
    for (const profile of [
      { audio_mode: "music_or_silent", narrative_mode: "construct_visual_story" },
      { audio_mode: "music_or_silent", narrative_mode: "reaction_reframe" },
      { audio_mode: "mixed_speech", narrative_mode: "reaction_reframe" },
    ]) {
      expect(factualTranscriptSegmentsForOperationalProfile(raw, profile)).toEqual([]);
    }
  });

  it("preserves genuine spoken commentary in a spoken reaction without treating lyrics as speech", () => {
    const raw = [
      { start: 0, end: 3, text: "[Música]" },
      { start: 3, end: 7, text: "O homem explica que a porta acabou de abrir." },
      { start: 7, end: 10, text: "[cantando] ela era do job" },
    ];

    expect(factualTranscriptSegmentsForOperationalProfile(raw, {
      audio_mode: "mixed_speech",
      narrative_mode: "reaction_reframe",
    })).toEqual([
      { start: 3, end: 7, text: "O homem explica que a porta acabou de abrir." },
    ]);
  });

  it("keeps a short but authoritative spoken-story segment", () => {
    const raw = [{ start: 31, end: 34, text: "Ele voltou apenas para salvar o filho." }];
    expect(factualTranscriptSegmentsForOperationalProfile(raw, {
      audio_mode: "mixed_speech",
      narrative_mode: "preserve_spoken_story",
    })).toEqual(raw);
  });

  it("prevents sung betrayal and sex-work words from becoming polemic evidence", () => {
    const raw = [{ start: 0, end: 4, text: "[cantando] ela era do job e me traiu" }];
    const safeSegments = factualTranscriptSegmentsForOperationalProfile(raw, {
      audio_mode: "music_or_silent",
      narrative_mode: "reaction_reframe",
    });
    const result = deriveGroundedPolemicOpportunities(
      safeSegments,
      [{ timestamp_seconds: 2, description: "Uma piloto abre a porta de casa.", main_action: "A piloto entra." }],
      10,
    );
    expect(result.some((item) => ["traição", "era do job"].includes(item.term))).toBe(false);
  });
});
