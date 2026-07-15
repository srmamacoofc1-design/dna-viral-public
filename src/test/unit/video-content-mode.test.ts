import { describe, expect, it } from "vitest";
import { resolveOperationalVideoContentProfile } from "../../../supabase/functions/_shared/video-content-mode";

const frames = (description: string) => Array.from({ length: 8 }, (_, index) => ({
  timestamp_seconds: index * 3,
  description,
  main_action: description,
}));

describe("operational video content mode", () => {
  it("preserves a substantial spoken story", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 30,
      transcription_segments: [
        { start: 0, end: 10, text: "Este homem não queria trabalhar e inventou uma desculpa para todos." },
        { start: 10, end: 25, text: "Depois o chefe descobriu a mentira e mostrou o que ele estava fazendo." },
      ],
      visual_frames: frames("homem dentro de uma oficina"),
    });
    expect(profile.narrative_mode).toBe("preserve_spoken_story");
    expect(profile.audio_mode).not.toBe("music_or_silent");
  });

  it("detects a reaction layout even when there is only music", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 24,
      transcription_segments: [{ start: 0, end: 24, text: "[Música]" }],
      visual_frames: frames("tela dividida com facecam; criador reagindo ao vídeo sobreposto"),
    });
    expect(profile.presentation_mode).toBe("reaction");
    expect(profile.audio_mode).toBe("music_or_silent");
    expect(profile.narrative_mode).toBe("reaction_reframe");
    expect(profile.writer_policy.join(" ")).toContain("When speech is absent");
  });

  it("keeps genuine spoken commentary available inside a reaction layout", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 30,
      transcription_segments: [{
        start: 1,
        end: 8,
        text: "O narrador explica que a mulher abriu a porta e encontrou uma caixa escondida.",
      }],
      visual_frames: [
        {
          timestamp_seconds: 0,
          description: "uma pessoa observa a tela",
          main_action: "observa em silêncio",
          subject_role: "reactor",
          layer: "reactor",
          region: "bottom",
          subject_id: "reactor_1",
        },
        {
          timestamp_seconds: 0,
          description: "uma mulher abre uma porta no vídeo incorporado",
          main_action: "abre a porta",
          subject_role: "embedded",
          layer: "embedded",
          region: "top",
          subject_id: "embedded_subject_1",
        },
      ],
      topic_analysis: {
        semantic_alignment_rules: {
          input_profile: {
            presentation_format: "reaction",
            audio_role: "narration",
            narrative_material: "partial_spoken_story",
            generation_mode: "reaction_reframe",
          },
        },
      },
    });

    expect(profile.presentation_mode).toBe("reaction");
    expect(profile.audio_mode).not.toBe("music_or_silent");
    expect(profile.narrative_mode).toBe("reaction_reframe");
    expect(profile.classification_reasons).toContain("spoken_commentary_available_in_reaction");
    expect(profile.writer_policy.join(" ")).toContain("spoken reactor/commentator narration");
    expect(profile.writer_policy.join(" ")).toContain("separate subjects");
  });

  it("uses structured reactor and embedded frame metadata even when descriptions are neutral", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 18,
      transcription_segments: [],
      visual_frames: [
        {
          timestamp_seconds: 0,
          description: "uma pessoa olha para a tela",
          main_action: "olha em silencio",
          subject_role: "reactor",
          layer: "reactor",
          region: "top",
          subject_id: "reactor_1",
        },
        {
          timestamp_seconds: 0,
          description: "um personagem abre uma porta",
          main_action: "abre a porta",
          subject_role: "embedded",
          layer: "embedded",
          region: "bottom",
          subject_id: "embedded_character_1",
        },
      ],
    });

    expect(profile.presentation_mode).toBe("reaction");
    expect(profile.narrative_mode).toBe("reaction_reframe");
    expect(profile.reaction_cue_count).toBeGreaterThanOrEqual(2);
    expect(profile.classification_reasons).toContain("reaction_layout_detected_in_structured_frame_metadata");
  });

  it("detects a reactor described in a separate bottom layer when model metadata is conservative", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 59,
      transcription_segments: [],
      visual_frames: frames(
        "An animated officer acts in the main video; a man is visible in the bottom layer, reacting with a neutral expression.",
      ).map((frame) => ({ ...frame, subject_role: "embedded", layer: "embedded" })),
    });

    expect(profile.presentation_mode).toBe("reaction");
    expect(profile.narrative_mode).toBe("reaction_reframe");
    expect(profile.classification_reasons).toContain("reaction_layout_detected_in_frames");
  });

  it("does not treat embedded-only metadata as proof of a reaction layout", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 18,
      transcription_segments: [],
      visual_frames: frames("um personagem abre uma porta").map((frame) => ({
        ...frame,
        subject_role: "embedded",
        layer: "embedded",
      })),
    });

    expect(profile.presentation_mode).toBe("direct");
    expect(profile.narrative_mode).toBe("construct_visual_story");
    expect(profile.reaction_cue_count).toBe(0);
  });

  it("constructs a visual story for a direct music-only clip", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 18,
      transcription_segments: [],
      visual_frames: frames("homem abre uma caixa e observa o objeto"),
    });
    expect(profile.presentation_mode).toBe("direct");
    expect(profile.narrative_mode).toBe("construct_visual_story");
  });

  it("accepts a multimodal behavioral reframe but refuses spoken-story mode without speech", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 20,
      transcription_segments: [],
      visual_frames: frames("homem deitado enquanto outras pessoas trabalham"),
      topic_analysis: {
        semantic_alignment_rules: {
          input_profile: {
            generation_mode: "preserve_spoken_story",
            narrative_material: "single_visible_behavior",
          },
        },
      },
    });
    expect(profile.narrative_mode).toBe("behavioral_reframe");
  });

  it("does not confuse a character reacting inside a direct story with a reaction layout", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 20,
      transcription_segments: [
        { start: 0, end: 12, text: "O cachorro reagiu ao gato e depois os dois entraram em uma briga." },
      ],
      visual_frames: frames("O cachorro reage ao gato costurado no mesmo corpo."),
      topic_analysis: {
        semantic_alignment_rules: {
          input_profile: {
            presentation_format: "direct",
            audio_role: "narration",
            narrative_material: "complete_spoken_story",
            generation_mode: "preserve_spoken_story",
          },
        },
      },
    });
    expect(profile.presentation_mode).toBe("direct");
    expect(profile.narrative_mode).toBe("preserve_spoken_story");
  });

  it("keeps a real short narration instead of calling it music or silence", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 5,
      transcription_segments: [{ start: 0, end: 5, text: "Este homem fugiu quando a porta abriu." }],
      visual_frames: frames("homem corre pela porta"),
    });
    expect(profile.audio_mode).toBe("spoken_narration");
    expect(profile.narrative_mode).toBe("preserve_spoken_story");
  });

  it("preserves a decisive sparse narration in a long video when multimodal signals confirm it", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 60,
      transcription_segments: [{
        start: 29,
        end: 33,
        text: "Ele voltou apenas para salvar o filho.",
      }],
      visual_frames: frames("homem volta e abre uma porta"),
      topic_analysis: {
        semantic_alignment_rules: {
          input_profile: {
            presentation_format: "direct",
            audio_role: "narration",
            narrative_material: "partial_spoken_story",
            generation_mode: "preserve_spoken_story",
          },
        },
      },
    });

    expect(profile.spoken_word_count).toBeGreaterThanOrEqual(4);
    expect(profile.speech_density_words_per_second).toBeLessThan(0.32);
    expect(profile.audio_mode).toBe("mixed_speech");
    expect(profile.narrative_mode).toBe("preserve_spoken_story");
    expect(profile.classification_reasons).toContain("ai_confirmed_sparse_spoken_story");
  });

  it("rejects a contradictory reaction generation mode for a direct layout", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 20,
      transcription_segments: [],
      visual_frames: frames("homem abre uma caixa em tela cheia"),
      topic_analysis: {
        semantic_alignment_rules: {
          input_profile: {
            presentation_format: "direct",
            audio_role: "music_only",
            narrative_material: "visual_sequence_only",
            generation_mode: "reaction_reframe",
          },
        },
      },
    });
    expect(profile.presentation_mode).toBe("direct");
    expect(profile.narrative_mode).toBe("construct_visual_story");
  });

  it("lets strong spoken-story evidence override a contradictory music-only label", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 12,
      transcription_segments: [{
        start: 0,
        end: 12,
        text: "O homem abriu a porta, encontrou a caixa e contou por que tinha voltado para casa.",
      }],
      visual_frames: frames("homem abre a porta e encontra uma caixa"),
      topic_analysis: {
        semantic_alignment_rules: {
          input_profile: {
            presentation_format: "direct",
            audio_role: "music_only",
            narrative_material: "complete_spoken_story",
            generation_mode: "preserve_spoken_story",
          },
        },
      },
    });
    expect(profile.audio_mode).not.toBe("music_or_silent");
    expect(profile.narrative_mode).toBe("preserve_spoken_story");
  });

  it("does not classify marked song lyrics as a spoken story", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 24,
      transcription_segments: Array.from({ length: 4 }, (_, index) => ({
        start: index * 6,
        end: (index + 1) * 6,
        text: "[cantando] ela era do job e me traiu sob as luzes",
      })),
      visual_frames: frames("animação muda mostra uma piloto voltando para casa"),
    });
    expect(profile.spoken_word_count).toBe(0);
    expect(profile.audio_mode).toBe("music_or_silent");
    expect(profile.narrative_mode).toBe("construct_visual_story");
  });

  it("lets a visual-only music profile override long unmarked lyric text", () => {
    const profile = resolveOperationalVideoContentProfile({
      duration_seconds: 24,
      transcription_segments: Array.from({ length: 4 }, (_, index) => ({
        start: index * 6,
        end: (index + 1) * 6,
        text: "baby love tonight dancing forever under all the lights",
      })),
      visual_frames: frames("animação muda mostra uma piloto voltando para casa"),
      topic_analysis: {
        semantic_alignment_rules: {
          input_profile: {
            presentation_format: "direct",
            audio_role: "music_only",
            narrative_material: "visual_sequence_only",
            generation_mode: "construct_visual_story",
          },
        },
      },
    });
    expect(profile.audio_mode).toBe("music_or_silent");
    expect(profile.narrative_mode).toBe("construct_visual_story");
  });
});
