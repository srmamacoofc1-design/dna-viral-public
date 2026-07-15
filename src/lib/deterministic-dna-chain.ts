import type { DnaStylePack } from "@/lib/dna-style-pack";
import type { Database, Json } from "@/integrations/supabase/types";

type DnaInsert = Database["public"]["Tables"]["dna_objects"]["Insert"];
type TemplateInsert = Database["public"]["Tables"]["template_contexts"]["Insert"];
type BlueprintInsert = Database["public"]["Tables"]["blueprint_contexts"]["Insert"];

export const DNA_CHAIN_SEED_VERSION = "dna-preset-chain-v1";
export const DNA_CHAIN_MIN_VIDEOS = 3;

export interface DnaChainPresetEvidence {
  id: string;
  name: string;
  video_ids: string[];
  style_pack: DnaStylePack;
}

export interface DnaChainVideoEvidence {
  id: string;
  status: string;
  duracao: number | null;
  engagement_rate: number | null;
  engagement_rate_relative: number | null;
  engagement_percentile_display: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  emocao_predominante: string | null;
  cta_type: string | null;
}

export interface DnaChainBlockEvidence {
  id: string;
  video_id: string;
  bloco_id: number;
  tipo_bloco: string;
  tempo_inicio: number;
  tempo_fim: number;
  emocao: string | null;
}

export interface DnaChainCtaEvidence {
  video_id: string;
  cta_type?: string | null;
  cta_position_seconds?: number | null;
}

export interface DnaChainBuildInput {
  preset: DnaChainPresetEvidence;
  videos: DnaChainVideoEvidence[];
  blocks: DnaChainBlockEvidence[];
  ctas?: DnaChainCtaEvidence[];
}

export interface DnaChainAudit {
  seed_version: string;
  preset_id: string;
  preset_name: string;
  source_video_ids: string[];
  eligible_video_count: number;
  block_count: number;
  evidence_coverage: number;
  engagement_source: string | null;
  emotion_source: string;
  hook_sample_count: number;
  payoff_sample_count: number;
  dominant_sequence_count: number;
}

