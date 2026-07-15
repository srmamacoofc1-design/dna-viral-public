import { supabase } from "@/integrations/supabase/client";

export interface HookEvidence {
  word_count_in_range: boolean | null; // null = range not available from DB
  matched_emotional_words: string[];
  matched_impact_words: string[];
  duplicate_blocked: boolean;
  blacklist_blocked: boolean;
  has_positive_evidence: boolean; // derived from P10 of real hooks
  evidence_total: number; // total evidence count for transparency
  evidence_p10_threshold: number | null; // the actual P10 used
}

export interface HookSuggestion {
  id: number;
  text: string;
  evidence: HookEvidence;
}

export interface HookGenerationResult {
  suggestions: HookSuggestion[];
  low_quality_warning: boolean;
  autoprotect_blocked?: boolean;
  autoprotect_reason?: string;
}

export interface HookProfile {
  narrative_function: string;
  position_role: string;
  expected_intensity: string | null;
  expected_length_words: string | null;
  expected_tension: string | null;
  emotion_vector: string | null;
  pattern_type: string | null;
  expected_first_event_pct: string | null;
  expected_tension_density: string | null;
  micropike_density: string | null;
  // Real word lists from DB
  real_emotional_words: string[];
  real_impact_words: string[];
  real_blacklist_patterns: string[];
  word_count_p10: number | null;
  word_count_p90: number | null;
  // Real few-shot examples from top performers
  real_top_hooks: string[];
  // Real similarity threshold from DB
  similarity_threshold_p90: number | null;
  // Real evidence P10 threshold from DB
  evidence_p10_threshold: number | null;
  // Real strength scores from pattern_performance_weights
  emotional_word_strength: number | null;
  impact_word_strength: number | null;
}

/* ── Fetch real word lists from DB ── */

async function fetchRealWordLists(blockType: string): Promise<{
  emotional_words: string[];
  impact_words: string[];
  blacklist_patterns: string[];
}> {
  const [emotionalRes, impactRes, blacklistRes] = await Promise.all([
    supabase.from("block_word_patterns")
      .select("word")
      .eq("block_type", blockType)
      .eq("is_emotional", true),
    supabase.from("block_word_patterns")
      .select("word")
      .eq("block_type", blockType)
      .eq("is_impact", true),
    supabase.from("verbal_noise_archive")
      .select("combination_text")
      .eq("source_block_type", blockType)
      .limit(100),
  ]);

  return {
    emotional_words: [...new Set((emotionalRes.data || []).map(r => r.word))],
    impact_words: [...new Set((impactRes.data || []).map(r => r.word))],
    blacklist_patterns: [...new Set((blacklistRes.data || []).map(r => r.combination_text))],
  };
}

/* ── Fetch real word count ranges from DB (direct percentile calculation) ── */

async function fetchRealWordCountRange(blockType: string): Promise<{ p10: number | null; p90: number | null }> {
  const { data: blockIds } = await supabase
    .from("video_blocks")
    .select("id")
    .eq("tipo_bloco", blockType as any);
  
  if (!blockIds || blockIds.length === 0) return { p10: null, p90: null };

  const ids = blockIds.map(b => b.id);
  const { data: wcData } = await supabase
    .from("block_verbal_analysis")
    .select("word_count")
    .in("block_id", ids)
    .gt("word_count", 0);

  if (!wcData || wcData.length === 0) return { p10: null, p90: null };

  const sorted = wcData.map(r => r.word_count!).sort((a, b) => a - b);
  return {
    p10: sorted[Math.floor(sorted.length * 0.1)] ?? null,
    p90: sorted[Math.floor(sorted.length * 0.9)] ?? null,
  };
}

/* ── Fetch top performing hooks as few-shot examples ── */

