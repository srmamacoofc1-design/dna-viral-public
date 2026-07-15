import { supabase } from "@/integrations/supabase/client";

/* ── Types ── */

export interface EarlyEventEvidence {
  word_count_in_range: boolean | null;
  continuity_with_hook_detected: boolean | null;
  matched_tension_words: string[];
  matched_action_words: string[];
  matched_progression_words: string[];
  duplicate_blocked: boolean;
  blacklist_blocked: boolean;
  has_positive_evidence: boolean;
  evidence_total: number;
  evidence_p10_threshold: number | null;
}

export interface EarlyEventSuggestion {
  id: number;
  text: string;
  evidence: EarlyEventEvidence;
}

export interface EarlyEventGenerationResult {
  suggestions: EarlyEventSuggestion[];
  low_quality_warning: boolean;
  autoprotect_blocked?: boolean;
  autoprotect_reason?: string;
}

export interface EarlyEventProfile {
  narrative_function: string;
  position_role: string;
  hook_text: string;
  hook_event_type: string | null;
  emotion_vector: string | null;
  pattern_type: string | null;
  expected_tension_density: string | null;
  micropike_density: string | null;
  // Real data from DB
  real_tension_words: string[];
  real_action_words: string[];
  real_progression_words: string[];
  real_blacklist_patterns: string[];
  word_count_p10: number | null;
  word_count_p90: number | null;
  // Real few-shot examples from top performers
  real_top_early_events: string[];
  // Real similarity threshold from DB
  similarity_threshold_p90: number | null;
  // Real evidence P10 threshold from DB
  evidence_p10_threshold: number | null;
}

/* ── Fetch real word lists from DB ── */

async function fetchRealWordLists(): Promise<{
  tension_words: string[];
  action_words: string[];
  progression_words: string[];
  blacklist_patterns: string[];
}> {
  const [tensionRes, actionRes, progressionRes, blacklistRes] = await Promise.all([
    supabase.from("block_word_patterns")
      .select("word")
      .in("block_type", ["tensao", "desenvolvimento", "setup"])
      .eq("is_emotional", true),
    supabase.from("block_word_patterns")
      .select("word")
      .in("block_type", ["setup", "desenvolvimento"])
      .eq("is_impact", true),
    supabase.from("block_word_patterns")
      .select("word")
      .in("block_type", ["transicao", "setup"])
      .eq("is_dominant", true),
    supabase.from("verbal_noise_archive")
      .select("combination_text")
      .in("source_block_type", ["setup", "desenvolvimento"])
      .limit(100),
  ]);

  return {
    tension_words: [...new Set((tensionRes.data || []).map(r => r.word))],
    action_words: [...new Set((actionRes.data || []).map(r => r.word))],
    progression_words: [...new Set((progressionRes.data || []).map(r => r.word))],
    blacklist_patterns: [...new Set((blacklistRes.data || []).map(r => r.combination_text))],
  };
}

/* ── Fetch top performing early events as few-shot examples ── */

async function fetchTopEarlyEvents(): Promise<string[]> {
  const { data } = await supabase
    .from("block_verbal_analysis")
    .select("full_text, block_id")
    .not("full_text", "is", null);

  if (!data || data.length === 0) return [];

  const { data: setupBlocks } = await supabase
    .from("video_blocks")
    .select("id, video_id")
    .eq("tipo_bloco", "setup");

  if (!setupBlocks || setupBlocks.length === 0) return [];

  const setupIds = new Set(setupBlocks.map(b => b.id));
  const videoMap = Object.fromEntries(setupBlocks.map(b => [b.id, b.video_id]));

  const setupTexts = data.filter(d => setupIds.has(d.block_id) && d.full_text && d.full_text.length > 3);

  const { data: videos } = await supabase
    .from("videos")
    .select("id, engagement_rate_relative")
    .eq("status", "completed")
    .not("engagement_rate_relative", "is", null)
    .order("engagement_rate_relative", { ascending: false })
    .limit(10);

  if (!videos || videos.length === 0) return [];

  const viralMap = Object.fromEntries(videos.map(v => [v.id, v.engagement_rate_relative]));

  return setupTexts
    .map(h => ({ text: h.full_text!, score: viralMap[videoMap[h.block_id]] ?? 0 }))
    .filter(h => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => r.text);
}

/* ── Calculate real similarity threshold for setup blocks ── */

