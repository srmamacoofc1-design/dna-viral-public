import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";
import {
  assessAndAssignPersistedGeminiMoments,
  type PersistedGeminiVisualMoment,
} from "../_shared/visual-block-evidence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LIBRARY_VISUAL_MAX_MOMENTS = 40;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stringValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
}

function observedBoolean(
  moments: PersistedGeminiVisualMoment[],
  field: "human_presence" | "animal_presence" | "text_on_screen",
): boolean | null {
  const values = moments
    .map((moment) => moment[field])
    .filter((value): value is boolean => typeof value === "boolean");
  return values.length > 0 ? values.some(Boolean) : null;
}

function observedScores(moments: PersistedGeminiVisualMoment[], field: "intensity_score"): number[] {
  return moments
    .map((moment) => Number(moment[field]))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);
}

function coverageDetails(assessment: ReturnType<typeof assessAndAssignPersistedGeminiMoments>) {
  return {
    duration_seconds: assessment.duration_seconds,
    persisted_moments: assessment.persisted_moments,
    valid_moments: assessment.valid_moments,
    unique_timestamps: assessment.unique_timestamps,
    assessed_timestamps: assessment.assessed_timestamps,
    blocks: assessment.blocks,
    assigned_blocks: assessment.assigned_blocks,
    nominal_spacing_seconds: assessment.nominal_spacing_seconds,
    maximum_observed_gap_seconds: assessment.maximum_observed_gap_seconds,
    maximum_allowed_gap_seconds: assessment.maximum_allowed_gap_seconds,
    nearest_assignment_limit_seconds: assessment.nearest_assignment_limit_seconds,
    first_timestamp_seconds: assessment.timeline_coverage.first_timestamp_seconds,
    last_timestamp_seconds: assessment.timeline_coverage.last_timestamp_seconds,
    ending_floor_seconds: assessment.timeline_coverage.ending_floor_seconds,
    reasons: assessment.reasons,
  };
}