async function fetchTopHooks(): Promise<string[]> {
  const { data } = await supabase
    .from("block_verbal_analysis")
    .select("full_text, block_id")
    .not("full_text", "is", null);

  if (!data || data.length === 0) return [];

  const { data: hookBlocks } = await supabase
    .from("video_blocks")
    .select("id, video_id")
    .eq("tipo_bloco", "hook");

  if (!hookBlocks || hookBlocks.length === 0) return [];

  const hookBlockIds = new Set(hookBlocks.map(b => b.id));
  const hookVideoMap = Object.fromEntries(hookBlocks.map(b => [b.id, b.video_id]));
  
  const hookTexts = data.filter(d => hookBlockIds.has(d.block_id) && d.full_text && d.full_text.length > 3);

  const { data: videos } = await supabase
    .from("videos")
    .select("id, engagement_rate_relative")
    .eq("status", "completed")
    .not("engagement_rate_relative", "is", null)
    .order("engagement_rate_relative", { ascending: false })
    .limit(10);

  if (!videos || videos.length === 0) return [];

  const viralMap = Object.fromEntries(videos.map(v => [v.id, v.engagement_rate_relative]));

  const ranked = hookTexts
    .map(h => ({ text: h.full_text!, score: viralMap[hookVideoMap[h.block_id]] ?? 0 }))
    .filter(h => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return ranked.map(r => r.text);
}

/* ── Calculate real similarity threshold from DB ── */

async function fetchSimilarityThreshold(): Promise<number | null> {
  const { data } = await supabase
    .from("block_verbal_analysis")
    .select("full_text, block_id")
    .not("full_text", "is", null);

  if (!data || data.length === 0) return null;

  const { data: hookBlocks } = await supabase
    .from("video_blocks")
    .select("id")
    .eq("tipo_bloco", "hook");

  if (!hookBlocks || hookBlocks.length === 0) return null;

  const hookIds = new Set(hookBlocks.map(b => b.id));
  const hookTexts = data.filter(d => hookIds.has(d.block_id) && d.full_text && d.full_text.length > 3).map(d => d.full_text!);

  if (hookTexts.length < 2) return null;

  const overlaps: number[] = [];
  for (let i = 0; i < hookTexts.length; i++) {
    for (let j = i + 1; j < hookTexts.length; j++) {
      const wordsA = new Set(hookTexts[i].toLowerCase().split(/\s+/));
      const wordsB = new Set(hookTexts[j].toLowerCase().split(/\s+/));
      let shared = 0;
      wordsA.forEach(w => { if (wordsB.has(w)) shared++; });
      overlaps.push(shared / Math.max(wordsA.size, 1));
    }
  }

  overlaps.sort((a, b) => a - b);
  return overlaps[Math.floor(overlaps.length * 0.9)] ?? null;
}

/* ── Fetch P10 of evidence_total from real hooks in the base ── */

async function fetchEvidenceP10(): Promise<number | null> {
  const { data: hookBlocks } = await supabase
    .from("video_blocks")
    .select("id")
    .eq("tipo_bloco", "hook");

  if (!hookBlocks || hookBlocks.length < 5) return null; // insufficient sample

  const ids = hookBlocks.map(b => b.id);

  const [emotionalRes, impactRes] = await Promise.all([
    supabase.from("block_word_patterns")
      .select("block_id")
      .in("block_id", ids)
      .eq("is_emotional", true),
    supabase.from("block_word_patterns")
      .select("block_id")
      .in("block_id", ids)
      .eq("is_impact", true),
  ]);

  // Count per block
  const counts: Record<string, number> = {};
  ids.forEach(id => { counts[id] = 0; });
  (emotionalRes.data || []).forEach(r => { counts[r.block_id] = (counts[r.block_id] || 0) + 1; });
  (impactRes.data || []).forEach(r => { counts[r.block_id] = (counts[r.block_id] || 0) + 1; });

  const sorted = Object.values(counts).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  return sorted[Math.floor(sorted.length * 0.1)] ?? null;
}

/* ── Fetch strength scores from pattern_performance_weights ── */

async function fetchStrengthScores(): Promise<{
  emotional_word: number | null;
  impact_word: number | null;
}> {
  const { data } = await supabase
    .from("pattern_performance_weights")
    .select("pattern_type, strength_score")
    .in("pattern_type", ["emotional_word", "impact_word"])
    .not("strength_score", "is", null);

  if (!data || data.length === 0) return { emotional_word: null, impact_word: null };

  const byType: Record<string, number[]> = {};
  data.forEach(r => {
    if (!byType[r.pattern_type]) byType[r.pattern_type] = [];
    byType[r.pattern_type].push(Number(r.strength_score));
  });

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    emotional_word: avg(byType["emotional_word"] || []),
    impact_word: avg(byType["impact_word"] || []),
  };
}

/* ── Evidence-based validation — P10-derived threshold ── */

