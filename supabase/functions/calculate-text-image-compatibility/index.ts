import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function norm(s: string | null): string {
  if (!s) return "";
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// ========== 3.1 TEXT INTENSITY ==========
function calcTextIntensity(
  verbal: any | null,
  semantic: any | null,
  phrases: any[],
): number {
  let score = 0;
  let weights = 0;

  // verbal emotional_intensity (0-10 scale → 0-100)
  if (verbal?.emotional_intensity != null) {
    score += (verbal.emotional_intensity / 10) * 100 * 0.30;
    weights += 0.30;
  }
  // verbal semantic_pressure_score (0-1 scale → 0-100)
  if (verbal?.semantic_pressure_score != null) {
    score += verbal.semantic_pressure_score * 100 * 0.25;
    weights += 0.25;
  }
  // semantic block_emotional_intensity (0-10 → 0-100)
  if (semantic?.block_emotional_intensity != null) {
    score += (semantic.block_emotional_intensity / 10) * 100 * 0.20;
    weights += 0.20;
  }
  // phrase strength: ratio of strong+emotional phrases
  if (phrases.length > 0) {
    const strongCount = phrases.filter((p: any) => p.is_strong || p.is_emotional).length;
    const ratio = strongCount / phrases.length;
    score += ratio * 100 * 0.15;
    weights += 0.15;
  }
  // linguistic density as modifier
  if (verbal?.linguistic_density != null) {
    const densityFactor = Math.min(verbal.linguistic_density / 30, 1);
    score += densityFactor * 100 * 0.10;
    weights += 0.10;
  }

  if (weights === 0) return 50; // neutral default
  return Math.round(Math.min(100, score / weights));
}

// ========== 3.2 VISUAL INTENSITY ==========
function calcVisualIntensity(visual: any | null): number {
  if (!visual) return 50;
  let score = 0;
  let weights = 0;

  // avg_visual_intensity_score (0-100)
  if (visual.avg_visual_intensity_score != null) {
    score += visual.avg_visual_intensity_score * 0.40;
    weights += 0.40;
  }
  // visual_intensity_level mapping
  const levelMap: Record<string, number> = { low: 25, medium: 50, high: 80 };
  const level = norm(visual.visual_intensity_level);
  if (level && levelMap[level] != null) {
    score += levelMap[level] * 0.25;
    weights += 0.25;
  }
  // scene_change_count: more changes = more intensity
  if (visual.scene_change_count != null) {
    const sceneScore = Math.min(100, visual.scene_change_count * 25);
    score += sceneScore * 0.15;
    weights += 0.15;
  }
  // visual_emotion: high-arousal emotions score higher
  const highArousal = ["surpresa", "impacto", "tensao", "medo"];
  const ve = norm(visual.visual_emotion);
  if (ve) {
    const arousal = highArousal.some(e => ve.includes(e)) ? 80 : 40;
    score += arousal * 0.20;
    weights += 0.20;
  }

  if (weights === 0) return 50;
  return Math.round(Math.min(100, score / weights));
}

// ========== 3.4 EMOTIONAL MATCH ==========
function calcEmotionalMatch(
  textEmotion: string | null,
  visualEmotion: string | null,
  alignment: any | null,
): number {
  // If we have existing alignment data, weight it heavily
  if (alignment?.emotion_alignment_score != null) {
    const alignScore = alignment.emotion_alignment_score;
    // Also do our own check
    const te = norm(textEmotion);
    const ve = norm(visualEmotion);
    if (!te || !ve) return alignScore;
    
    let directScore = 50;
    if (te === ve) directScore = 100;
    else {
      const groups = [
        ["curiosidade", "expectativa"],
        ["tensao", "medo"],
        ["surpresa", "impacto"],
        ["alivio", "neutra"],
      ];
      for (const g of groups) {
        if (g.some(e => te.includes(e)) && g.some(e => ve.includes(e))) {
          directScore = 80;
          break;
        }
      }
      // Opposing
      const pos = ["alivio", "curiosidade", "expectativa"];
      const neg = ["medo", "tensao"];
      if ((pos.some(e => te.includes(e)) && neg.some(e => ve.includes(e))) ||
          (neg.some(e => te.includes(e)) && pos.some(e => ve.includes(e)))) {
        directScore = 20;
      }
    }
    return Math.round(alignScore * 0.6 + directScore * 0.4);
  }

  const te = norm(textEmotion);
  const ve = norm(visualEmotion);
  if (!te && !ve) return 50;
  if (!te || !ve) return 40;
  if (te === ve) return 100;

  const groups = [
    ["curiosidade", "expectativa"],
    ["tensao", "medo"],
    ["surpresa", "impacto"],
    ["alivio", "neutra"],
  ];
  for (const g of groups) {
    if (g.some(e => te.includes(e)) && g.some(e => ve.includes(e))) return 75;
  }
  return 40;
}

// ========== 3.5 ACTION MATCH ==========
function calcActionMatch(
  textAction: string | null,
  visualAction: string | null,
  alignment: any | null,
): number {
  if (alignment?.action_alignment_score != null) {
    return alignment.action_alignment_score;
  }
  const ta = norm(textAction);
  const va = norm(visualAction);
  if (!ta && !va) return 50;
  if (!ta || !va) return 40;
  if (ta === va) return 100;
  if (ta.includes(va) || va.includes(ta)) return 85;

  const groups = [
    ["mostrar", "revelar", "apresentar", "exibir"],
    ["falar", "narrar", "contar", "explicar", "dizer"],
    ["correr", "mover", "andar", "entrar", "sair"],
    ["olhar", "observar", "reagir", "assistir"],
    ["esconder", "ocultar", "cobrir"],
    ["apontar", "indicar", "direcionar"],
  ];
  for (const g of groups) {
    if (g.some(a => ta.includes(a)) && g.some(a => va.includes(a))) return 70;
  }
  return 35;
}

// ========== 3.6 CURIOSITY & REVEAL MATCH ==========
function calcCuriosityMatch(
  blockType: string,
  textIntensity: number,
  visual: any | null,
  words: any[],
  phrases: any[],
): number {
  // Curiosity is most relevant for hook, setup, tensao blocks
  const curiosityBlocks = ["hook", "setup", "tensao"];
  const bt = norm(blockType);
  if (!curiosityBlocks.some(b => bt.includes(b))) return 50; // neutral for other blocks

  let score = 50;
  
  // Check for curiosity-triggering words
  const curiosityWords = ["segredo", "nunca", "impossivel", "chocante", "inacreditavel", "descubra", "voce", "nao", "vai", "acreditar", "verdade", "real"];
  const wordTexts = words.map((w: any) => norm(w.word));
  const hasCuriosityWords = wordTexts.some(w => curiosityWords.some(cw => w.includes(cw)));
  if (hasCuriosityWords) score += 15;

  // Visual should match with scene changes or strong emotion for curiosity
  if (visual?.scene_change_count > 0) score += 10;
  const ve = norm(visual?.visual_emotion);
  if (ve && ["curiosidade", "expectativa", "tensao"].some(e => ve.includes(e))) score += 15;
  
  // High text intensity in curiosity blocks needs visual support
  if (textIntensity > 60 && (visual?.avg_visual_intensity_score || 0) < 40) score -= 15;
  if (textIntensity > 60 && (visual?.avg_visual_intensity_score || 0) >= 60) score += 10;

  return Math.max(0, Math.min(100, score));
}

function calcRevealMatch(
  blockType: string,
  textIntensity: number,
  visual: any | null,
  words: any[],
): number {
  const revealBlocks = ["revelacao", "payoff", "loop"];
  const bt = norm(blockType);
  if (!revealBlocks.some(b => bt.includes(b))) return 50;

  let score = 50;

  // Reveal words
  const revealWords = ["revelacao", "verdade", "real", "final", "resultado", "resposta", "agora", "pronto", "aqui"];
  const wordTexts = words.map((w: any) => norm(w.word));
  const hasRevealWords = wordTexts.some(w => revealWords.some(rw => w.includes(rw)));
  if (hasRevealWords) score += 15;

  // Visual should have scene change or high intensity for reveal
  if (visual?.scene_change_detected) score += 10;
  const ve = norm(visual?.visual_emotion);
  if (ve && ["surpresa", "impacto", "alivio"].some(e => ve.includes(e))) score += 15;

  // High text intensity needs visual payoff
  if (textIntensity > 70 && (visual?.avg_visual_intensity_score || 0) >= 60) score += 10;
  if (textIntensity > 70 && (visual?.avg_visual_intensity_score || 0) < 30) score -= 20;

  return Math.max(0, Math.min(100, score));
}

// ========== CLASSIFICATION ==========
function classify(
  intensityGap: number,
  emotionalMatch: number,
  actionMatch: number,
  compatibilityScore: number,
): { label: string; reason: string; direction: string } {
  // Conflicting: emotion or action strongly mismatched
  if (emotionalMatch < 30 && actionMatch < 35) {
    return {
      label: "conflicting",
      reason: "Emotion and action strongly diverge between text and visual",
      direction: "realign visual emotion and action to match narrative intent",
    };
  }
  if (emotionalMatch < 25) {
    return {
      label: "conflicting",
      reason: "Visual emotion contradicts text emotion",
      direction: "match visual emotion to text narrative tone",
    };
  }

  // Underpowered: text much stronger than visual
  if (intensityGap > 25) {
    let direction = "stronger visual impact needed";
    if (emotionalMatch < 50) direction = "stronger facial reaction or emotional framing";
    else if (actionMatch < 50) direction = "more motion or dynamic framing";
    else direction = "tighter framing with higher visual intensity";
    return {
      label: "underpowered",
      reason: `Text intensity (${intensityGap > 0 ? '+' : ''}${intensityGap} gap) exceeds visual delivery`,
      direction,
    };
  }

  // Overpowered: visual much stronger than text
  if (intensityGap < -25) {
    return {
      label: "overpowered",
      reason: `Visual intensity exceeds text by ${Math.abs(intensityGap)} points`,
      direction: "calmer frame or reduce scene changes to match text tone",
    };
  }

  // Neutral: both low energy, no conflict
  if (compatibilityScore < 45 && emotionalMatch >= 40 && actionMatch >= 40) {
    return {
      label: "neutral",
      reason: "Both text and visual are moderate without strong conflict",
      direction: "keep current direction or add subtle emphasis",
    };
  }

  // Compatible
  let direction = "keep current direction";
  if (compatibilityScore >= 70) direction = "excellent match — maintain approach";
  else if (emotionalMatch > actionMatch + 20) direction = "action could be stronger to match emotional alignment";
  else if (actionMatch > emotionalMatch + 20) direction = "emotional framing could be enhanced";
  
  return {
    label: "compatible",
    reason: "Text and visual are well-aligned in emotion, action, and intensity",
    direction,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const videoId = body.video_id || null;

    // Get target videos
    let videoIds: string[] = [];
    if (videoId) {
      videoIds = [videoId];
    } else {
      const { data: videos } = await supabase
        .from("videos").select("id").eq("status", "completed");
      videoIds = (videos || []).map((v: any) => v.id);
    }

    let totalProcessed = 0;
    let totalBlocks = 0;
    const labelCounts: Record<string, number> = {
      compatible: 0, underpowered: 0, overpowered: 0, neutral: 0, conflicting: 0,
    };
    const errors: string[] = [];

    for (const vid of videoIds) {
      try {
        // Fetch all needed data in parallel
        const [blocksRes, visualsRes, semanticsRes, verbalsRes, wordsRes, phrasesRes, alignmentsRes] = await Promise.all([
          supabase.from("video_blocks")
            .select("id, tipo_bloco, texto, emocao, elemento_visual, descricao_visual")
            .eq("video_id", vid).order("bloco_id"),
          supabase.from("visual_block_analysis")
            .select("block_id, scene_description, main_objects, main_action, visual_emotion, scene_change_count, scene_change_detected, avg_visual_intensity_score, visual_intensity_level, data_source_type, confidence_score")
            .eq("video_id", vid),
          supabase.from("block_semantic_patterns")
            .select("block_id, block_keywords, block_emotional_type, block_emotional_words, block_emotional_intensity, block_verbal_tone")
            .eq("video_id", vid),
          supabase.from("block_verbal_analysis")
            .select("block_id, emotional_intensity, semantic_pressure_score, linguistic_density, tone")
            .eq("video_id", vid),
          supabase.from("block_word_patterns")
            .select("block_id, word, is_emotional, is_impact, is_dominant, weighted_score")
            .eq("video_id", vid),
          supabase.from("block_phrase_patterns")
            .select("block_id, phrase, is_strong, is_emotional, phrase_strength_score")
            .eq("video_id", vid),
          supabase.from("text_visual_alignment")
            .select("block_id, emotion_alignment_score, action_alignment_score, alignment_score, text_emotion, visual_emotion, text_action, visual_action")
            .eq("video_id", vid),
        ]);

        const blocks = blocksRes.data || [];
        if (blocks.length === 0) continue;

        const visualMap = new Map((visualsRes.data || []).map((v: any) => [v.block_id, v]));
        const semanticMap = new Map((semanticsRes.data || []).map((s: any) => [s.block_id, s]));
        const verbalMap = new Map((verbalsRes.data || []).map((v: any) => [v.block_id, v]));
        const alignMap = new Map((alignmentsRes.data || []).map((a: any) => [a.block_id, a]));
        
        // Group words and phrases by block
        const wordsMap = new Map<string, any[]>();
        for (const w of (wordsRes.data || [])) {
          if (!wordsMap.has(w.block_id)) wordsMap.set(w.block_id, []);
          wordsMap.get(w.block_id)!.push(w);
        }
        const phrasesMap = new Map<string, any[]>();
        for (const p of (phrasesRes.data || [])) {
          if (!phrasesMap.has(p.block_id)) phrasesMap.set(p.block_id, []);
          phrasesMap.get(p.block_id)!.push(p);
        }

        // Delete existing
        await supabase.from("text_image_compatibility").delete().eq("video_id", vid);

        const records: any[] = [];

        for (const block of blocks) {
          const visual = visualMap.get(block.id);
          const semantic = semanticMap.get(block.id);
          const verbal = verbalMap.get(block.id);
          const alignment = alignMap.get(block.id);
          const blockWords = wordsMap.get(block.id) || [];
          const blockPhrases = phrasesMap.get(block.id) || [];

          // 3.1 Text intensity
          const textIntensity = calcTextIntensity(verbal, semantic, blockPhrases);

          // 3.2 Visual intensity
          const visualIntensity = calcVisualIntensity(visual);

          // 3.3 Intensity gap
          const intensityGap = textIntensity - visualIntensity;

          // 3.4 Emotional match
          const textEmotion = semantic?.block_emotional_type || block.emocao || verbal?.tone || null;
          const visualEmotion = visual?.visual_emotion || null;
          const emotionalMatch = calcEmotionalMatch(textEmotion, visualEmotion, alignment);

          // 3.5 Action match
          const textAction = alignment?.text_action || block.elemento_visual || null;
          const visualAction = alignment?.visual_action || visual?.main_action || null;
          const actionMatch = calcActionMatch(textAction, visualAction, alignment);

          // 3.6 Curiosity & Reveal
          const curiosityMatch = calcCuriosityMatch(block.tipo_bloco, textIntensity, visual, blockWords, blockPhrases);
          const revealMatch = calcRevealMatch(block.tipo_bloco, textIntensity, visual, blockWords);

          // Compatibility score: weighted average
          const compatibilityScore = Math.round(
            emotionalMatch * 0.30 +
            actionMatch * 0.20 +
            Math.max(0, 100 - Math.abs(intensityGap) * 1.2) * 0.25 +
            curiosityMatch * 0.15 +
            revealMatch * 0.10
          );

          // Classification
          const { label, reason, direction } = classify(intensityGap, emotionalMatch, actionMatch, compatibilityScore);

          // Confidence
          let confidence = 50;
          if (visual) {
            const isAiVisualSource = visual.data_source_type === "ai_extraction"
              || visual.data_source_type === "gemini_video_understanding";
            confidence = isAiVisualSource ? 75 : 45;
            if (verbal && semantic) confidence += 10;
            if (alignment) confidence += 10;
            if (blockWords.length > 0) confidence += 5;
          } else {
            confidence = 20;
          }
          confidence = Math.min(100, confidence);

          labelCounts[label] = (labelCounts[label] || 0) + 1;

          records.push({
            video_id: vid,
            block_id: block.id,
            block_type: block.tipo_bloco,
            text_intensity_score: textIntensity,
            visual_intensity_score_calc: visualIntensity,
            intensity_gap: intensityGap,
            text_requires_visual_boost: intensityGap > 20,
            visual_underpowered: intensityGap > 25,
            visual_overpowered: intensityGap < -25,
            emotional_match_score: emotionalMatch,
            action_match_score: actionMatch,
            curiosity_match_score: curiosityMatch,
            reveal_match_score: revealMatch,
            compatibility_score: compatibilityScore,
            compatibility_label: label,
            compatibility_reason: reason,
            recommended_visual_direction: direction,
            confidence_score: Math.round(confidence),
            semantic_coherence_score: compatibilityScore,
            contradiction_detected: label === "conflicting",
            visual_overload_detected: (visual?.scene_change_count || 0) > 3,
            data_source_type: "calculated",
            origin_level: "calculated",
          });
        }

        if (records.length > 0) {
          const { error: insertErr } = await supabase
            .from("text_image_compatibility").insert(records);
          if (insertErr) {
            errors.push(`${vid}: ${insertErr.message}`);
          } else {
            totalBlocks += records.length;
            totalProcessed++;
          }
        }

        // Log to video_logs
        await supabase.from("video_logs").insert({
          video_id: vid,
          etapa: "text_image_compatibility",
          status: "success",
          mensagem: `${records.length} blocks processed, labels: ${JSON.stringify(
            records.reduce((acc: any, r: any) => { acc[r.compatibility_label] = (acc[r.compatibility_label] || 0) + 1; return acc; }, {})
          )}`,
        });

      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${vid}: ${message}`);
        // Best-effort log: a logging failure must not replace the original error.
        try {
          await supabase.from("video_logs").insert({
            video_id: vid,
            etapa: "text_image_compatibility",
            status: "error",
            mensagem: message,
          });
        } catch {
          // Ignore transport failures while recording the diagnostic log.
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      summary: {
        videos_processed: totalProcessed,
        total_blocks: totalBlocks,
        label_distribution: labelCounts,
        errors_count: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