async function fetchSimilarityThreshold(): Promise<number | null> {
  const { data } = await supabase
    .from("block_verbal_analysis")
    .select("full_text, block_id")
    .not("full_text", "is", null);

  if (!data || data.length === 0) return null;

  const { data: setupBlocks } = await supabase
    .from("video_blocks")
    .select("id")
    .eq("tipo_bloco", "setup");

  if (!setupBlocks || setupBlocks.length === 0) return null;

  const setupIds = new Set(setupBlocks.map(b => b.id));
  const texts = data.filter(d => setupIds.has(d.block_id) && d.full_text && d.full_text.length > 3).map(d => d.full_text!);

  if (texts.length < 2) return null;

  const overlaps: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const wordsA = new Set(texts[i].toLowerCase().split(/\s+/));
      const wordsB = new Set(texts[j].toLowerCase().split(/\s+/));
      let shared = 0;
      wordsA.forEach(w => { if (wordsB.has(w)) shared++; });
      overlaps.push(shared / Math.max(wordsA.size, 1));
    }
  }

  overlaps.sort((a, b) => a - b);
  return overlaps[Math.floor(overlaps.length * 0.9)] ?? null;
}

/* ── Fetch P10 of evidence_total from real setup blocks ── */

async function fetchEvidenceP10(): Promise<number | null> {
  const { data: setupBlocks } = await supabase
    .from("video_blocks")
    .select("id")
    .eq("tipo_bloco", "setup");

  if (!setupBlocks || setupBlocks.length < 5) return null;

  const ids = setupBlocks.map(b => b.id);

  const [tensionRes, actionRes, progressionRes] = await Promise.all([
    supabase.from("block_word_patterns")
      .select("block_id")
      .in("block_id", ids)
      .eq("is_emotional", true),
    supabase.from("block_word_patterns")
      .select("block_id")
      .in("block_id", ids)
      .eq("is_impact", true),
    supabase.from("block_word_patterns")
      .select("block_id")
      .in("block_id", ids)
      .eq("is_dominant", true),
  ]);

  const counts: Record<string, number> = {};
  ids.forEach(id => { counts[id] = 0; });
  (tensionRes.data || []).forEach(r => { counts[r.block_id] = (counts[r.block_id] || 0) + 1; });
  (actionRes.data || []).forEach(r => { counts[r.block_id] = (counts[r.block_id] || 0) + 1; });
  (progressionRes.data || []).forEach(r => { counts[r.block_id] = (counts[r.block_id] || 0) + 1; });

  const sorted = Object.values(counts).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  return sorted[Math.floor(sorted.length * 0.1)] ?? null;
}

/* ── Evidence-based validation — P10-derived threshold ── */

export function evaluateEarlyEventEvidence(
  text: string,
  hookText: string,
  previousSuggestions: EarlyEventSuggestion[] = [],
  realTensionWords: string[] = [],
  realActionWords: string[] = [],
  realProgressionWords: string[] = [],
  realBlacklistPatterns: string[] = [],
  wordCountP10: number | null = null,
  wordCountP90: number | null = null,
  similarityThreshold: number | null = null,
  evidenceP10Threshold: number | null = null
): EarlyEventEvidence {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Blacklist — only from real DB
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
    for (const prev of previousSuggestions) {
      const prevWords = new Set(prev.text.toLowerCase().split(/\s+/));
      let shared = 0;
      lowerWords.forEach((w) => { if (prevWords.has(w)) shared++; });
      if (shared / Math.max(lowerWords.size, 1) >= similarityThreshold) {
        duplicate_blocked = true;
        break;
      }
    }
  }
  // If similarityThreshold is null, dedup is skipped (no fallback)

  // Continuity with hook — uses DB similarity threshold
  let continuity_with_hook_detected: boolean | null = null;
  if (similarityThreshold !== null && hookText.trim().length > 0) {
    const hookWords = new Set(hookText.toLowerCase().split(/\s+/));
    let hookShared = 0;
    words.forEach((w) => { if (hookWords.has(w)) hookShared++; });
    const hookOverlap = hookShared / Math.max(words.length, 1);
    continuity_with_hook_detected = hookOverlap > 0 && hookOverlap < similarityThreshold;
  }

  // Matched words from DB
  const matched_tension_words = realTensionWords.filter((w) => lower.includes(w.toLowerCase()));
  const matched_action_words = realActionWords.filter((w) => lower.includes(w.toLowerCase()));
  const matched_progression_words = realProgressionWords.filter((w) => lower.includes(w.toLowerCase()));

  // Evidence total
  const evidence_total =
    matched_tension_words.length +
    matched_action_words.length +
    matched_progression_words.length +
    (continuity_with_hook_detected === true ? 1 : 0) +
    (word_count_in_range === true ? 1 : 0);

  // has_positive_evidence: strictly derived from P10 of real base
  // If P10 threshold is null → insufficient_data, NO fallback
  const has_positive_evidence = evidenceP10Threshold !== null
    ? evidence_total >= evidenceP10Threshold
    : false;

  return {
    word_count_in_range,
    continuity_with_hook_detected,
    matched_tension_words,
    matched_action_words,
    matched_progression_words,
    duplicate_blocked,
    blacklist_blocked,
    has_positive_evidence,
    evidence_total,
    evidence_p10_threshold: evidenceP10Threshold,
  };
}