export function evaluateHookEvidence(
  text: string,
  previousSuggestions: HookSuggestion[] = [],
  realEmotionalWords: string[] = [],
  realImpactWords: string[] = [],
  realBlacklistPatterns: string[] = [],
  wordCountP10: number | null = null,
  wordCountP90: number | null = null,
  similarityThreshold: number | null = null,
  evidenceP10Threshold: number | null = null
): HookEvidence {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Blacklist check — only from real DB patterns
  const blacklist_blocked = realBlacklistPatterns.length > 0 &&
    realBlacklistPatterns.some((p) => lower.includes(p.toLowerCase()));

  // Word count — from real percentiles ONLY
  const word_count_in_range = (wordCountP10 !== null && wordCountP90 !== null)
    ? (words.length >= wordCountP10 && words.length <= wordCountP90)
    : null;

  // Duplicate check — threshold from DB, NO fallback
  let duplicate_blocked = false;
  if (previousSuggestions.length > 0 && similarityThreshold !== null) {
    const lowerWords = new Set(words);
    const maxOverlap = previousSuggestions.reduce((mx, prev) => {
      const prevWords = new Set(prev.text.toLowerCase().split(/\s+/));
      let shared = 0;
      lowerWords.forEach((w) => { if (prevWords.has(w)) shared++; });
      return Math.max(mx, shared / Math.max(lowerWords.size, 1));
    }, 0);
    duplicate_blocked = maxOverlap >= similarityThreshold;
  }
  // If similarityThreshold is null, dedup is skipped (no fallback)

  // Matched emotional words from DB
  const matched_emotional_words = realEmotionalWords.filter((w) =>
    lower.includes(w.toLowerCase())
  );

  // Matched impact words from DB
  const matched_impact_words = realImpactWords.filter((w) =>
    lower.includes(w.toLowerCase())
  );

  // Evidence total
  const evidence_total =
    matched_emotional_words.length +
    matched_impact_words.length +
    (word_count_in_range === true ? 1 : 0);

  // has_positive_evidence: strictly derived from P10 of real hooks
  // If P10 threshold is null → insufficient_data, NO fallback
  const has_positive_evidence = evidenceP10Threshold !== null
    ? evidence_total >= evidenceP10Threshold
    : false;

  return {
    word_count_in_range,
    matched_emotional_words,
    matched_impact_words,
    duplicate_blocked,
    blacklist_blocked,
    has_positive_evidence,
    evidence_total,
    evidence_p10_threshold: evidenceP10Threshold,
  };
}

/* ── Build hook profile from DNA — NO fallbacks ── */

export async function buildHookProfile(
  block: { narrative_function: string; position_role: string }
): Promise<HookProfile> {
  const [dnaRes, dnaFormalRes, wordLists, wordCountRange, topHooks, simThreshold, evidenceP10, strengthScores] = await Promise.all([
    supabase.from("dna_objects").select("dominant_emotion, secondary_emotion, dominant_sequence")
      .order("created_at", { ascending: false }).limit(1).single(),
    supabase.from("dna_base_v2_formal").select("emotional, verbal, temporal")
      .order("generated_at", { ascending: false }).limit(1).single(),
    fetchRealWordLists("hook"),
    fetchRealWordCountRange("hook"),
    fetchTopHooks(),
    fetchSimilarityThreshold(),
    fetchEvidenceP10(),
    fetchStrengthScores(),
  ]);

  const dna = dnaRes.data;
  const formal = dnaFormalRes.data;

  const emotionalData = formal?.emotional as any;
  const verbalData = formal?.verbal as any;
  const temporalData = formal?.temporal as any;

  // NO FALLBACKS — null if not in DB
  const emotionVector = emotionalData?.dominant_emotion
    || dna?.dominant_emotion
    || null;

  const patternType = verbalData?.dominant_verbal_pattern || null;

  const firstEventPct = temporalData?.avg_first_event_pct
    ? String(Math.round(temporalData.avg_first_event_pct))
    : null;

  const tensionDensity = emotionalData?.dominant_intensity || null;
  const micropike = verbalData?.micropike_density || null;

  return {
    narrative_function: block.narrative_function,
    position_role: block.position_role,
    expected_intensity: emotionalData?.dominant_intensity || null,
    expected_length_words: (wordCountRange.p10 !== null && wordCountRange.p90 !== null)
      ? `${Math.round(wordCountRange.p10)}-${Math.round(wordCountRange.p90)}`
      : null,
    expected_tension: tensionDensity,
    emotion_vector: emotionVector,
    pattern_type: patternType,
    expected_first_event_pct: firstEventPct,
    expected_tension_density: tensionDensity,
    micropike_density: micropike,
    real_emotional_words: wordLists.emotional_words,
    real_impact_words: wordLists.impact_words,
    real_blacklist_patterns: wordLists.blacklist_patterns,
    word_count_p10: wordCountRange.p10,
    word_count_p90: wordCountRange.p90,
    real_top_hooks: topHooks,
    similarity_threshold_p90: simThreshold,
    evidence_p10_threshold: evidenceP10,
    emotional_word_strength: strengthScores.emotional_word,
    impact_word_strength: strengthScores.impact_word,
  };
}

