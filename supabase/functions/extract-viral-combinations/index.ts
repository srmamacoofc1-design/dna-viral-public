import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// All narrative block types — full arc coverage
const ALL_NARRATIVE_BLOCKS = ["hook", "setup", "desenvolvimento", "tensao", "revelacao", "payoff", "transicao", "loop"] as const;

const BLOCKLIST = new Set([
  "this is", "you know", "kind of", "going to", "lot of", "and i'm", "no no", "is this", "who is", "and don't",
  "first day", "these buttons", "dealing with", "oh my god", "excuse me", "i mean", "like you know", "that's what",
  "it's like", "so much", "and then", "but i", "right now", "i think", "i just", "a little", "at the", "in the",
  "on the", "to the", "for the", "with the", "isso é", "eu sei", "tipo assim", "sabe né", "aí então", "e aí",
  "na verdade", "por isso", "com isso", "eu acho", "mais ou menos", "do you", "i was", "it was", "and the",
  "that i", "is a", "are you", "have you", "we have", "they are", "there is", "can you", "would you", "if you",
  "when you", "what you", "i don't", "don't know", "know what", "like a", "like i", "that's a", "it's a",
  "there's a", "here's a", "who this", "is great", "this first", "these pedals", "no no no",
  "i watched", "he went", "we saw", "she said", "he said", "they said", "i went", "i got", "i had",
  // Social / polite / filler phrases
  "nice to see", "nice to see you", "nice to meet", "nice to meet you", "good to see", "good to see you",
  "thank you", "thanks for", "thanks so much", "pleased to meet", "how are you", "how you doing",
  "see me on social media", "follow me on", "check me out on", "find me on",
  "if i watched", "mind if i watched", "mind if i", "do you mind", "would you mind",
  "i appreciate", "i appreciate it", "that's great", "that's nice", "that's cool", "that's awesome",
  "pretty good", "pretty nice", "really nice", "really good", "sounds good", "sounds great",
  "nice one", "good one", "fair enough", "no worries", "no problem", "of course",
  "tudo bem", "tudo certo", "obrigado", "obrigada", "por favor", "com licença", "desculpa",
  "prazer em conhecer", "bom te ver", "legal isso", "que legal", "que bom",
]);

const CONTRACTION_FRAGMENTS = new Set(["s", "re", "t", "ve", "ll", "d", "m"]);

const STOPWORDS = new Set([
  "a", "o", "os", "as", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "por", "para", "pra", "com", "sem", "sob", "sobre", "até", "que", "se", "e", "ou", "mas", "porque", "como", "isso",
  "isto", "essa", "esse", "aquele", "aquela", "eu", "tu", "ele", "ela", "nós", "vós", "eles", "elas", "me", "te",
  "lhe", "lhes", "my", "your", "you", "he", "she", "it", "we", "they", "this", "that", "these", "those", "the", "an",
  "of", "to", "in", "on", "at", "for", "with", "from", "by", "and", "or", "but", "if", "then", "so", "is", "are", "was",
  "were", "be", "been", "being", "am", "do", "did", "does", "have", "has", "had", "i", "im", "i'm",
]);

const AUXILIARY_ONLY = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "did", "does", "have", "has", "had",
  "will", "would", "could", "should", "might", "can", "shall", "may",
  "é", "era", "foi", "são", "eram", "ser", "estar", "está", "estou", "tem", "tinha", "ter",
]);

const ACTION_WORDS = [
  "olha", "veja", "vê", "assiste", "escuta", "espera", "pare", "descobre", "descubra", "entenda", "clica", "clique",
  "inscreve", "inscreva", "segue", "siga", "compra", "compre", "corre", "corra", "watch", "look", "wait", "stop", "click",
  "buy", "follow", "subscribe", "listen", "see", "check", "believe", "imagine", "happens", "happened", "changed", "mudou",
  "aconteceu", "acontece", "descobriu", "percebeu", "perceba", "faz", "faça", "não faça", "nao faça",
];

const CURIOSITY_WORDS = [
  "see", "wait", "look", "watch", "guess", "imagine", "what happens", "you won't believe",
  "veja", "espera", "olha", "assista", "adivinha", "imagina", "o que acontece", "você não vai acreditar",
];

const SURPRISE_WORDS = [
  "suddenly", "unexpected", "out of nowhere", "de repente", "inesperado", "do nada",
];

const TENSION_WORDS = [
  "danger", "warning", "don't", "careful", "perigo", "cuidado", "não", "alerta",
];

const COMMAND_WORDS = [
  "now", "before", "until", "don't skip", "agora", "antes", "até", "não pule",
];

const EMOTION_WORDS = [
  "coragem", "segredo", "ninguém", "ninguem", "nunca", "jamais", "agora", "alerta", "cuidado", "perigo", "choque", "surpresa",
  "absurdo", "proibido", "erro", "verdade", "mentira", "mudou", "revelou", "revelação", "revelacao", "tudo",
  "believe", "crazy", "secret", "danger", "warning", "now", "don't", "never", "nobody", "happens", "changed",
  ...CURIOSITY_WORDS, ...SURPRISE_WORDS, ...TENSION_WORDS, ...COMMAND_WORDS,
];

const CTA_WORDS = ["inscreve", "inscreva", "segue", "siga", "clica", "clique", "compra", "compre", "link", "bio", "follow", "subscribe", "click", "buy"];

const CTA_VIEWER_INDICATORS = [
  "you", "your", "you'll", "você", "voce", "te ", "seu ", "sua ", "agora", "now",
  "don't skip", "não pule", "nao pule", "wait until", "espere", "até o final",
  "se inscreva", "inscreva-se", "assista", "veja", "clique", "siga",
];

const FIRST_THIRD_PERSON_PATTERNS = [
  /^(i |i'm |i've |i'd |i'll |we |he |she |they |it )/i,
  /^(eu |nós |nos |ele |ela |eles |elas )/i,
  /\b(i bought|i watched|i opened|i made|i saw|i did|i went|i got|i had|i found|i tried)/i,
  /\b(comprei|assisti|abri|fiz|vi |fui |peguei|tentei|achei|encontrei|descobri|comi|bebi)/i,
  /\b(he bought|she opened|they watched|he made|she did|he went|she got|they found)/i,
  /\b(ele comprou|ela abriu|eles assistiram|ele fez|ela foi|ele pegou)/i,
];

// WEAK VERBS — reject if used without an object following
const WEAK_VERBS = new Set([
  "looked", "walked", "grabbed", "moved", "went", "stood", "turned", "watched", "opened",
  "sat", "ran", "came", "left", "got", "took", "put", "gave", "fell", "held",
  "olhou", "andou", "pegou", "moveu", "foi", "ficou", "virou", "assistiu", "abriu",
  "sentou", "correu", "veio", "saiu", "pegou", "colocou", "deu", "caiu", "segurou",
]);

const HOT_ZONES: Record<string, number> = {
  HOOK: 0.95,
  CTA: 0.9,
  PAYOFF: 0.85,
  TWIST: 0.8,
  MICRO_PEAK: 0.78,
  BUILD: 0.65,
  SETUP: 0.55,
  ACTION: 0.3,
};

// HOOK-specific indicators for targeted extraction
const HOOK_INDICATORS = [
  "suddenly", "wait", "you won't believe", "look closely", "this changed everything",
  "de repente", "espera", "você não vai acreditar", "olha só", "isso mudou tudo",
  "what if", "imagine", "have you ever", "já imaginou", "e se",
];

// MICRO_PEAK indicators — small emotional spikes
const MICRO_PEAK_INDICATORS = [
  "look at this", "did you see that", "something strange happened", "now watch this",
  "olha isso", "viu isso", "algo estranho aconteceu", "agora veja isso",
  "wait what", "hold on", "no way", "espera aí", "não acredito", "sério",
  "oh my", "whoa", "wow", "nossa", "caramba",
];

// PAYOFF indicators — resolution/result phrases
const PAYOFF_INDICATORS = [
  "this is what happened", "here's the result", "this is why it worked",
  "foi isso que aconteceu", "esse foi o resultado", "por isso funcionou",
  "and that's how", "finally", "in the end", "e foi assim", "finalmente", "no final",
];

