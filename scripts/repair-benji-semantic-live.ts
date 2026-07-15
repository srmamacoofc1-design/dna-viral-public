/** Reexecuta extração semântica incompleta e só aceita cobertura total. */
(globalThis as any).localStorage = (globalThis as any).localStorage ?? {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const VIDEO_IDS = String(process.env.BENJI_REPAIR_VIDEO_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (VIDEO_IDS.length === 0) {
  throw new Error("BENJI_REPAIR_VIDEO_IDS is required (comma-separated video UUIDs)");
}
for (const videoId of VIDEO_IDS) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) {
    throw new Error(`Invalid video UUID in BENJI_REPAIR_VIDEO_IDS: ${videoId}`);
  }
}

const { supabase } = await import("../src/integrations/supabase/client");

const STOP_WORDS = new Set("a al algo ante como con contra cual cuando de del desde donde el ella en entre era es esa ese esta este fue ha hasta hay la las le les lo los mas me mi no o para pero por porque que se sin sobre su sus te tu un una y ya".split(" "));
const EMOTIONAL_WORDS = new Set("absurdo alerta asombro atrapado choque desesperado dolor extraño fatal feliz furia horror imposible miedo peligro sorpresa tensión terrible venganza".split(" "));

async function count(table: string, videoId: string): Promise<number> {
  const { count: value, error } = await (supabase.from(table as any) as any)
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId);
  if (error) throw error;
  return value ?? 0;
}

function wordsFrom(text: string): string[] {
  return (text.toLocaleLowerCase("es").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [])
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

async function fillMissingSemantics(videoId: string): Promise<void> {
  const [{ data: blocks, error: blocksError }, { data: existing, error: existingError }, { data: verbal }, { data: visual }, { data: video }] = await Promise.all([
    supabase.from("video_blocks").select("id, tipo_bloco, texto").eq("video_id", videoId),
    supabase.from("block_semantic_patterns").select("block_id").eq("video_id", videoId),
    supabase.from("block_verbal_analysis").select("block_id, emotional_intensity, tone, trigger_words").eq("video_id", videoId),
    supabase.from("visual_block_analysis").select("block_id, visual_emotion, avg_visual_intensity_score").eq("video_id", videoId),
    supabase.from("videos").select("engagement_rate_relative").eq("id", videoId).single(),
  ]);
  if (blocksError || existingError) throw blocksError || existingError;
  const existingIds = new Set((existing || []).map(row => row.block_id));
  const missing = (blocks || []).filter(block => block.texto?.trim() && !existingIds.has(block.id));
  if (!missing.length) return;

  const engagement = Number(video?.engagement_rate_relative) || 0;
  const rows = missing.map(block => {
    const text = block.texto!.trim();
    const words = wordsFrom(text);
    const frequencies = new Map<string, number>();
    for (const word of words) frequencies.set(word, (frequencies.get(word) || 0) + 1);
    const ranked = [...frequencies].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([word]) => word);
    const verbalRow = verbal?.find(row => row.block_id === block.id);
    const visualRow = visual?.find(row => row.block_id === block.id);
    const triggers = Array.isArray(verbalRow?.trigger_words) ? verbalRow.trigger_words.filter(item => typeof item === "string") : [];
    const keywords = [...new Set([...triggers, ...ranked])].slice(0, 10);
    const emotional = words.filter(word => EMOTIONAL_WORDS.has(word)).slice(0, 8);
    const phrases = text.split(/(?<=[.!?])\s+/).map(phrase => phrase.trim()).filter(Boolean).slice(0, 3);
    const rawIntensity = Number(verbalRow?.emotional_intensity) || Number(visualRow?.avg_visual_intensity_score) || 60;
    return {
      video_id: videoId,
      block_id: block.id,
      block_type: block.tipo_bloco || "unknown",
      block_text: text,
      block_keywords: keywords,
      block_emotional_words: emotional,
      block_repeated_words: [...frequencies].filter(([, value]) => value > 1).map(([word]) => word).slice(0, 8),
      block_strong_phrases: phrases,
      rare_words: ranked.filter(word => (frequencies.get(word) || 0) === 1 && word.length >= 8).slice(0, 5),
      dominant_words: keywords.slice(0, 5),
      block_emotional_type: visualRow?.visual_emotion || block.tipo_bloco || "curiosidade",
      block_emotional_intensity: Math.max(1, Math.min(5, Math.round(rawIntensity / 20))),
      block_verbal_tone: verbalRow?.tone || "curioso",
      weighted_word_score: engagement > 0 ? +(keywords.length * engagement).toFixed(4) : null,
      weighted_phrase_score: engagement > 0 ? +(phrases.length * engagement).toFixed(4) : null,
    };
  });
  const { error } = await supabase.from("block_semantic_patterns").insert(rows);
  if (error) throw error;
  console.log(`  fallback determinístico aplicado a ${rows.length} bloco(s) com texto real`);
}

for (const videoId of VIDEO_IDS) {
  const expected = await count("video_blocks", videoId);
  let actual = await count("block_semantic_patterns", videoId);
  for (let attempt = 1; actual < expected && attempt <= 1; attempt++) {
    console.log(`[${videoId}] semântica ${actual}/${expected}; tentativa remota ${attempt}/1`);
    const { data, error } = await supabase.functions.invoke("extract-block-semantics", {
      body: { video_id: videoId },
    });
    if (error || data?.error) console.warn(`  extração: ${error?.message || data?.error}`);
    actual = await count("block_semantic_patterns", videoId);
  }
  if (actual < expected) {
    await fillMissingSemantics(videoId);
    actual = await count("block_semantic_patterns", videoId);
  }
  if (actual !== expected) throw new Error(`${videoId}: cobertura semântica ${actual}/${expected}`);

  const { data, error } = await supabase.functions.invoke("calculate-text-image-compatibility", {
    body: { video_id: videoId },
  });
  if (error || data?.error) throw new Error(`${videoId}: compatibilidade: ${error?.message || data?.error}`);
  const compatibility = await count("text_image_compatibility", videoId);
  if (compatibility !== expected) throw new Error(`${videoId}: compatibilidade ${compatibility}/${expected}`);
  console.log(`[${videoId}] reparado: semântica ${actual}/${expected}; compatibilidade ${compatibility}/${expected}`);
}
