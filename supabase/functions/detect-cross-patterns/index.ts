import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ─── STEP 1: Sequence Patterns ───
    const { data: blocks } = await supabase
      .from("video_blocks")
      .select("video_id, bloco_id, tipo_bloco, emocao, tempo_inicio, tempo_fim")
      .order("video_id")
      .order("bloco_id");

    if (!blocks || blocks.length === 0) {
      return new Response(JSON.stringify({ error: "No blocks found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group blocks by video
    const videoBlocks: Record<string, typeof blocks> = {};
    for (const b of blocks) {
      if (!videoBlocks[b.video_id]) videoBlocks[b.video_id] = [];
      videoBlocks[b.video_id].push(b);
    }

    // Get micro events for peak intensity
    const { data: microEvents } = await supabase
      .from("video_micro_events")
      .select("video_id, block_id, event_strength")
      .eq("processing_status", "completed");

    const videoMicroPeaks: Record<string, number> = {};
    if (microEvents) {
      for (const e of microEvents) {
        if (!videoMicroPeaks[e.video_id] || e.event_strength > videoMicroPeaks[e.video_id]) {
          videoMicroPeaks[e.video_id] = Number(e.event_strength);
        }
      }
    }

    // Detect 3-block sequences
    const seqCounter: Record<string, { videos: Set<string>; count: number; durations: number[]; intensities: number[]; emotionFlow: string }> = {};

    for (const [videoId, vBlocks] of Object.entries(videoBlocks)) {
      const sorted = vBlocks.sort((a, b) => a.bloco_id - b.bloco_id);
      for (let i = 0; i <= sorted.length - 3; i++) {
        const seq = `${sorted[i].tipo_bloco} → ${sorted[i + 1].tipo_bloco} → ${sorted[i + 2].tipo_bloco}`;
        const emotionFlow = `${sorted[i].emocao || "neutro"} → ${sorted[i + 1].emocao || "neutro"} → ${sorted[i + 2].emocao || "neutro"}`;
        const duration = Number(sorted[i + 2].tempo_fim) - Number(sorted[i].tempo_inicio);

        if (!seqCounter[seq]) {
          seqCounter[seq] = { videos: new Set(), count: 0, durations: [], intensities: [], emotionFlow };
        }
        seqCounter[seq].videos.add(videoId);
        seqCounter[seq].count++;
        seqCounter[seq].durations.push(duration);
        if (videoMicroPeaks[videoId]) seqCounter[seq].intensities.push(videoMicroPeaks[videoId]);
      }
    }

    // Filter: min 3 videos
    const validSequences = Object.entries(seqCounter)
      .filter(([_, v]) => v.videos.size >= 3)
      .map(([seq, v]) => ({
        sequence_structure: seq,
        sequence_emotion_flow: v.emotionFlow,
        sequence_duration_avg: v.durations.reduce((a, b) => a + b, 0) / v.durations.length,
        videos_count: v.videos.size,
        occurrence_count: v.count,
        avg_peak_intensity: v.intensities.length > 0 ? v.intensities.reduce((a, b) => a + b, 0) / v.intensities.length : 0,
        pattern_score: 0,
      }));

    // Normalize scores
    const maxSeqVideos = Math.max(...validSequences.map(s => s.videos_count), 1);
    for (const s of validSequences) {
      const freqScore = s.videos_count / maxSeqVideos;
      const intensityScore = Math.min(s.avg_peak_intensity, 1);
      const consistencyScore = s.occurrence_count / (s.videos_count * 3);
      s.pattern_score = Math.round((freqScore * 0.4 + intensityScore * 0.3 + Math.min(consistencyScore, 1) * 0.3) * 100) / 100;
    }

    // Clear and insert sequence patterns
    await supabase.from("viral_sequence_patterns").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (validSequences.length > 0) {
      await supabase.from("viral_sequence_patterns").insert(validSequences);
    }

    // ─── STEP 2: Timing Patterns ───
    const { data: temporalData } = await supabase
      .from("video_temporal_profile")
      .select("video_id, block_id, cut_density, avg_cut_interval, rhythm_level, tempo_pattern")
      .eq("processing_status", "completed");

    const timingByVideo: Record<string, typeof temporalData> = {};
    if (temporalData) {
      for (const t of temporalData) {
        if (!timingByVideo[t.video_id]) timingByVideo[t.video_id] = [];
        timingByVideo[t.video_id].push(t);
      }
    }

    const timingCounter: Record<string, { videos: Set<string>; cutDensities: number[]; pauses: number[]; accelerations: number[] }> = {};
    for (const [videoId, tBlocks] of Object.entries(timingByVideo)) {
      if (!tBlocks || tBlocks.length < 2) continue;
      // Use 2-block sliding windows for more matches
      for (let i = 0; i <= tBlocks.length - 2; i++) {
        const signature = `${tBlocks[i].rhythm_level} → ${tBlocks[i + 1].rhythm_level}`;
        if (!timingCounter[signature]) {
          timingCounter[signature] = { videos: new Set(), cutDensities: [], pauses: [], accelerations: [] };
        }
        timingCounter[signature].videos.add(videoId);
        timingCounter[signature].cutDensities.push(Number(tBlocks[i].cut_density), Number(tBlocks[i + 1].cut_density));
        if (tBlocks[i].rhythm_level === "low") timingCounter[signature].pauses.push(Number(tBlocks[i].avg_cut_interval));
        const accel = Number(tBlocks[i + 1].cut_density) - Number(tBlocks[i].cut_density);
        timingCounter[signature].accelerations.push(accel);
      }
      // Also add tempo_pattern transitions
      for (let i = 0; i <= tBlocks.length - 2; i++) {
        const sig = `tempo:${tBlocks[i].tempo_pattern} → ${tBlocks[i + 1].tempo_pattern}`;
        if (!timingCounter[sig]) {
          timingCounter[sig] = { videos: new Set(), cutDensities: [], pauses: [], accelerations: [] };
        }
        timingCounter[sig].videos.add(videoId);
        timingCounter[sig].cutDensities.push(Number(tBlocks[i].cut_density));
      }
    }

    const validTimings = Object.entries(timingCounter)
      .filter(([_, v]) => v.videos.size >= 2)
      .map(([sig, v]) => ({
        timing_signature: sig,
        avg_cut_density: v.cutDensities.reduce((a, b) => a + b, 0) / v.cutDensities.length,
        avg_pause_duration: v.pauses.length > 0 ? v.pauses.reduce((a, b) => a + b, 0) / v.pauses.length : 0,
        avg_acceleration: v.accelerations.length > 0 ? v.accelerations.reduce((a, b) => a + b, 0) / v.accelerations.length : 0,
        videos_count: v.videos.size,
        pattern_score: 0,
      }));

    const maxTimingVideos = Math.max(...validTimings.map(t => t.videos_count), 1);
    for (const t of validTimings) {
      t.pattern_score = Math.round((t.videos_count / maxTimingVideos) * 100) / 100;
    }

    await supabase.from("viral_timing_patterns").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (validTimings.length > 0) {
      await supabase.from("viral_timing_patterns").insert(validTimings);
    }

    // ─── STEP 3: Emotional Patterns ───
    // Use 2-3 block emotion windows for better matching
    const emotionCounter: Record<string, { videos: Set<string>; intensities: number[]; positions: number[][] }> = {};

    for (const [videoId, vBlocks] of Object.entries(videoBlocks)) {
      const sorted = vBlocks.sort((a, b) => a.bloco_id - b.bloco_id);
      // 2-block emotion windows
      for (let i = 0; i <= sorted.length - 2; i++) {
        const emoSeq2 = `${sorted[i].emocao || "neutro"} → ${sorted[i + 1].emocao || "neutro"}`;
        if (!emotionCounter[emoSeq2]) emotionCounter[emoSeq2] = { videos: new Set(), intensities: [], positions: [] };
        emotionCounter[emoSeq2].videos.add(videoId);
      }
      // 3-block emotion windows
      for (let i = 0; i <= sorted.length - 3; i++) {
        const emoSeq3 = `${sorted[i].emocao || "neutro"} → ${sorted[i + 1].emocao || "neutro"} → ${sorted[i + 2].emocao || "neutro"}`;
        if (!emotionCounter[emoSeq3]) emotionCounter[emoSeq3] = { videos: new Set(), intensities: [], positions: [] };
        emotionCounter[emoSeq3].videos.add(videoId);
      }
    }

    // Enrich with semantic intensity
    const { data: semanticData } = await supabase
      .from("block_semantic_patterns")
      .select("video_id, block_emotional_intensity");
    if (semanticData) {
      for (const s of semanticData) {
        for (const [_, v] of Object.entries(emotionCounter)) {
          if (v.videos.has(s.video_id) && s.block_emotional_intensity) {
            v.intensities.push(Number(s.block_emotional_intensity));
          }
        }
      }
    }

    const validEmotions = Object.entries(emotionCounter)
      .filter(([_, v]) => v.videos.size >= 3)
      .map(([seq, v]) => ({
        emotional_sequence: seq,
        peak_positions: [] as number[],
        avg_intensity: v.intensities.length > 0 ? v.intensities.reduce((a, b) => a + b, 0) / v.intensities.length : 0,
        videos_count: v.videos.size,
        pattern_score: 0,
      }));

    const maxEmVideos = Math.max(...validEmotions.map(e => e.videos_count), 1);
    for (const e of validEmotions) {
      e.pattern_score = Math.round((e.videos_count / maxEmVideos) * 100) / 100;
    }

    await supabase.from("viral_emotional_patterns").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (validEmotions.length > 0) {
      await supabase.from("viral_emotional_patterns").insert(validEmotions);
    }

    // ─── STEP 4: Verbal Patterns (CALIBRATED — 6 detection fronts) ───
    const allVerbalPatterns: any[] = [];

    // Helper: Portuguese stopwords
    const stopwords = new Set(["de","a","o","e","do","da","em","um","uma","que","para","com","por","se","na","no","os","as","ao","dos","das","ou","mais","mas","não","foi","ser","como","eu","ele","ela","isso","esse","essa","este","esta","já","também","nos","te","me","lhe","seu","sua","seus","suas","pelo","pela","lo","la","lá","lhe","muito","bem","só","vai","vou","tem","ter","foi","era","são","está","estou","aqui","ali","aí","até","quando","onde","então","depois","antes","sobre","entre","cada","todo","toda","todos","todas","nada","tudo","algo","outro","outra","outros","outras","mesmo","mesma","ainda","agora","dia","vez","uns","umas"]);

    // A) PHRASE STRUCTURE PATTERNS from block_verbal_analysis
    const { data: verbalData } = await supabase
      .from("block_verbal_analysis")
      .select("video_id, block_id, tone, linguistic_density, semantic_pressure_score, phrase_pattern, emotional_intensity, full_text");

    // Get block types
    const blockTypeMap: Record<string, string> = {};
    for (const b of blocks) {
      blockTypeMap[b.video_id + "_" + b.bloco_id] = b.tipo_bloco;
    }

    // Get block_id -> block info mapping
    const { data: blockIdInfo } = await supabase
      .from("video_blocks")
      .select("id, video_id, tipo_bloco");
    const blockIdTypeMap: Record<string, string> = {};
    if (blockIdInfo) {
      for (const b of blockIdInfo) {
        blockIdTypeMap[b.id] = b.tipo_bloco;
      }
    }

    // A) Phrase pattern structures
    if (verbalData) {
      const phrasePatternCounter: Record<string, { videos: Set<string>; densities: number[]; pressures: number[]; intensities: number[]; tones: string[]; samples: string[]; positions: Set<string> }> = {};
      for (const v of verbalData) {
        if (!v.phrase_pattern || v.phrase_pattern === "generic") continue;
        const key = v.phrase_pattern;
        if (!phrasePatternCounter[key]) {
          phrasePatternCounter[key] = { videos: new Set(), densities: [], pressures: [], intensities: [], tones: [], samples: [], positions: new Set() };
        }
        phrasePatternCounter[key].videos.add(v.video_id);
        if (v.linguistic_density) phrasePatternCounter[key].densities.push(Number(v.linguistic_density));
        if (v.semantic_pressure_score) phrasePatternCounter[key].pressures.push(Number(v.semantic_pressure_score));
        if (v.emotional_intensity) phrasePatternCounter[key].intensities.push(Number(v.emotional_intensity));
        if (v.tone) phrasePatternCounter[key].tones.push(v.tone);
        if (v.full_text && phrasePatternCounter[key].samples.length < 3) phrasePatternCounter[key].samples.push(v.full_text.substring(0, 80));
        const blockType = blockIdTypeMap[v.block_id];
        if (blockType) phrasePatternCounter[key].positions.add(blockType);
      }

      for (const [pattern, v] of Object.entries(phrasePatternCounter)) {
        if (v.videos.size < 2) continue;
        const avgPressure = v.pressures.length > 0 ? v.pressures.reduce((a, b) => a + b, 0) / v.pressures.length : 0;
        if (v.videos.size < 3 && avgPressure < 0.3) continue;
        const positions = Array.from(v.positions);
        allVerbalPatterns.push({
          phrase_structure: `phrasal:${pattern}`,
          dominant_tone: mostFrequent(v.tones) || "neutro",
          linguistic_density_avg: v.densities.length > 0 ? v.densities.reduce((a, b) => a + b, 0) / v.densities.length : 0,
          semantic_pressure_avg: avgPressure,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "phrase_structure",
          verbal_position: positions.join(","),
          recurrence_type: "structural",
          sample_phrases: v.samples,
          dominant_emotion: null,
          hook_related: positions.includes("hook"),
          payoff_related: positions.includes("payoff"),
          cta_related: positions.includes("cta"),
        });
      }

      // F) TONE + PRESSURE + DENSITY PATTERNS
      const toneCounter: Record<string, { videos: Set<string>; densities: number[]; pressures: number[]; intensities: number[]; samples: string[] }> = {};
      for (const v of verbalData) {
        if (!v.tone) continue;
        const key = v.tone;
        if (!toneCounter[key]) {
          toneCounter[key] = { videos: new Set(), densities: [], pressures: [], intensities: [], samples: [] };
        }
        toneCounter[key].videos.add(v.video_id);
        if (v.linguistic_density) toneCounter[key].densities.push(Number(v.linguistic_density));
        if (v.semantic_pressure_score) toneCounter[key].pressures.push(Number(v.semantic_pressure_score));
        if (v.emotional_intensity) toneCounter[key].intensities.push(Number(v.emotional_intensity));
        if (v.full_text && toneCounter[key].samples.length < 3) toneCounter[key].samples.push(v.full_text.substring(0, 80));
      }

      for (const [tone, v] of Object.entries(toneCounter)) {
        if (v.videos.size < 3) continue;
        allVerbalPatterns.push({
          phrase_structure: `tone:${tone}`,
          dominant_tone: tone,
          linguistic_density_avg: v.densities.length > 0 ? v.densities.reduce((a, b) => a + b, 0) / v.densities.length : 0,
          semantic_pressure_avg: v.pressures.length > 0 ? v.pressures.reduce((a, b) => a + b, 0) / v.pressures.length : 0,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "tone_pattern",
          verbal_position: null,
          recurrence_type: "semantic",
          sample_phrases: v.samples,
          dominant_emotion: tone,
          hook_related: false,
          payoff_related: false,
          cta_related: false,
        });
      }
    }

    // B) FUNCTIONAL WORD COMBINATIONS (2-gram, 3-gram, 4-gram with narrative function)
    const { data: wordPatterns } = await supabase
      .from("block_word_patterns")
      .select("video_id, block_id, word, block_type, is_emotional, is_impact, weighted_score")
      .order("video_id")
      .order("block_id");

    // Extended stopwords — filter noise combinations
    const noiseGrams = new Set([
      "you know", "know like", "oh my god", "excuse me", "i mean", "like you",
      "you know what", "i don't know", "oh my", "um like", "like i", "and then",
      "it was", "it is", "that was", "there was", "i was", "he was", "she was",
      "we were", "they were", "is the", "in the", "on the", "to the", "of the",
      "a the", "the the", "and the", "for the", "at the", "with the",
    ]);

    // Narrative-relevant block types
    const narrativeBlockTypes = new Set(["hook", "payoff", "cta", "revelacao", "tensao", "virada", "setup", "desenvolvimento"]);

    if (wordPatterns) {
      // Group words by block preserving order
      const wordsByBlock: Record<string, { video_id: string; block_type: string; words: string[] }> = {};
      for (const w of wordPatterns) {
        const key = `${w.video_id}_${w.block_id}`;
        if (!wordsByBlock[key]) wordsByBlock[key] = { video_id: w.video_id, block_type: w.block_type, words: [] };
        const word = w.word.toLowerCase().trim();
        if (word.length >= 2 && !stopwords.has(word)) {
          wordsByBlock[key].words.push(word);
        }
      }

      // Generate 2-gram, 3-gram, 4-gram
      const ngramCounter: Record<string, { videos: Set<string>; positions: Set<string>; count: number }> = {};

      for (const [_, blockData] of Object.entries(wordsByBlock)) {
        const words = blockData.words;
        for (let n = 2; n <= 4; n++) {
          for (let i = 0; i <= words.length - n; i++) {
            const gram = words.slice(i, i + n).join(" ");
            if (gram.length < 4 || noiseGrams.has(gram)) continue;
            if (!ngramCounter[gram]) ngramCounter[gram] = { videos: new Set(), positions: new Set(), count: 0 };
            ngramCounter[gram].videos.add(blockData.video_id);
            ngramCounter[gram].positions.add(blockData.block_type);
            ngramCounter[gram].count++;
          }
        }
      }

      // Filter: must appear in narrative-relevant positions OR in 3+ videos
      for (const [gram, v] of Object.entries(ngramCounter)) {
        const positions = Array.from(v.positions);
        const inNarrativePosition = positions.some(p => narrativeBlockTypes.has(p));
        
        // Priority filter: in narrative position with 2+ videos, OR 3+ videos anywhere
        if (inNarrativePosition && v.videos.size >= 2) {
          // OK — functional combination
        } else if (v.videos.size >= 3) {
          // OK — frequent enough
        } else {
          continue; // skip noise
        }

        // Determine dominant function from positions
        let domFunc = "BUILD";
        if (positions.includes("cta")) domFunc = "CTA";
        else if (positions.includes("hook")) domFunc = "HOOK";
        else if (positions.includes("payoff") || positions.includes("revelacao")) domFunc = "PAYOFF";
        else if (positions.includes("tensao") || positions.includes("virada")) domFunc = "TWIST";
        else if (positions.includes("setup") || positions.includes("contexto")) domFunc = "SETUP";

        // Emotional intent from combination content
        let emotionalIntent = "neutro";
        const gramLower = gram.toLowerCase();
        if (gramLower.includes("segred") || gramLower.includes("descub") || gramLower.includes("sabia")) emotionalIntent = "curiosidade";
        else if (gramLower.includes("incr") || gramLower.includes("impress") || gramLower.includes("mudou")) emotionalIntent = "surpresa";
        else if (gramLower.includes("inscrev") || gramLower.includes("coment") || gramLower.includes("compart")) emotionalIntent = "ação";
        else if (gramLower.includes("perceb") || gramLower.includes("acontec") || gramLower.includes("olha")) emotionalIntent = "alerta";
        else if (gramLower.includes("corag") || gramLower.includes("desafi") || gramLower.includes("conseg")) emotionalIntent = "tensão";

        const freqScore = Math.min(v.videos.size / 10, 1);
        const funcBonus = inNarrativePosition ? 0.15 : 0;
        const score = Math.round(Math.min(freqScore * 0.7 + funcBonus + 0.1, 1) * 100) / 100;

        allVerbalPatterns.push({
          phrase_structure: `combo:${gram}`,
          dominant_tone: null,
          linguistic_density_avg: 0,
          semantic_pressure_avg: score,
          videos_count: v.videos.size,
          pattern_score: score,
          pattern_category: "word_combination",
          verbal_position: positions.join(","),
          recurrence_type: "functional",
          sample_phrases: [gram],
          dominant_emotion: emotionalIntent !== "neutro" ? emotionalIntent : null,
          hook_related: domFunc === "HOOK",
          payoff_related: domFunc === "PAYOFF",
          cta_related: domFunc === "CTA",
        });
      }
    }

    // C) HOOK VERBAL PATTERNS
    // D) PAYOFF VERBAL PATTERNS
    // E) CTA VERBAL PATTERNS
    const { data: semanticPatternsData } = await supabase
      .from("semantic_patterns")
      .select("video_id, hook_phrase_type, hook_emotional_type, hook_text, hook_word_count, payoff_pattern, payoff_emotional_type, payoff_text, cta_type, cta_tone, dominant_verbal_tone");

    if (semanticPatternsData) {
      // C) Hook patterns
      const hookTypeCounter: Record<string, { videos: Set<string>; emotions: string[]; samples: string[] }> = {};
      for (const s of semanticPatternsData) {
        if (s.hook_phrase_type) {
          const key = s.hook_phrase_type;
          if (!hookTypeCounter[key]) hookTypeCounter[key] = { videos: new Set(), emotions: [], samples: [] };
          hookTypeCounter[key].videos.add(s.video_id);
          if (s.hook_emotional_type) hookTypeCounter[key].emotions.push(s.hook_emotional_type);
          if (s.hook_text && hookTypeCounter[key].samples.length < 3) hookTypeCounter[key].samples.push(s.hook_text.substring(0, 80));
        }
      }

      for (const [hookType, v] of Object.entries(hookTypeCounter)) {
        if (v.videos.size < 2) continue;
        allVerbalPatterns.push({
          phrase_structure: `hook:${hookType}`,
          dominant_tone: mostFrequent(v.emotions) || null,
          linguistic_density_avg: 0,
          semantic_pressure_avg: 0,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "hook_verbal",
          verbal_position: "hook",
          recurrence_type: "structural",
          sample_phrases: v.samples,
          dominant_emotion: mostFrequent(v.emotions) || null,
          hook_related: true,
          payoff_related: false,
          cta_related: false,
        });
      }

      // D) Payoff patterns
      const payoffCounter: Record<string, { videos: Set<string>; emotions: string[]; samples: string[] }> = {};
      for (const s of semanticPatternsData) {
        if (s.payoff_pattern) {
          const key = s.payoff_pattern;
          if (!payoffCounter[key]) payoffCounter[key] = { videos: new Set(), emotions: [], samples: [] };
          payoffCounter[key].videos.add(s.video_id);
          if (s.payoff_emotional_type) payoffCounter[key].emotions.push(s.payoff_emotional_type);
          if (s.payoff_text && payoffCounter[key].samples.length < 3) payoffCounter[key].samples.push(s.payoff_text.substring(0, 80));
        }
      }

      for (const [payoffType, v] of Object.entries(payoffCounter)) {
        if (v.videos.size < 2) continue;
        allVerbalPatterns.push({
          phrase_structure: `payoff:${payoffType}`,
          dominant_tone: mostFrequent(v.emotions) || null,
          linguistic_density_avg: 0,
          semantic_pressure_avg: 0,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "payoff_verbal",
          verbal_position: "payoff",
          recurrence_type: "structural",
          sample_phrases: v.samples,
          dominant_emotion: mostFrequent(v.emotions) || null,
          hook_related: false,
          payoff_related: true,
          cta_related: false,
        });
      }

      // E) CTA patterns
      const ctaCounter: Record<string, { videos: Set<string>; tones: string[]; samples: string[] }> = {};
      for (const s of semanticPatternsData) {
        if (s.cta_type) {
          const key = s.cta_type;
          if (!ctaCounter[key]) ctaCounter[key] = { videos: new Set(), tones: [], samples: [] };
          ctaCounter[key].videos.add(s.video_id);
          if (s.cta_tone) ctaCounter[key].tones.push(s.cta_tone);
        }
      }

      for (const [ctaType, v] of Object.entries(ctaCounter)) {
        if (v.videos.size < 2) continue;
        allVerbalPatterns.push({
          phrase_structure: `cta:${ctaType}`,
          dominant_tone: mostFrequent(v.tones) || null,
          linguistic_density_avg: 0,
          semantic_pressure_avg: 0,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "cta_verbal",
          verbal_position: "cta",
          recurrence_type: "structural",
          sample_phrases: [],
          dominant_emotion: null,
          hook_related: false,
          payoff_related: false,
          cta_related: true,
        });
      }

      // Also: hook emotional type patterns
      const hookEmotionCounter: Record<string, { videos: Set<string>; samples: string[] }> = {};
      for (const s of semanticPatternsData) {
        if (s.hook_emotional_type) {
          const key = s.hook_emotional_type;
          if (!hookEmotionCounter[key]) hookEmotionCounter[key] = { videos: new Set(), samples: [] };
          hookEmotionCounter[key].videos.add(s.video_id);
          if (s.hook_text && hookEmotionCounter[key].samples.length < 3) hookEmotionCounter[key].samples.push(s.hook_text.substring(0, 80));
        }
      }

      for (const [emotion, v] of Object.entries(hookEmotionCounter)) {
        if (v.videos.size < 3) continue;
        allVerbalPatterns.push({
          phrase_structure: `hook_emotion:${emotion}`,
          dominant_tone: emotion,
          linguistic_density_avg: 0,
          semantic_pressure_avg: 0,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "hook_verbal",
          verbal_position: "hook",
          recurrence_type: "semantic",
          sample_phrases: v.samples,
          dominant_emotion: emotion,
          hook_related: true,
          payoff_related: false,
          cta_related: false,
        });
      }
    }

    // Also use cta_deep_analysis
    const { data: ctaDeep } = await supabase
      .from("cta_deep_analysis")
      .select("video_id, cta_type, cta_tone, cta_text, cta_position, implicit_cta_detected");

    if (ctaDeep) {
      // CTA tone patterns
      const ctaToneCounter: Record<string, { videos: Set<string>; types: string[]; samples: string[] }> = {};
      for (const c of ctaDeep) {
        if (c.cta_tone) {
          const key = c.cta_tone;
          if (!ctaToneCounter[key]) ctaToneCounter[key] = { videos: new Set(), types: [], samples: [] };
          ctaToneCounter[key].videos.add(c.video_id);
          if (c.cta_type) ctaToneCounter[key].types.push(c.cta_type);
          if (c.cta_text && ctaToneCounter[key].samples.length < 3) ctaToneCounter[key].samples.push(c.cta_text.substring(0, 80));
        }
      }

      for (const [tone, v] of Object.entries(ctaToneCounter)) {
        if (v.videos.size < 2) continue;
        allVerbalPatterns.push({
          phrase_structure: `cta_tone:${tone}`,
          dominant_tone: tone,
          linguistic_density_avg: 0,
          semantic_pressure_avg: 0,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "cta_verbal",
          verbal_position: "cta",
          recurrence_type: "semantic",
          sample_phrases: v.samples,
          dominant_emotion: null,
          hook_related: false,
          payoff_related: false,
          cta_related: true,
        });
      }

      // Implicit CTA patterns
      const implicitCount = ctaDeep.filter(c => c.implicit_cta_detected).length;
      const implicitVideos = new Set(ctaDeep.filter(c => c.implicit_cta_detected).map(c => c.video_id));
      if (implicitVideos.size >= 2) {
        allVerbalPatterns.push({
          phrase_structure: "cta_implicit:detected",
          dominant_tone: null,
          linguistic_density_avg: 0,
          semantic_pressure_avg: 0,
          videos_count: implicitVideos.size,
          pattern_score: 0,
          pattern_category: "cta_verbal",
          verbal_position: "cta",
          recurrence_type: "structural",
          sample_phrases: ctaDeep.filter(c => c.implicit_cta_detected && c.cta_text).slice(0, 3).map(c => c.cta_text!.substring(0, 80)),
          dominant_emotion: null,
          hook_related: false,
          payoff_related: false,
          cta_related: true,
        });
      }
    }

    // Also: block_phrase_patterns for phrase category patterns
    const { data: phrasePatterns } = await supabase
      .from("block_phrase_patterns")
      .select("video_id, block_id, block_type, phrase, phrase_type, phrase_category, is_emotional, is_strong, phrase_strength_score");

    if (phrasePatterns) {
      // Group by phrase_category
      const phraseCatCounter: Record<string, { videos: Set<string>; positions: Set<string>; scores: number[]; samples: string[] }> = {};
      for (const p of phrasePatterns) {
        if (p.phrase_category) {
          const key = p.phrase_category;
          if (!phraseCatCounter[key]) phraseCatCounter[key] = { videos: new Set(), positions: new Set(), scores: [], samples: [] };
          phraseCatCounter[key].videos.add(p.video_id);
          phraseCatCounter[key].positions.add(p.block_type);
          if (p.phrase_strength_score) phraseCatCounter[key].scores.push(Number(p.phrase_strength_score));
          if (p.phrase && phraseCatCounter[key].samples.length < 3) phraseCatCounter[key].samples.push(p.phrase.substring(0, 80));
        }
      }

      for (const [cat, v] of Object.entries(phraseCatCounter)) {
        if (v.videos.size < 2) continue;
        const avgScore = v.scores.length > 0 ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : 0;
        if (v.videos.size < 3 && avgScore < 0.3) continue;
        const positions = Array.from(v.positions);
        allVerbalPatterns.push({
          phrase_structure: `phrase_cat:${cat}`,
          dominant_tone: null,
          linguistic_density_avg: 0,
          semantic_pressure_avg: avgScore,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "phrase_structure",
          verbal_position: positions.join(","),
          recurrence_type: "structural",
          sample_phrases: v.samples,
          dominant_emotion: null,
          hook_related: positions.includes("hook"),
          payoff_related: positions.includes("payoff"),
          cta_related: positions.includes("cta"),
        });
      }

      // Strong phrases cross-video
      const strongPhrases = phrasePatterns.filter(p => p.is_strong);
      const strongCounter: Record<string, { videos: Set<string>; positions: Set<string> }> = {};
      for (const p of strongPhrases) {
        const normalized = p.phrase.toLowerCase().trim();
        if (normalized.length < 3) continue;
        if (!strongCounter[normalized]) strongCounter[normalized] = { videos: new Set(), positions: new Set() };
        strongCounter[normalized].videos.add(p.video_id);
        strongCounter[normalized].positions.add(p.block_type);
      }

      for (const [phrase, v] of Object.entries(strongCounter)) {
        if (v.videos.size < 2) continue;
        const positions = Array.from(v.positions);
        allVerbalPatterns.push({
          phrase_structure: `strong:${phrase}`,
          dominant_tone: null,
          linguistic_density_avg: 0,
          semantic_pressure_avg: 0.7,
          videos_count: v.videos.size,
          pattern_score: 0,
          pattern_category: "word_combination",
          verbal_position: positions.join(","),
          recurrence_type: "literal",
          sample_phrases: [phrase],
          dominant_emotion: null,
          hook_related: positions.includes("hook"),
          payoff_related: positions.includes("payoff"),
          cta_related: positions.includes("cta"),
        });
      }
    }

    // Deduplicate by phrase_structure
    const seen = new Set<string>();
    const uniqueVerbals = allVerbalPatterns.filter(p => {
      if (seen.has(p.phrase_structure)) return false;
      seen.add(p.phrase_structure);
      return true;
    });

    // ─── Classify verbal_function with EXCLUSIVE PRIORITY ───
    // Priority: 1) CTA  2) HOOK  3) PAYOFF  4) TWIST  5) SETUP  6) BUILD (default)
    const classifyVerbalFunction = (p: typeof uniqueVerbals[0]): string => {
      const pos = (p.verbal_position || "").toLowerCase();
      const struct = p.phrase_structure.toLowerCase();
      const tone = (p.dominant_tone || "").toLowerCase();
      const cat = (p.pattern_category || "").toLowerCase();

      // 1️⃣ CTA — highest priority
      if (p.cta_related || cat === "cta_verbal" || pos.includes("cta") || struct.includes("cta") || tone.includes("urgente") || tone.includes("comando")) return "CTA";

      // 2️⃣ HOOK
      if (p.hook_related || cat === "hook_verbal" || pos.includes("hook") || struct.includes("hook") || tone.includes("curiosidade") || tone.includes("surpresa") || tone.includes("alerta")) return "HOOK";

      // 3️⃣ PAYOFF
      if (p.payoff_related || cat === "payoff_verbal" || pos.includes("payoff") || struct.includes("payoff") || tone.includes("satisfacao") || tone.includes("alivio") || tone.includes("resolucao")) return "PAYOFF";

      // 4️⃣ TWIST
      if (pos.includes("twist") || pos.includes("revelacao") || pos.includes("virada") || struct.includes("twist") || struct.includes("revelacao")) return "TWIST";

      // 5️⃣ SETUP
      if (pos.includes("setup") || pos.includes("contexto") || struct.includes("setup") || struct.includes("contexto")) return "SETUP";

      // 6️⃣ BUILD (default)
      return "BUILD";
    };

    const classifyEmotionalIntent = (p: typeof uniqueVerbals[0]): string => {
      const emotion = (p.dominant_emotion || "").toLowerCase();
      const tone = (p.dominant_tone || "").toLowerCase();
      const struct = p.phrase_structure.toLowerCase();
      // Map known emotions
      if (emotion.includes("curiosidade") || struct.includes("curiosidade") || struct.includes("pergunta")) return "curiosidade";
      if (emotion.includes("surpresa") || struct.includes("surpresa") || struct.includes("chocante")) return "surpresa";
      if (emotion.includes("tensao") || tone.includes("tensao") || tone.includes("suspense")) return "tensão";
      if (emotion.includes("medo") || emotion.includes("alerta") || tone.includes("alerta")) return "alerta";
      if (emotion.includes("urgencia") || tone.includes("urgente")) return "urgência";
      if (emotion.includes("empatia") || emotion.includes("conexao")) return "empatia";
      if (emotion.includes("humor") || emotion.includes("divertido")) return "humor";
      if (emotion.includes("satisfacao") || emotion.includes("alivio")) return "resolução";
      if (emotion.includes("confianca") || tone.includes("autoridade")) return "autoridade";
      if (emotion.includes("provocacao") || struct.includes("provocat")) return "provocação";
      if (tone.includes("sugestivo")) return "sugestão";
      if (tone.includes("narrativo")) return "narrativa";
      if (emotion) return emotion;
      if (tone) return tone;
      return "neutro";
    };

    // Apply exclusive classification and remove boolean flags
    for (const v of uniqueVerbals) {
      const func = classifyVerbalFunction(v);
      (v as any).verbal_function = func;
      (v as any).emotional_intent = classifyEmotionalIntent(v);
      // Set booleans from exclusive function (backward compat)
      v.hook_related = func === "HOOK";
      v.payoff_related = func === "PAYOFF";
      v.cta_related = func === "CTA";
    }

    // Validate: no pattern should have multiple functions (enforced by design)
    // Each pattern has exactly ONE verbal_function

    // Normalize verbal scores
    const maxVbVideos = Math.max(...uniqueVerbals.map(v => v.videos_count), 1);
    const funcBonus: Record<string, number> = { CTA: 0.15, HOOK: 0.12, PAYOFF: 0.08, TWIST: 0.06, SETUP: 0.04, BUILD: 0.02 };
    for (const v of uniqueVerbals) {
      const freqScore = v.videos_count / maxVbVideos;
      const pressureBonus = Math.min(Number(v.semantic_pressure_avg || 0), 1) * 0.2;
      const fb = funcBonus[(v as any).verbal_function] || 0.02;
      v.pattern_score = Math.round(Math.min(freqScore * 0.6 + pressureBonus + fb + 0.1, 1) * 100) / 100;
    }

    // Sort by score desc
    uniqueVerbals.sort((a, b) => b.pattern_score - a.pattern_score);

    await supabase.from("viral_verbal_patterns").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (uniqueVerbals.length > 0) {
      // Insert in batches of 50
      for (let i = 0; i < uniqueVerbals.length; i += 50) {
        await supabase.from("viral_verbal_patterns").insert(uniqueVerbals.slice(i, i + 50));
      }
    }

    const validVerbals = uniqueVerbals;

    // ─── STEP 5: Visual Patterns ───
    const { data: visualData } = await supabase
      .from("visual_block_analysis")
      .select("video_id, block_id, main_action, visual_emotion, visual_intensity_level");

    const visualCounter: Record<string, { videos: Set<string>; transitions: string[]; alignments: string[] }> = {};
    if (visualData) {
      for (const v of visualData) {
        const sig = `${v.main_action || "unknown"}_${v.visual_emotion || "neutro"}`;
        if (!visualCounter[sig]) {
          visualCounter[sig] = { videos: new Set(), transitions: [], alignments: [] };
        }
        visualCounter[sig].videos.add(v.video_id);
        if (v.visual_intensity_level) visualCounter[sig].transitions.push(v.visual_intensity_level);
      }
    }

    // Get alignment data
    const { data: alignData } = await supabase
      .from("text_visual_alignment")
      .select("video_id, block_id, text_action, visual_action");

    const alignByVideo: Record<string, string[]> = {};
    if (alignData) {
      for (const a of alignData) {
        const key = `${a.text_action || "x"}_${a.visual_action || "x"}`;
        if (!alignByVideo[key]) alignByVideo[key] = [];
        // Enrich visual patterns
        for (const [sig, v] of Object.entries(visualCounter)) {
          if (v.videos.has(a.video_id)) {
            v.alignments.push(key);
          }
        }
      }
    }

    const validVisuals = Object.entries(visualCounter)
      .filter(([_, v]) => v.videos.size >= 3)
      .map(([sig, v]) => ({
        visual_signature: sig,
        frame_transition_pattern: v.transitions.length > 0 ? mostFrequent(v.transitions) : null,
        alignment_type: v.alignments.length > 0 ? mostFrequent(v.alignments) : null,
        videos_count: v.videos.size,
        pattern_score: 0,
      }));

    const maxVisVideos = Math.max(...validVisuals.map(v => v.videos_count), 1);
    for (const v of validVisuals) {
      v.pattern_score = Math.round((v.videos_count / maxVisVideos) * 100) / 100;
    }

    await supabase.from("viral_visual_patterns").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (validVisuals.length > 0) {
      await supabase.from("viral_visual_patterns").insert(validVisuals);
    }

    const result = {
      sequence_patterns: validSequences.length,
      timing_patterns: validTimings.length,
      emotional_patterns: validEmotions.length,
      verbal_patterns: validVerbals.length,
      visual_patterns: validVisuals.length,
      total_patterns: validSequences.length + validTimings.length + validEmotions.length + validVerbals.length + validVisuals.length,
      status: "completed",
    };

    console.log("Cross-pattern detection completed:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in detect-cross-patterns:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function mostFrequent(arr: string[]): string {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    counts[item] = (counts[item] || 0) + 1;
  }
  let maxCount = 0;
  let maxItem = arr[0];
  for (const [item, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxItem = item;
    }
  }
  return maxItem;
}
