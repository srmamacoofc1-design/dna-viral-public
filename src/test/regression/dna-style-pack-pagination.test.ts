import { describe, expect, it } from "vitest";
import {
  buildDnaStylePack,
  STYLE_PACK_PAGE_SIZE,
  validateDnaStylePack,
} from "@/lib/dna-style-pack";

type Row = Record<string, any>;
type TableStore = Record<string, Row[]>;
type PageTracker = Record<string, Array<[number, number]>>;

const EVIDENCE_TABLES = [
  "video_blocks",
  "block_semantic_patterns",
  "visual_block_analysis",
  "text_visual_alignment",
  "block_word_patterns",
] as const;

function createLargePresetFixture(): { tables: TableStore; videoIds: string[] } {
  const videoIds = Array.from({ length: 50 }, (_, index) => `video-${String(index).padStart(2, "0")}`);
  const videos = videoIds.map((id, index) => ({
    id,
    titulo: index % 2
      ? "VOCÊ NÃO VAI ACREDITAR NESTE TÍTULO!!!"
      : "SEGREDO PROIBIDO REVELADO AGORA!!!",
    status: "completed",
    approved_for_global: true,
    views: 100_000 + index,
    likes: 10_000,
    comments: 500,
    engagement_rate: 0.1,
    duracao: 32,
    idioma: "pt",
    hook_phrase_pattern: null,
    hook_type_verbal: null,
    hook_emotion_verbal: null,
    hook_emotion_intensity: null,
    narrative_progression_type: "escalada_causal",
    micro_turn_count: 7,
    micro_turn_types: ["descoberta", "consequencia"],
  }));

  const videoBlocks: Row[] = [];
  const semantics: Row[] = [];
  const visuals: Row[] = [];
  const alignments: Row[] = [];
  const words: Row[] = [];
  const blockTypes = ["hook", "desenvolvimento", "payoff"];
  let rowIndex = 0;

  // 21 blocks x 50 videos = 1,050 rows in every scoped evidence table.
  // This deliberately crosses the standard 1,000-row PostgREST ceiling.
  for (const [videoIndex, videoId] of videoIds.entries()) {
    for (let localIndex = 0; localIndex < 21; localIndex++) {
      const suffix = String(rowIndex).padStart(4, "0");
      const blockId = `block-${suffix}`;
      const blockType = blockTypes[localIndex % blockTypes.length];
      const text = blockType === "hook"
        ? `Ninguém esperava que o segredo do vídeo ${videoIndex} aparecesse agora.`
        : blockType === "desenvolvimento"
          ? `Então a ação muda e revela uma nova consequência para o vídeo ${videoIndex}.`
          : `No final, tudo se resolve quando a verdade do vídeo ${videoIndex} aparece.`;

      videoBlocks.push({
        id: blockId,
        video_id: videoId,
        tipo_bloco: blockType,
        texto: text,
        tempo_inicio: localIndex * 1.5,
        tempo_fim: localIndex * 1.5 + 1.5,
        emocao: "surpresa",
        funcao_narrativa: blockType,
        semantic_shift_score: 0.8,
        visual_shift_score: 0.8,
        block_density_score: 0.9,
        elemento_visual: "mudança",
        descricao_visual: "A personagem transforma um objeto.",
      });
      semantics.push({
        id: `semantic-${suffix}`,
        block_id: blockId,
        video_id: videoId,
        block_type: blockType,
        block_emotional_intensity: 4,
        block_emotional_type: "surpresa",
        block_verbal_tone: "urgente",
        weighted_phrase_score: 0.9,
        weighted_word_score: 0.9,
      });
      visuals.push({
        id: `visual-${suffix}`,
        block_id: blockId,
        video_id: videoId,
        block_type: blockType,
        main_action: "A personagem transforma um objeto.",
        scene_description: "Uma mudança visível acontece na cena.",
        visual_emotion: "surpresa",
        avg_visual_intensity_score: 4,
        scene_change_count: 1,
        scene_change_detected: true,
        confidence_score: 0.95,
      });
      alignments.push({
        id: `alignment-${suffix}`,
        block_id: blockId,
        video_id: videoId,
        alignment_score: 0.95,
        action_alignment_score: 0.95,
        emotion_alignment_score: 0.9,
        intensity_alignment_score: 0.9,
        visual_action: "transformação",
        visual_emotion: "surpresa",
        confidence_score: 0.95,
      });
      words.push({
        id: `word-${suffix}`,
        block_id: blockId,
        video_id: videoId,
        word: rowIndex === 1049 ? "palavrafinal" : `estrategia${suffix}`,
        is_emotional: false,
        is_impact: rowIndex === 1049,
        is_dominant: rowIndex === 1049,
      });
      rowIndex++;
    }
  }

  return {
    videoIds,
    tables: {
      videos,
      video_blocks: videoBlocks,
      block_semantic_patterns: semantics,
      visual_block_analysis: visuals,
      text_visual_alignment: alignments,
      block_word_patterns: words,
      verbal_layer_patterns: [],
    },
  };
}

