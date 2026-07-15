import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PatternAccumulator {
  frequency: number;
  total_views: number;
  total_likes_rate: number;
  total_comments_rate: number;
  total_engagement: number;
  video_ids: Set<string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1) Load all completed videos with engagement data
    const { data: videos, error: vErr } = await supabase
      .from("videos")
      .select("id, titulo, views, likes, comments")
      .eq("status", "completed")
      .eq("approved_for_global", true)
      .gt("views", 0);

    if (vErr) throw vErr;
    if (!videos?.length) throw new Error("No completed videos with views > 0");

    // 2) Calculate per-video engagement scores
    const videoScores = new Map<
      string,
      {
        views: number;
        likes_rate: number;
        comments_rate: number;
        engagement_score: number;
      }
    >();

    for (const v of videos) {
      const views = Number(v.views) || 1;
      const likes = Number(v.likes) || 0;
      const comments = Number(v.comments) || 0;
      const likes_rate = likes / views;
      const comments_rate = comments / views;
      const engagement_score = likes_rate * 0.35 + comments_rate * 0.65;
      videoScores.set(v.id, { views, likes_rate, comments_rate, engagement_score });
    }

    const videoIds = videos.map((v) => v.id);

    // 3) Load blocks for these videos
    const { data: blocks, error: bErr } = await supabase
      .from("video_blocks")
      .select("id, video_id, tipo_bloco, texto, emocao, funcao_narrativa")
      .in("video_id", videoIds);

    if (bErr) throw bErr;

    // 4) Load semantic patterns
    const { data: semantics } = await supabase
      .from("block_semantic_patterns")
      .select("block_id, video_id, block_type, block_keywords, block_emotional_type, block_verbal_tone, block_strong_phrases")
      .in("video_id", videoIds);

    // 5) Load CTA events
    const { data: ctas } = await supabase
      .from("cta_deep_analysis")
      .select("video_id, cta_type, cta_tone, cta_position")
      .in("video_id", videoIds);

    // 6) Load word patterns
    const { data: words } = await supabase
      .from("block_word_patterns")
      .select("video_id, block_id, block_type, word, is_emotional, is_dominant, is_impact")
      .in("video_id", videoIds);

    // Accumulators: key = `${pattern_type}||${pattern_value}||${block_type}`
    const accum = new Map<string, PatternAccumulator>();

    function addPattern(
      type: string,
      value: string,
      blockType: string | null,
      videoId: string
    ) {
      if (!value || value.trim().length < 2) return;
      const score = videoScores.get(videoId);
      if (!score) return;
      const key = `${type}||${value.toLowerCase().trim()}||${blockType || "all"}`;
      if (!accum.has(key)) {
        accum.set(key, {
          frequency: 0,
          total_views: 0,
          total_likes_rate: 0,
          total_comments_rate: 0,
          total_engagement: 0,
          video_ids: new Set(),
        });
      }
      const a = accum.get(key)!;
      a.frequency++;
      a.video_ids.add(videoId);
      a.total_views += score.views;
      a.total_likes_rate += score.likes_rate;
      a.total_comments_rate += score.comments_rate;
      a.total_engagement += score.engagement_score;
    }

    // --- Extract patterns from blocks ---
    for (const b of blocks || []) {
      const vid = b.video_id;
      const bt = b.tipo_bloco;

      // Block type as pattern
      addPattern("block_type", bt, bt, vid);

      // Emotion per block type
      if (b.emocao) addPattern("emotion", b.emocao, bt, vid);

      // Narrative function
      if (b.funcao_narrativa) addPattern("narrative_function", b.funcao_narrativa, bt, vid);

      // Words from text (top frequent)
      if (b.texto) {
        const rawWords = b.texto
          .toLowerCase()
          .replace(/[^\p{L}\s]/gu, "")
          .split(/\s+/)
          .filter((w: string) => w.length > 3);
        for (const w of rawWords.slice(0, 20)) {
          addPattern("word", w, bt, vid);
        }
      }
    }

    // --- Extract from semantic patterns ---
    for (const s of semantics || []) {
      if (s.block_emotional_type)
        addPattern("semantic_emotion", s.block_emotional_type, s.block_type, s.video_id);
      if (s.block_verbal_tone)
        addPattern("verbal_tone", s.block_verbal_tone, s.block_type, s.video_id);

      // Keywords
      const kws = Array.isArray(s.block_keywords) ? s.block_keywords : [];
      for (const kw of kws.slice(0, 10)) {
        if (typeof kw === "string") addPattern("keyword", kw, s.block_type, s.video_id);
      }

      // Strong phrases
      const phrases = Array.isArray(s.block_strong_phrases) ? s.block_strong_phrases : [];
      for (const p of phrases.slice(0, 5)) {
        if (typeof p === "string") addPattern("strong_phrase", p, s.block_type, s.video_id);
      }
    }

    // --- Extract from word patterns ---
    for (const w of words || []) {
      if (w.is_emotional) addPattern("emotional_word", w.word, w.block_type, w.video_id);
      if (w.is_dominant) addPattern("dominant_word", w.word, w.block_type, w.video_id);
      if (w.is_impact) addPattern("impact_word", w.word, w.block_type, w.video_id);
    }

    // --- Extract CTA patterns ---
    for (const c of ctas || []) {
      if (c.cta_type) addPattern("cta_type", c.cta_type, "cta", c.video_id);
      if (c.cta_tone) addPattern("cta_tone", c.cta_tone, "cta", c.video_id);
      if (c.cta_position) addPattern("cta_position", c.cta_position, "cta", c.video_id);
    }

    // 7) Calculate strength_score and build insert rows
    // strength_score = avg_engagement_score * log2(frequency + 1) * (sample_size / total_videos)
    const totalVideos = videos.length;

    const rows: Array<Record<string, unknown>> = [];
    for (const [key, a] of accum.entries()) {
      const [pattern_type, pattern_value, block_type] = key.split("||");
      const sampleSize = a.video_ids.size;
      const avgViews = a.total_views / a.frequency;
      const avgLikesRate = a.total_likes_rate / a.frequency;
      const avgCommentsRate = a.total_comments_rate / a.frequency;
      const avgEngagement = a.total_engagement / a.frequency;

      // strength = engagement * log coverage * sample weight
      const logFreq = Math.log2(a.frequency + 1);
      const sampleWeight = sampleSize / totalVideos;
      const strength_score = avgEngagement * logFreq * sampleWeight;

      // Only keep patterns with frequency >= 2 or from important types
      const importantTypes = ["block_type", "cta_type", "cta_position", "emotion", "semantic_emotion"];
      if (a.frequency < 2 && !importantTypes.includes(pattern_type)) continue;

      rows.push({
        pattern_type,
        pattern_value,
        block_type,
        frequency: a.frequency,
        avg_views: +avgViews.toFixed(0),
        avg_likes_rate: +avgLikesRate.toFixed(8),
        avg_comments_rate: +avgCommentsRate.toFixed(8),
        avg_engagement_score: +avgEngagement.toFixed(8),
        strength_score: +strength_score.toFixed(8),
        sample_size: sampleSize,
      });
    }

    // Sort by strength_score descending
    rows.sort((a, b) => (b.strength_score as number) - (a.strength_score as number));

    // 8) Clear old data and insert
    await supabase.from("pattern_performance_weights").delete().gte("id", "00000000-0000-0000-0000-000000000000");

    // Insert in batches of 500
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error: iErr } = await supabase
        .from("pattern_performance_weights")
        .insert(batch);
      if (iErr) throw iErr;
      inserted += batch.length;
    }

    // 9) Build summary
    const topByType: Record<string, Array<{ value: string; block: string; strength: number; freq: number }>> = {};
    for (const r of rows.slice(0, 200)) {
      const pt = r.pattern_type as string;
      if (!topByType[pt]) topByType[pt] = [];
      if (topByType[pt].length < 5) {
        topByType[pt].push({
          value: r.pattern_value as string,
          block: r.block_type as string,
          strength: r.strength_score as number,
          freq: r.frequency as number,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_patterns: inserted,
        total_videos_analyzed: totalVideos,
        total_blocks_analyzed: blocks?.length || 0,
        strength_formula:
          "avg_engagement_score * log2(frequency + 1) * (sample_size / total_videos)",
        engagement_formula:
          "(likes/views * 0.35) + (comments/views * 0.65)",
        top_patterns_by_type: topByType,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
