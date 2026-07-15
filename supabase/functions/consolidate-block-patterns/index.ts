import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function countFrequencies(items: string[]): Array<{ word: string; count: number }> {
  const map = new Map<string, number>();
  items.forEach(w => {
    const key = w.toLowerCase().trim();
    if (key) map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
}

function dominantValue(items: (string | null)[]): { value: string; count: number; total: number } | null {
  const valid = items.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  const map = new Map<string, number>();
  valid.forEach(v => map.set(v, (map.get(v) || 0) + 1));
  const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  return { value: sorted[0][0], count: sorted[0][1], total: valid.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const body = await req.json().catch(() => ({}));
    const persist = body.persist !== false;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: approvedVideos, error: approvedVideosError } = await supabase
      .from("videos")
      .select("id, engagement_rate_relative")
      .eq("approved_for_global", true);
    if (approvedVideosError) throw approvedVideosError;
    const approvedIds = approvedVideos?.map((video) => video.id) ?? [];
    const approvedScope = approvedIds.length
      ? approvedIds
      : ["00000000-0000-0000-0000-000000000000"];

    // Fetch only administrator-approved shared-corpus data in parallel.
    const [patternsRes, wordsRes, phrasesRes, ctaRes] = await Promise.all([
      supabase.from("block_semantic_patterns").select("*").in("video_id", approvedScope).order("block_type"),
      supabase.from("block_word_patterns").select("*").in("video_id", approvedScope),
      supabase.from("block_phrase_patterns").select("*").in("video_id", approvedScope),
      supabase.from("cta_profiles").select("*").in("video_id", approvedScope),
    ]);

    const patterns = patternsRes.data || [];
    const wordPatterns = wordsRes.data || [];
    const phrasePatterns = phrasesRes.data || [];
    const ctaProfiles = ctaRes.data || [];

    if (patterns.length === 0 && wordPatterns.length === 0) {
      return new Response(JSON.stringify({
        success: true, message: "No patterns found",
        consolidation: {}, granular: {},
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch viral scores
    const allVideoIds = [...new Set([
      ...patterns.map((p: any) => p.video_id),
      ...wordPatterns.map((w: any) => w.video_id),
    ])];

    const viralScoreMap = new Map<string, number>();
    (approvedVideos || []).forEach((v: any) => viralScoreMap.set(v.id, Number(v.engagement_rate_relative) || 0));

    // === LEGACY CONSOLIDATION (from block_semantic_patterns) ===
    const blockTypes = [...new Set(patterns.map((p: any) => p.block_type))];
    const consolidation: Record<string, any> = {};

    for (const blockType of blockTypes) {
      const typePatterns = patterns.filter((p: any) => p.block_type === blockType);

      const allKeywords = typePatterns.flatMap((p: any) => Array.isArray(p.block_keywords) ? p.block_keywords : []);
      const allEmotionalWords = typePatterns.flatMap((p: any) => Array.isArray(p.block_emotional_words) ? p.block_emotional_words : []);
      const allStrongPhrases = typePatterns.flatMap((p: any) => Array.isArray(p.block_strong_phrases) ? p.block_strong_phrases : []);
      const allRareWords = typePatterns.flatMap((p: any) => Array.isArray(p.rare_words) ? p.rare_words : []);
      const allDominantWords = typePatterns.flatMap((p: any) => Array.isArray(p.dominant_words) ? p.dominant_words : []);

      // Viral-weighted words
      const wordVideoMap = new Map<string, string>();
      let wordIdx = 0;
      typePatterns.forEach((p: any) => {
        const kws = Array.isArray(p.block_keywords) ? p.block_keywords : [];
        kws.forEach(() => { wordVideoMap.set(String(wordIdx), p.video_id); wordIdx++; });
      });

      const phraseVideoMap = new Map<string, string>();
      let phraseIdx = 0;
      typePatterns.forEach((p: any) => {
        const phs = Array.isArray(p.block_strong_phrases) ? p.block_strong_phrases : [];
        phs.forEach(() => { phraseVideoMap.set(String(phraseIdx), p.video_id); phraseIdx++; });
      });

      const intensities = typePatterns.filter((p: any) => p.block_emotional_intensity != null).map((p: any) => p.block_emotional_intensity);
      const avgIntensity = intensities.length > 0 ? intensities.reduce((a: number, b: number) => a + b, 0) / intensities.length : null;

      const viralScores = typePatterns.map((p: any) => viralScoreMap.get(p.video_id) || 0).filter((s: number) => s > 0);
      const avgViralScore = viralScores.length > 0 ? viralScores.reduce((a: number, b: number) => a + b, 0) / viralScores.length : null;

      // Build viral-weighted
      const vwWords: Array<{ word: string; score: number; count: number }> = [];
      const vwMap = new Map<string, { score: number; count: number }>();
      allKeywords.forEach((w: string, idx: number) => {
        const key = w.toLowerCase().trim();
        if (!key) return;
        const vid = wordVideoMap.get(String(idx)) || "";
        const vs = viralScoreMap.get(vid) || 0;
        const existing = vwMap.get(key) || { score: 0, count: 0 };
        existing.score += vs; existing.count += 1;
        vwMap.set(key, existing);
      });
      for (const [word, { score, count }] of vwMap) {
        vwWords.push({ word, score: +score.toFixed(4), count });
      }
      vwWords.sort((a, b) => b.score - a.score);

      const vwPhrases: Array<{ word: string; score: number; count: number }> = [];
      const vpMap = new Map<string, { score: number; count: number }>();
      allStrongPhrases.forEach((w: string, idx: number) => {
        const key = w.toLowerCase().trim();
        if (!key) return;
        const vid = phraseVideoMap.get(String(idx)) || "";
        const vs = viralScoreMap.get(vid) || 0;
        const existing = vpMap.get(key) || { score: 0, count: 0 };
        existing.score += vs; existing.count += 1;
        vpMap.set(key, existing);
      });
      for (const [word, { score, count }] of vpMap) {
        vwPhrases.push({ word, score: +score.toFixed(4), count });
      }
      vwPhrases.sort((a, b) => b.score - a.score);

      consolidation[blockType] = {
        total_blocks: typePatterns.length,
        total_videos: new Set(typePatterns.map((p: any) => p.video_id)).size,
        top_keywords: countFrequencies(allKeywords).slice(0, 15),
        top_emotional_words: countFrequencies(allEmotionalWords).slice(0, 10),
        top_strong_phrases: countFrequencies(allStrongPhrases).slice(0, 10),
        top_rare_words: countFrequencies(allRareWords).slice(0, 10),
        top_dominant_words: countFrequencies(allDominantWords).slice(0, 10),
        dominant_emotion: dominantValue(typePatterns.map((p: any) => p.block_emotional_type)),
        dominant_tone: dominantValue(typePatterns.map((p: any) => p.block_verbal_tone)),
        avg_intensity: avgIntensity ? +avgIntensity.toFixed(2) : null,
        avg_engagement_rate: avgViralScore ? +avgViralScore.toFixed(4) : null,
        engagement_weighted_words: vwWords.slice(0, 15),
        engagement_weighted_phrases: vwPhrases.slice(0, 10),
      };
    }

    // === GRANULAR CONSOLIDATION (from block_word_patterns & block_phrase_patterns) ===
    const granularBlockTypes = [...new Set([
      ...wordPatterns.map((w: any) => w.block_type),
      ...phrasePatterns.map((p: any) => p.block_type),
    ])];

    const granular: Record<string, any> = {};
    for (const bt of granularBlockTypes) {
      const words = wordPatterns.filter((w: any) => w.block_type === bt);
      const phrases = phrasePatterns.filter((p: any) => p.block_type === bt);

      // Top words by weighted score
      const wordScoreMap = new Map<string, { total_score: number; total_freq: number; emotional: number; rare: number; dominant: number; impact: number }>();
      words.forEach((w: any) => {
        const key = w.word.toLowerCase();
        const existing = wordScoreMap.get(key) || { total_score: 0, total_freq: 0, emotional: 0, rare: 0, dominant: 0, impact: 0 };
        existing.total_score += Number(w.weighted_score) || 0;
        existing.total_freq += Number(w.word_frequency) || 1;
        if (w.is_emotional) existing.emotional++;
        if (w.is_rare) existing.rare++;
        if (w.is_dominant) existing.dominant++;
        if (w.is_impact) existing.impact++;
        wordScoreMap.set(key, existing);
      });

      const topWeightedWords = Array.from(wordScoreMap.entries())
        .map(([word, data]) => ({ word, ...data }))
        .sort((a, b) => b.total_score - a.total_score)
        .slice(0, 20);

      // Phrase categories distribution
      const categoryMap = new Map<string, number>();
      phrases.forEach((p: any) => {
        if (p.phrase_category) categoryMap.set(p.phrase_category, (categoryMap.get(p.phrase_category) || 0) + 1);
      });

      // Top phrases by strength
      const topStrengthPhrases = [...phrases]
        .sort((a: any, b: any) => (Number(b.phrase_strength_score) || 0) - (Number(a.phrase_strength_score) || 0))
        .slice(0, 10)
        .map((p: any) => ({
          phrase: p.phrase,
          category: p.phrase_category,
          strength: Number(p.phrase_strength_score) || 0,
          weighted: Number(p.weighted_score) || 0,
          is_emotional: p.is_emotional,
        }));

      // Top phrases by viral weight
      const topViralPhrases = [...phrases]
        .sort((a: any, b: any) => (Number(b.weighted_score) || 0) - (Number(a.weighted_score) || 0))
        .slice(0, 10)
        .map((p: any) => ({
          phrase: p.phrase,
          category: p.phrase_category,
          strength: Number(p.phrase_strength_score) || 0,
          weighted: Number(p.weighted_score) || 0,
        }));

      granular[bt] = {
        total_words: words.length,
        total_phrases: phrases.length,
        total_videos: new Set(words.map((w: any) => w.video_id)).size,
        top_weighted_words: topWeightedWords,
        phrase_categories: Array.from(categoryMap.entries())
          .map(([cat, count]) => ({ category: cat, count }))
          .sort((a, b) => b.count - a.count),
        top_strength_phrases: topStrengthPhrases,
        top_viral_phrases: topViralPhrases,
        avg_phrase_strength: phrases.length > 0
          ? +(phrases.reduce((s: number, p: any) => s + (Number(p.phrase_strength_score) || 0), 0) / phrases.length).toFixed(1)
          : null,
      };
    }

    // CTA consolidation
    const ctaConsolidation = (() => {
      if (!ctaProfiles || ctaProfiles.length === 0) return null;
      const types = new Map<string, number>();
      const emotions = new Map<string, number>();
      const actions = new Map<string, number>();
      const intensities: number[] = [];
      ctaProfiles.forEach((c: any) => {
        if (c.cta_type) types.set(c.cta_type, (types.get(c.cta_type) || 0) + 1);
        if (c.cta_emotion) emotions.set(c.cta_emotion, (emotions.get(c.cta_emotion) || 0) + 1);
        if (c.cta_action) actions.set(c.cta_action, (actions.get(c.cta_action) || 0) + 1);
        if (c.cta_intensity != null) intensities.push(Number(c.cta_intensity));
      });
      const positions = ctaProfiles.filter((c: any) => c.cta_position_seconds != null).map((c: any) => Number(c.cta_position_seconds));
      return {
        total: ctaProfiles.length,
        top_types: Array.from(types.entries()).sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ type: t, count: c })),
        top_emotions: Array.from(emotions.entries()).sort((a, b) => b[1] - a[1]).map(([e, c]) => ({ emotion: e, count: c })),
        top_actions: Array.from(actions.entries()).sort((a, b) => b[1] - a[1]).map(([a, c]) => ({ action: a, count: c })),
        avg_position: positions.length > 0 ? +(positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(2) : null,
        avg_intensity: intensities.length > 0 ? +(intensities.reduce((a, b) => a + b, 0) / intensities.length).toFixed(1) : null,
      };
    })();

    // Persist to verbal_layer_patterns
    if (persist) {
      await supabase.from("verbal_layer_patterns").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      const layerRows = Object.entries(consolidation).map(([layerType, data]: [string, any]) => ({
        layer_type: layerType,
        top_words: data.top_keywords,
        top_phrases: data.top_strong_phrases,
        top_emotions: data.dominant_emotion ? [data.dominant_emotion] : [],
        avg_emotion_intensity: data.avg_intensity,
        engagement_weighted_words: data.engagement_weighted_words,
        engagement_weighted_phrases: data.engagement_weighted_phrases,
        top_tones: data.dominant_tone ? [data.dominant_tone] : [],
        total_videos_analyzed: data.total_videos,
        total_blocks_analyzed: data.total_blocks,
        avg_engagement_rate: data.avg_engagement_rate,
      }));

      if (layerRows.length > 0) {
        const { error: insertErr } = await supabase.from("verbal_layer_patterns").insert(layerRows);
        if (insertErr) console.error("verbal_layer_patterns insert error:", insertErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_patterns: patterns.length,
      total_words: wordPatterns.length,
      total_phrases: phrasePatterns.length,
      total_videos: allVideoIds.length,
      block_types: blockTypes,
      consolidation,
      granular,
      cta_consolidation: ctaConsolidation,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("consolidate-block-patterns error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