function createPostgrestCappedClient(
  tables: TableStore,
  fail?: { table: string; rangeStart: number },
): { client: any; pages: PageTracker } {
  const pages: PageTracker = {};

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private orderColumn: string | null = null;
    private ascending = true;
    private start: number | null = null;
    private end: number | null = null;
    private exactCount = false;

    constructor(private readonly table: string) {}

    select(_columns: string, options?: { count?: string }): this {
      this.exactCount = options?.count === "exact";
      return this;
    }

    eq(column: string, value: unknown): this {
      this.filters.push(row => row[column] === value);
      return this;
    }

    gt(column: string, value: number): this {
      this.filters.push(row => Number(row[column]) > value);
      return this;
    }

    in(column: string, values: unknown[]): this {
      const allowed = new Set(values);
      this.filters.push(row => allowed.has(row[column]));
      return this;
    }

    order(column: string, options?: { ascending?: boolean }): this {
      this.orderColumn = column;
      this.ascending = options?.ascending !== false;
      return this;
    }

    range(start: number, end: number): this {
      this.start = start;
      this.end = end;
      (pages[this.table] ||= []).push([start, end]);
      return this;
    }

    private execute(): { data: Row[] | null; error: any; count: number | null } {
      if (fail?.table === this.table && fail.rangeStart === this.start) {
        return {
          data: null,
          error: { code: "TEST_PAGE_FAILURE", message: "second page unavailable" },
          count: null,
        };
      }

      let rows = [...(tables[this.table] || [])].filter(row => this.filters.every(filter => filter(row)));
      if (this.orderColumn) {
        const direction = this.ascending ? 1 : -1;
        rows.sort((left, right) => String(left[this.orderColumn!]).localeCompare(String(right[this.orderColumn!])) * direction);
      }
      const count = this.exactCount ? rows.length : null;
      const start = this.start ?? 0;
      const requestedEnd = this.end ?? (start + STYLE_PACK_PAGE_SIZE - 1);
      // Simulate the server-side max-rows setting even if a caller asks for more.
      const cappedEnd = Math.min(requestedEnd, start + STYLE_PACK_PAGE_SIZE - 1);
      rows = rows.slice(start, cappedEnd + 1);
      return { data: rows, error: null, count };
    }

    then<TResult1 = any, TResult2 = never>(
      onfulfilled?: ((value: ReturnType<Query["execute"]>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }
  }

  return {
    client: { from: (table: string) => new Query(table) },
    pages,
  };
}

describe("DNA Style Pack — paginação PostgREST", () => {
  it("ignora títulos apelativos e deriva o hook somente da fala do bloco hook", async () => {
    const fixture = createLargePresetFixture();
    const firstHook = fixture.tables.video_blocks.find(row =>
      row.video_id === fixture.videoIds[0] && row.tipo_bloco === "hook"
    )!;
    const secondHook = fixture.tables.video_blocks.find(row =>
      row.video_id === fixture.videoIds[1] && row.tipo_bloco === "hook"
    )!;
    firstHook.texto = "Ninguém percebeu o que aconteceu naquela sala silenciosa.";
    secondHook.texto = firstHook.texto;

    const equalSpeech = await buildDnaStylePack("pt", {
      videoIds: fixture.videoIds,
      client: createPostgrestCappedClient(fixture.tables).client,
    });
    const strategyByVideo = new Map(equalSpeech!.video_strategies!.map(strategy =>
      [strategy.video_id, strategy.hook_strategy]
    ));
    expect(strategyByVideo.get(fixture.videoIds[0])).toEqual(strategyByVideo.get(fixture.videoIds[1]));

    fixture.tables.videos[0].titulo = "TÍTULO TOTALMENTE DIFERENTE E MAIS APELÃO";
    fixture.tables.videos[1].titulo = "OUTRO TÍTULO QUE NÃO FOI FALADO";
    const changedTitles = await buildDnaStylePack("pt", {
      videoIds: fixture.videoIds,
      client: createPostgrestCappedClient(fixture.tables).client,
    });
    const afterTitleByVideo = new Map(changedTitles!.video_strategies!.map(strategy =>
      [strategy.video_id, strategy.hook_strategy]
    ));
    expect(afterTitleByVideo.get(fixture.videoIds[0])).toEqual(strategyByVideo.get(fixture.videoIds[0]));
    expect(afterTitleByVideo.get(fixture.videoIds[1])).toEqual(strategyByVideo.get(fixture.videoIds[1]));

    secondHook.texto = "Você descobriu por que ninguém voltou?";
    const changedSpeech = await buildDnaStylePack("pt", {
      videoIds: fixture.videoIds,
      client: createPostgrestCappedClient(fixture.tables).client,
    });
    const changedSpeechByVideo = new Map(changedSpeech!.video_strategies!.map(strategy =>
      [strategy.video_id, strategy.hook_strategy]
    ));
    expect(changedSpeechByVideo.get(fixture.videoIds[1])).not.toEqual(strategyByVideo.get(fixture.videoIds[1]));
  });

  it("consolida 50 vídeos e todas as linhas após o limite de 1.000", async () => {
    const fixture = createLargePresetFixture();
    const { client, pages } = createPostgrestCappedClient(fixture.tables);

    const pack = await buildDnaStylePack("pt", {
      // A duplicata também prova que o tamanho do escopo não é inflado.
      videoIds: [...fixture.videoIds, fixture.videoIds[0]],
      client,
    });

    expect(STYLE_PACK_PAGE_SIZE).toBe(1000);
    expect(pack).not.toBeNull();
    expect(pack!.scope_video_ids).toHaveLength(50);
    expect(pack!.total_videos).toBe(50);
    expect(pack!.video_strategies).toHaveLength(50);
    expect(pack!.video_strategies!.every(video => video.evidence_coverage === 1)).toBe(true);
    expect(pack!.block_styles.find(block => block.block_type === "payoff")?.weighted_words)
      .toContain("palavrafinal");
    expect(validateDnaStylePack(pack).ready).toBe(true);

    for (const table of EVIDENCE_TABLES) {
      expect(pages[table]).toEqual([[0, 999], [1000, 1999]]);
    }
  });

  it("falha fechado quando qualquer página de evidência não pode ser lida", async () => {
    const fixture = createLargePresetFixture();
    const { client } = createPostgrestCappedClient(fixture.tables, {
      table: "visual_block_analysis",
      rangeStart: 1000,
    });

    await expect(buildDnaStylePack("pt", { videoIds: fixture.videoIds, client }))
      .rejects.toThrow("DNA style pack query failed [visual_block_analysis]: TEST_PAGE_FAILURE");
  });
});