/* ── Build profile — NO fallbacks ── */

export async function buildEarlyEventProfile(
  block: { narrative_function: string; position_role: string },
  hookBlock: { text_content?: string | null; event_type?: string } | null
): Promise<EarlyEventProfile> {
  const [dnaRes, dnaFormalRes, wordLists, topEvents, simThreshold, evidenceP10] = await Promise.all([
    supabase.from("dna_objects").select("dominant_emotion, secondary_emotion")
      .order("created_at", { ascending: false }).limit(1).single(),
    supabase.from("dna_base_v2_formal").select("emotional, verbal")
      .order("generated_at", { ascending: false }).limit(1).single(),
    fetchRealWordLists(),
    fetchTopEarlyEvents(),
    fetchSimilarityThreshold(),
    fetchEvidenceP10(),
  ]);

  const dna = dnaRes.data;
  const formal = dnaFormalRes.data;
  const emotionalData = formal?.emotional as any;
  const verbalData = formal?.verbal as any;

  // Fetch word count range for setup blocks (early event position)
  const { data: setupBlocks } = await supabase
    .from("video_blocks")
    .select("id")
    .eq("tipo_bloco", "setup");

  let p10: number | null = null;
  let p90: number | null = null;

  if (setupBlocks && setupBlocks.length > 0) {
    const ids = setupBlocks.map(b => b.id);
    const { data: wcData } = await supabase
      .from("block_verbal_analysis")
      .select("word_count")
      .in("block_id", ids)
      .gt("word_count", 0);

    if (wcData && wcData.length > 0) {
      const sorted = wcData.map(r => r.word_count!).sort((a, b) => a - b);
      p10 = sorted[Math.floor(sorted.length * 0.1)] ?? null;
      p90 = sorted[Math.floor(sorted.length * 0.9)] ?? null;
    }
  }

  return {
    narrative_function: block.narrative_function,
    position_role: block.position_role,
    hook_text: hookBlock?.text_content || "",
    hook_event_type: (hookBlock as any)?.event_type || null,
    // NO FALLBACKS — null if not in DB
    emotion_vector: emotionalData?.dominant_emotion || dna?.dominant_emotion || null,
    pattern_type: verbalData?.dominant_verbal_pattern || null,
    expected_tension_density: emotionalData?.dominant_intensity || null,
    micropike_density: verbalData?.micropike_density || null,
    // Real data
    real_tension_words: wordLists.tension_words,
    real_action_words: wordLists.action_words,
    real_progression_words: wordLists.progression_words,
    real_blacklist_patterns: wordLists.blacklist_patterns,
    word_count_p10: p10,
    word_count_p90: p90,
    real_top_early_events: topEvents,
    similarity_threshold_p90: simThreshold,
    evidence_p10_threshold: evidenceP10,
  };
}

/* ── AUTOPROTECT ── */