// Minimum coverage targets per narrative zone
const COVERAGE_TARGETS: Record<string, number> = {
  HOOK: 1, SETUP: 1, BUILD: 2, MICRO_PEAK: 1, TWIST: 1, PAYOFF: 1, CTA: 1,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const targetVideoId = typeof body?.video_id === "string" ? body.video_id : null;

    const { data: approvedVideos, error: approvedVideosError } = await supabase
      .from("videos")
      .select("id")
      .eq("approved_for_global", true);
    if (approvedVideosError) throw approvedVideosError;
    const approvedIds = approvedVideos?.map((video) => video.id) ?? [];
    const approvedScope = approvedIds.length
      ? approvedIds
      : ["00000000-0000-0000-0000-000000000000"];

    let blocksQuery = supabase
      .from("video_blocks")
      .select("id, video_id, bloco_id, tipo_bloco, texto, tempo_inicio, tempo_fim, language_code, emocao, funcao_narrativa")
      .in("video_id", approvedScope)
      .not("texto", "is", null)
      .in("tipo_bloco", [...ALL_NARRATIVE_BLOCKS])
      .order("video_id")
      .order("bloco_id");

    if (targetVideoId) blocksQuery = blocksQuery.eq("video_id", targetVideoId);

    const { data: blocks, error: blocksError } = await blocksQuery;
    if (blocksError) throw blocksError;

    if (!blocks?.length) {
      return jsonResponse({
        status: "no_blocks",
        COMBINATION_DNA_READY: false,
        stats: {
          total_extracted: 0,
          discarded: 0,
          approved_for_dna: 0,
          visual_temporal_confirmed: 0,
          by_zone: { HOOK: 0, SETUP: 0, BUILD: 0, MICRO_PEAK: 0, TWIST: 0, PAYOFF: 0, CTA: 0, ACTION: 0 },
        },
        top_20_approved: [],
        cross_video_patterns: 0,
        videos_processed: 0,
        blocks_processed: 0,
      });
    }

    const blockIds = blocks.map((block) => block.id);
    const videoIds = [...new Set(blocks.map((block) => block.video_id))];

    const [microEventsRes, temporalDataRes, alignmentDataRes, verbalDataRes, videoDataRes] = await Promise.all([
      supabase.from("video_micro_events").select("block_id, event_strength").in("block_id", blockIds),
      supabase.from("video_temporal_profile").select("block_id, rhythm_level, tempo_pattern").in("block_id", blockIds),
      supabase.from("text_visual_alignment").select("block_id, alignment_score").in("block_id", blockIds),
      targetVideoId
        ? supabase.from("block_verbal_analysis").select("block_id, video_id, full_text, tone, emotional_intensity, phrase_pattern").eq("video_id", targetVideoId)
        : supabase.from("block_verbal_analysis").select("block_id, video_id, full_text, tone, emotional_intensity, phrase_pattern").in("video_id", videoIds),
      targetVideoId
        ? supabase.from("videos").select("id, views, likes, comments, engagement_rate_relative, cta_text").eq("id", targetVideoId).eq("approved_for_global", true)
        : supabase.from("videos").select("id, views, likes, comments, engagement_rate_relative, cta_text").in("id", videoIds).eq("approved_for_global", true),
    ]);

    if (microEventsRes.error) throw microEventsRes.error;
    if (temporalDataRes.error) throw temporalDataRes.error;
    if (alignmentDataRes.error) throw alignmentDataRes.error;
    if (verbalDataRes.error) throw verbalDataRes.error;
    if (videoDataRes.error) throw videoDataRes.error;

    const microEventBlocks = new Set((microEventsRes.data || []).filter((item) => Number(item.event_strength || 0) >= 0.3).map((item) => item.block_id));
    const temporalSignalBlocks = new Set(
      (temporalDataRes.data || [])
        .filter((item) => ["high", "explosive"].includes(String(item.rhythm_level || "")) || ["burst", "accelerating", "pause_before_reveal"].includes(String(item.tempo_pattern || "")))
        .map((item) => item.block_id),
    );
    const highAlignmentBlocks = new Set((alignmentDataRes.data || []).filter((item) => Number(item.alignment_score || 0) >= 40).map((item) => item.block_id));

    const verbalMap: Record<string, { full_text: string; tone: string | null; emotional_intensity: number; phrase_pattern: string | null }> = {};
    for (const item of (verbalDataRes.data || [])) {
      verbalMap[item.block_id] = {
        full_text: item.full_text || "",
        tone: item.tone || null,
        emotional_intensity: Number(item.emotional_intensity || 0),
        phrase_pattern: item.phrase_pattern || null,
      };
    }

    const engagementMap = buildEngagementMap(videoDataRes.data || []);
    const videoMetaMap = new Map((videoDataRes.data || []).map((video) => [video.id, video]));

    if (targetVideoId) {
      const { error } = await supabase.from("viral_word_combinations").delete().eq("video_id", targetVideoId);
      if (error) throw error;
    } else {
      const [deleteCombinations, deletePatterns] = await Promise.all([
        supabase.from("viral_word_combinations").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
        supabase.from("viral_combination_patterns").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      ]);
      if (deleteCombinations.error) throw deleteCombinations.error;
      if (deletePatterns.error) throw deletePatterns.error;
    }

    const allCombinations: any[] = [];
    const noiseArchive: any[] = [];

    // Build micro-event strength map for MICRO_PEAK detection
    const microEventStrengthMap = new Map<string, number>();
    for (const item of (microEventsRes.data || [])) {
      const strength = Number(item.event_strength || 0);
      if (strength >= 0.3) {
        const current = microEventStrengthMap.get(item.block_id) || 0;
        microEventStrengthMap.set(item.block_id, Math.max(current, strength));
      }
    }

    // First pass: extract from all blocks
    const extractedByZone = processBlocks(blocks, verbalMap, microEventBlocks, microEventStrengthMap, temporalSignalBlocks, highAlignmentBlocks, videoMetaMap, noiseArchive, allCombinations);

    // COVERAGE BALANCE CHECK — per video multi-pass
    const videoBlockMap = new Map<string, typeof blocks>();
    for (const block of blocks) {
      if (!videoBlockMap.has(block.video_id)) videoBlockMap.set(block.video_id, []);
      videoBlockMap.get(block.video_id)!.push(block);
    }

    // Check coverage gaps per video and re-scan missing zones with relaxed thresholds
    for (const [videoId, videoBlocks] of videoBlockMap) {
      const zoneCoverage = countZoneCoverage(allCombinations, videoId);
      const missingZones: string[] = [];
      for (const [zone, target] of Object.entries(COVERAGE_TARGETS)) {
        if ((zoneCoverage[zone] || 0) < target) missingZones.push(zone);
      }

      if (missingZones.length > 0) {
        // Re-scan blocks for missing zones with relaxed thresholds
        rescanForMissingZones(videoBlocks, missingZones, verbalMap, microEventBlocks, microEventStrengthMap, temporalSignalBlocks, highAlignmentBlocks, videoMetaMap, noiseArchive, allCombinations);
      }
    }


    // Dedupe keeping best per video+block+text
    const dedupedCombinations = dedupeCombinationRows(allCombinations);

    // SEMANTIC DEDUPLICATION LAYER — merge equivalent phrase variations
    const semanticDedupedCombinations = semanticDeduplicateCombinations(dedupedCombinations, noiseArchive);

    // LAYER 4: QUOTA-BASED SELECTION BY NARRATIVE FUNCTION
    const totalAfterHardReject = semanticDedupedCombinations.length;
    const quotaResult = applyQuotaSelection(semanticDedupedCombinations, highAlignmentBlocks, noiseArchive);
    const finalCombinations = quotaResult.all;

    if (finalCombinations.length > 0) {
      for (let index = 0; index < finalCombinations.length; index += 200) {
        const chunk = finalCombinations.slice(index, index + 200).map(({ _rankScore, narrative_force_score, narrative_value_score, ...rest }) => rest);
        const { error } = await supabase.from("viral_word_combinations").insert(chunk);
        if (error) throw error;
      }
    }

    // Archive noise (non-blocking, best-effort) — keep max 200 per video for diagnostics
    if (noiseArchive.length > 0) {
      const noiseVideoIds = [...new Set(noiseArchive.map((n: any) => n.video_id))];
      // Delete old noise in batch
      await supabase.from("verbal_noise_archive").delete().in("video_id", noiseVideoIds);
      // Sample noise: keep first 200 per video
      const noiseSample: any[] = [];
      const noiseCountByVideo: Record<string, number> = {};
      for (const n of noiseArchive) {
        noiseCountByVideo[n.video_id] = (noiseCountByVideo[n.video_id] || 0) + 1;
        if (noiseCountByVideo[n.video_id] <= 200) noiseSample.push(n);
      }
      for (let index = 0; index < noiseSample.length; index += 200) {
        const chunk = noiseSample.slice(index, index + 200);
        await supabase.from("verbal_noise_archive" as any).insert(chunk).then(() => {});
      }
    }

    const crossMap: Record<string, any> = {};
    for (const combination of finalCombinations) {
      const key = combination.combination_text;
      if (!crossMap[key]) {
        crossMap[key] = {
          videos: new Set<string>(), functions: [], intents: [], blockTypes: [],
          confidences: [], impactScores: [], approvalScores: [], contexts: [],
          languages: new Set<string>(), totalOccurrences: 0, word_count: combination.word_count,
          approvedCount: 0, visualConfirmedCount: 0, engagementScores: [],
        };
      }
      const item = crossMap[key];
      item.videos.add(combination.video_id);
      item.functions.push(combination.dominant_function);
      item.intents.push(combination.emotional_intent);
      item.blockTypes.push(combination.block_type);
      item.confidences.push(Number(combination.confidence_score || 0));
      item.impactScores.push(Number(combination.impact_score || 0));
      item.approvalScores.push(Number(combination.approval_score || 0));
      if (combination.sample_context && item.contexts.length < 3) item.contexts.push(combination.sample_context);
      item.languages.add(combination.language_code || "pt");
      item.totalOccurrences += Number(combination.occurrence_count || 1);
      if (combination.approved_for_dna) item.approvedCount += 1;
      if (combination.linked_micro_event || combination.linked_temporal_signal || combination.linked_visual_signal) item.visualConfirmedCount += 1;
      item.engagementScores.push(engagementMap.get(combination.video_id) ?? 0.5);
    }

    const patterns = Object.entries(crossMap)
      .filter(([, value]: any) => value.videos.size >= 2 || value.approvedCount >= 2)
      .map(([text, value]: any) => {
        const dominantFunction = mostFrequent(value.functions) || "BUILD";
        const patternScore = clamp(
          avg(value.approvalScores) * 0.45 +
          avg(value.impactScores) * 0.2 +
          (HOT_ZONES[dominantFunction] || 0.4) * 0.15 +
          Math.min(value.videos.size / Math.max(videoIds.length, 1), 1) * 0.1 +
          avg(value.engagementScores) * 0.1
        );
        return {
          combination_text: text, word_count: value.word_count, dominant_function: dominantFunction,
          emotional_intent: mostFrequent(value.intents) || "impacto", videos_count: value.videos.size,
          total_occurrences: value.totalOccurrences, avg_confidence: Math.round(avg(value.confidences)),
          pattern_score: round2(patternScore), dominant_block_types: [...new Set(value.blockTypes)].filter(Boolean).slice(0, 5),
          sample_contexts: value.contexts.slice(0, 3), languages: [...value.languages],
        };
      })
      .sort((a, b) => Number(b.pattern_score) - Number(a.pattern_score));

    const crossCounts = new Map(patterns.map((p) => [p.combination_text, { videos: p.videos_count, score: p.pattern_score }]));
    const updatedRows = finalCombinations.map((row) => {
      const { _rankScore, narrative_force_score, narrative_value_score, ...rest } = row;
      return {
        ...rest,
        cross_video_count: crossCounts.get(row.combination_text)?.videos ?? 1,
        pattern_score: crossCounts.get(row.combination_text)?.score ?? row.approval_score,
      };
    });

    if (updatedRows.length > 0) {
      for (let index = 0; index < updatedRows.length; index += 200) {
        const chunk = updatedRows.slice(index, index + 200);
        const { error } = await supabase.from("viral_word_combinations").upsert(chunk, { onConflict: "id" });
        if (error) throw error;
      }
    }

    if (!targetVideoId && patterns.length > 0) {
      for (let index = 0; index < patterns.length; index += 50) {
        const chunk = patterns.slice(index, index + 50);
        const { error } = await supabase.from("viral_combination_patterns").upsert(chunk, { onConflict: "combination_text" });
        if (error) throw error;
      }
    }

    const approvedForDna = updatedRows.filter((row) => row.approved_for_dna);
    const rejectedByQuota = updatedRows.filter((row) => !row.approved_for_dna);
    const visualConfirmed = approvedForDna.filter((row) => row.linked_micro_event || row.linked_temporal_signal || row.linked_visual_signal).length;

    // Avg score per function
    const avgScoreByFunction: Record<string, number> = {};
    const functionGroups = new Map<string, number[]>();
    for (const row of updatedRows) {
      const fn = row.dominant_function || "BUILD";
      if (!functionGroups.has(fn)) functionGroups.set(fn, []);
      functionGroups.get(fn)!.push(Number(row.approval_score || 0));
    }
    for (const [fn, scores] of functionGroups) {
      avgScoreByFunction[fn] = round2(scores.reduce((s, v) => s + v, 0) / scores.length);
    }

    return jsonResponse({
      status: "completed",
      COMBINATION_DNA_READY: approvedForDna.length > 0,
      stats: {
        candidates_after_hard_reject: totalAfterHardReject,
        total_extracted: updatedRows.length,
        noise_rejected: noiseArchive.length,
        approved_for_dna: approvedForDna.length,
        rejected_by_quota: rejectedByQuota.length,
        visual_temporal_confirmed: visualConfirmed,
        avg_score_by_function: avgScoreByFunction,
        approved_by_function: {
          HOOK: approvedForDna.filter((row) => row.dominant_function === "HOOK").length,
          SETUP: approvedForDna.filter((row) => row.dominant_function === "SETUP").length,
          BUILD: approvedForDna.filter((row) => row.dominant_function === "BUILD").length,
          MICRO_PEAK: approvedForDna.filter((row) => row.dominant_function === "MICRO_PEAK").length,
          TWIST: approvedForDna.filter((row) => row.dominant_function === "TWIST").length,
          PAYOFF: approvedForDna.filter((row) => row.dominant_function === "PAYOFF").length,
          CTA: approvedForDna.filter((row) => row.dominant_function === "CTA").length,
          ACTION: approvedForDna.filter((row) => row.dominant_function === "ACTION").length,
        },
        overflow_by_function: quotaResult.stats,
      },
      top_20_approved: approvedForDna
        .sort((a, b) => Number(b.approval_score) - Number(a.approval_score))
        .slice(0, 20)
        .map((row) => ({
          text: row.combination_text, function: row.dominant_function, intent: row.emotional_intent,
          approval: row.approval_score, semantic: row.semantic_coherence_score, emotional: row.emotional_score,
          rank_score: round2(row._rankScore || 0),
          visual_confirmed: row.linked_micro_event || row.linked_temporal_signal || row.linked_visual_signal,
        })),
      cross_video_patterns: patterns.length,
      videos_processed: videoIds.length,
      blocks_processed: blocks.length,
    });
  } catch (error) {
    console.error("Fatal error in extract-viral-combinations:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
}

function buildEngagementMap(videos: any[]) {
  const map = new Map<string, number>();
  const maxViews = Math.max(...videos.map((video) => Number(video.views || 0)), 1);
  const maxLikes = Math.max(...videos.map((video) => Number(video.likes || 0)), 1);
  const maxComments = Math.max(...videos.map((video) => Number(video.comments || 0)), 1);

  for (const video of videos) {
    const viral = Number(video.engagement_rate_relative || 0) > 0 ? clamp(Number(video.engagement_rate_relative || 0) / 100) : 0.5;
    const score = (
      clamp(Number(video.views || 0) / maxViews) * 0.4 +
      clamp(Number(video.likes || 0) / maxLikes) * 0.3 +
      clamp(Number(video.comments || 0) / maxComments) * 0.2 +
      viral * 0.1
    );
    map.set(video.id, round2(score));
  }

  return map;
}

function dedupeCombinationRows(rows: any[]) {
  const grouped = new Map<string, any>();

  for (const row of rows) {
    const key = `${row.video_id}::${row.block_id}::${row.combination_text}`;
    if (!grouped.has(key)) {
      grouped.set(key, row);
      continue;
    }

    const current = grouped.get(key);
    current.occurrence_count += 1;
    current.confidence_score = Math.max(Number(current.confidence_score || 0), Number(row.confidence_score || 0));
    current.impact_score = Math.max(Number(current.impact_score || 0), Number(row.impact_score || 0));
    current.semantic_coherence_score = Math.max(Number(current.semantic_coherence_score || 0), Number(row.semantic_coherence_score || 0));
    current.emotional_score = Math.max(Number(current.emotional_score || 0), Number(row.emotional_score || 0));
    current.visual_temporal_confirmation_score = Math.max(Number(current.visual_temporal_confirmation_score || 0), Number(row.visual_temporal_confirmation_score || 0));
    current.approval_score = Math.max(Number(current.approval_score || 0), Number(row.approval_score || 0));
    current.linked_micro_event ||= row.linked_micro_event;
    current.linked_temporal_signal ||= row.linked_temporal_signal;
    current.linked_visual_signal ||= row.linked_visual_signal;
    current.approved_for_dna ||= row.approved_for_dna;
  }

  return [...grouped.values()];
}

function extractCandidatesFromText(text: string) {
  const clauses = splitClauses(text);
  const candidates = new Set<string>();

  for (const clause of clauses) {
    const tokens = tokenize(clause);
    if (tokens.length < 2) continue;

    // Extract n-grams of 2 to 10 words
    for (let size = 2; size <= Math.min(10, tokens.length); size++) {
      for (let index = 0; index <= tokens.length - size; index++) {
        const phrase = tokens.slice(index, index + size).join(" ");
        if (isValidCandidateText(phrase)) candidates.add(phrase);
      }
    }

    if (tokens.length >= 2 && tokens.length <= 12) {
      const wholeClause = tokens.join(" ");
      if (isValidCandidateText(wholeClause)) candidates.add(wholeClause);
    }
  }

  return [...candidates];
}

function splitClauses(text: string) {
  return normalizeSpaces(text)
    .replace(/["""'`´]/g, " ")
    .split(/[\n.!?;:|—–]+/g)
    .map((item) => normalizeSpaces(item))
    .filter((item) => item.length >= 6);
}

function tokenize(text: string) {
  return normalizeSpaces(text.toLowerCase())
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.replace(/^[-']+|[-']+$/g, ""))
    .filter(Boolean);
}

function isValidCandidateText(phrase: string) {
  const normalized = normalizeSpaces(phrase.toLowerCase());
  if (BLOCKLIST.has(normalized)) return false;
  const words = normalized.split(" ");
  if (words.length < 2 || words.length > 10) return false;
  if (words.every((word) => word.length <= 2)) return false;
  if (words.every((word) => STOPWORDS.has(word))) return false;
  return true;
}

// RULE 1: Phrase Integrity Check
function checkPhraseIntegrity(phrase: string): { pass: boolean; reason: string } {
  const words = phrase.split(" ");

  // Check for contraction fragment at start
  if (CONTRACTION_FRAGMENTS.has(words[0])) return { pass: false, reason: "starts_with_contraction_fragment" };
  if (CONTRACTION_FRAGMENTS.has(words[words.length - 1])) return { pass: false, reason: "ends_with_contraction_fragment" };

  // Check for dangling apostrophes
  if (/^'|'$/.test(phrase) || /\s'$|^'\s/.test(phrase)) return { pass: false, reason: "dangling_apostrophe" };

  // Check word count
  const meaningful = words.filter((w) => !STOPWORDS.has(w) && w.length > 2);
  if (meaningful.length < 1) return { pass: false, reason: "no_meaningful_words" };

  // Check blocklist
  if (BLOCKLIST.has(phrase.toLowerCase())) return { pass: false, reason: "blocklisted" };

  return { pass: true, reason: "" };
}

// RULE 2: Semantic Completeness + Narrative Completeness
function checkSemanticCompleteness(phrase: string): { pass: boolean; reason: string } {
  const words = phrase.toLowerCase().split(" ");

  // All auxiliary-only
  if (words.every((w) => AUXILIARY_ONLY.has(w) || STOPWORDS.has(w))) {
    if (!hasEmotionWord(phrase) && !hasActionWord(phrase)) {
      return { pass: false, reason: "auxiliary_only_no_meaning" };
    }
  }

  // Simple subject+verb with no emotional content (RULE 6 also)
  if (isNarrativeAction(phrase) && !hasEmotionWord(phrase) && !hasCuriosityWord(phrase)) {
    return { pass: false, reason: "narrative_action_no_emotion" };
  }

  // NEW: Weak verb without object check
  const weakVerbResult = checkWeakVerbWithoutObject(phrase);
  if (!weakVerbResult.pass) return weakVerbResult;

  // NEW: Narrative completeness — subject+weak_verb only phrases
  const narrativeResult = checkNarrativeCompleteness(phrase);
  if (!narrativeResult.pass) return narrativeResult;

  return { pass: true, reason: "" };
}

// Check if phrase is just subject + weak verb with no object
function checkWeakVerbWithoutObject(phrase: string): { pass: boolean; reason: string } {
  const words = phrase.toLowerCase().split(" ");
  if (words.length > 3) return { pass: true, reason: "" }; // has enough words for an object

  // Find if any word is a weak verb
  const weakVerbIdx = words.findIndex((w) => WEAK_VERBS.has(w));
  if (weakVerbIdx === -1) return { pass: true, reason: "" };

  // Check if there's a meaningful word AFTER the weak verb (the object)
  const afterVerb = words.slice(weakVerbIdx + 1);
  const hasMeaningfulObject = afterVerb.some((w) => !STOPWORDS.has(w) && w.length > 2 && !AUXILIARY_ONLY.has(w));

  if (!hasMeaningfulObject) {
    // Allow if phrase has emotional trigger or curiosity
    if (hasEmotionWord(phrase) || hasCuriosityWord(phrase) || hasSurpriseWord(phrase)) {
      return { pass: true, reason: "" };
    }
    return { pass: false, reason: `weak_verb_no_object:${words[weakVerbIdx]}` };
  }
  return { pass: true, reason: "" };
}

// Narrative completeness: require emotional trigger, suspense object, or viewer direction
function checkNarrativeCompleteness(phrase: string): { pass: boolean; reason: string } {
  const lower = phrase.toLowerCase();
  const words = lower.split(" ");

  // Only enforce on short phrases (2-3 words) that look like subject+verb
  if (words.length > 4) return { pass: true, reason: "" };

  const subjectPatterns = /^(he |she |they |it |we |i |eu |ele |ela |eles |elas |nós )/i;
  if (!subjectPatterns.test(lower)) return { pass: true, reason: "" };

  // Has emotional trigger? OK
  if (hasEmotionWord(lower)) return { pass: true, reason: "" };
  // Has curiosity/surprise/tension? OK
  if (hasCuriosityWord(lower) || hasSurpriseWord(lower) || hasTensionWord(lower)) return { pass: true, reason: "" };
  // Has viewer direction? OK
  if (hasCommandWord(lower)) return { pass: true, reason: "" };
  // Has a meaningful object (non-stopword after verb position)?
  if (words.length >= 3) {
    const objectWords = words.slice(2).filter((w) => !STOPWORDS.has(w) && w.length > 2);
    if (objectWords.length > 0) return { pass: true, reason: "" };
  }

  return { pass: false, reason: "narrative_incomplete_no_impact" };
}

// RULE 3: Emotional Intensity Filter — calibrated for 18-22% block survival
function checkEmotionalSignal(phrase: string): { pass: boolean; reason: string } {
  const lower = phrase.toLowerCase();
  if (hasCuriosityWord(lower)) return { pass: true, reason: "" };
  if (hasSurpriseWord(lower)) return { pass: true, reason: "" };
  if (hasTensionWord(lower)) return { pass: true, reason: "" };
  if (hasCommandWord(lower)) return { pass: true, reason: "" };
  if (hasEmotionWord(lower)) return { pass: true, reason: "" };
  if (hasActionWord(lower)) return { pass: true, reason: "" };
  if (hasNarrativeShape(lower.split(" "))) return { pass: true, reason: "" };
  // Allow phrases with 3+ words containing at least one meaningful word (4+ chars, non-stopword)
  const words = lower.split(" ");
  if (words.length >= 3 && words.some((w) => !STOPWORDS.has(w) && w.length >= 4)) return { pass: true, reason: "" };
  return { pass: false, reason: "no_emotional_signal" };
}

function hasCuriosityWord(text: string) { return CURIOSITY_WORDS.some((w) => text.includes(w)); }
function hasSurpriseWord(text: string) { return SURPRISE_WORDS.some((w) => text.includes(w)); }
function hasTensionWord(text: string) { return TENSION_WORDS.some((w) => text.includes(w)); }
function hasCommandWord(text: string) { return COMMAND_WORDS.some((w) => text.includes(w)); }

function scoreCandidate({ phrase, block, narrativeZone, emotionalIntensity, signalCount, tone, videoMeta, crossVideoFreq }: any) {
  const words = phrase.split(" ");
  const stopwordRatio = words.filter((w) => STOPWORDS.has(w)).length / words.length;
  const actionBoost = hasActionWord(phrase) ? 0.2 : 0;
  const emotionBoost = hasEmotionWord(phrase) ? 0.25 : 0;
  const narrativeBoost = hasNarrativeShape(words) ? 0.15 : 0;
  const ctaBoost = detectCta(phrase, block?.funcao_narrativa || "", videoMeta?.cta_text || "") ? 0.18 : 0;
  // Meaningful content bonus: phrase has a word with 5+ chars that's not a stopword
  const hasMeaningfulContent = words.some((w) => !STOPWORDS.has(w) && w.length >= 5) ? 0.10 : 0;

  const semantic = clamp(
    0.46 + actionBoost + narrativeBoost + hasMeaningfulContent +
    (words.length >= 3 && words.length <= 6 ? 0.12 : 0.05) +
    (STOPWORDS.has(words[0]) ? -0.10 : 0) +
    (STOPWORDS.has(words[words.length - 1]) ? -0.06 : 0) +
    (stopwordRatio > 0.6 ? -0.12 : 0)
  );

  const emotional = clamp(
    0.32 + emotionBoost + actionBoost * 0.7 + ctaBoost * 0.5 + hasMeaningfulContent * 0.8 +
    clamp(emotionalIntensity / 10) * 0.22 +
    Math.min(signalCount, 3) * 0.07 +
    (String(tone || "").toLowerCase().includes("urgent") ? 0.08 : 0)
  );

  // RULE 4: Impact score — calibrated with base narrative position value
  const emotionalSignalPresence = (hasEmotionWord(phrase) ? 0.4 : 0) + (hasCuriosityWord(phrase) ? 0.2 : 0) + (hasSurpriseWord(phrase) ? 0.2 : 0) + (hasTensionWord(phrase) ? 0.15 : 0);
  const narrativeFunctionPosition = (HOT_ZONES[narrativeZone] || 0.3) * 0.30;
  const crossVideoFrequency = clamp((crossVideoFreq || 0) / 10) * 0.15;
  const viewerDirection = (ctaBoost > 0 || hasCommandWord(phrase)) ? 0.15 : 0;
  const contentBase = hasMeaningfulContent > 0 ? 0.10 : 0;

  const impact = clamp(
    contentBase +
    clamp(emotionalSignalPresence) * 0.35 +
    narrativeFunctionPosition +
    crossVideoFrequency +
    viewerDirection +
    Math.min(signalCount, 3) * 0.04
  );

  // Narrative Force Score — calibrated with object presence weight
  const emotionalWordPresence = hasEmotionWord(phrase) ? 0.3 : 0;
  const suspenseStructure = (hasCuriosityWord(phrase) || hasSurpriseWord(phrase)) ? 0.25 : 0;
  const viewerDirectionForce = (hasCommandWord(phrase) || ctaBoost > 0) ? 0.2 : 0;
  const hasObject = words.length >= 3 && words.slice(1).some((w) => !STOPWORDS.has(w) && w.length > 2);
  const objectPresence = hasObject ? 0.20 : 0;
  const tensionPresence = hasTensionWord(phrase) ? 0.1 : 0;
  const narrativeForceScore = clamp(emotionalWordPresence + suspenseStructure + viewerDirectionForce + objectPresence + tensionPresence);

  // Narrative Value Score — calibrated with object presence
  const hasUniqueNarrative = words.some((w) => w.length >= 5 && !STOPWORDS.has(w) && !AUXILIARY_ONLY.has(w));
  const narrativeValueScore = clamp(
    clamp(emotionalSignalPresence) * 0.30 +
    suspenseStructure * 0.20 +
    viewerDirectionForce * 0.15 +
    objectPresence * 0.15 +
    (hasUniqueNarrative ? 0.20 : 0)
  );

  const dominantFunction = detectDominantFunction(narrativeZone, phrase, block?.funcao_narrativa || "", videoMeta?.cta_text || "");
  const emotionalIntent = detectEmotionalIntent(phrase, dominantFunction);

  // Lower emotional floor for high-value narrative zones (PAYOFF/TWIST) to avoid losing resolution content
  const emotionalFloor = (narrativeZone === "PAYOFF" || narrativeZone === "TWIST") ? 0.15 : 0.25;
  if (semantic < 0.40 || emotional < emotionalFloor) return null;

  return {
    combination_text: phrase,
    word_count: words.length,
    dominant_function: dominantFunction,
    emotional_intent: emotionalIntent,
    confidence_score: clamp100((semantic * 0.45 + emotional * 0.3 + impact * 0.25) * 100),
    semantic_coherence_score: round2(semantic),
    emotional_score: round2(emotional),
    impact_score: round2(impact),
    narrative_force_score: round2(narrativeForceScore),
    narrative_value_score: round2(narrativeValueScore),
    local_rank: semantic * 0.4 + emotional * 0.35 + impact * 0.25,
  };
}

function detectDominantFunction(zone: string, phrase: string, funcaoNarrativa: string, ctaText: string) {
  if (isNarrativeAction(phrase)) return "ACTION";
  if (isStrictCta(phrase, funcaoNarrativa, ctaText)) return "CTA";
  // Detect MICRO_PEAK from phrase indicators
  if (zone !== "HOOK" && zone !== "CTA" && hasMicroPeakIndicator(phrase)) return "MICRO_PEAK";
  // Detect HOOK from indicators even if block type wasn't hook
  if (zone === "BUILD" && hasHookIndicator(phrase)) return "HOOK";
  // Detect PAYOFF from indicators
  if (zone === "BUILD" && hasPayoffIndicator(phrase)) return "PAYOFF";
  return zone;
}

function detectEmotionalIntent(phrase: string, dominantFunction: string) {
  const text = phrase.toLowerCase();
  if (dominantFunction === "ACTION") return "narração";
  if (isStrictCta(text, "", "")) return "ação";
  if (/(ningu[eé]m|nobody|segredo|secret|percebeu|believe|coragem)/.test(text)) return "curiosidade";
  if (/(agora|now|urgente|corre|rápido|rapido|warning|alerta|cuidado)/.test(text)) return "urgência";
  if (/(mudou|aconteceu|happens|happened|changed|revel)/.test(text)) return "revelação";
  if (/(não|nao|don't|never|pare|stop)/.test(text)) return "alerta";
  if (dominantFunction === "HOOK") return "curiosidade";
  if (dominantFunction === "PAYOFF") return "revelação";
  if (dominantFunction === "TWIST") return "surpresa";
  if (dominantFunction === "MICRO_PEAK") return "impacto";
  if (dominantFunction === "SETUP") return "contexto";
  return "impacto";
}

function isNarrativeAction(phrase: string) {
  const lower = phrase.toLowerCase();
  return FIRST_THIRD_PERSON_PATTERNS.some((pattern) => pattern.test(lower));
}

function isStrictCta(phrase: string, funcaoNarrativa: string, ctaText: string) {
  const lower = phrase.toLowerCase();
  if (isNarrativeAction(lower)) return false;
  const hasCTAWord = CTA_WORDS.some((word) => lower.includes(word));
  if (!hasCTAWord) return false;
  const combined = `${lower} ${funcaoNarrativa} ${ctaText}`.toLowerCase();
  return CTA_VIEWER_INDICATORS.some((indicator) => combined.includes(indicator));
}

function detectCta(phrase: string, funcaoNarrativa: string, ctaText: string) {
  return isStrictCta(phrase, funcaoNarrativa, ctaText);
}

function hasActionWord(text: string) { return ACTION_WORDS.some((word) => text.includes(word)); }
function hasEmotionWord(text: string) { return EMOTION_WORDS.some((word) => text.includes(word)); }

function hasNarrativeShape(words: string[]) {
  if (words.length < 2) return false;
  const first = words[0];
  return ["você", "voce", "isso", "olha", "watch", "look", "não", "nao", "mas", "ninguém", "ninguem"].includes(first) || words.some((w) => w.length >= 6);
}

function mapBlockTypeToZone(blockType: string, funcaoNarrativa: string, text: string, hasMicroEvent?: boolean) {
  const normalized = blockType.toLowerCase();
  if (detectCta(text, funcaoNarrativa, "")) return "CTA";
  if (normalized === "hook") return "HOOK";
  if (["setup", "contexto"].includes(normalized)) return "SETUP";
  if (["revelacao", "payoff"].includes(normalized)) return "PAYOFF";
  if (normalized === "tensao") return "TWIST";
  // MICRO_PEAK detection: blocks with micro events or micro-peak indicator phrases
  if (hasMicroEvent || hasMicroPeakIndicator(text)) return "MICRO_PEAK";
  if (normalized === "transicao") return "BUILD";
  return "BUILD";
}

function hasMicroPeakIndicator(text: string): boolean {
  const lower = text.toLowerCase();
  return MICRO_PEAK_INDICATORS.some((ind) => lower.includes(ind));
}

function hasHookIndicator(text: string): boolean {
  const lower = text.toLowerCase();
  return HOOK_INDICATORS.some((ind) => lower.includes(ind));
}

function hasPayoffIndicator(text: string): boolean {
  const lower = text.toLowerCase();
  return PAYOFF_INDICATORS.some((ind) => lower.includes(ind));
}

// =============================================
// BLOCK PROCESSING ENGINE
// =============================================

function processBlocks(
  blocks: any[], verbalMap: any, microEventBlocks: Set<string>,
  microEventStrengthMap: Map<string, number>, temporalSignalBlocks: Set<string>,
  highAlignmentBlocks: Set<string>, videoMetaMap: Map<string, any>,
  noiseArchive: any[], allCombinations: any[],
  relaxedMode = false,
): Record<string, number> {
  const zoneCounts: Record<string, number> = {};

  for (const block of blocks) {
    const verbal = verbalMap[block.id];
    const sourceText = normalizeSpaces(verbal?.full_text || block.texto || "");
    if (!sourceText) continue;

    const hasMicroEvent = microEventBlocks.has(block.id);
    const narrativeZone = mapBlockTypeToZone(String(block.tipo_bloco || ""), String(block.funcao_narrativa || ""), sourceText, hasMicroEvent);
    const signalCount = [microEventBlocks.has(block.id), temporalSignalBlocks.has(block.id), highAlignmentBlocks.has(block.id)].filter(Boolean).length;
    const emotionalIntensity = Number(verbal?.emotional_intensity || 0);

    // All blocks processed — no emotional intensity gates (densification strategy)

    const rawCandidates = extractCandidatesFromText(sourceText);
    // Also add full block text as candidate if reasonable length (expanded to 20 words)
    const fullWords = sourceText.split(/\s+/);
    if (fullWords.length >= 2 && fullWords.length <= 20 && !rawCandidates.includes(sourceText.toLowerCase())) {
      rawCandidates.push(sourceText);
    }
    // Add each clause as a standalone candidate for better coverage
    const clauses = splitClauses(sourceText);
    for (const clause of clauses) {
      const clauseWords = clause.split(/\s+/);
      if (clauseWords.length >= 2 && clauseWords.length <= 15) {
        const normalized = normalizeSpaces(clause);
        if (!rawCandidates.includes(normalized) && !rawCandidates.includes(normalized.toLowerCase())) {
          rawCandidates.push(normalized);
        }
      }
    }
    // For revelacao/payoff/tensao blocks: ensure minimum 2 candidates by also adding half-splits
    const isHighValueBlock = ["revelacao", "payoff", "tensao"].includes(String(block.tipo_bloco || "").toLowerCase());
    if (isHighValueBlock && rawCandidates.length < 2 && fullWords.length >= 4) {
      const mid = Math.ceil(fullWords.length / 2);
      const firstHalf = fullWords.slice(0, mid).join(" ");
      const secondHalf = fullWords.slice(mid).join(" ");
      if (firstHalf.split(/\s+/).length >= 2) rawCandidates.push(firstHalf);
      if (secondHalf.split(/\s+/).length >= 2) rawCandidates.push(secondHalf);
    }
    const blockCandidates: any[] = [];

    for (const rawPhrase of rawCandidates) {
      // RULE 12: Strip fillers before processing
      const phrase = stripFillersFromCandidate(rawPhrase);

      const integrityResult = checkPhraseIntegrity(phrase);
      if (!integrityResult.pass) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: integrityResult.reason, source_block_type: block.tipo_bloco });
        continue;
      }
      // RULE 11: Truncation check
      const truncResult = checkTruncatedPhrase(phrase);
      if (!truncResult.pass) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: truncResult.reason, source_block_type: block.tipo_bloco });
        continue;
      }
      const semanticResult = checkSemanticCompleteness(phrase);
      // For revelacao/payoff/tensao blocks: bypass narrative_action rejection — these blocks
      // naturally contain narrative descriptions that ARE the twist/payoff content
      const isHighValueBlockType = ["revelacao", "payoff", "tensao"].includes(String(block.tipo_bloco || "").toLowerCase());
      if (!semanticResult.pass && !(isHighValueBlockType && semanticResult.reason === "narrative_action_no_emotion")) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: semanticResult.reason, source_block_type: block.tipo_bloco });
        continue;
      }
      const emotionalResult = checkEmotionalSignal(phrase);
      if (!emotionalResult.pass) {
        if (relaxedMode && (hasHookIndicator(phrase) || hasMicroPeakIndicator(phrase) || hasPayoffIndicator(phrase))) {
          // Allow through in relaxed mode
        } else {
          noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: emotionalResult.reason, source_block_type: block.tipo_bloco });
          continue;
        }
      }
      const socialResult = checkSocialPhrase(phrase);
      if (!socialResult.pass) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: socialResult.reason, source_block_type: block.tipo_bloco });
        continue;
      }
      const genericResult = checkGenericVerb(phrase);
      if (!genericResult.pass) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: genericResult.reason, source_block_type: block.tipo_bloco });
        continue;
      }
      const completionResult = checkContextualCompletion(phrase);
      if (!completionResult.pass) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: completionResult.reason, source_block_type: block.tipo_bloco });
        continue;
      }

      const words = phrase.split(" ");
      if (words.length < 2 || words.length > 10) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: `word_count_${words.length}_out_of_range`, source_block_type: block.tipo_bloco });
        continue;
      }

      const scored = scoreCandidate({
        phrase, block, narrativeZone, emotionalIntensity, signalCount,
        tone: verbal?.tone || block.emocao || "",
        videoMeta: videoMetaMap.get(block.video_id),
        crossVideoFreq: 0,
      });

      if (!scored) {
        noiseArchive.push({ video_id: block.video_id, block_id: block.id, combination_text: phrase, rejection_reason: "below_score_threshold", source_block_type: block.tipo_bloco });
        continue;
      }

      // Compute scores for ranking — no binary rejection here
      const hasTemporalSignal = temporalSignalBlocks.has(block.id);
      const hasVisualSignal = highAlignmentBlocks.has(block.id);
      const visualTemporalScore = clamp((Number(hasMicroEvent) + Number(hasTemporalSignal) + Number(hasVisualSignal)) / 3 + ((hasMicroEvent || hasTemporalSignal || hasVisualSignal) ? 0.15 : 0));
      const approvalScore = clamp(
        (HOT_ZONES[scored.dominant_function] || 0.4) * 0.20 +
        scored.emotional_score * 0.25 +
        visualTemporalScore * 0.20 +
        scored.semantic_coherence_score * 0.20 +
        scored.impact_score * 0.10 +
        (scored.word_count >= 3 && scored.word_count <= 6 ? 0.05 : 0)
      );

      blockCandidates.push({
        id: crypto.randomUUID(),
        video_id: block.video_id,
        block_id: block.id,
        combination_text: scored.combination_text,
        word_count: scored.word_count,
        dominant_function: scored.dominant_function,
        emotional_intent: scored.emotional_intent,
        block_type: block.tipo_bloco,
        source_block_type: block.tipo_bloco,
        language_code: block.language_code || "pt",
        confidence_score: scored.confidence_score,
        impact_score: scored.impact_score,
        semantic_coherence_score: scored.semantic_coherence_score,
        emotional_score: scored.emotional_score,
        narrative_force_score: scored.narrative_force_score,
        narrative_value_score: scored.narrative_value_score,
        visual_temporal_confirmation_score: visualTemporalScore,
        approval_score: approvalScore,
        linked_micro_event: hasMicroEvent,
        linked_temporal_signal: hasTemporalSignal,
        linked_visual_signal: hasVisualSignal,
        approved_for_dna: true,
        sample_context: sourceText.slice(0, 200),
        occurrence_count: 1,
        cross_video_count: 1,
        pattern_score: approvalScore,
      });
    }

    // Keep top 10 per block — densification for narrative coverage
    blockCandidates.sort((a, b) => Number(b.approval_score) - Number(a.approval_score));
    const topFromBlock = blockCandidates.slice(0, 10);
    for (const c of topFromBlock) {
      allCombinations.push(c);
      zoneCounts[c.dominant_function] = (zoneCounts[c.dominant_function] || 0) + 1;
    }
    // Archive overflow
    for (const c of blockCandidates.slice(10)) {
      noiseArchive.push({ video_id: c.video_id, block_id: c.block_id, combination_text: c.combination_text, rejection_reason: "block_cap_overflow", source_block_type: c.source_block_type });
    }
  }

  return zoneCounts;
}

function countZoneCoverage(combinations: any[], videoId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of combinations) {
    if (c.video_id === videoId && c.approved_for_dna) {
      counts[c.dominant_function] = (counts[c.dominant_function] || 0) + 1;
    }
  }
  return counts;
}

function rescanForMissingZones(
  videoBlocks: any[], missingZones: string[], verbalMap: any,
  microEventBlocks: Set<string>, microEventStrengthMap: Map<string, number>,
  temporalSignalBlocks: Set<string>, highAlignmentBlocks: Set<string>,
  videoMetaMap: Map<string, any>, noiseArchive: any[], allCombinations: any[],
) {
  // Filter blocks that could belong to missing zones
  const candidateBlocks = videoBlocks.filter((block) => {
    const verbal = verbalMap[block.id];
    const text = normalizeSpaces(verbal?.full_text || block.texto || "");
    if (!text) return false;
    const hasME = microEventBlocks.has(block.id);
    const zone = mapBlockTypeToZone(String(block.tipo_bloco || ""), String(block.funcao_narrativa || ""), text, hasME);
    return missingZones.includes(zone);
  });

  if (candidateBlocks.length === 0) {
    // If no direct block matches, try to find blocks by temporal position
    // HOOK: first blocks; PAYOFF/CTA: last blocks
    const sorted = [...videoBlocks].sort((a, b) => a.bloco_id - b.bloco_id);
    const rescannableBlocks: any[] = [];
    if (missingZones.includes("HOOK") && sorted.length > 0) rescannableBlocks.push(sorted[0]);
    if (missingZones.includes("CTA") && sorted.length > 1) rescannableBlocks.push(sorted[sorted.length - 1]);
    if (missingZones.includes("PAYOFF") && sorted.length > 2) rescannableBlocks.push(sorted[sorted.length - 2]);
    if (missingZones.includes("MICRO_PEAK")) {
      // Pick middle blocks with any signal
      const midBlocks = sorted.slice(1, -1).filter((b) => microEventBlocks.has(b.id) || temporalSignalBlocks.has(b.id));
      rescannableBlocks.push(...midBlocks.slice(0, 2));
    }
    if (rescannableBlocks.length > 0) {
      processBlocks(rescannableBlocks, verbalMap, microEventBlocks, microEventStrengthMap, temporalSignalBlocks, highAlignmentBlocks, videoMetaMap, noiseArchive, allCombinations, true);
    }
  } else {
    processBlocks(candidateBlocks, verbalMap, microEventBlocks, microEventStrengthMap, temporalSignalBlocks, highAlignmentBlocks, videoMetaMap, noiseArchive, allCombinations, true);
  }
}

function normalizeSpaces(text: string) { return text.replace(/\s+/g, " ").trim(); }

function mostFrequent(values: string[]) {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function avg(values: number[]) { return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0; }
function round2(v: number) { return Math.round(v * 100) / 100; }
function clamp(v: number) { return Math.min(Math.max(v, 0), 1); }
function clamp100(v: number) { return Math.min(Math.max(Math.round(v), 0), 100); }

// RULE 7: Social phrase rejection
const SOCIAL_PATTERNS = [
  /\bnice to (see|meet)\b/i, /\bgood to (see|meet)\b/i, /\bpleased to meet\b/i,
  /\bhow are you\b/i, /\bhow you doing\b/i, /\bthank(s| you)\b/i, /\bi appreciate\b/i,
  /\bthat's (great|nice|cool|awesome)\b/i, /\bsounds (good|great)\b/i,
  /\bpretty (good|nice)\b/i, /\breally (nice|good)\b/i,
  /\bno worries\b/i, /\bno problem\b/i, /\bof course\b/i, /\bfair enough\b/i,
  /\bnice one\b/i, /\bgood one\b/i,
  /\btudo (bem|certo)\b/i, /\bobrigad[oa]\b/i, /\bpor favor\b/i, /\bcom licença\b/i,
  /\bprazer em conhecer\b/i, /\bbom te ver\b/i, /\bque (legal|bom)\b/i,
  /\bsee me on\b/i, /\bfollow me on\b/i, /\bcheck me out\b/i, /\bfind me on\b/i,
  /\bmind if i\b/i,
];

function checkSocialPhrase(phrase: string): { pass: boolean; reason: string } {
  const lower = phrase.toLowerCase();
  for (const pattern of SOCIAL_PATTERNS) {
    if (pattern.test(lower)) return { pass: false, reason: "social_polite_filler" };
  }
  return { pass: true, reason: "" };
}

// RULE 8: Generic verb without tension
const GENERIC_VERB_PATTERNS = [
  /\bjust looks\b/i, /\blooks vaguely\b/i, /\bliterally looking\b/i,
  /\bjust seems\b/i, /\bjust sitting\b/i, /\bjust standing\b/i,
  /\bjust walking\b/i, /\bjust talking\b/i, /\bjust goes\b/i,
  /\bkinda looks\b/i, /\bsort of looks\b/i, /\bsort of seems\b/i,
  /\bbasically just\b/i, /\bliterally just\b/i,
  /\bsó olhando\b/i, /\bsó andando\b/i, /\bsó falando\b/i,
  /\bsó parece\b/i, /\bparece que\b/i,
];

function checkGenericVerb(phrase: string): { pass: boolean; reason: string } {
  const lower = phrase.toLowerCase();
  for (const pattern of GENERIC_VERB_PATTERNS) {
    if (pattern.test(lower)) return { pass: false, reason: "generic_verb_no_tension" };
  }
  return { pass: true, reason: "" };
}

// RULE 9: Contextual completion — reject incomplete thoughts
const INCOMPLETE_ENDINGS = [
  /\b(you could|you would|you might|that's|if that's|know if|could be|would be|might be)$/i,
  /\b(bites it|couple bites|if that|know that|think that)$/i,
  /\b(você poderia|seria|talvez|se isso|sabe se)$/i,
];
const INCOMPLETE_STARTS = [
  /^(and also|but also|or maybe|and maybe|so basically|like basically|and literally)/i,
  /^(e também|mas também|ou talvez|e tipo)/i,
];

function checkContextualCompletion(phrase: string): { pass: boolean; reason: string } {
  const lower = phrase.toLowerCase().trim();
  for (const pattern of INCOMPLETE_ENDINGS) {
    if (pattern.test(lower)) return { pass: false, reason: "incomplete_thought_ending" };
  }
  for (const pattern of INCOMPLETE_STARTS) {
    if (pattern.test(lower)) return { pass: false, reason: "incomplete_thought_start" };
  }
  return { pass: true, reason: "" };
}

// =============================================
// RULE 11: TRUNCATED PHRASE DETECTION
// =============================================

const TRUNCATION_PATTERNS = [
  // Ends with dangling preposition/conjunction/article
  /\b(the|a|an|of|to|in|on|at|for|with|and|or|but|that|which|who|where|when|just|it|its|you|your|o|a|os|as|de|do|da|em|no|na|por|pra|com|que|e|ou|mas|um|uma)$/i,
  // Ends with truncated word (cut mid-word, indicated by lowercase char at end after very short final token)
  /\s[a-záàâãéèêíìîóòôõúùûç]{1}$/i,
  // Visible truncation marker
  /[…]+$/,
  /\.{2,}$/,
];

// Patterns that indicate mid-sentence cut
const MID_THOUGHT_PATTERNS = [
  /\b(looks just|it looks just|couple bites it|experience you c|know where to make who)$/i,
  /\b(horrible experience you|olhasse por trás voc|where to make who)$/i,
  /\b(couple bites it looks|know where to make|make whole look hotter)/i,
  /\bpterodacty\b/i,
  /\blooks wet$/i,
  /\blook hotter\b.*[a-z]{6,}$/i,
];

function checkTruncatedPhrase(phrase: string): { pass: boolean; reason: string } {
  const lower = phrase.toLowerCase().trim();
  const words = lower.split(" ");

  // Single-char last word (likely truncated)
  if (words.length > 1 && words[words.length - 1].length === 1 && /[a-záàâãéèêíìîóòôõúùûç]/i.test(words[words.length - 1])) {
    return { pass: false, reason: "truncated_single_char_ending" };
  }

  for (const pattern of MID_THOUGHT_PATTERNS) {
    if (pattern.test(lower)) return { pass: false, reason: "mid_thought_truncation" };
  }

  // Check if phrase ends with a weak/dangling word that suggests incompleteness
  const lastWord = words[words.length - 1];
  const danglingEnders = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "that", "which", "just", "its", "o", "os", "as", "de", "do", "da", "em", "no", "na", "por", "com", "que", "e", "ou", "um", "uma"]);
  if (words.length >= 3 && danglingEnders.has(lastWord)) {
    return { pass: false, reason: `dangling_ending:${lastWord}` };
  }

  // Ellipsis / truncation markers
  if (/[…]/.test(phrase) || /\.{2,}$/.test(phrase)) {
    return { pass: false, reason: "ellipsis_truncation" };
  }

  return { pass: true, reason: "" };
}

// =============================================
// RULE 12: STRIP FILLERS AT EXTRACTION TIME
// =============================================

function stripFillersFromCandidate(phrase: string): string {
  let cleaned = phrase;
  const fillers = [
    "kind of", "sort of", "a bit", "just", "literally", "basically",
    "really", "actually", "pretty much", "you know", "like",
    "tipo", "meio que", "basicamente", "literalmente", "na real",
    "a little", "little bit", "um pouco",
  ];
  const sorted = [...fillers].sort((a, b) => b.length - a.length);
  for (const filler of sorted) {
    const regex = new RegExp(`\\b${filler.replace(/\s+/g, "\\s+")}\\b`, "gi");
    cleaned = cleaned.replace(regex, " ");
  }
  cleaned = normalizeSpaces(cleaned);
  // If stripping reduced to <2 words, return original
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 2) return phrase;
  return cleaned;
}

// =============================================
// LAYER 4: QUOTA-BASED SELECTION
// =============================================

const FUNCTION_QUOTAS: Record<string, [number, number]> = {
  HOOK: [15, 30],
  CTA: [15, 25],
  BUILD: [15, 30],
  TWIST: [15, 30],
  PAYOFF: [15, 25],
  MICRO_PEAK: [15, 30],
  SETUP: [10, 20],
  ACTION: [0, 6],
};

function applyQuotaSelection(
  combinations: any[],
  highAlignmentBlocks: Set<string>,
  noiseArchive: any[],
): { all: any[]; stats: Record<string, { candidates: number; selected: number; overflow: number }> } {
  // Compute composite rank score for each candidate
  for (const c of combinations) {
    const hasVisual = highAlignmentBlocks.has(c.block_id) || c.linked_visual_signal || c.linked_micro_event || c.linked_temporal_signal;
    const visualBonus = hasVisual ? 0.10 : -0.05;
    c._rankScore =
      Number(c.approval_score || 0) * 0.30 +
      Number(c.emotional_score || 0) * 0.25 +
      Number(c.semantic_coherence_score || 0) * 0.15 +
      Number(c.impact_score || 0) * 0.10 +
      Number(c.narrative_force_score || 0) * 0.08 +
      Number(c.narrative_value_score || 0) * 0.07 +
      visualBonus +
      (Number(c.visual_temporal_confirmation_score || 0)) * 0.05;
  }

  // Group by dominant_function
  const byFunction = new Map<string, any[]>();
  for (const c of combinations) {
    const fn = c.dominant_function || "BUILD";
    if (!byFunction.has(fn)) byFunction.set(fn, []);
    byFunction.get(fn)!.push(c);
  }

  const stats: Record<string, { candidates: number; selected: number; overflow: number }> = {};
  const result: any[] = [];

  for (const [fn, items] of byFunction) {
    // Sort by rank score descending
    items.sort((a: any, b: any) => b._rankScore - a._rankScore);
    const [, max] = FUNCTION_QUOTAS[fn] || [0, 4];
    const candidateCount = items.length;
    let selectedCount = 0;

    for (let i = 0; i < items.length; i++) {
      if (i < max) {
        items[i].approved_for_dna = true;
        selectedCount++;
      } else {
        items[i].approved_for_dna = false;
        noiseArchive.push({
          video_id: items[i].video_id,
          block_id: items[i].block_id,
          combination_text: items[i].combination_text,
          rejection_reason: `quota_overflow:${fn}_rank_${i + 1}_of_${candidateCount}`,
          source_block_type: items[i].source_block_type || items[i].block_type,
          impact_score: items[i].impact_score,
          emotional_score: items[i].emotional_score,
        });
      }
      result.push(items[i]);
    }

    stats[fn] = { candidates: candidateCount, selected: selectedCount, overflow: candidateCount - selectedCount };
  }

  return { all: result, stats };
}

// =============================================
// SEMANTIC DEDUPLICATION LAYER
// =============================================

const FILLER_MODIFIERS = [
  "kind of", "sort of", "a bit", "just", "literally", "basically",
  "really", "actually", "pretty much", "you know", "like",
  "tipo", "meio que", "basicamente", "literalmente", "na real",
];

function removeFillerModifiers(phrase: string): string {
  let cleaned = phrase.toLowerCase();
  const sorted = [...FILLER_MODIFIERS].sort((a, b) => b.length - a.length);
  for (const filler of sorted) {
    cleaned = cleaned.replace(new RegExp(`\\b${filler.replace(/\s+/g, "\\s+")}\\b`, "gi"), " ");
  }
  return normalizeSpaces(cleaned);
}

function tokenSetForSimilarity(phrase: string): Set<string> {
  return new Set(
    phrase.toLowerCase().split(/\s+/).filter((w) => !STOPWORDS.has(w) && w.length > 2)
  );
}

function calculateSemanticSimilarity(a: string, b: string): number {
  const normA = removeFillerModifiers(a);
  const normB = removeFillerModifiers(b);
  if (normA === normB) return 1.0;
  if (normA.includes(normB) || normB.includes(normA)) return 0.92;
  const setA = tokenSetForSimilarity(normA);
  const setB = tokenSetForSimilarity(normB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) { if (setB.has(token)) intersection++; }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

function pickBestVariant(variants: any[]): any {
  return variants.sort((a, b) => {
    const scoreDiff = Number(b.approval_score || 0) - Number(a.approval_score || 0);
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    const emotDiff = Number(b.emotional_score || 0) - Number(a.emotional_score || 0);
    if (Math.abs(emotDiff) > 0.01) return emotDiff;
    return (b.combination_text?.length || 0) - (a.combination_text?.length || 0);
  })[0];
}

function semanticDeduplicateCombinations(combinations: any[], noiseArchive: any[]): any[] {
  const byVideo = new Map<string, any[]>();
  for (const c of combinations) {
    const vid = c.video_id;
    if (!byVideo.has(vid)) byVideo.set(vid, []);
    byVideo.get(vid)!.push(c);
  }
  const result: any[] = [];
  for (const [videoId, items] of byVideo) {
    const clusters: any[][] = [];
    const assigned = new Set<number>();
    for (let i = 0; i < items.length; i++) {
      if (assigned.has(i)) continue;
      const cluster = [items[i]];
      assigned.add(i);
      for (let j = i + 1; j < items.length; j++) {
        if (assigned.has(j)) continue;
        const sim = calculateSemanticSimilarity(items[i].combination_text, items[j].combination_text);
        if (sim >= 0.88) { cluster.push(items[j]); assigned.add(j); }
      }
      clusters.push(cluster);
    }
    for (const cluster of clusters) {
      const best = pickBestVariant(cluster);
      best.occurrence_count = cluster.reduce((sum, c) => sum + Number(c.occurrence_count || 1), 0);
      for (const variant of cluster) {
        if (variant.id !== best.id) {
          noiseArchive.push({
            video_id: videoId, block_id: variant.block_id,
            combination_text: variant.combination_text,
            rejection_reason: `semantic_duplicate_of:${best.combination_text}`,
            source_block_type: variant.source_block_type || variant.block_type,
            impact_score: variant.impact_score, emotional_score: variant.emotional_score,
            semantic_coherence_score: variant.semantic_coherence_score,
          });
        }
      }
      result.push(best);
    }
  }
  return result;
}