/* ── AUTOPROTECT: pre-generation validation ── */

async function autoprotectCheck(hookProfile: HookProfile): Promise<{ allowed: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const dataPresent: Record<string, boolean> = {};

  // Check DNA exists
  const { count } = await supabase.from("dna_objects").select("id", { count: "exact", head: true });
  dataPresent["dna_objects"] = (count ?? 0) > 0;
  if (!dataPresent["dna_objects"]) reasons.push("DNA object não encontrado na base");

  // Check hook blocks exist in word patterns
  dataPresent["hook_word_patterns"] = hookProfile.real_emotional_words.length > 0 || hookProfile.real_impact_words.length > 0;
  if (!dataPresent["hook_word_patterns"]) reasons.push("Nenhum word pattern de hook encontrado na base");

  // Check word count range exists
  dataPresent["word_count_range"] = hookProfile.word_count_p10 !== null && hookProfile.word_count_p90 !== null;
  if (!dataPresent["word_count_range"]) reasons.push("Faixa de palavras do hook não calculada (block_verbal_analysis vazio para hooks)");

  // Check emotion_vector exists — MANDATORY
  dataPresent["emotion_vector"] = hookProfile.emotion_vector !== null;
  if (!dataPresent["emotion_vector"]) reasons.push("emotion_vector ausente no DNA — bloqueio obrigatório");

  // Check pattern_type — MANDATORY
  dataPresent["pattern_type"] = hookProfile.pattern_type !== null;
  if (!dataPresent["pattern_type"]) reasons.push("pattern_type ausente no DNA — bloqueio obrigatório");

  // Check expected_tension_density — MANDATORY
  dataPresent["expected_tension_density"] = hookProfile.expected_tension_density !== null;
  if (!dataPresent["expected_tension_density"]) reasons.push("expected_tension_density ausente no DNA — bloqueio obrigatório");

  // Check micropike_density — MANDATORY
  dataPresent["micropike_density"] = hookProfile.micropike_density !== null;
  if (!dataPresent["micropike_density"]) reasons.push("micropike_density ausente no DNA — bloqueio obrigatório");

  // Check few-shot examples exist
  dataPresent["top_hooks"] = hookProfile.real_top_hooks.length > 0;
  if (!dataPresent["top_hooks"]) reasons.push("Nenhum hook de referência encontrado na base (few-shot vazio)");

  // Log the autoprotect check
  try {
    await supabase.from("validation_reports").insert({
      validation_type: "autoprotect_check",
      report_data: {
        module: "hook_generation",
        data_present: dataPresent,
        null_fields: Object.entries({
          emotion_vector: hookProfile.emotion_vector,
          pattern_type: hookProfile.pattern_type,
          expected_tension_density: hookProfile.expected_tension_density,
          expected_length_words: hookProfile.expected_length_words,
          micropike_density: hookProfile.micropike_density,
          similarity_threshold_p90: hookProfile.similarity_threshold_p90,
          evidence_p10_threshold: hookProfile.evidence_p10_threshold,
        }).filter(([, v]) => v === null || v === undefined).map(([k]) => k),
        blocked: reasons.length > 0,
        reasons,
        timestamp: new Date().toISOString(),
      } as any,
      confidence_score: reasons.length === 0 ? 100 : 0,
    });
  } catch { /* non-critical */ }

  return { allowed: reasons.length === 0, reasons };
}

/* ── Log hook generation ── */

async function logHookGeneration(suggestions: HookSuggestion[], hookProfile: HookProfile, sortMethod: string, dedupMethod: string) {
  try {
    const logs = suggestions.map((s) => ({
      hook_text: s.text,
      evidence: s.evidence,
      emotion_vector: hookProfile.emotion_vector,
      pattern_type: hookProfile.pattern_type,
      data_source: "mvp_database",
      sort_method: sortMethod,
      dedup_method: dedupMethod,
      timestamp: new Date().toISOString(),
    }));

    await supabase.from("validation_reports").insert({
      validation_type: "hook_generation_log",
      report_data: { logs } as any,
      confidence_score: suggestions.filter(s => s.evidence.has_positive_evidence).length > 0 ? 100 : 0,
    });
  } catch { /* non-critical */ }
}

/* ── Generate hook suggestions with retry loop ── */