async function autoprotectCheck(profile: EarlyEventProfile): Promise<{ allowed: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const dataPresent: Record<string, boolean> = {};

  const { count } = await supabase.from("dna_objects").select("id", { count: "exact", head: true });
  dataPresent["dna_objects"] = (count ?? 0) > 0;
  if (!dataPresent["dna_objects"]) reasons.push("DNA object não encontrado na base");

  dataPresent["hook_text"] = !!profile.hook_text && profile.hook_text.trim().length > 0;
  if (!dataPresent["hook_text"]) reasons.push("Hook text vazio — impossível gerar early event sem hook");

  dataPresent["tension_words"] = profile.real_tension_words.length > 0;
  dataPresent["action_words"] = profile.real_action_words.length > 0;
  if (!dataPresent["tension_words"] && !dataPresent["action_words"]) {
    reasons.push("Nenhum word pattern (tension/action) encontrado na base");
  }

  dataPresent["emotion_vector"] = profile.emotion_vector !== null;
  if (!dataPresent["emotion_vector"]) reasons.push("emotion_vector ausente no DNA — bloqueio obrigatório");

  dataPresent["pattern_type"] = profile.pattern_type !== null;
  if (!dataPresent["pattern_type"]) reasons.push("pattern_type ausente no DNA — bloqueio obrigatório");

  dataPresent["expected_tension_density"] = profile.expected_tension_density !== null;
  if (!dataPresent["expected_tension_density"]) reasons.push("expected_tension_density ausente no DNA — bloqueio obrigatório");

  dataPresent["micropike_density"] = profile.micropike_density !== null;
  if (!dataPresent["micropike_density"]) reasons.push("micropike_density ausente no DNA — bloqueio obrigatório");

  dataPresent["top_early_events"] = profile.real_top_early_events.length > 0;
  if (!dataPresent["top_early_events"]) reasons.push("Nenhum early event de referência encontrado na base (few-shot vazio)");

  try {
    await supabase.from("validation_reports").insert({
      validation_type: "autoprotect_check",
      report_data: {
        module: "early_event_generation",
        data_present: dataPresent,
        null_fields: Object.entries({
          emotion_vector: profile.emotion_vector,
          pattern_type: profile.pattern_type,
          expected_tension_density: profile.expected_tension_density,
          micropike_density: profile.micropike_density,
          word_count_p10: profile.word_count_p10,
          word_count_p90: profile.word_count_p90,
          similarity_threshold_p90: profile.similarity_threshold_p90,
          evidence_p10_threshold: profile.evidence_p10_threshold,
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

/* ── Log ── */

async function logEarlyEventGeneration(suggestions: EarlyEventSuggestion[], profile: EarlyEventProfile, sortMethod: string, dedupMethod: string) {
  try {
    const logs = suggestions.map((s) => ({
      text: s.text,
      evidence: s.evidence,
      emotion_vector: profile.emotion_vector,
      hook_text: profile.hook_text,
      data_source: "mvp_database",
      sort_method: sortMethod,
      dedup_method: dedupMethod,
      timestamp: new Date().toISOString(),
    }));

    await supabase.from("validation_reports").insert({
      validation_type: "early_event_generation_log",
      report_data: { logs } as any,
      confidence_score: suggestions.filter(s => s.evidence.has_positive_evidence).length > 0 ? 100 : 0,
    });
  } catch { /* non-critical */ }
}

/* ── Generate with retry loop ── */

export async function generateEarlyEventSuggestions(
  profile: EarlyEventProfile,
  previousSuggestions: EarlyEventSuggestion[] = []
): Promise<EarlyEventGenerationResult> {
  const check = await autoprotectCheck(profile);
  if (!check.allowed) {
    return {
      suggestions: [],
      low_quality_warning: true,
      autoprotect_blocked: true,
      autoprotect_reason: check.reasons.join("; "),
    };
  }

  // Log insufficient_data if evidence P10 threshold is missing
  if (profile.evidence_p10_threshold === null) {
    try {
      await supabase.from("validation_reports").insert({
        validation_type: "insufficient_data",
        report_data: {
          module: "early_event_generation",
          reason: "missing_evidence_p10_threshold",
          impact: "has_positive_evidence will be false for all suggestions",
          timestamp: new Date().toISOString(),
        } as any,
        confidence_score: 0,
      });
    } catch { /* non-critical */ }
  }

  const MAX_ATTEMPTS = 5;
  const allValid: EarlyEventSuggestion[] = [];
  const allEvaluated: EarlyEventSuggestion[] = [];
  let combinedPrevious = [...previousSuggestions];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (allValid.length >= 3) break;

    const { data, error } = await supabase.functions.invoke("generate-early-event", {
      body: {
        early_event_profile: profile,
        previous_suggestions: combinedPrevious,
      },
    });

    if (error) throw new Error(error.message || "Erro ao gerar sugestões de Early Event");

    const raw = data?.suggestions as Array<{ id: number; text: string }> | undefined;
    if (!raw || raw.length === 0) continue;

    const evaluated: EarlyEventSuggestion[] = raw.map((s) => {
      const evidence = evaluateEarlyEventEvidence(
        s.text,
        profile.hook_text,
        combinedPrevious,
        profile.real_tension_words,
        profile.real_action_words,
        profile.real_progression_words,
        profile.real_blacklist_patterns,
        profile.word_count_p10,
        profile.word_count_p90,
        profile.similarity_threshold_p90,
        profile.evidence_p10_threshold
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
  if (profile.similarity_threshold_p90 !== null) {
    deduped = deduplicateSuggestions(pool, profile.similarity_threshold_p90);
    dedupMethod = "p90_threshold";
  }

  // Sort: tension_word/action_word/progression_word do NOT exist in pattern_performance_weights
  // Therefore: keep generation order and log insufficient_data
  const sortMethod = "generation_order_insufficient_data";
  const filtered = deduped.filter(s => !s.evidence.blacklist_blocked);

  const final = filtered.slice(0, 3);

  await logEarlyEventGeneration(final, profile, sortMethod, dedupMethod);
  const noEvidence = final.length === 0 || final.every(s => !s.evidence.has_positive_evidence);
  return { suggestions: final, low_quality_warning: noEvidence };
}

function deduplicateSuggestions(items: EarlyEventSuggestion[], threshold: number): EarlyEventSuggestion[] {
  const result: EarlyEventSuggestion[] = [];
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
