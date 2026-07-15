/**
 * Reconsolida e audita o preset Benji com o contrato DNA atual, sem reimportar
 * mídia. Use depois de `import-benji-preset-live.ts`.
 */

(globalThis as any).localStorage = (globalThis as any).localStorage ?? {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const SOURCE_URLS = [
  "https://www.youtube.com/shorts/vjqsNKq05iE",
  "https://www.youtube.com/shorts/adcOHqnTEZY",
  "https://www.youtube.com/shorts/FaZGE4SyeUc",
  "https://www.youtube.com/shorts/ybTdVLMyxTA",
  "https://www.youtube.com/shorts/NB3n-OFF7Nw",
  "https://www.youtube.com/shorts/9ZNzEeIZGOo",
  "https://www.youtube.com/shorts/sQdSlqAflKg",
] as const;

const PRESET_NAME = "Benji Curioso — Virais Jun-Jul 2026";
const REQUIRED_TABLES = [
  "video_transcripts",
  "video_blocks",
  "video_frames",
  "visual_block_analysis",
  "block_semantic_patterns",
  "block_verbal_analysis",
  "text_visual_alignment",
  "text_image_compatibility",
  "video_temporal_profile",
] as const;

const { supabase } = await import("../src/integrations/supabase/client");
const { createDnaPreset, deleteDnaPreset, listDnaPresets } = await import("../src/lib/dna-presets");
const { validateDnaStylePack } = await import("../src/lib/dna-style-pack");

const { data: videos, error: videosError } = await supabase
  .from("videos")
  .select("id, origem, titulo, status, duracao, views, likes, comments, engagement_rate")
  .in("origem", [...SOURCE_URLS]);
if (videosError) throw videosError;

const ordered = SOURCE_URLS.map(url => videos?.find(video => video.origem === url));
if (ordered.some(video => !video)) throw new Error(`Base incompleta: ${ordered.filter(Boolean).length}/${SOURCE_URLS.length}`);
if (ordered.some(video => video?.status !== "completed")) {
  throw new Error(`Há fontes não concluídas: ${ordered.filter(video => video?.status !== "completed").map(video => video?.origem).join(", ")}`);
}

const audit: Array<Record<string, unknown>> = [];
const auditFailures: string[] = [];
for (const video of ordered) {
  if (!video) continue;
  const counts: Record<string, number> = {};
  for (const table of REQUIRED_TABLES) {
    const { count, error } = await (supabase.from(table as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("video_id", video.id);
    if (error) throw new Error(`${table}/${video.id}: ${error.message}`);
    counts[table] = count ?? 0;
  }

  const blocks = counts.video_blocks;
  const failures = [
    counts.video_transcripts < 1 && "sem transcrição",
    blocks < 3 && "menos de 3 blocos",
    counts.video_frames < blocks * 3 && `frames ${counts.video_frames}/${blocks * 3}`,
    counts.visual_block_analysis < blocks && `visual ${counts.visual_block_analysis}/${blocks}`,
    counts.block_semantic_patterns < blocks && `semântica ${counts.block_semantic_patterns}/${blocks}`,
    counts.block_verbal_analysis < blocks && `verbal ${counts.block_verbal_analysis}/${blocks}`,
    counts.text_visual_alignment < blocks && `alinhamento ${counts.text_visual_alignment}/${blocks}`,
    counts.text_image_compatibility < blocks && `compatibilidade ${counts.text_image_compatibility}/${blocks}`,
    counts.video_temporal_profile < 1 && "sem perfil temporal",
  ].filter(Boolean);
  if (failures.length) auditFailures.push(`${video.origem}: ${failures.join(", ")}`);
  audit.push({ ...video, counts, failures });
}

if (auditFailures.length) {
  console.error(JSON.stringify({ audit }, null, 2));
  throw new Error(`Auditoria incompleta:\n${auditFailures.join("\n")}`);
}

for (const preset of (await listDnaPresets()).filter(item => item.name === PRESET_NAME)) {
  await deleteDnaPreset(preset.id);
}
const preset = await createDnaPreset(PRESET_NAME, ordered.map(video => video!.id), "pt");
const readiness = validateDnaStylePack(preset.style_pack);
if (!readiness.ready) throw new Error(`Contrato DNA inválido: ${readiness.reasons.join(", ")}`);

console.log(JSON.stringify({
  preset: {
    id: preset.id,
    name: preset.name,
    confidence_score: preset.confidence_score,
    source_video_count: preset.video_ids.length,
    extraction_quality: preset.style_pack?.extraction_quality,
    strategy_contract: preset.style_pack?.strategy_contract,
    block_strategies: preset.style_pack?.block_styles.map(block => ({
      block_type: block.block_type,
      source_count: block.source_count,
      strategy: block.strategy,
    })),
  },
  audit,
}, null, 2));