export interface DeterministicDnaChain {
  source_scope: string;
  template_name: string;
  blueprint_name: string;
  dna: DnaInsert;
  template: Omit<TemplateInsert, "source_dna_object_id">;
  blueprint: Omit<BlueprintInsert, "source_template_context_id">;
  audit: DnaChainAudit;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegative(value: unknown): number | null {
  const number = finite(value);
  return number != null && number >= 0 ? number : null;
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number != null && number > 0 ? number : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value: number | null, digits = 2): number | null {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function standardDeviation(values: number[]): number | null {
  const mean = average(values);
  if (mean == null || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function rankedCounts(values: Array<string | null | undefined>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const rawValue of values) {
    const value = rawValue?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([leftValue, leftCount], [rightValue, rightCount]) =>
    rightCount - leftCount || leftValue.localeCompare(rightValue),
  );
}

function asJson(value: unknown): Json {
  return value as Json;
}

function safeLabel(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function sequenceForVideo(blocks: DnaChainBlockEvidence[]): string[] {
  return [...blocks]
    .sort((left, right) =>
      Number(left.tempo_inicio) - Number(right.tempo_inicio)
      || Number(left.bloco_id) - Number(right.bloco_id)
      || left.id.localeCompare(right.id),
    )
    .map((block) => block.tipo_bloco?.trim())
    .filter(Boolean);
}

function selectEngagement(
  videos: DnaChainVideoEvidence[],
  pack: DnaStylePack,
): { value: number | null; source: string | null } {
  const candidates: Array<{ source: string; values: number[] }> = [
    {
      source: "engagement_rate_relative",
      values: videos.map((video) => nonNegative(video.engagement_rate_relative)).filter((value): value is number => value != null),
    },
    {
      source: "engagement_rate",
      values: videos.map((video) => nonNegative(video.engagement_rate)).filter((value): value is number => value != null),
    },
    {
      source: "likes_comments_over_views",
      values: videos.flatMap((video) => {
        const views = positive(video.views);
        const likes = nonNegative(video.likes);
        const comments = nonNegative(video.comments);
        return views != null && (likes != null || comments != null)
          ? [((likes ?? 0) + (comments ?? 0)) / views]
          : [];
      }),
    },
    {
      source: "preset_style_pack.video_strategies",
      values: (pack.video_strategies ?? [])
        .filter((strategy) => videos.some((video) => video.id === strategy.video_id))
        .map((strategy) => nonNegative(strategy.engagement_rate))
        .filter((value): value is number => value != null),
    },
    {
      source: "engagement_percentile_display",
      values: videos.map((video) => nonNegative(video.engagement_percentile_display)).filter((value): value is number => value != null),
    },
  ];

  const selected = candidates.find((candidate) => candidate.values.length > 0);
  return selected
    ? { value: round(average(selected.values), 6), source: selected.source }
    : { value: null, source: null };
}

function assertReadyPack(preset: DnaChainPresetEvidence): void {
  const pack = preset.style_pack;
  if (!pack || typeof pack !== "object") throw new Error("Preset DNA sem style_pack consolidado");
  if (pack.scope !== "preset") throw new Error("O style_pack selecionado não pertence a um preset");
  if (!Array.isArray(pack.block_styles) || pack.block_styles.length === 0) {
    throw new Error("Preset DNA sem estratégias de bloco consolidadas");
  }
  if (pack.strategy_contract?.fail_closed !== true) {
    throw new Error("Preset DNA sem contrato fail-closed; reconsolide o preset antes de criar a cadeia");
  }
  if (pack.strategy_contract?.protected_reference_required !== true) {
    throw new Error("Preset DNA sem proteção de referências; reconsolide o preset antes de criar a cadeia");
  }
}

/**
 * Deriva uma cadeia pronta exclusivamente de métricas e estruturas já
 * persistidas. Nenhum texto-fonte é copiado para DNA, Template ou Blueprint.
 */
export function buildDeterministicDnaChain(input: DnaChainBuildInput): DeterministicDnaChain {
  const presetVideoIds = [...new Set(input.preset.video_ids.filter(Boolean))].sort();
  if (presetVideoIds.length < DNA_CHAIN_MIN_VIDEOS) {
    throw new Error(`O preset precisa de pelo menos ${DNA_CHAIN_MIN_VIDEOS} vídeos distintos`);
  }
  assertReadyPack(input.preset);

  const presetVideoSet = new Set(presetVideoIds);
  const videoById = new Map(
    input.videos
      .filter((video) => presetVideoSet.has(video.id))
      .map((video) => [video.id, video] as const),
  );
  const missingVideoIds = presetVideoIds.filter((videoId) => !videoById.has(videoId));
  if (missingVideoIds.length) {
    throw new Error(`Preset referencia ${missingVideoIds.length} vídeo(s) inexistente(s) no banco`);
  }

  const incompleteVideoIds = presetVideoIds.filter((videoId) => videoById.get(videoId)?.status !== "completed");
  if (incompleteVideoIds.length) {
    throw new Error(`Preset contém ${incompleteVideoIds.length} vídeo(s) ainda não concluído(s)`);
  }

  const blocksByVideo = new Map<string, DnaChainBlockEvidence[]>();
  for (const block of input.blocks) {
    if (!presetVideoSet.has(block.video_id) || !block.tipo_bloco?.trim()) continue;
    const list = blocksByVideo.get(block.video_id) ?? [];
    list.push(block);
    blocksByVideo.set(block.video_id, list);
  }

  const eligibleVideoIds = presetVideoIds.filter((videoId) => (blocksByVideo.get(videoId)?.length ?? 0) >= 3);
  if (eligibleVideoIds.length < DNA_CHAIN_MIN_VIDEOS) {
    throw new Error(`Evidência insuficiente: só ${eligibleVideoIds.length} vídeo(s) têm pelo menos 3 blocos`);
  }
  const coverage = eligibleVideoIds.length / presetVideoIds.length;
  if (coverage < 0.8) {
    throw new Error(`Cobertura estrutural insuficiente: ${Math.round(coverage * 100)}% (mínimo 80%)`);
  }

  const eligibleVideos = eligibleVideoIds.map((videoId) => videoById.get(videoId)!);
  const durations = eligibleVideos.map((video) => positive(video.duracao));
  if (durations.some((duration) => duration == null)) {
    throw new Error("Todos os vídeos elegíveis precisam ter duração positiva");
  }
  const durationByVideo = new Map(eligibleVideos.map((video, index) => [video.id, durations[index]!]));

  const sequences = eligibleVideoIds.map((videoId) => sequenceForVideo(blocksByVideo.get(videoId) ?? []));
  const sequenceRanking = rankedCounts(sequences.map((sequence) => sequence.join(" → ")));
  const dominantSequence = sequenceRanking[0]?.[0] ?? null;
  const dominantSequenceCount = sequenceRanking[0]?.[1] ?? 0;
  if (!dominantSequence) throw new Error("Não foi possível derivar uma sequência estrutural dominante");

  const presenceByType = new Map<string, number>();
  for (const sequence of sequences) {
    for (const type of new Set(sequence)) {
      presenceByType.set(type, (presenceByType.get(type) ?? 0) + 1);
    }
  }

  const contractRequired = input.preset.style_pack.strategy_contract?.required_block_types ?? [];
  const minContractSources = Math.max(
    DNA_CHAIN_MIN_VIDEOS,
    input.preset.style_pack.strategy_contract?.min_source_videos ?? DNA_CHAIN_MIN_VIDEOS,
  );
  const requiredBlocks = [...new Set(contractRequired)]
    .filter((type) => (presenceByType.get(type) ?? 0) >= Math.min(minContractSources, eligibleVideoIds.length))
    .sort();
  if (requiredBlocks.length === 0) {
    throw new Error("Nenhum bloco obrigatório do contrato possui evidência em vídeos suficientes");
  }
  for (const coreType of ["hook", "desenvolvimento", "payoff"]) {
    if (!requiredBlocks.includes(coreType)) {
      throw new Error(`Contrato pronto exige o bloco obrigatório '${coreType}' com evidência suficiente`);
    }
  }

  const optionalBlocks = [...presenceByType.keys()]
    .filter((type) => !requiredBlocks.includes(type))
    .sort();

  const hookPositions: number[] = [];
  const payoffPositions: number[] = [];
  for (const videoId of eligibleVideoIds) {
    const duration = durationByVideo.get(videoId)!;
    const orderedBlocks = [...(blocksByVideo.get(videoId) ?? [])].sort((left, right) => left.tempo_inicio - right.tempo_inicio);
    const hook = orderedBlocks.find((block) => block.tipo_bloco === "hook");
    const payoff = orderedBlocks.find((block) => block.tipo_bloco === "payoff");
    const hookStart = hook ? nonNegative(hook.tempo_inicio) : null;
    const payoffStart = payoff ? nonNegative(payoff.tempo_inicio) : null;
    if (hookStart != null) hookPositions.push((hookStart / duration) * 100);
    if (payoffStart != null) payoffPositions.push((payoffStart / duration) * 100);
  }
  if (hookPositions.length < DNA_CHAIN_MIN_VIDEOS || payoffPositions.length < DNA_CHAIN_MIN_VIDEOS) {
    throw new Error("Evidência temporal insuficiente para hook/payoff em pelo menos 3 vídeos");
  }

  const blockEmotions = eligibleVideoIds.flatMap((videoId) =>
    (blocksByVideo.get(videoId) ?? []).map((block) => block.emocao),
  );
  let emotionRanking = rankedCounts(blockEmotions);
  let emotionSource = "video_blocks.emocao";
  if (emotionRanking.length === 0) {
    emotionRanking = rankedCounts(eligibleVideos.map((video) => video.emocao_predominante));
    emotionSource = "videos.emocao_predominante";
  }
  if (emotionRanking.length === 0) {
    emotionRanking = rankedCounts(input.preset.style_pack.block_styles.map((style) => style.dominant_emotion));
    emotionSource = "preset_style_pack.block_styles";
  }
  const dominantEmotion = emotionRanking[0]?.[0] ?? null;
  const secondaryEmotion = emotionRanking[1]?.[0] ?? null;
  if (!dominantEmotion) throw new Error("Evidência emocional ausente; a cadeia não pode ser marcada como pronta");

  const ctas = (input.ctas ?? []).filter((cta) => presetVideoSet.has(cta.video_id));
  const ctaTypeRanking = rankedCounts([
    ...eligibleVideos.map((video) => video.cta_type),
    ...ctas.map((cta) => cta.cta_type),
  ]);
  const ctaPositions = ctas
    .map((cta) => nonNegative(cta.cta_position_seconds))
    .filter((value): value is number => value != null);
  const dominantCtaType = ctaTypeRanking[0]?.[0] ?? null;
  const avgCtaPosition = round(average(ctaPositions), 2);

  const engagement = selectEngagement(eligibleVideos, input.preset.style_pack);
  if (engagement.value == null) {
    throw new Error("Evidência de engajamento ausente; a cadeia não pode ser marcada como pronta");
  }

  const avgHookPosition = round(average(hookPositions), 2)!;
  const avgPayoffPosition = round(average(payoffPositions), 2)!;
  const avgBlockCount = round(average(eligibleVideoIds.map((videoId) => blocksByVideo.get(videoId)!.length)), 1);
  const avgDuration = round(average(durations as number[]), 2);
  const sourceScope = `dna_preset:${input.preset.id}`;
  const cleanPresetName = safeLabel(input.preset.name) || input.preset.id;
  const templateName = `Template DNA — ${cleanPresetName}`;
  const blueprintName = `Blueprint DNA — ${cleanPresetName}`;
  const audit: DnaChainAudit = {
    seed_version: DNA_CHAIN_SEED_VERSION,
    preset_id: input.preset.id,
    preset_name: cleanPresetName,
    source_video_ids: eligibleVideoIds,
    eligible_video_count: eligibleVideoIds.length,
    block_count: eligibleVideoIds.reduce((sum, videoId) => sum + blocksByVideo.get(videoId)!.length, 0),
    evidence_coverage: round(coverage, 4)!,
    engagement_source: engagement.source,
    emotion_source: emotionSource,
    hook_sample_count: hookPositions.length,
    payoff_sample_count: payoffPositions.length,
    dominant_sequence_count: dominantSequenceCount,
  };

  const templateRules = [
    `Preservar a sequência estrutural dominante: ${dominantSequence}`,
    `Incluir todos os blocos obrigatórios: ${requiredBlocks.join(", ")}`,
    `Posicionar o hook próximo de ${avgHookPosition}% da duração`,
    `Posicionar o payoff próximo de ${avgPayoffPosition}% da duração`,
    `Manter a emoção estrutural dominante: ${dominantEmotion}`,
    "Aplicar somente estratégias abstratas; nunca copiar texto, entidades ou fatos das referências",
  ];
  if (dominantCtaType) templateRules.push(`Usar CTA do tipo dominante quando houver CTA: ${dominantCtaType}`);

  const dominantTypes = dominantSequence.split(/\s*→\s*/).filter(Boolean);
  const blockSequence = dominantTypes.map((blockType, index) => ({
    index: index + 1,
    block_type: blockType,
    is_required: requiredBlocks.includes(blockType),
  }));
  const blueprintRules = [
    "Seguir a ordem observada dos blocos sem reutilizar conteúdo-fonte",
    "Todos os blocos obrigatórios devem estar presentes",
    `Hook esperado em ${avgHookPosition}% (tolerância observada: ${standardDeviation(hookPositions) ?? "n/d"}%)`,
    `Payoff esperado em ${avgPayoffPosition}% (tolerância observada: ${standardDeviation(payoffPositions) ?? "n/d"}%)`,
    "Cada frase deve avançar a curiosidade até o payoff, respeitando o contrato do Preset DNA",
  ];

  return {
    source_scope: sourceScope,
    template_name: templateName,
    blueprint_name: blueprintName,
    dna: {
      source_scope: sourceScope,
      total_videos_used: eligibleVideoIds.length,
      dominant_sequence: dominantSequence,
      required_blocks: asJson(requiredBlocks),
      optional_blocks: asJson(optionalBlocks),
      avg_hook_time: avgHookPosition,
      avg_payoff_time: avgPayoffPosition,
      avg_cta_time: avgCtaPosition,
      avg_block_count: avgBlockCount,
      avg_video_duration: avgDuration,
      dominant_emotion: dominantEmotion,
      secondary_emotion: secondaryEmotion,
      dominant_cta_type: dominantCtaType,
      avg_engagement_rate: engagement.value,
      notes: JSON.stringify(audit),
      status: "ready",
    },
    template: {
      template_name: templateName,
      dominant_sequence: dominantSequence,
      required_blocks: asJson(requiredBlocks),
      optional_blocks: asJson(optionalBlocks),
      hook_position_pct: avgHookPosition,
      payoff_position_pct: avgPayoffPosition,
      cta_position_seconds: avgCtaPosition,
      dominant_emotion: dominantEmotion,
      secondary_emotion: secondaryEmotion,
      dominant_cta_type: dominantCtaType,
      avg_block_count: avgBlockCount,
      avg_video_duration: avgDuration,
      template_rules: asJson(templateRules),
      notes: JSON.stringify({ seed_version: DNA_CHAIN_SEED_VERSION, preset_id: input.preset.id }),
      status: "ready",
    },
    blueprint: {
      blueprint_name: blueprintName,
      block_sequence: asJson(blockSequence),
      block_count_expected: blockSequence.length,
      hook_expected_position_pct: avgHookPosition,
      payoff_expected_position_pct: avgPayoffPosition,
      cta_expected_position_seconds: avgCtaPosition,
      hook_position_tolerance_pct: standardDeviation(hookPositions),
      payoff_position_tolerance_pct: standardDeviation(payoffPositions),
      cta_position_tolerance_seconds: standardDeviation(ctaPositions),
      dominant_emotion: dominantEmotion,
      dominant_cta_type: dominantCtaType,
      blueprint_rules: asJson(blueprintRules),
      status: "ready",
    },
    audit,
  };
}
