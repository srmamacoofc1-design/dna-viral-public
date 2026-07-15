import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { assertResourceOwner, EdgeAuthError, requireUserOrService } from "../_shared/edge-auth.ts";
import { resolveValidatedEffectiveWordContract } from "../_shared/effective-word-contract.ts";
import { resolvePromotedBlockIndex, sortPromotableScriptBlocks } from "../_shared/promoted-script-blocks.ts";
import { assessRequiredViralReview, resolveScriptInputMode } from "../_shared/required-viral-review.ts";
import {
  resolveViralPacingWordsPerSecond,
  resolveViralSlotWordRange,
  resolveViralWordCountContract,
  viralDraftFingerprint,
} from "../_shared/viral-review-loop.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function countWords(text: unknown): number {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function assessExactSlotCoverage(slots: any[], scriptBlocks: any[]) {
  const expectedIndexes = slots.map((slot) => Number(slot?.index));
  const blockIndexes = scriptBlocks.map((block) => Number(block?.index));
  const expectedSet = new Set(expectedIndexes);
  const duplicateExpectedIndexes = expectedIndexes.filter((value, index) =>
    !Number.isInteger(value) || expectedIndexes.indexOf(value) !== index
  );
  const duplicateBlockIndexes = blockIndexes.filter((value, index) =>
    !Number.isInteger(value) || blockIndexes.indexOf(value) !== index
  );
  const missingIndexes = expectedIndexes.filter((index) =>
    blockIndexes.filter((candidate) => candidate === index).length !== 1
  );
  const unexpectedIndexes = blockIndexes.filter((index) =>
    !Number.isInteger(index) || !expectedSet.has(index)
  );
  const emptyIndexes = expectedIndexes.filter((index) => {
    const block = scriptBlocks.find((candidate) => Number(candidate?.index) === index);
    return !String(block?.generated_text || "").trim();
  });
  const passed = slots.length > 0
    && scriptBlocks.length === slots.length
    && duplicateExpectedIndexes.length === 0
    && duplicateBlockIndexes.length === 0
    && missingIndexes.length === 0
    && unexpectedIndexes.length === 0
    && emptyIndexes.length === 0;
  return {
    passed,
    expected_count: slots.length,
    actual_count: scriptBlocks.length,
    non_empty_count: scriptBlocks.filter((block) => String(block?.generated_text || "").trim()).length,
    missing_indexes: [...new Set(missingIndexes)],
    empty_indexes: [...new Set(emptyIndexes)],
    duplicate_indexes: [...new Set(duplicateBlockIndexes)],
    unexpected_indexes: [...new Set(unexpectedIndexes)],
  };
}

function persistedWordContract(assemblyRules: any): any | null {
  const log = Array.isArray(assemblyRules?.generation_log) ? assemblyRules.generation_log : [];
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index]?.stage === "total_word_count_contract") return log[index];
  }
  return null;
}