export async function generateHookSuggestions(
  hookProfile: HookProfile,
  previousSuggestions: HookSuggestion[] = []
): Promise<HookGenerationResult> {
  // AUTOPROTECT: block if insufficient data
  const check = await autoprotectCheck(hookProfile);
  if (!check.allowed) {
    return {
      suggestions: [],
      low_quality_warning: true,
      autoprotect_blocked: true,
      autoprotect_reason: check.reasons.join("; "),
    };
  }

  // Log insufficient_data if evidence P10 threshold is missing
  if (hookProfile.evidence_p10_threshold === null) {
    try {
      await supabase.from("validation_reports").insert({
        validation_type: "insufficient_data",
        report_data: {
          module: "hook_generation",
          reason: "missing_evidence_p10_threshold",
          impact: "has_positive_evidence will be false for all suggestions",
          timestamp: new Date().toISOString(),
        } as any,
        confidence_score: 0,
      });
    } catch { /* non-critical */ }
  }

  const MAX_ATTEMPTS = 5;
  const allValid: HookSuggestion[] = [];
  const allEvaluated: HookSuggestion[] = [];
  let combinedPrevious = [...previousSuggestions];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (allValid.length >= 3) break;

    const { data, error } = await supabase.functions.invoke("generate-hook-suggestions", {
      body: {
        hook_profile: hookProfile,
        previous_suggestions: combinedPrevious,
      },
    });

    if (error) throw new Error(error.message || "Erro ao gerar sugestões de hook");

    const raw = data?.suggestions as Array<{ id: number; text: string }> | undefined;
    if (!raw || raw.length === 0) continue;

    const evaluated: HookSuggestion[] = raw.map((s) => {
      const evidence = evaluateHookEvidence(
        s.text,
        combinedPrevious,
        hookProfile.real_emotional_words,
        hookProfile.real_impact_words,
        hookProfile.real_blacklist_patterns,
        hookProfile.word_count_p10,
        hookProfile.word_count_p90,
        hookProfile.similarity_threshold_p90,
        hookProfile.evidence_p10_threshold
      );
      return { id: s.id, text: s.text, evidence };
    });

    allEvaluated.push(...evaluated);
    const valid = evaluated.filter((s) =>
      !s.evidence.blacklist_blocked &&
      !s.evidence.duplicate_blocked &&
      s.evidence.has_positive_evidence
    );
    allValid.push(...valid);
    combinedPrevious = [...combinedPrevious, ...evaluated];
  }

  const pool = allValid.length >= 3 ? allValid : allEvaluated;

  // Deduplication: skip if no threshold from DB (NO fallback)
  let dedupMethod = "dedup_skipped_no_threshold";
  let deduped = pool;
  if (hookProfile.similarity_threshold_p90 !== null) {
    deduped = deduplicateSuggestions(pool, hookProfile.similarity_threshold_p90);
    dedupMethod = "p90_threshold";
  }

  // Sort: use strength_score from pattern_performance_weights if available
  let sortMethod = "generation_order";
  const filtered = deduped.filter(s => !s.evidence.blacklist_blocked);

  let sorted: HookSuggestion[];
  if (hookProfile.emotional_word_strength !== null && hookProfile.impact_word_strength !== null) {
    // Sort by weighted evidence using real strength scores from DB
    const emoWeight = hookProfile.emotional_word_strength;
    const impWeight = hookProfile.impact_word_strength;
    sorted = filtered.sort((a, b) => {
      const scoreA = a.evidence.matched_emotional_words.length * emoWeight +
                     a.evidence.matched_impact_words.length * impWeight;
      const scoreB = b.evidence.matched_emotional_words.length * emoWeight +
                     b.evidence.matched_impact_words.length * impWeight;
      return scoreB - scoreA;
    });
    sortMethod = "strength_score_weighted";
  } else {
    // insufficient_data: no strength scores in DB, keep generation order
    sorted = filtered;
    sortMethod = "generation_order_insufficient_data";
  }

  const final = sorted.slice(0, 3);

  await logHookGeneration(final, hookProfile, sortMethod, dedupMethod);
  const noEvidence = final.length === 0 || final.every(s => !s.evidence.has_positive_evidence);
  return { suggestions: final, low_quality_warning: noEvidence };
}

function deduplicateSuggestions(items: HookSuggestion[], threshold: number): HookSuggestion[] {
  const result: HookSuggestion[] = [];
  for (const item of items) {
    const lowerWords = new Set(item.text.toLowerCase().split(/\s+/));
    const isDuplicate = result.some((existing) => {
      const existingWords = new Set(existing.text.toLowerCase().split(/\s+/));
      let shared = 0;
      lowerWords.forEach((w) => { if (existingWords.has(w)) shared++; });
      return shared / Math.max(lowerWords.size, 1) >= threshold;
    });
    if (!isDuplicate) result.push(item);
  }
  return result;
}
