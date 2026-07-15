import { describe, expect, it } from "vitest";
import type { DnaStylePack } from "@/lib/dna-style-pack";
import {
  buildDeterministicDnaChain,
  type DnaChainBlockEvidence,
  type DnaChainVideoEvidence,
} from "@/lib/deterministic-dna-chain";

const videoIds = ["video-a", "video-b", "video-c"];

const stylePack: DnaStylePack = {
  version: 3,
  target_lang: "pt",
  scope: "preset",
  scope_video_ids: videoIds,
  total_videos: 3,
  dominant_sequence: "hook → desenvolvimento → payoff",
  dominant_sequence_count: 3,
  block_styles: ["hook", "desenvolvimento", "payoff"].map((block_type) => ({
    block_type,
    examples: [],
    protected_examples: [],
    weighted_words: [],
    impact_phrases: [],
    dominant_emotion: "surpresa",
    avg_intensity: 80,
    median_words: 8,
    avg_words_per_second: 2,
  })),
  strategy_contract: {
    required_block_types: ["hook", "desenvolvimento", "payoff"],
    min_source_videos: 3,
    min_strategy_score: 0.82,
    max_exact_ngram: 3,
    max_content_similarity: 0.62,
    max_semantic_similarity: 0.78,
    protected_reference_required: true,
    semantic_copy_guard_required: true,
    fail_closed: true,
    visual_first_required: true,
  },
  built_at: "2026-07-13T00:00:00.000Z",
};

const videos: DnaChainVideoEvidence[] = videoIds.map((id, index) => ({
  id,
  status: "completed",
  duracao: 10,
  engagement_rate: 0.1 + index / 100,
  engagement_rate_relative: null,
  engagement_percentile_display: null,
  views: 1000,
  likes: 100,
  comments: 10,
  emocao_predominante: "surpresa",
  cta_type: null,
}));

const blocks: DnaChainBlockEvidence[] = videoIds.flatMap((video_id) => [
  { id: `${video_id}-1`, video_id, bloco_id: 1, tipo_bloco: "hook", tempo_inicio: 0, tempo_fim: 2, emocao: "surpresa" },
  { id: `${video_id}-2`, video_id, bloco_id: 2, tipo_bloco: "desenvolvimento", tempo_inicio: 2, tempo_fim: 8, emocao: "curiosidade" },
  { id: `${video_id}-3`, video_id, bloco_id: 3, tipo_bloco: "payoff", tempo_inicio: 8, tempo_fim: 10, emocao: "surpresa" },
]);

describe("deterministic DNA pipeline chain", () => {
  it("builds a linked-ready payload from observed preset evidence", () => {
    const chain = buildDeterministicDnaChain({
      preset: { id: "preset-1", name: "Preset teste", video_ids: videoIds, style_pack: stylePack },
      videos,
      blocks,
    });

    expect(chain.dna.status).toBe("ready");
    expect(chain.template.status).toBe("ready");
    expect(chain.blueprint.status).toBe("ready");
    expect(chain.dna.dominant_sequence).toBe("hook → desenvolvimento → payoff");
    expect(chain.dna.avg_hook_time).toBe(0);
    expect(chain.dna.avg_payoff_time).toBe(80);
    expect(chain.blueprint.block_count_expected).toBe(3);
    expect(chain.audit.evidence_coverage).toBe(1);
  });

  it("fails closed when payoff evidence is missing", () => {
    expect(() => buildDeterministicDnaChain({
      preset: { id: "preset-1", name: "Preset teste", video_ids: videoIds, style_pack: stylePack },
      videos,
      blocks: blocks.filter((block) => block.tipo_bloco !== "payoff"),
    })).toThrow(/Evidência|payoff/);
  });
});