function assessGlobalWordCountContract(args: {
  required: boolean;
  slots: any[];
  scriptBlocks: any[];
  payload: any;
  assemblyRules: any;
}) {
  const actual = args.scriptBlocks.reduce(
    (sum, block) => sum + countWords(block?.generated_text),
    0,
  );
  if (!args.required) {
    return { required: false, passed: true, actual_word_count: actual, reason: null };
  }
  const estimatedTarget = Number(
    args.payload?.video_reference_context?.topic_analysis?.estimated_target_word_count,
  );
  const ranges = args.slots
    .filter((slot) => slot?.generation_ready === true)
    .map(resolveViralSlotWordRange);
  const recomputed = resolveViralWordCountContract(
    ranges,
    estimatedTarget,
    args.payload?.video_reference_context?.duration_seconds,
    0.12,
    resolveViralPacingWordsPerSecond(args.slots),
  );
  const persisted = persistedWordContract(args.assemblyRules);
  const fields = [
    "requested_target",
    "target",
    "acceptable_min",
    "acceptable_max",
    "total_p10",
    "total_p90",
  ] as const;
  const targetAvailable = Number.isFinite(estimatedTarget) && estimatedTarget > 0;
  const completeRanges = ranges.length === args.slots.length
    && ranges.every((range) => Number.isInteger(range.index));
  const persistedMatchesRecomputed = !!persisted && fields.every((field) =>
    Number(persisted?.[field]) === Number(recomputed[field])
  );
  const recomputedAllocations = Array.isArray(recomputed.allocations) ? recomputed.allocations : [];
  const persistedAllocations = Array.isArray(persisted?.allocations) ? persisted.allocations : [];
  const persistedAllocationsByIndex = new Map(
    persistedAllocations.map((allocation: any) => [Number(allocation?.index), allocation]),
  );
  const allocationsMatchRecomputed = recomputedAllocations.length === persistedAllocations.length
    && recomputedAllocations.every((allocation) => {
      const saved = persistedAllocationsByIndex.get(Number(allocation.index));
      return !!saved
        && Number(saved.min) === Number(allocation.min)
        && Number(saved.max) === Number(allocation.max)
        && Number(saved.target_words) === Number(allocation.target_words);
    });
  const persistedLoop = args.assemblyRules?.writer_evaluator_loop;
  const allowPersistedOverride = persistedLoop?.passed === true
    && persistedLoop?.termination_reason === "quality_gate_passed";
  const effectiveRangeViolations = recomputedAllocations.flatMap((allocation) => {
    const block = args.scriptBlocks.find((candidate) => Number(candidate?.index) === Number(allocation.index));
    const words = countWords(block?.generated_text);
    const effective = resolveValidatedEffectiveWordContract(
      allocation,
      block,
      allowPersistedOverride,
    );
    return words >= effective.min && words <= effective.max
      ? []
      : [{ index: Number(allocation.index), actual: words, min: effective.min, max: effective.max, source: effective.source }];
  });
  const withinPersistedTolerance = !!persisted
    && actual >= Number(persisted.acceptable_min)
    && actual <= Number(persisted.acceptable_max);
  const passed = targetAvailable
    && completeRanges
    && persistedMatchesRecomputed
    && allocationsMatchRecomputed
    && effectiveRangeViolations.length === 0
    && withinPersistedTolerance;
  const reason = !targetAvailable
    ? "estimated_target_word_count_missing"
    : !completeRanges
    ? "word_count_ranges_incomplete"
    : !persisted
    ? "persisted_total_word_count_contract_missing"
    : !persistedMatchesRecomputed
    ? "persisted_total_word_count_contract_mismatch"
    : !allocationsMatchRecomputed
    ? "persisted_slot_word_allocations_mismatch"
    : effectiveRangeViolations.length > 0
    ? `effective_slot_word_range_violations:${effectiveRangeViolations.map((item) => `${item.index}:${item.actual}_outside_${item.min}_${item.max}`).join(",")}`
    : !withinPersistedTolerance
    ? `actual_word_count_${actual}_outside_${persisted.acceptable_min}_${persisted.acceptable_max}`
    : null;
  return {
    required: true,
    passed,
    reason,
    actual_word_count: actual,
    estimated_target_word_count: targetAvailable ? Math.round(estimatedTarget) : null,
    persisted_contract: persisted,
    recomputed_contract: recomputed,
    effective_slot_word_range_violations: effectiveRangeViolations,
  };
}

