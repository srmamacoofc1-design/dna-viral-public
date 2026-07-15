import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Issue {
  video_id: string;
  validation_step: string;
  issue_type: string;
  severity: string;
  field_name: string | null;
  current_value: string | null;
  expected_rule: string;
}

function addIssue(issues: Issue[], videoId: string, step: string, type: string, severity: string, field: string | null, value: any, rule: string) {
  issues.push({
    video_id: videoId,
    validation_step: step,
    issue_type: type,
    severity,
    field_name: field,
    current_value: value != null ? String(value).substring(0, 500) : null,
    expected_rule: rule,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const body = await req.json();
    const videoIds: string[] = body.video_ids || (body.video_id ? [body.video_id] : []);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // If no IDs provided, validate all completed videos
    let targetIds = videoIds;
    if (targetIds.length === 0) {
      const { data } = await supabase.from("videos").select("id").eq("status", "completed");
      targetIds = (data || []).map((v: any) => v.id);
    }

    if (targetIds.length === 0) {
      return new Response(JSON.stringify({ success: true, validated: 0, issues: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalIssues = 0;

    // Process in batches of 10
    for (let batchStart = 0; batchStart < targetIds.length; batchStart += 10) {
      const batchIds = targetIds.slice(batchStart, batchStart + 10);

      const [videosRes, blocksRes, transcriptsRes, semanticsRes, extractionLogsRes, ctaRes] = await Promise.all([
        supabase.from("videos").select("*").in("id", batchIds),
        supabase.from("video_blocks").select("*").in("video_id", batchIds).order("tempo_inicio"),
        supabase.from("video_transcripts").select("video_id").in("video_id", batchIds),
        supabase.from("block_semantic_patterns").select("video_id, block_id").in("video_id", batchIds),
        supabase.from("extraction_logs").select("video_id, field_name, confidence_score, source_type, origin_level, error_flag").in("video_id", batchIds),
        supabase.from("cta_profiles").select("*").in("video_id", batchIds),
      ]);

      const videos = videosRes.data || [];
      const allBlocks = blocksRes.data || [];
      const allTranscripts = transcriptsRes.data || [];
      const allSemantics = semanticsRes.data || [];
      const allExtrLogs = extractionLogsRes.data || [];
      const allCtas = ctaRes.data || [];

      for (const video of videos) {
        const issues: Issue[] = [];
        const vid = video.id;
        const blocks = allBlocks.filter((b: any) => b.video_id === vid);
        const hasTranscripts = allTranscripts.some((t: any) => t.video_id === vid);
        const semanticCount = allSemantics.filter((s: any) => s.video_id === vid).length;
        const extrLogs = allExtrLogs.filter((l: any) => l.video_id === vid);
        const cta = allCtas.find((c: any) => c.video_id === vid);

        // === 1. TIMESTAMP VALIDATION ===
        const step1 = "timestamps";

        if (video.tempo_gancho != null && Number(video.tempo_gancho) < 0) {
          addIssue(issues, vid, step1, "invalid_timestamp", "error", "tempo_gancho", video.tempo_gancho, "hook_time >= 0");
        }

        if (video.tempo_primeira_revelacao != null && video.tempo_gancho != null && Number(video.tempo_primeira_revelacao) < Number(video.tempo_gancho)) {
          addIssue(issues, vid, step1, "invalid_sequence", "warning", "tempo_primeira_revelacao", video.tempo_primeira_revelacao, "reveal_time >= hook_time");
        }

        if (video.tempo_payoff != null && video.tempo_primeira_revelacao != null && Number(video.tempo_payoff) < Number(video.tempo_primeira_revelacao)) {
          addIssue(issues, vid, step1, "invalid_sequence", "warning", "tempo_payoff", video.tempo_payoff, "payoff_time >= reveal_time");
        }

        for (const block of blocks) {
          if (Number(block.tempo_fim) <= Number(block.tempo_inicio)) {
            addIssue(issues, vid, step1, "invalid_block_duration", "error", `block_${block.bloco_id}`, `${block.tempo_inicio}-${block.tempo_fim}`, "tempo_fim > tempo_inicio");
          }
          if (video.duracao && Number(block.tempo_fim) > Number(video.duracao) + 1) {
            addIssue(issues, vid, step1, "block_exceeds_duration", "warning", `block_${block.bloco_id}`, `fim=${block.tempo_fim} dur=${video.duracao}`, "block.tempo_fim <= video.duracao");
          }
        }

        // === 2. BLOCK OVERLAP ===
        const step2 = "block_overlap";
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i];
            const b = blocks[j];
            const aStart = Number(a.tempo_inicio);
            const aEnd = Number(a.tempo_fim);
            const bStart = Number(b.tempo_inicio);
            const bEnd = Number(b.tempo_fim);
            // Overlap if they share more than 0.5s
            const overlapStart = Math.max(aStart, bStart);
            const overlapEnd = Math.min(aEnd, bEnd);
            if (overlapEnd - overlapStart > 0.5) {
              addIssue(issues, vid, step2, "block_overlap", "warning", `block_${a.bloco_id}_vs_${b.bloco_id}`,
                `${aStart.toFixed(3)}-${aEnd.toFixed(3)} ∩ ${bStart.toFixed(3)}-${bEnd.toFixed(3)}`,
                "blocks should not overlap more than 0.5s");
            }
          }
        }

        // === 3. REQUIRED FIELDS COHERENCE ===
        const step3 = "required_fields";

        if (video.status === "completed" && !hasTranscripts) {
          addIssue(issues, vid, step3, "missing_transcript", "error", "transcripts", "0", "completed video must have transcripts");
        }

        if (video.status === "completed" && blocks.length === 0) {
          addIssue(issues, vid, step3, "missing_blocks", "error", "blocks", "0", "completed video must have blocks");
        }

        if (video.status === "completed" && blocks.length > 0 && semanticCount === 0) {
          addIssue(issues, vid, step3, "missing_semantics", "warning", "block_semantic_patterns", "0", "completed video with blocks should have semantic patterns");
        }

        if (video.status === "completed" && blocks.length > 0 && semanticCount > 0 && semanticCount < blocks.length) {
          addIssue(issues, vid, step3, "partial_semantics", "warning", "block_semantic_patterns", `${semanticCount}/${blocks.length}`, "all blocks should have semantic patterns");
        }

        if (video.engagement_rate_relative != null && Number(video.engagement_rate_relative) > 0) {
          const hasViews = video.views != null && Number(video.views) > 0;
          const hasLikes = video.likes != null && Number(video.likes) > 0;
          const hasComments = video.comments != null && Number(video.comments) > 0;
          if (!hasViews && !hasLikes && !hasComments) {
            addIssue(issues, vid, step3, "engagement_without_metrics", "error", "engagement_rate_relative", video.engagement_rate_relative, "engagement_rate_relative > 0 requires at least one engagement metric");
          }
        }

        // === 4. CTA COHERENCE ===
        const step4 = "cta_coherence";

        if (cta) {
          if (cta.cta_position_seconds != null && video.duracao != null && Number(cta.cta_position_seconds) > Number(video.duracao)) {
            addIssue(issues, vid, step4, "cta_after_end", "error", "cta_position_seconds", cta.cta_position_seconds, "CTA position must be within video duration");
          }

          if (cta.cta_position_seconds != null && video.tempo_gancho != null && Number(cta.cta_position_seconds) < Number(video.tempo_gancho)) {
            addIssue(issues, vid, step4, "cta_before_hook", "warning", "cta_position_seconds", `cta=${cta.cta_position_seconds} hook=${video.tempo_gancho}`, "CTA before hook is unusual");
          }

          if ((!cta.cta_text || cta.cta_text.trim() === "") && cta.cta_type) {
            addIssue(issues, vid, step4, "cta_empty_text", "warning", "cta_text", `type=${cta.cta_type}`, "CTA with type but empty text");
          }
        }

        // === 5. RAW VS CALCULATED COHERENCE ===
        const step5 = "raw_vs_calculated";

        // Check weighted_score with zero engagement_rate
        const engRate = Number(video.engagement_rate_relative) || 0;
        if (engRate === 0) {
          const hasWeighted = extrLogs.some((l: any) => l.origin_level === "calculated" && l.field_name === "weighted_scores" && !l.error_flag);
          if (hasWeighted) {
            addIssue(issues, vid, step5, "weighted_without_engagement", "warning", "weighted_scores", `engagement_rate_relative=${engRate}`, "weighted scores require engagement_rate_relative > 0");
          }
        }

        // Check high confidence on null fields
        for (const log of extrLogs) {
          if (log.confidence_score > 80 && log.error_flag) {
            addIssue(issues, vid, step5, "high_confidence_null", "error", log.field_name, `confidence=${log.confidence_score}`, "high confidence should not have error_flag=true");
          }
        }

        // === PERSIST ISSUES ===
        // Delete old reports for this video
        await supabase.from("data_consistency_reports").delete().eq("video_id", vid);

        if (issues.length > 0) {
          for (let i = 0; i < issues.length; i += 100) {
            await supabase.from("data_consistency_reports").insert(issues.slice(i, i + 100));
          }
        }

        totalIssues += issues.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      validated: targetIds.length,
      issues: totalIssues,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("validate-data-consistency error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