async function clearDerivedVisualRows(supabase: any, videoId: string): Promise<void> {
  const results = await Promise.all([
    supabase.from("visual_block_analysis").delete().eq("video_id", videoId),
    supabase.from("visual_emotion_sequence").delete().eq("video_id", videoId),
    supabase.from("extraction_logs").delete().eq("video_id", videoId).eq("extraction_step", "extract-visual-blocks"),
  ]);
  const failure = results.find((result: any) => result.error)?.error;
  if (failure) throw new Error(`Fail-closed visual cleanup failed: ${failure.message}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  let supabase: any = null;
  let videoId: string | null = null;
  try {
    const body = await req.json();
    videoId = typeof body?.video_id === "string" ? body.video_id.trim() : null;
    if (!videoId) {
      return jsonResponse({ error: "Missing video_id", code: "VIDEO_ID_REQUIRED" }, 422);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    supabase = createClient(supabaseUrl, serviceRoleKey);

    const [blocksResult, visualMetadataResult, videoResult] = await Promise.all([
      supabase.from("video_blocks").select("*").eq("video_id", videoId).order("tempo_inicio"),
      supabase.from("video_metadata").select("valor").eq("video_id", videoId)
        .eq("chave", "multimodal_visual_analysis").maybeSingle(),
      supabase.from("videos").select("id, duracao").eq("id", videoId).maybeSingle(),
    ]);
    if (blocksResult.error) throw blocksResult.error;
    if (visualMetadataResult.error) throw visualMetadataResult.error;
    if (videoResult.error) throw videoResult.error;
    if (!videoResult.data) {
      return jsonResponse({ error: "Video not found", code: "VIDEO_NOT_FOUND" }, 404);
    }

    const blocks = (blocksResult.data ?? []).map((block: any) => ({
      ...block,
      tempo_inicio: Number(block.tempo_inicio),
      tempo_fim: Number(block.tempo_fim),
    }));
    let persistedMoments: unknown = null;
    try {
      const storedValue = visualMetadataResult.data?.valor;
      persistedMoments = typeof storedValue === "string" ? JSON.parse(storedValue) : storedValue;
    } catch {
      persistedMoments = null;
    }

    const assessment = assessAndAssignPersistedGeminiMoments(
      persistedMoments,
      blocks,
      Number(videoResult.data.duracao),
      {
        maxMoments: LIBRARY_VISUAL_MAX_MOMENTS,
        secondsPerMoment: 3,
        minMoments: 3,
        sparseGapMultiplier: 2.5,
      },
    );

    if (!assessment.passed) {
      // Old derived rows must not survive a failed current evidence check and
      // accidentally make a later exact-count audit pass.
      await clearDerivedVisualRows(supabase, videoId);
      await supabase.from("extraction_logs").insert({
        video_id: videoId,
        extraction_step: "extract-visual-blocks",
        field_name: "exact_gemini_block_coverage",
        extracted_value: JSON.stringify(coverageDetails(assessment)).slice(0, 500),
        confidence_score: 0,
        source_type: "gemini_video_understanding",
        origin_level: "raw",
        error_flag: true,
        error_message: assessment.reasons.join(", ").slice(0, 1000),
      });
      await supabase.from("video_logs").insert({
        video_id: videoId,
        etapa: "Extracao Visual por Bloco",
        status: "failed",
        mensagem: `Cobertura Gemini rejeitada: ${assessment.reasons.join(", ")}`.slice(0, 2000),
      });
      return jsonResponse({
        error: "A linha do tempo Gemini persistida nao cobre todos os blocos com evidencia visual real.",
        code: "EXACT_GEMINI_VISUAL_BLOCK_COVERAGE_REQUIRED",
        retryable: true,
        exact_block_coverage: false,
        blocks_processed: 0,
        observed_blocks: 0,
        multimodal_moments: assessment.persisted_moments,
        details: coverageDetails(assessment),
      }, 422);
    }

    const visualRecords: any[] = [];
    const blockVisualUpdates: Array<{ id: string; descricao_visual: string; elemento_visual: string }> = [];
    const extractionLogs: any[] = [];

    for (const assignment of assessment.assignments) {
      const block = assignment.block as any;
      const moments = assignment.moments;
      const representative = assignment.representative_moment;
      const descriptions = [...new Set(moments.map((moment) => moment.description.trim()).filter(Boolean))];
      const objects = [...new Set(moments.flatMap((moment) => stringArray(moment.main_objects)))];
      const intensities = observedScores(moments, "intensity_score");
      const averageIntensity = intensities.length > 0
        ? Math.round(intensities.reduce((sum, value) => sum + value, 0) / intensities.length)
        : null;
      const intensityLevel = averageIntensity === null
        ? null
        : averageIntensity >= 70
        ? "alta"
        : averageIntensity >= 40
        ? "media"
        : "baixa";
      const sceneChanges = moments.filter((moment) => moment.is_scene_change === true).length;
      const observedDescription = descriptions.join(" | ");
      const associationLimit = assessment.nearest_assignment_limit_seconds || 1;
      const confidence = assignment.used_nearest_moment
        ? Math.max(75, Math.round(95 - (assignment.nearest_distance_seconds / associationLimit) * 20))
        : 98;

      visualRecords.push({
        video_id: videoId,
        block_id: block.id,
        block_type: block.tipo_bloco,
        // Gemini moments are persisted JSON observations, not extracted image
        // files. A fake frame path would misrepresent the evidence source.
        representative_frame_path: null,
        representative_timestamp: representative.timestamp_seconds,
        scene_description: observedDescription,
        main_action: stringValue(representative.main_action, 300),
        main_objects: objects,
        human_presence: observedBoolean(moments, "human_presence"),
        animal_presence: observedBoolean(moments, "animal_presence"),
        text_on_screen_presence: observedBoolean(moments, "text_on_screen"),
        visual_intensity_level: intensityLevel,
        visual_emotion: stringValue(representative.emotional_tone, 100),
        scene_change_detected: sceneChanges > 0,
        scene_change_count: sceneChanges,
        avg_visual_intensity_score: averageIntensity,
        data_source_type: "gemini_video_understanding",
        confidence_score: confidence,
        origin_level: "raw",
      });
      blockVisualUpdates.push({
        id: block.id,
        descricao_visual: observedDescription.slice(0, 4000),
        elemento_visual: objects.join(", ").slice(0, 2000),
      });
      extractionLogs.push({
        video_id: videoId,
        extraction_step: "extract-visual-blocks",
        field_name: `visual_block_${block.tipo_bloco}_${block.bloco_id}`,
        extracted_value: JSON.stringify({
          persisted_gemini_timestamps: moments.map((moment) => moment.timestamp_seconds),
          used_nearest_moment: assignment.used_nearest_moment,
          nearest_distance_seconds: assignment.nearest_distance_seconds,
          nearest_limit_seconds: assessment.nearest_assignment_limit_seconds,
          scene_changes: sceneChanges,
          intensity: averageIntensity,
        }).slice(0, 500),
        confidence_score: confidence,
        source_type: "gemini_video_understanding",
        origin_level: "raw",
        error_flag: false,
        error_message: null,
      });
    }

    try {
      await clearDerivedVisualRows(supabase, videoId);
      const { data: insertedRows, error: insertError } = await supabase
        .from("visual_block_analysis")
        .insert(visualRecords)
        .select("block_id");
      if (insertError) throw new Error(`Insert visual_block_analysis failed: ${insertError.message}`);
      const expectedBlockIds = new Set(blocks.map((block: any) => block.id));
      const insertedBlockIds = new Set((insertedRows ?? []).map((row: any) => row.block_id));
      if (
        insertedRows?.length !== blocks.length
        || insertedBlockIds.size !== expectedBlockIds.size
        || [...expectedBlockIds].some((id) => !insertedBlockIds.has(id))
      ) {
        throw new Error(`Exact visual persistence failed: ${insertedRows?.length ?? 0}/${blocks.length}`);
      }

      const updateResults = await Promise.all(blockVisualUpdates.map((update) => supabase
        .from("video_blocks")
        .update({ descricao_visual: update.descricao_visual, elemento_visual: update.elemento_visual })
        .eq("id", update.id)
        .eq("video_id", videoId)));
      const updateFailure = updateResults.find((result: any) => result.error)?.error;
      if (updateFailure) throw new Error(`Update video_blocks failed: ${updateFailure.message}`);

      const emotionSequence = visualRecords.map((record) => ({
        block_type: record.block_type,
        emotion: record.visual_emotion,
        intensity: record.visual_intensity_level,
      }));
      const transitionPairs: Record<string, number> = {};
      for (let index = 0; index < emotionSequence.length - 1; index++) {
        const current = emotionSequence[index].emotion;
        const next = emotionSequence[index + 1].emotion;
        if (!current || !next) continue;
        const pair = `${current}->${next}`;
        transitionPairs[pair] = (transitionPairs[pair] || 0) + 1;
      }
      const dominantTransition = Object.entries(transitionPairs)
        .sort(([, left], [, right]) => right - left)[0]?.[0] ?? null;
      const emotionsObserved = emotionSequence.filter((item) => Boolean(item.emotion)).length;
      const { error: emotionError } = await supabase.from("visual_emotion_sequence").insert({
        video_id: videoId,
        emotion_sequence: emotionSequence,
        sequence_string: emotionSequence.map((item) => item.emotion).filter(Boolean).join(" -> "),
        transition_count: Math.max(0, emotionSequence.length - 1),
        dominant_transition: dominantTransition,
        confidence_score: Math.round(emotionsObserved / Math.max(emotionSequence.length, 1) * 100),
      });
      if (emotionError) throw new Error(`Insert visual_emotion_sequence failed: ${emotionError.message}`);

      const { error: logsError } = await supabase.from("extraction_logs").insert(extractionLogs);
      if (logsError) throw new Error(`Insert extraction_logs failed: ${logsError.message}`);

      const { data: verifiedRows, error: verificationError } = await supabase
        .from("visual_block_analysis")
        .select("block_id")
        .eq("video_id", videoId);
      if (verificationError) throw new Error(`Verify visual_block_analysis failed: ${verificationError.message}`);
      const verifiedIds = new Set((verifiedRows ?? []).map((row: any) => row.block_id));
      if (
        verifiedRows?.length !== blocks.length
        || verifiedIds.size !== expectedBlockIds.size
        || [...expectedBlockIds].some((id) => !verifiedIds.has(id))
      ) {
        throw new Error(`Exact visual verification failed: ${verifiedRows?.length ?? 0}/${blocks.length}`);
      }
    } catch (persistenceError) {
      await clearDerivedVisualRows(supabase, videoId);
      throw persistenceError;
    }

    const { data: alignmentRows, error: alignmentError } = await supabase
      .from("text_visual_alignment")
      .select("alignment_score")
      .eq("video_id", videoId);
    if (!alignmentError && alignmentRows && alignmentRows.length > 0) {
      const average = alignmentRows.reduce(
        (sum: number, row: any) => sum + (Number(row.alignment_score) || 0),
        0,
      ) / alignmentRows.length;
      await supabase.from("videos").update({ avg_alignment_score: Math.round(average * 100) / 100 }).eq("id", videoId);
    }

    await supabase.from("video_logs").insert({
      video_id: videoId,
      etapa: "Extracao Visual por Bloco",
      status: "success",
      mensagem: `${visualRecords.length}/${blocks.length} blocos ligados exclusivamente a momentos Gemini persistidos`,
    });

    return jsonResponse({
      success: true,
      exact_block_coverage: true,
      blocks_processed: visualRecords.length,
      observed_blocks: visualRecords.length,
      multimodal_moments: assessment.persisted_moments,
      unique_timestamps: assessment.unique_timestamps,
      assessed_timestamps: assessment.assessed_timestamps,
      nearest_assignments: assessment.nearest_assignments,
      nearest_assignment_limit_seconds: assessment.nearest_assignment_limit_seconds,
      emotion_sequence_generated: true,
    });
  } catch (error) {
    console.error("extract-visual-blocks error:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
      code: "EXTRACT_VISUAL_BLOCKS_FAILED",
      retryable: true,
      video_id: videoId,
    }, 500);
  }
});