function assessCurrentViralFingerprint(required: boolean, writerEvaluatorLoop: any, scriptBlocks: any[]) {
  const current = viralDraftFingerprint(scriptBlocks as any);
  if (!required) {
    return { required: false, passed: true, current_draft_fingerprint: current, evaluated_draft_fingerprint: null, reason: null };
  }
  const audit = Array.isArray(writerEvaluatorLoop?.audit_trail) ? writerEvaluatorLoop.audit_trail : [];
  const lastEntry = audit.length > 0 ? audit[audit.length - 1] : null;
  const evaluated = typeof lastEntry?.draft_fingerprint === "string"
    ? lastEntry.draft_fingerprint
    : null;
  const passed = evaluated !== null && evaluated === current;
  return {
    required: true,
    passed,
    current_draft_fingerprint: current,
    evaluated_draft_fingerprint: evaluated,
    reason: passed ? null : "current_script_blocks_do_not_match_last_evaluated_draft",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const actor = await requireUserOrService({ req, supabaseUrl, serviceRoleKey: serviceKey });

    const { script_assembly_id } = await req.json();

    if (!script_assembly_id) {
      return new Response(JSON.stringify({
        status: "error",
        status_reason: "script_assembly_id is required",
        script_assembly_id: null,
        video_script_id: null,
        validation_status: null,
        promoted_at: null,
        summary: null,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── STEP 1: Load script assembly ──
    const { data: assembly, error: assemblyErr } = await supabase
      .from("script_assemblies")
      .select("*")
      .eq("id", script_assembly_id)
      .maybeSingle();

    if (assemblyErr || !assembly) {
      return json200({
        status: "insufficient_data",
        status_reason: assemblyErr ? `DB error: ${assemblyErr.message}` : "Script assembly not found",
        script_assembly_id,
        video_script_id: null,
        validation_status: null,
        promoted_at: null,
        summary: null,
      });
    }
    assertResourceOwner(actor, assembly.user_id);

    // ── STEP 2: Validate promotion eligibility ──
    const blocks: string[] = [];

    if (assembly.validation_status !== "approved") {
      blocks.push(`validation_status is "${assembly.validation_status}", expected "approved"`);
    }
    const writerEvaluatorLoop = assembly?.assembly_rules?.writer_evaluator_loop;
    if (!assembly.validation_result) {
      blocks.push("validation_result is null");
    }
    if (!assembly.script_blocks || !Array.isArray(assembly.script_blocks) || assembly.script_blocks.length === 0) {
      blocks.push("script_blocks is empty or missing");
    }
    if (!assembly.source_generation_context_id) {
      blocks.push("source_generation_context_id is missing");
    }
    if (!assembly.validated_at) {
      blocks.push("validated_at is missing");
    }

    if (blocks.length > 0) {
      return json200({
        status: "blocked",
        status_reason: blocks.join("; "),
        script_assembly_id,
        video_script_id: null,
        validation_status: assembly.validation_status || null,
        promoted_at: null,
        summary: null,
      });
    }

    // ── STEP 3: Load generation context ──
    const { data: genCtx, error: genErr } = await supabase
      .from("generation_contexts")
      .select("*")
      .eq("id", assembly.source_generation_context_id)
      .maybeSingle();

    if (genErr || !genCtx) {
      return json200({
        status: "insufficient_data",
        status_reason: genErr ? `DB error loading generation_context: ${genErr.message}` : "Generation context not found",
        script_assembly_id,
        video_script_id: null,
        validation_status: assembly.validation_status,
        promoted_at: null,
        summary: null,
      });
    }
    assertResourceOwner(actor, genCtx.user_id);

    const inputMode = resolveScriptInputMode(assembly?.assembly_rules, genCtx.generation_rules);
    const viralReviewGate = assessRequiredViralReview(inputMode, writerEvaluatorLoop);
    const generationRules = genCtx.generation_rules as any;
    const payload = generationRules?.context_payload;
    const slotSequence = Array.isArray(genCtx.slot_sequence) ? genCtx.slot_sequence as any[] : [];
    const scriptBlocks = assembly.script_blocks as Array<Record<string, unknown>>;
    const exactSlotCoverage = assessExactSlotCoverage(slotSequence, scriptBlocks);
    const globalWordCountContract = assessGlobalWordCountContract({
      required: inputMode === "video",
      slots: slotSequence,
      scriptBlocks,
      payload,
      assemblyRules: assembly?.assembly_rules,
    });
    const currentViralFingerprint = assessCurrentViralFingerprint(
      viralReviewGate.required === true,
      writerEvaluatorLoop,
      scriptBlocks,
    );
    const finalAcceptanceFailures = [
      exactSlotCoverage.passed ? null : `exact_slot_coverage_failed:${exactSlotCoverage.non_empty_count}/${exactSlotCoverage.expected_count}`,
      globalWordCountContract.passed ? null : globalWordCountContract.reason || "global_word_count_contract_failed",
      currentViralFingerprint.passed ? null : currentViralFingerprint.reason || "current_viral_fingerprint_failed",
    ].filter(Boolean) as string[];
    if (finalAcceptanceFailures.length > 0) {
      return json200({
        status: "blocked",
        status_reason: finalAcceptanceFailures.join("; "),
        script_assembly_id,
        video_script_id: null,
        validation_status: assembly.validation_status || null,
        promoted_at: null,
        summary: {
          exact_slot_coverage: exactSlotCoverage,
          global_word_count: globalWordCountContract,
          current_viral_fingerprint: currentViralFingerprint,
        },
      });
    }
    if (viralReviewGate.passed !== true) {
      return json200({
        status: "blocked",
        status_reason: viralReviewGate.reason || "video viral review gate failed",
        script_assembly_id,
        video_script_id: null,
        validation_status: assembly.validation_status || null,
        promoted_at: null,
        summary: null,
      });
    }

    // ── STEP 4: Load blueprint context ──
    let blueprint: Record<string, unknown> | null = null;
    if (genCtx.source_blueprint_id) {
      const { data: bp, error: bpErr } = await supabase
        .from("blueprint_contexts")
        .select("*")
        .eq("id", genCtx.source_blueprint_id)
        .maybeSingle();

      if (bpErr || !bp) {
        return json200({
          status: "insufficient_data",
          status_reason: bpErr ? `DB error loading blueprint: ${bpErr.message}` : "Blueprint context not found",
          script_assembly_id,
          video_script_id: null,
          validation_status: assembly.validation_status,
          promoted_at: null,
          summary: null,
        });
      }
      blueprint = bp;
    }

    // ── STEP 5: Build final script text ──
    const sortedBlocks = sortPromotableScriptBlocks(scriptBlocks);

    const finalScriptBlocks: Array<Record<string, unknown>> = [];
    const textParts: string[] = [];

    for (const block of sortedBlocks) {
      const blockIndex = resolvePromotedBlockIndex(block);
      const generatedText = (block.generated_text as string) || "";
      if (generatedText.trim()) {
        textParts.push(generatedText.trim());
      }

      finalScriptBlocks.push({
        index: blockIndex,
        slot_index: blockIndex,
        slot_type: block.slot_type ?? null,
        narrative_function: block.narrative_function ?? null,
        generated_text: generatedText,
        word_count: generatedText ? generatedText.split(/\s+/).filter(Boolean).length : 0,
        slot_status: block.slot_status ?? (generatedText.trim() ? "present" : "empty"),
      });
    }

    const finalScriptText = textParts.join("\n\n");

    // ── STEP 6: Check if already promoted ──
    const { data: existing, error: existErr } = await supabase
      .from("promoted_scripts")
      .select("id")
      .eq("source_script_assembly_id", script_assembly_id)
      .maybeSingle();

    if (existErr && !existErr.message.includes("0 rows")) {
      // ignore "no rows" errors
    }

    if (existing) {
      return json200({
        status: "already_promoted",
        status_reason: "A promoted script already exists for this assembly",
        script_assembly_id,
        video_script_id: existing.id,
        validation_status: assembly.validation_status,
        promoted_at: null,
        summary: {
          total_blocks: finalScriptBlocks.length,
          blocks_promoted: textParts.length,
          final_text_length: finalScriptText.length,
          source_generation_context_id: assembly.source_generation_context_id,
          source_blueprint_id: genCtx.source_blueprint_id || null,
          validation_version: assembly.validation_version,
        },
      });
    }

    // ── STEP 7: Build promotion trace ──
    const validationResult = assembly.validation_result as Record<string, unknown> | null;
    const promotedAt = new Date().toISOString();

    const promotionTrace = {
      script_assembly_id,
      generation_context_id: assembly.source_generation_context_id,
      blueprint_context_id: genCtx.source_blueprint_id || null,
      validation_status: assembly.validation_status,
      validation_version: assembly.validation_version,
      promoted_at: promotedAt,
      source_validation_summary: validationResult?.summary ?? null,
      source_runtime_metrics: validationResult?.runtime_metrics ?? null,
      final_acceptance_contracts: {
        exact_slot_coverage: exactSlotCoverage,
        global_word_count: globalWordCountContract,
        current_viral_fingerprint: currentViralFingerprint,
      },
    };

    // ── STEP 8: Persist into promoted_scripts ──
    const scriptTitle = `${assembly.assembly_name || "Script"} — Final (${genCtx.generation_name || "Gen"})`;

    // Propagate user_id from assembly
    const promoteInsert: Record<string, any> = {
      source_script_assembly_id: script_assembly_id,
      source_generation_context_id: assembly.source_generation_context_id,
      source_blueprint_id: genCtx.source_blueprint_id || null,
      script_title: scriptTitle,
      script_text: finalScriptText,
      script_blocks: finalScriptBlocks,
      script_status: "final",
      promoted_at: promotedAt,
      validation_status: assembly.validation_status,
      validation_version: assembly.validation_version,
      promotion_trace: promotionTrace,
    };
    const effectiveUserId = assembly.user_id ?? genCtx.user_id ?? null;
    if (effectiveUserId) promoteInsert.user_id = effectiveUserId;

    const { data: inserted, error: insertErr } = await supabase
      .from("promoted_scripts")
      .insert(promoteInsert)
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return json200({
        status: "error",
        status_reason: `Failed to insert promoted script: ${insertErr?.message || "unknown"}`,
        script_assembly_id,
        video_script_id: null,
        validation_status: assembly.validation_status,
        promoted_at: null,
        summary: null,
      });
    }

    // ── STEP 9: Update assembly status to "final" ──
    await supabase
      .from("script_assemblies")
      .update({ status: "final" })
      .eq("id", script_assembly_id);

    // ── STEP 10: Return ──
    const executionTimeMs = Date.now() - startTime;

    return json200({
      status: "promoted",
      status_reason: `Script promoted successfully in ${executionTimeMs}ms`,
      script_assembly_id,
      promoted_script_id: inserted.id,
      video_script_id: inserted.id,
      validation_status: assembly.validation_status,
      promoted_at: promotedAt,
      summary: {
        total_blocks: finalScriptBlocks.length,
        blocks_promoted: textParts.length,
        final_text_length: finalScriptText.length,
        source_generation_context_id: assembly.source_generation_context_id,
        source_blueprint_id: genCtx.source_blueprint_id || null,
        validation_version: assembly.validation_version,
      },
    });

  } catch (err) {
    if (err instanceof EdgeAuthError) {
      return new Response(JSON.stringify({
        status: "auth_error",
        error_code: err.code,
        status_reason: err.message,
        script_assembly_id: null,
        video_script_id: null,
        validation_status: null,
        promoted_at: null,
        summary: null,
      }), { status: err.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      status: "error",
      status_reason: `Unexpected error: ${(err as Error).message}`,
      script_assembly_id: null,
      video_script_id: null,
      validation_status: null,
      promoted_at: null,
      summary: null,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function json200(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
