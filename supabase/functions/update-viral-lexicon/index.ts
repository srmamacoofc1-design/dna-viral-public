import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOP_WORDS = new Set(["a", "o", "e", "de", "do", "da", "em", "um", "uma", "que", "é", "para", "com", "não", "os", "as", "no", "na", "se", "por", "mais", "como", "mas", "foi", "ao", "ele", "ela", "dos", "das", "seu", "sua", "ou", "ser", "quando", "muito", "nos", "já", "eu", "também", "só", "pelo", "pela", "até", "isso", "são", "entre", "era", "depois", "sem", "mesmo", "aos", "ter", "seus", "quem", "nas", "me", "esse", "eles", "está", "você", "tinha", "nem", "suas", "meu", "às", "minha", "tem", "numa", "pelos", "elas", "havia", "essa", "num", "dele", "tu", "cada", "lhe", "nós", "bem", "dia", "vez", "vou", "vai", "fez", "tão", "aqui", "ali", "lá", "sim", "então", "aí", "cara", "tipo", "gente", "coisa", "coisas", "assim"]);

// Minimum thresholds to be considered active lexicon
const MIN_FREQUENCY = 3;
const MIN_WORD_LENGTH = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { video_id, cohort_id } = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let cohortVideoIds: string[] | null = null;
    if (cohort_id) {
      const { data: cohortRow } = await supabase.from("dataset_cohort").select("id").eq("id", cohort_id).maybeSingle();
      if (!cohortRow) {
        return new Response(JSON.stringify({ error: "Cohort not found", cohort_id }), { status: 404, headers: corsHeaders });
      }
      const { data: cv } = await supabase.from("dataset_cohort_videos").select("video_id").eq("cohort_id", cohort_id);
      cohortVideoIds = (cv || []).map(v => v.video_id);
      if (!cohortVideoIds.length) {
        return new Response(JSON.stringify({ error: "Cohort exists but has no videos", cohort_id }), { status: 400, headers: corsHeaders });
      }
    }

    const { data: approvedVideos, error: approvedVideosError } = await supabase
      .from("videos")
      .select("id")
      .eq("approved_for_global", true);
    if (approvedVideosError) throw approvedVideosError;
    const approvedIds = approvedVideos?.map((video) => video.id) ?? [];
    const approvedScope = approvedIds.length
      ? approvedIds
      : ["00000000-0000-0000-0000-000000000000"];

    let query = supabase
      .from("block_verbal_analysis")
      .select("video_id, block_id, full_text, trigger_words, phrase_pattern, tone")
      .in("video_id", approvedScope);
    if (video_id) query = query.eq("video_id", video_id);
    else if (cohortVideoIds) query = query.in("video_id", cohortVideoIds);
    const { data: analyses } = await query;

    if (!analyses?.length) {
      return new Response(JSON.stringify({ error: cohort_id ? "No verbal data for cohort videos" : "No verbal data found", words_updated: 0 }), { status: 400, headers: corsHeaders });
    }

    const videoIds = [...new Set(analyses.map(a => a.video_id))];
    const { data: videos } = await supabase
      .from("videos")
      .select("id, engagement_rate_relative, dataset_weight_pct")
      .in("id", videoIds)
      .eq("approved_for_global", true);

    const scoreMap = new Map((videos || []).map(v => [v.id, Number(v.engagement_rate_relative) || 0]));

    const blockIds = analyses.map(a => a.block_id);
    const { data: blocks } = await supabase
      .from("video_blocks")
      .select("id, tipo_bloco")
      .in("id", blockIds);
    const blockTypeMap = new Map((blocks || []).map(b => [b.id, b.tipo_bloco]));

    // Aggregate words
    const wordStats: Record<string, { freq: number; positions: Record<string, number>; emotions: Record<string, number>; perfScores: number[] }> = {};
    const phraseStats: Record<string, { freq: number; position: string; emotion: string; perfScores: number[] }> = {};

    for (const a of analyses) {
      const text = a.full_text || "";
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(w));
      const position = blockTypeMap.get(a.block_id) || "unknown";
      const perfScore = scoreMap.get(a.video_id) || 0;

      // Use Set to count each word once per block (avoid inflation)
      const uniqueWords = [...new Set(words)];
      for (const word of uniqueWords) {
        // Skip purely numeric words
        if (/^\d+$/.test(word)) continue;
        if (!wordStats[word]) wordStats[word] = { freq: 0, positions: {}, emotions: {}, perfScores: [] };
        wordStats[word].freq++;
        wordStats[word].positions[position] = (wordStats[word].positions[position] || 0) + 1;
        wordStats[word].perfScores.push(perfScore);
        if (a.phrase_pattern && a.phrase_pattern !== "afirmacao") {
          wordStats[word].emotions[a.phrase_pattern] = (wordStats[word].emotions[a.phrase_pattern] || 0) + 1;
        }
      }

      // Trigger words as phrases (from verbal DNA)
      const triggers = (a.trigger_words as string[]) || [];
      for (const tw of triggers) {
        const key = `${tw}__${position}`;
        if (!phraseStats[key]) phraseStats[key] = { freq: 0, position, emotion: a.phrase_pattern || "neutro", perfScores: [] };
        phraseStats[key].freq++;
        phraseStats[key].perfScores.push(perfScore);
      }

      // Also mine bigram phrases from block text
      const blockText = a.full_text || "";
      const textWords = blockText.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3 && !STOP_WORDS.has(w));
      for (let i = 0; i < textWords.length - 1; i++) {
        const bigram = `${textWords[i]} ${textWords[i + 1]}`;
        if (bigram.length < 7) continue;
        const bigramKey = `${bigram}__${position}`;
        if (!phraseStats[bigramKey]) phraseStats[bigramKey] = { freq: 0, position, emotion: a.tone || a.phrase_pattern || "neutro", perfScores: [] };
        phraseStats[bigramKey].freq++;
        phraseStats[bigramKey].perfScores.push(perfScore);
      }
    }

    // Filter noise: only keep words with frequency >= MIN_FREQUENCY
    const activeWords = Object.entries(wordStats)
      .filter(([_, stats]) => stats.freq >= MIN_FREQUENCY)
      .sort((a, b) => b[1].freq - a[1].freq)
      .slice(0, 500);

    const noisyWords = Object.entries(wordStats).filter(([_, stats]) => stats.freq < MIN_FREQUENCY);

    // Batch upsert active words (chunks of 50)
    const wordRows = activeWords.map(([word, stats]) => {
      const dominantEmotion = Object.entries(stats.emotions).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const dominantPosition = Object.entries(stats.positions).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const avgPerfScore = stats.perfScores.length > 0
        ? +(stats.perfScores.reduce((a, b) => a + b, 0) / stats.perfScores.length).toFixed(4)
        : 0;
      return {
        word,
        frequency_total: stats.freq,
        frequency_by_position: stats.positions,
        narrative_position: dominantPosition,
        emotional_association: dominantEmotion,
        performance_weighted_score: avgPerfScore,
        updated_at: new Date().toISOString(),
      };
    });

    for (let i = 0; i < wordRows.length; i += 50) {
      await supabase.from("viral_lexicon_global").upsert(wordRows.slice(i, i + 50), { onConflict: "word" });
    }

    // Upsert phrases (only freq >= 2)
    const activePhrases = Object.entries(phraseStats).filter(([_, s]) => s.freq >= 2);
    for (const [key, stats] of activePhrases) {
      const phraseText = key.split("__")[0];
      const avgPerf = stats.perfScores.length > 0
        ? +(stats.perfScores.reduce((a, b) => a + b, 0) / stats.perfScores.length).toFixed(4)
        : 0;
      await supabase.from("viral_phrase_bank").upsert({
        phrase_text: phraseText,
        frequency_count: stats.freq,
        narrative_position: stats.position,
        emotional_trigger: stats.emotion,
        performance_weight: avgPerf,
        updated_at: new Date().toISOString(),
      }, { onConflict: "phrase_text,narrative_position" });
    }

    await supabase.from("extraction_logs").insert({
      video_id: video_id || videoIds[0],
      extraction_step: "update_viral_lexicon",
      field_name: "viral_lexicon_global",
      extracted_value: JSON.stringify({ 
        active_words: activeWords.length, 
        noisy_words: noisyWords.length,
        active_phrases: activePhrases.length,
        noise_ratio: Object.keys(wordStats).length > 0 
          ? +(noisyWords.length / Object.keys(wordStats).length).toFixed(4) : 0,
      }),
      confidence_score: 70,
      source_type: "calculated",
      origin_level: "calculated",
    });

    return new Response(JSON.stringify({ 
      success: true, 
      active_words: activeWords.length, 
      noisy_words_filtered: noisyWords.length,
      active_phrases: activePhrases.length,
    }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
