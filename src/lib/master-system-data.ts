import { supabase } from "@/integrations/supabase/client";

export interface MasterData {
  // DNA
  dnaBase: any | null;
  dnaFormal: any | null;
  // Readiness
  readinessReport: any | null;
  // Verbal
  verbalSummary: any[];
  verbalSequences: any[];
  verbalLayerPatterns: any[];
  canonicalUnits: any[];
  // CTA
  ctaDeep: any[];
  ctaProfiles: any[];
  // Performance
  performanceCorrelations: any[];
  patternWeights: any[];
  // Cohorts
  cohorts: any[];
  cohortSummaries: any[];
  // Micro Events
  microEvents: any[];
  // Alignment
  textVisualAlignment: any[];
  textImageCompatibility: any[];
  // Outliers
  outliers: any[];
  // Semantic
  semanticPatterns: any[];
  blockSemantics: any[];
  // Words/Phrases
  wordPatterns: any[];
  phrasePatterns: any[];
  // Videos + Blocks
  videos: any[];
  blocks: any[];
  blockVerbalAnalysis: any[];
  // Meta
  fetchedAt: string;
  fetchTimeMs: number;
}

export async function loadMasterData(): Promise<MasterData> {
  const start = Date.now();

  const timeout = <T,>(p: Promise<T>, ms = 30000): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Timeout")), ms))]);

  const [
    dnaBaseRes,
    dnaFormalRes,
    readinessRes,
    verbalSummaryRes,
    verbalSeqRes,
    verbalLayerRes,
    canonicalRes,
    ctaDeepRes,
    ctaProfilesRes,
    perfCorrRes,
    patternWeightsRes,
    cohortsRes,
    cohortSummariesRes,
    microEventsRes,
    alignmentRes,
    compatibilityRes,
    outliersRes,
    semanticPatternsRes,
    blockSemanticsRes,
    wordPatternsRes,
    phrasePatternsRes,
    videosRes,
    blocksRes,
    blockVerbalRes,
  ] = await timeout(Promise.all([
    supabase.from("dna_base_v2").select("*").order("generated_at", { ascending: false }).limit(1),
    supabase.from("dna_base_v2_formal").select("*").order("generated_at", { ascending: false }).limit(1),
    supabase.from("readiness_reports").select("*").order("generated_at", { ascending: false }).limit(1),
    supabase.from("verbal_intelligence_summary").select("*"),
    supabase.from("verbal_narrative_sequences").select("*").order("frequency", { ascending: false }),
    supabase.from("verbal_layer_patterns").select("*"),
    supabase.from("verbal_canonical_units").select("*").order("narrative_replicability_score", { ascending: false }).limit(500),
    supabase.from("cta_deep_analysis").select("*"),
    supabase.from("cta_profiles").select("*"),
    supabase.from("performance_correlation").select("*").order("confidence_score", { ascending: false }),
    supabase.from("pattern_performance_weights").select("*").order("strength_score", { ascending: false }),
    supabase.from("dataset_cohort").select("*"),
    supabase.from("cohort_analysis_summary").select("*"),
    supabase.from("video_micro_events").select("*").order("timestamp_seconds", { ascending: true }).limit(1000),
    supabase.from("text_visual_alignment").select("*"),
    supabase.from("text_image_compatibility").select("*"),
    supabase.from("outlier_detection").select("*"),
    supabase.from("semantic_patterns").select("*"),
    supabase.from("block_semantic_patterns").select("*"),
    supabase.from("block_word_patterns").select("*").limit(1000),
    supabase.from("block_phrase_patterns").select("*").limit(1000),
    supabase.from("videos").select("*").order("created_at", { ascending: false }),
    supabase.from("video_blocks").select("*").order("bloco_id", { ascending: true }),
    supabase.from("block_verbal_analysis").select("*"),
  ]), 45000);

  return {
    dnaBase: dnaBaseRes.data?.[0] ?? null,
    dnaFormal: dnaFormalRes.data?.[0] ?? null,
    readinessReport: readinessRes.data?.[0] ?? null,
    verbalSummary: verbalSummaryRes.data ?? [],
    verbalSequences: verbalSeqRes.data ?? [],
    verbalLayerPatterns: verbalLayerRes.data ?? [],
    canonicalUnits: canonicalRes.data ?? [],
    ctaDeep: ctaDeepRes.data ?? [],
    ctaProfiles: ctaProfilesRes.data ?? [],
    performanceCorrelations: perfCorrRes.data ?? [],
    patternWeights: patternWeightsRes.data ?? [],
    cohorts: cohortsRes.data ?? [],
    cohortSummaries: cohortSummariesRes.data ?? [],
    microEvents: microEventsRes.data ?? [],
    textVisualAlignment: alignmentRes.data ?? [],
    textImageCompatibility: compatibilityRes.data ?? [],
    outliers: outliersRes.data ?? [],
    semanticPatterns: semanticPatternsRes.data ?? [],
    blockSemantics: blockSemanticsRes.data ?? [],
    wordPatterns: wordPatternsRes.data ?? [],
    phrasePatterns: phrasePatternsRes.data ?? [],
    videos: videosRes.data ?? [],
    blocks: blocksRes.data ?? [],
    blockVerbalAnalysis: blockVerbalRes.data ?? [],
    fetchedAt: new Date().toISOString(),
    fetchTimeMs: Date.now() - start,
  };
}
