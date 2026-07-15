import { gzipSync, zipSync, strToU8 } from "fflate";
import type { MasterData } from "./master-system-data";

export type PreparedDownload = {
  fileName: string;
  mimeType: string;
  objectUrl: string;
  sizeBytes: number;
  shareFile: File | null;
};

function dateTag() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function encode(obj: unknown): Uint8Array {
  return strToU8(JSON.stringify(obj, null, 2));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hasCryptoSubtle(): boolean {
  try {
    return typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function";
  } catch {
    return false;
  }
}

function prepareDownload(blob: Blob, fileName: string, mimeType: string): PreparedDownload {
  return {
    fileName,
    mimeType,
    objectUrl: URL.createObjectURL(blob),
    sizeBytes: blob.size,
    shareFile: typeof File !== "undefined" ? new File([blob], fileName, { type: mimeType }) : null,
  };
}

function buildMetadata(data: MasterData) {
  return {
    export_date: new Date().toISOString(),
    system_version: "1.0.0",
    dataset_version: "phase-1",
    total_videos: data.videos.length,
    total_blocks: data.blocks.length,
    total_reports: 15,
    total_records:
      data.videos.length +
      data.blocks.length +
      data.blockVerbalAnalysis.length +
      data.verbalSummary.length +
      data.verbalSequences.length +
      data.verbalLayerPatterns.length +
      data.canonicalUnits.length +
      data.ctaDeep.length +
      data.ctaProfiles.length +
      data.performanceCorrelations.length +
      data.patternWeights.length +
      data.cohorts.length +
      data.cohortSummaries.length +
      data.microEvents.length +
      data.textVisualAlignment.length +
      data.textImageCompatibility.length +
      data.outliers.length +
      data.semanticPatterns.length +
      data.blockSemantics.length +
      data.wordPatterns.length +
      data.phrasePatterns.length,
    compression_type: "gzip",
    generated_by: "ViralDNA Master System Report",
    snapshot_fetch_time_ms: data.fetchTimeMs,
  };
}

function buildSchema() {
  return {
    version: "1.0",
    tables: {
      videos: { pk: "id", fields: ["id", "titulo", "url", "views", "likes", "comments", "shares", "duracao_segundos", "engagement_rate_relative", "segment", "created_at"] },
      video_blocks: { pk: "id", fk: { video_id: "videos.id" }, fields: ["id", "video_id", "bloco_id", "tipo_bloco", "texto", "emocao", "funcao_narrativa", "tempo_inicio", "tempo_fim"] },
      block_verbal_analysis: { pk: "id", fk: { video_id: "videos.id", block_id: "video_blocks.id" }, fields: ["id", "video_id", "block_id", "tone", "word_count", "emotional_intensity", "semantic_pressure_score"] },
      dna_base_v2: { pk: "id", fields: ["id", "version_name", "dataset_type", "total_videos_used", "total_blocks_used", "dominant_structure_sequence", "dominant_emotional_arc"] },
      dna_base_v2_formal: { pk: "id", fk: { source_dna_base_v2_id: "dna_base_v2.id" }, fields: ["id", "version_name", "structural", "emotional", "verbal", "temporal", "performance"] },
      readiness_reports: { pk: "id", fields: ["id", "readiness_score", "total_videos", "total_blocks", "validation_status", "report_json"] },
      verbal_intelligence_summary: { pk: "id", fields: ["id", "narrative_function", "total_canonical_units", "avg_replicability_score", "primary_emotion"] },
      verbal_narrative_sequences: { pk: "id", fields: ["id", "sequence_pattern", "frequency", "sequence_length", "avg_engagement_rate"] },
      verbal_layer_patterns: { pk: "id", fields: ["id", "layer_type", "total_blocks_analyzed", "top_words", "top_phrases"] },
      verbal_canonical_units: { pk: "id", fields: ["id", "video_id", "candidate_text", "narrative_function", "narrative_replicability_score", "emotional_intent"] },
      cta_deep_analysis: { pk: "id", fk: { video_id: "videos.id" }, fields: ["id", "video_id", "cta_type", "cta_text", "cta_intensity", "cta_position"] },
      cta_profiles: { pk: "id", fk: { video_id: "videos.id" }, fields: ["id", "video_id", "cta_type", "cta_text", "cta_intensity"] },
      performance_correlation: { pk: "id", fields: ["id", "pattern_name", "pattern_type", "correlation_with_views", "correlation_with_engagement", "confidence_score"] },
      pattern_performance_weights: { pk: "id", fields: ["id", "pattern_type", "pattern_value", "strength_score", "frequency"] },
      dataset_cohort: { pk: "id", fields: ["id", "cohort_name", "cohort_type", "video_count"] },
      cohort_analysis_summary: { pk: "id", fk: { cohort_id: "dataset_cohort.id" }, fields: ["id", "cohort_name", "avg_engagement_rate", "dominant_structure", "dominant_emotion"] },
      video_micro_events: { pk: "id", fields: ["id", "video_id", "event_type", "timestamp_seconds", "event_strength"] },
      text_visual_alignment: { pk: "id", fk: { video_id: "videos.id", block_id: "video_blocks.id" }, fields: ["id", "video_id", "block_id", "alignment_score"] },
      text_image_compatibility: { pk: "id", fk: { video_id: "videos.id", block_id: "video_blocks.id" }, fields: ["id", "video_id", "block_id", "compatibility_score"] },
      outlier_detection: { pk: "id", fk: { video_id: "videos.id" }, fields: ["id", "video_id", "outlier_type", "z_score", "outlier_flag"] },
      semantic_patterns: { pk: "id", fk: { video_id: "videos.id" }, fields: ["id", "video_id", "hook_text", "dominant_verbal_tone"] },
      block_semantic_patterns: { pk: "id", fk: { video_id: "videos.id", block_id: "video_blocks.id" }, fields: ["id", "video_id", "block_id", "block_type", "block_verbal_tone"] },
      block_word_patterns: { pk: "id", fk: { video_id: "videos.id", block_id: "video_blocks.id" }, fields: ["id", "video_id", "block_id", "word", "word_frequency", "is_dominant"] },
      block_phrase_patterns: { pk: "id", fk: { video_id: "videos.id", block_id: "video_blocks.id" }, fields: ["id", "video_id", "block_id", "phrase", "phrase_type", "is_strong"] },
    },
  };
}

export function exportExecutivePDF() {
  window.print();
}

export function exportSnapshot(data: MasterData): PreparedDownload & { rawSize: number; compressedSize: number } {
  const payload = {
    metadata: buildMetadata(data),
    schema: buildSchema(),
    masterData: data,
  };

  const jsonBytes = strToU8(JSON.stringify(payload));
  const compressed = gzipSync(jsonBytes, { level: 9 });
  const fileName = `master_snapshot_${dateTag()}.json.gz`;
  const mimeType = "application/gzip";
  const blob = new Blob([toArrayBuffer(compressed)], { type: mimeType });

  return {
    ...prepareDownload(blob, fileName, mimeType),
    rawSize: jsonBytes.length,
    compressedSize: compressed.length,
  };
}

export async function exportDatasetPackage(
  data: MasterData,
  onProgress?: (msg: string) => void,
): Promise<PreparedDownload & { totalFiles: number; zipSize: number; sha256Available: boolean }> {
  const log = (m: string) => onProgress?.(m);
  const canHash = hasCryptoSubtle();

  log("Preparando arquivos segmentados...");

  const videoFiles: Record<string, Uint8Array> = {};
  data.videos.forEach((v: any, i: number) => {
    const vid = v.id;
    const entry = {
      video: v,
      blocks: data.blocks.filter((b: any) => b.video_id === vid),
      blockVerbalAnalysis: data.blockVerbalAnalysis.filter((b: any) => b.video_id === vid),
      ctaDeep: data.ctaDeep.filter((c: any) => c.video_id === vid),
      ctaProfiles: data.ctaProfiles.filter((c: any) => c.video_id === vid),
      textVisualAlignment: data.textVisualAlignment.filter((t: any) => t.video_id === vid),
      textImageCompatibility: data.textImageCompatibility.filter((t: any) => t.video_id === vid),
      outliers: data.outliers.filter((o: any) => o.video_id === vid),
      semanticPatterns: data.semanticPatterns.filter((s: any) => s.video_id === vid),
      blockSemantics: data.blockSemantics.filter((s: any) => s.video_id === vid),
      wordPatterns: data.wordPatterns.filter((w: any) => w.video_id === vid),
      phrasePatterns: data.phrasePatterns.filter((p: any) => p.video_id === vid),
      microEvents: data.microEvents.filter((m: any) => m.video_id === vid),
    };
    const idx = String(i + 1).padStart(4, "0");
    videoFiles[`videos/video-${idx}.json`] = encode(entry);
  });

  const sectionFiles: Record<string, Uint8Array> = {
    "00-summary.json": encode({
      total_videos: data.videos.length,
      total_blocks: data.blocks.length,
      dna_version: data.dnaBase?.version_name ?? null,
      readiness_score: data.readinessReport?.readiness_score ?? null,
      snapshot_date: data.fetchedAt,
    }),
    "01-dna-base-v2.json": encode(data.dnaBase),
    "02-dna-formal-v1.json": encode(data.dnaFormal),
    "03-readiness.json": encode(data.readinessReport),
    "04-master-readiness.json": encode({
      readinessReport: data.readinessReport,
      videos: data.videos.length,
      blocks: data.blocks.length,
    }),
    "05-verbal-intelligence.json": encode({
      summary: data.verbalSummary,
      layerPatterns: data.verbalLayerPatterns,
      canonicalUnits: data.canonicalUnits,
    }),
    "06-narrative-sequences.json": encode(data.verbalSequences),
    "07-cta-analysis.json": encode({ ctaDeep: data.ctaDeep, ctaProfiles: data.ctaProfiles }),
    "08-performance.json": encode({ correlations: data.performanceCorrelations, weights: data.patternWeights }),
    "09-cohorts.json": encode({ cohorts: data.cohorts, summaries: data.cohortSummaries }),
    "10-micro-events.json": encode(data.microEvents),
    "11-alignment.json": encode({ textVisualAlignment: data.textVisualAlignment, textImageCompatibility: data.textImageCompatibility }),
    "12-outliers.json": encode(data.outliers),
    "13-semantic-patterns.json": encode({ semanticPatterns: data.semanticPatterns, blockSemantics: data.blockSemantics }),
    "14-word-patterns.json": encode({ wordPatterns: data.wordPatterns, phrasePatterns: data.phrasePatterns }),
  };

  const allFiles: Record<string, Uint8Array> = { ...sectionFiles, ...videoFiles };

  log("Gerando manifest...");
  const manifestEntries = Object.entries(allFiles).map(([name, bytes]) => ({
    name,
    size: bytes.length,
  }));
  const manifest = {
    package_version: "1.0",
    generated_at: new Date().toISOString(),
    total_files: manifestEntries.length + 4,
    files: manifestEntries,
  };
  allFiles["manifest.json"] = encode(manifest);

  log("Calculando checksums SHA-256...");
  if (canHash) {
    const checksums: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(allFiles)) {
      checksums[name] = await sha256(bytes);
    }
    allFiles["checksums.json"] = encode(checksums);
  } else {
    allFiles["checksums.json"] = encode({
      error: "SHA-256 indisponível neste ambiente. crypto.subtle não suportado.",
      warning: "Checksums não foram gerados. Reexporte em ambiente com HTTPS/crypto.subtle.",
      generated_at: new Date().toISOString(),
    });
  }

  allFiles["metadata.json"] = encode(buildMetadata(data));
  allFiles["schema.json"] = encode(buildSchema());

  log("Compactando pacote ZIP...");
  const zipInput: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(allFiles)) {
    zipInput[`master-dataset-package/${name}`] = bytes;
  }

  const zipData = zipSync(zipInput, { level: 6 });
  const fileName = `master-dataset-package_${dateTag()}.zip`;
  const mimeType = "application/zip";
  const blob = new Blob([toArrayBuffer(zipData)], { type: mimeType });

  return {
    ...prepareDownload(blob, fileName, mimeType),
    totalFiles: Object.keys(allFiles).length,
    zipSize: zipData.length,
    sha256Available: canHash,
  };
}
