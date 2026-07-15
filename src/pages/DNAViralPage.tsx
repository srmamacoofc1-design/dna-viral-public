import { useEffect, useState } from 'react';
import { DNABaseV1 } from '@/components/report/DNABaseV1';
import { AppLayout } from '@/components/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { isEligibleForDNA, DNA_WEIGHT_CONFIG, TIPO_BLOCOS, EMOCOES_EXTENDED } from '@/types/video';
import type { EngagementStatus, Video, VideoBlock } from '@/types/video';
import type { Tables } from '@/integrations/supabase/types';
import type { ViralScoreResult, ViralScoreStats } from '@/lib/viral-score';
import { Dna, ShieldAlert, Eye, Heart, MessageCircle, Trophy, Activity, BarChart3, TrendingUp, Zap, Download, Percent, Clock, CheckCircle2, AlertTriangle, Play, RotateCcw, FileDown } from 'lucide-react';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

type VideoRow = Tables<'videos'>;

interface EligibleVideo {
  id: string;
  titulo: string;
  views: number;
  likes: number;
  comments: number;
  duracao: number;
  blocks: VideoBlock[];
  gancho_detectado?: boolean;
  tempo_gancho?: number;
  tempo_payoff?: number;
  loop_detectado?: boolean;
  emocao_predominante?: string;
  intensidade_emocional?: string;
  // Narrative Intelligence
  first_impact_time?: number;
  hook_text?: string;
  hook_keywords?: string[];
  hook_phrase_pattern?: string;
  hook_type_verbal?: string;
  hook_emotion_verbal?: string;
  hook_emotion_intensity?: number;
  narrative_progression_type?: string;
  micro_turn_count?: number;
  micro_turn_types?: string[];
  payoff_text?: string;
  payoff_type?: string;
  payoff_emotion?: string;
  cta_text?: string;
  cta_type?: string;
  cta_position_time?: number;
  cta_intrusion_score?: number;
  cta_flow_break_score?: number;
}

function deriveEngagementStatus(row: any): EngagementStatus {
  if (row.engagement_status && ['ausente', 'informado', 'importado_pendente', 'importado_confirmado'].includes(row.engagement_status)) {
    return row.engagement_status;
  }
  const v = Number(row.views) || 0;
  const l = Number(row.likes) || 0;
  const c = Number(row.comments) || 0;
  if (v === 0 && l === 0 && c === 0) return 'ausente';
  return 'informado';
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `há ${seconds} segundos`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} minuto${minutes > 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} hora${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}

function getRecalcStatus(audit: AuditInfo): { label: string; color: string } {
  if (!audit.lastRecalculation) return { label: '—', color: 'text-muted-foreground' };
  const peso = audit.totalPeso ? parseFloat(audit.totalPeso) : 0;
  const age = Date.now() - new Date(audit.lastRecalculation).getTime();
  const isWeightOk = Math.abs(peso - 100) < 0.1;
  const isStale = age > 24 * 60 * 60 * 1000;
  if (!isWeightOk) return { label: 'Divergente', color: 'text-amber-500' };
  if (isStale) return { label: 'Desatualizado', color: 'text-amber-500' };
  return { label: 'OK', color: 'text-emerald-500' };
}

interface AuditInfo {
  lastRecalculation: string | null;
  totalRecalculated: string | null;
  totalScore: string | null;
  totalPeso: string | null;
}

interface EngagementGroup {
  completo: number;
  parcial: number;
  ausente: number;
}

export default function DNAViralPage() {
  const [eligible, setEligible] = useState<EligibleVideo[]>([]);
  const [rawRows, setRawRows] = useState<VideoRow[]>([]);
  const [totalVideos, setTotalVideos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<AuditInfo>({ lastRecalculation: null, totalRecalculated: null, totalScore: null, totalPeso: null });
  const [engagementGroups, setEngagementGroups] = useState<EngagementGroup>({ completo: 0, parcial: 0, ausente: 0 });
  const [engagementSources, setEngagementSources] = useState<Record<string, number>>({});
  const [totalAllVideos, setTotalAllVideos] = useState(0);

  // Batch block semantics state
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ processed: number; total: number; errors: number } | null>(null);
  const [batchLog, setBatchLog] = useState<string[]>([]);

  // Block semantic consolidation state
  type BlockConsolidation = Record<string, {
    total_blocks: number;
    total_videos: number;
    top_keywords: Array<{ word: string; count: number }>;
    top_emotional_words: Array<{ word: string; count: number }>;
    top_strong_phrases: Array<{ word: string; count: number }>;
    top_rare_words?: Array<{ word: string; count: number }>;
    top_dominant_words?: Array<{ word: string; count: number }>;
    dominant_emotion: { value: string; count: number; total: number } | null;
    dominant_tone: { value: string; count: number; total: number } | null;
    avg_intensity: number | null;
    avg_engagement_rate: number | null;
    engagement_weighted_words?: Array<{ word: string; score: number; count: number }>;
    engagement_weighted_phrases?: Array<{ word: string; score: number; count: number }>;
  }>;
  const [blockConsolidation, setBlockConsolidation] = useState<BlockConsolidation | null>(null);
  const [consolidationLoading, setConsolidationLoading] = useState(false);
  const [ctaConsolidation, setCtaConsolidation] = useState<{
    total: number;
    top_types: Array<{ type: string; count: number }>;
    top_emotions: Array<{ emotion: string; count: number }>;
    top_actions: Array<{ action: string; count: number }>;
    avg_position: number | null;
    avg_intensity?: number | null;
  } | null>(null);

  // Granular consolidation state
  type GranularConsolidation = Record<string, {
    total_words: number;
    total_phrases: number;
    total_videos: number;
    top_weighted_words: Array<{ word: string; total_score: number; total_freq: number; emotional: number; rare: number; dominant: number; impact: number }>;
    phrase_categories: Array<{ category: string; count: number }>;
    top_strength_phrases: Array<{ phrase: string; category: string; strength: number; weighted: number; is_emotional: boolean }>;
    top_viral_phrases: Array<{ phrase: string; category: string; strength: number; weighted: number }>;
    avg_phrase_strength: number | null;
  }>;
  const [granularConsolidation, setGranularConsolidation] = useState<GranularConsolidation | null>(null);

  const loadConsolidation = async () => {
    setConsolidationLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('consolidate-block-patterns', {
        body: { persist: true },
      });
      if (!error && data?.consolidation) {
        setBlockConsolidation(data.consolidation);
      }
      if (!error && data?.cta_consolidation) {
        setCtaConsolidation(data.cta_consolidation);
      }
      if (!error && data?.granular) {
        setGranularConsolidation(data.granular);
      }
    } catch (e) {
      console.error('Failed to load consolidation:', e);
    }
    setConsolidationLoading(false);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Fetch all completed videos
      const { data: videos } = await supabase.from('videos').select('*').eq('status', 'completed');
      if (!videos) { setLoading(false); return; }
      setTotalVideos(videos.length);

      // Count all videos (any status) for context
      const { count: allCount } = await supabase.from('videos').select('*', { count: 'exact', head: true });
      setTotalAllVideos(allCount || videos.length);

      // Engagement groups (from all completed videos)
      let completo = 0, parcial = 0, ausente = 0;
      videos.forEach(v => {
        const hasV = Number(v.views) > 0;
        const hasL = Number(v.likes) > 0;
        const hasC = Number(v.comments) > 0;
        if (hasV && hasL && hasC) completo++;
        else if (hasV || hasL || hasC) parcial++;
        else ausente++;
      });
      setEngagementGroups({ completo, parcial, ausente });

      // Engagement sources from metadata
      const { data: srcRows } = await supabase
        .from('video_metadata')
        .select('video_id, chave, valor')
        .in('chave', ['scrape_status', 'engagement_source']);
      const sources: Record<string, number> = {};
      if (srcRows) {
        srcRows.forEach(r => {
          if (r.chave === 'engagement_source' || r.chave === 'scrape_status') {
            const key = r.valor || 'desconhecido';
            sources[key] = (sources[key] || 0) + 1;
          }
        });
      }
      setEngagementSources(sources);

      const eligibleRows = videos.filter(v => {
        const es = deriveEngagementStatus(v);
        return isEligibleForDNA({ views: Number(v.views), likes: Number(v.likes), comments: Number(v.comments), engagement_status: es });
      });

      if (eligibleRows.length === 0) { setEligible([]); setRawRows([]); setLoading(false); return; }

      // Fetch blocks for all eligible videos
      const ids = eligibleRows.map(v => v.id);
      const { data: allBlocks } = await supabase.from('video_blocks').select('*').in('video_id', ids).order('tempo_inicio');

      const result: EligibleVideo[] = eligibleRows.map(v => {
        const vBlocks = (allBlocks || []).filter(b => b.video_id === v.id).map(b => ({
          ...b,
          tempo_inicio: Number(b.tempo_inicio),
          tempo_fim: Number(b.tempo_fim),
          emocao: b.emocao as any,
          tipo_bloco: b.tipo_bloco as any,
          funcao_narrativa: b.funcao_narrativa || '',
        }));
        return {
          id: v.id,
          titulo: v.titulo || 'Sem título',
          views: Number(v.views) || 0,
          likes: Number(v.likes) || 0,
          comments: Number(v.comments) || 0,
          duracao: Number(v.duracao) || 0,
          blocks: vBlocks,
          gancho_detectado: v.gancho_detectado ?? undefined,
          tempo_gancho: v.tempo_gancho != null ? Number(v.tempo_gancho) : undefined,
          tempo_payoff: v.tempo_payoff != null ? Number(v.tempo_payoff) : undefined,
          loop_detectado: v.loop_detectado ?? undefined,
          emocao_predominante: v.emocao_predominante ?? undefined,
          intensidade_emocional: v.intensidade_emocional ?? undefined,
          first_impact_time: (v as any).first_impact_time != null ? Number((v as any).first_impact_time) : undefined,
          hook_text: (v as any).hook_text ?? undefined,
          hook_keywords: (v as any).hook_keywords ?? undefined,
          hook_phrase_pattern: (v as any).hook_phrase_pattern ?? undefined,
          hook_type_verbal: (v as any).hook_type_verbal ?? undefined,
          hook_emotion_verbal: (v as any).hook_emotion_verbal ?? undefined,
          hook_emotion_intensity: (v as any).hook_emotion_intensity != null ? Number((v as any).hook_emotion_intensity) : undefined,
          narrative_progression_type: (v as any).narrative_progression_type ?? undefined,
          micro_turn_count: (v as any).micro_turn_count != null ? Number((v as any).micro_turn_count) : undefined,
          micro_turn_types: (v as any).micro_turn_types ?? undefined,
          payoff_text: (v as any).payoff_text ?? undefined,
          payoff_type: (v as any).payoff_type ?? undefined,
          payoff_emotion: (v as any).payoff_emotion ?? undefined,
          cta_text: (v as any).cta_text ?? undefined,
          cta_type: (v as any).cta_type ?? undefined,
          cta_position_time: (v as any).cta_position_time != null ? Number((v as any).cta_position_time) : undefined,
          cta_intrusion_score: (v as any).cta_intrusion_score != null ? Number((v as any).cta_intrusion_score) : undefined,
          cta_flow_break_score: (v as any).cta_flow_break_score != null ? Number((v as any).cta_flow_break_score) : undefined,
        };
      });

      setEligible(result);
      setRawRows(eligibleRows);

      // Fetch audit metadata (dual-read for backward compat with historical keys)
      const auditKeys = ['last_engagement_recalculation', 'last_viral_score_recalculation', 'total_videos_recalculated', 'total_score', 'total_peso'];
      const { data: auditRows } = await supabase
        .from('video_metadata')
        .select('chave, valor')
        .in('chave', auditKeys);
      if (auditRows) {
        const get = (k: string) => auditRows.find(r => r.chave === k)?.valor || null;
        setAudit({
          lastRecalculation: get('last_engagement_recalculation') || get('last_viral_score_recalculation'),
          totalRecalculated: get('total_videos_recalculated'),
          totalScore: get('total_score'),
          totalPeso: get('total_peso'),
        });
      }

      setLoading(false);

      // Fetch block semantic consolidation
      loadConsolidation();
    })();
  }, []);

  // === Engagement Ranking (read from persisted data) ===
  const engagementRanking: ViralScoreResult[] = eligible
    .map(v => {
      const row = rawRows.find(r => r.id === v.id);
      return {
        id: v.id,
        titulo: v.titulo,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        engagement_rate: Number(row?.engagement_rate) || 0,
        engagement_rate_relative: Number(row?.engagement_rate_relative) || 0,
        dataset_weight_pct: Number(row?.dataset_weight_pct) || 0,
      };
    })
    .sort((a, b) => b.engagement_rate_relative - a.engagement_rate_relative);

  const engagementStats: ViralScoreStats = {
    max_views: Math.max(...eligible.map(v => v.views), 1),
    max_likes: Math.max(...eligible.map(v => v.likes), 1),
    max_comments: Math.max(...eligible.map(v => v.comments), 1),
    max_engagement_rate: Math.max(...engagementRanking.map(v => v.engagement_rate), 0.0001),
    total_engagement_relative: engagementRanking.reduce((s, v) => s + v.engagement_rate_relative, 0),
    total_dataset_weight: engagementRanking.reduce((s, v) => s + v.dataset_weight_pct, 0),
    scoring_method: "engagement_rate_normalized",
  };

  // === Totals ===
  const totalViews = eligible.reduce((s, v) => s + v.views, 0);
  const totalLikes = eligible.reduce((s, v) => s + v.likes, 0);
  const totalComments = eligible.reduce((s, v) => s + v.comments, 0);

  // === Ranking for other sections ===
  const ranking = engagementRanking.map(vr => {
    const orig = eligible.find(e => e.id === vr.id)!;
    return { ...orig, ...vr, weight: vr.dataset_weight_pct };
  });

  // === Consolidated narrative metrics ===
  const allBlocks = eligible.flatMap(v => v.blocks);

  // Average narrative structure (% of time per block type across all videos)
  const avgStructure = (() => {
    const totalDur = eligible.reduce((s, v) => s + v.duracao, 0);
    if (totalDur === 0) return [];
    const typeTime = new Map<string, number>();
    allBlocks.forEach(b => {
      const dur = b.tempo_fim - b.tempo_inicio;
      typeTime.set(b.tipo_bloco, (typeTime.get(b.tipo_bloco) || 0) + dur);
    });
    return TIPO_BLOCOS.filter(t => typeTime.has(t.value)).map(t => ({
      name: t.label,
      value: +((typeTime.get(t.value)! / totalDur) * 100).toFixed(1),
      color: t.color,
    }));
  })();

  // Average rhythm metrics
  const avgRhythm = (() => {
    if (eligible.length === 0) return null;
    const durations = eligible.map(v => v.duracao);
    const avgDuracao = durations.reduce((a, b) => a + b, 0) / eligible.length;
    const blockCounts = eligible.map(v => v.blocks.length);
    const avgBlocos = blockCounts.reduce((a, b) => a + b, 0) / eligible.length;
    const densities = eligible.map(v => v.duracao > 0 ? v.blocks.length / v.duracao : 0);
    const avgDensidade = densities.reduce((a, b) => a + b, 0) / eligible.length;

    // Avg block duration
    const blockDurs = allBlocks.map(b => b.tempo_fim - b.tempo_inicio);
    const avgBlockDur = blockDurs.length > 0 ? blockDurs.reduce((a, b) => a + b, 0) / blockDurs.length : 0;

    return { avgDuracao, avgBlocos, avgDensidade, avgBlockDur };
  })();

  // Average hook & payoff positions
  const avgHookPayoff = (() => {
    // Hook médio = duração média do bloco HOOK (tempo_fim - tempo_inicio)
    const hookDurations: number[] = [];
    const hookStarts: number[] = [];
    eligible.forEach(v => {
      const hookBlock = v.blocks.find(b => b.tipo_bloco === 'hook');
      if (hookBlock) {
        hookDurations.push(hookBlock.tempo_fim - hookBlock.tempo_inicio);
        hookStarts.push(hookBlock.tempo_inicio);
      }
    });

    const firstImpacts = eligible.filter(v => v.first_impact_time != null).map(v => v.first_impact_time!);

    const payoffs = eligible.filter(v => v.tempo_payoff !== undefined && v.duracao > 0);
    const avgHookTime = hookDurations.length > 0 ? hookDurations.reduce((a, b) => a + b, 0) / hookDurations.length : null;
    const avgHookPct = avgHookTime !== null && eligible.length > 0
      ? (avgHookTime / (eligible.reduce((s, v) => s + v.duracao, 0) / eligible.length)) * 100 : null;
    const avgPayoffPct = payoffs.length > 0
      ? payoffs.reduce((s, v) => s + (v.tempo_payoff! / v.duracao) * 100, 0) / payoffs.length : null;
    const avgPayoffTime = payoffs.length > 0 ? payoffs.reduce((s, v) => s + v.tempo_payoff!, 0) / payoffs.length : null;

    const median = (arr: number[]) => {
      if (arr.length === 0) return null;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };

    return {
      avgHookPct, avgPayoffPct, avgHookTime, avgPayoffTime,
      hookCount: hookDurations.length, payoffCount: payoffs.length,
      // Expanded hook model
      hookStartMean: hookStarts.length > 0 ? hookStarts.reduce((a, b) => a + b, 0) / hookStarts.length : null,
      hookStartMin: hookStarts.length > 0 ? Math.min(...hookStarts) : null,
      hookStartMax: hookStarts.length > 0 ? Math.max(...hookStarts) : null,
      hookStartMedian: median(hookStarts),
      hookDurationMin: hookDurations.length > 0 ? Math.min(...hookDurations) : null,
      hookDurationMax: hookDurations.length > 0 ? Math.max(...hookDurations) : null,
      hookDurationMedian: median(hookDurations),
      firstImpactMean: firstImpacts.length > 0 ? firstImpacts.reduce((a, b) => a + b, 0) / firstImpacts.length : null,
      firstImpactMin: firstImpacts.length > 0 ? Math.min(...firstImpacts) : null,
      firstImpactMax: firstImpacts.length > 0 ? Math.max(...firstImpacts) : null,
      firstImpactMedian: median(firstImpacts),
      firstImpactCount: firstImpacts.length,
    };
  })();

  // Verbal DNA consolidation
  const verbalDNA = (() => {
    const hookKeywords = new Map<string, number>();
    const phrasePatterns = new Map<string, number>();
    const hookTypes = new Map<string, number>();
    const ctaTypes = new Map<string, number>();
    const hookEmotions = new Map<string, number>();

    eligible.forEach(v => {
      if (v.hook_keywords && Array.isArray(v.hook_keywords)) {
        (v.hook_keywords as string[]).forEach(kw => hookKeywords.set(kw, (hookKeywords.get(kw) || 0) + 1));
      }
      if (v.hook_phrase_pattern) phrasePatterns.set(v.hook_phrase_pattern, (phrasePatterns.get(v.hook_phrase_pattern) || 0) + 1);
      if (v.hook_type_verbal) hookTypes.set(v.hook_type_verbal, (hookTypes.get(v.hook_type_verbal) || 0) + 1);
      if (v.cta_type) ctaTypes.set(v.cta_type, (ctaTypes.get(v.cta_type) || 0) + 1);
      if (v.hook_emotion_verbal) hookEmotions.set(v.hook_emotion_verbal, (hookEmotions.get(v.hook_emotion_verbal) || 0) + 1);
    });

    const sortMap = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]);

    const emotionIntensities = eligible.filter(v => v.hook_emotion_intensity != null).map(v => v.hook_emotion_intensity!);
    const avgEmotionIntensity = emotionIntensities.length > 0 ? emotionIntensities.reduce((a, b) => a + b, 0) / emotionIntensities.length : null;

    const ctaIntrusions = eligible.filter(v => v.cta_intrusion_score != null).map(v => v.cta_intrusion_score!);
    const avgCtaIntrusion = ctaIntrusions.length > 0 ? ctaIntrusions.reduce((a, b) => a + b, 0) / ctaIntrusions.length : null;

    const ctaFlowBreaks = eligible.filter(v => v.cta_flow_break_score != null).map(v => v.cta_flow_break_score!);
    const avgCtaFlowBreak = ctaFlowBreaks.length > 0 ? ctaFlowBreaks.reduce((a, b) => a + b, 0) / ctaFlowBreaks.length : null;

    const progressionTypes = new Map<string, number>();
    eligible.forEach(v => {
      if (v.narrative_progression_type) progressionTypes.set(v.narrative_progression_type, (progressionTypes.get(v.narrative_progression_type) || 0) + 1);
    });

    return {
      topKeywords: sortMap(hookKeywords).slice(0, 10),
      topPhrasePatterns: sortMap(phrasePatterns),
      dominantHookTypes: sortMap(hookTypes),
      dominantCtaTypes: sortMap(ctaTypes),
      dominantHookEmotions: sortMap(hookEmotions),
      avgEmotionIntensity,
      avgCtaIntrusion,
      avgCtaFlowBreak,
      progressionTypes: sortMap(progressionTypes),
      hasData: hookKeywords.size > 0 || phrasePatterns.size > 0 || hookTypes.size > 0 || ctaTypes.size > 0,
    };
  })();

  // Average narrative turns
  const avgTurns = (() => {
    if (eligible.length === 0) return { avgTurns: 0, avgTurnTime: 0 };
    let totalTurns = 0;
    let totalTurnTimes: number[] = [];
    eligible.forEach(v => {
      const sorted = [...v.blocks].sort((a, b) => a.tempo_inicio - b.tempo_inicio);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].tipo_bloco !== sorted[i - 1].tipo_bloco) {
          totalTurns++;
          totalTurnTimes.push(sorted[i].tempo_inicio - sorted[i - 1].tempo_inicio);
        }
      }
    });
    return {
      avgTurns: totalTurns / eligible.length,
      avgTurnTime: totalTurnTimes.length > 0 ? totalTurnTimes.reduce((a, b) => a + b, 0) / totalTurnTimes.length : 0,
    };
  })();

  // Emotional distribution across the base
  const emotionDistribution = (() => {
    const totalDur = allBlocks.reduce((s, b) => s + (b.tempo_fim - b.tempo_inicio), 0);
    if (totalDur === 0) return [];
    const emoTime = new Map<string, number>();
    allBlocks.forEach(b => {
      if (b.emocao) {
        const dur = b.tempo_fim - b.tempo_inicio;
        emoTime.set(b.emocao, (emoTime.get(b.emocao) || 0) + dur);
      }
    });
    const emoColors: Record<string, string> = {
      curiosidade: '#3B82F6', surpresa: '#F59E0B', medo: '#7C3AED',
      tensao: '#EF4444', alivio: '#22C55E', expectativa: '#EC4899',
      impacto: '#F97316', humor: '#10B981', suspense: '#6366F1', choque: '#DC2626',
    };
    return Array.from(emoTime.entries())
      .map(([emo, dur]) => ({
        name: EMOCOES_EXTENDED.find(e => e.value === emo)?.label || emo,
        icon: EMOCOES_EXTENDED.find(e => e.value === emo)?.icon || '',
        value: +((dur / totalDur) * 100).toFixed(1),
        color: emoColors[emo] || '#94A3B8',
      }))
      .sort((a, b) => b.value - a.value);
  })();

  // Dominant patterns
  const dominantPatterns = (() => {
    const patterns: string[] = [];
    if (avgHookPayoff.hookCount === eligible.length && eligible.length > 0) patterns.push('Todos os vídeos têm gancho detectado');
    else if (avgHookPayoff.hookCount > 0) patterns.push(`${avgHookPayoff.hookCount}/${eligible.length} vídeos com gancho`);
    if (avgHookPayoff.avgHookPct !== null && avgHookPayoff.avgHookPct < 10) patterns.push('Hook posicionado nos primeiros 10% do vídeo');
    const loopCount = eligible.filter(v => v.loop_detectado).length;
    if (loopCount > 0) patterns.push(`${loopCount}/${eligible.length} vídeos com loop detectado`);
    if (avgRhythm && avgRhythm.avgDensidade > 0.2) patterns.push('Ritmo narrativo alto (>0.2 blocos/s)');
    else if (avgRhythm && avgRhythm.avgDensidade > 0.1) patterns.push('Ritmo narrativo médio');
    if (emotionDistribution.length > 0) patterns.push(`Emoção dominante: ${emotionDistribution[0].icon} ${emotionDistribution[0].name} (${emotionDistribution[0].value}%)`);
    if (avgTurns.avgTurns > 5) patterns.push(`Média de ${avgTurns.avgTurns.toFixed(3)} viradas narrativas`);
    return patterns;
  })();

  // Chart tooltip style
  const tooltipStyle = { backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--foreground))' };

  // === Batch block semantics runner ===
  const runBatchBlockSemantics = async (forceReprocess = false) => {
    setBatchRunning(true);
    setBatchLog([]);
    setBatchProgress({ processed: 0, total: 0, errors: 0 });

    let offset = 0;
    const batchSize = 5;
    let totalProcessed = 0;
    let totalErrors = 0;
    let totalEligible = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        setBatchLog(prev => [...prev, `Lote offset=${offset}...`]);
        const { data, error } = await supabase.functions.invoke('batch-extract-block-semantics', {
          body: { batch_size: batchSize, offset, force_reprocess: forceReprocess },
        });

        if (error) {
          setBatchLog(prev => [...prev, `❌ Erro: ${error.message}`]);
          hasMore = false;
          break;
        }

        totalEligible = data.total_eligible || 0;
        totalProcessed += data.success_count || 0;
        totalErrors += data.error_count || 0;

        setBatchProgress({ processed: totalProcessed, total: totalEligible, errors: totalErrors });

        if (data.results) {
          data.results.forEach((r: any) => {
            if (r.status === 'success') {
              setBatchLog(prev => [...prev, `✅ ${r.video_id.slice(0, 8)}... — ${r.blocks_processed} blocos, ${r.words_extracted || '?'} palavras, ${r.phrases_extracted || '?'} frases`]);
            } else {
              setBatchLog(prev => [...prev, `❌ ${r.video_id.slice(0, 8)}... — ${r.error}`]);
            }
          });
        }

        if (data.next_offset != null) {
          offset = data.next_offset;
        } else {
          hasMore = false;
        }
      } catch (err) {
        setBatchLog(prev => [...prev, `❌ Exceção: ${err instanceof Error ? err.message : 'unknown'}`]);
        hasMore = false;
      }
    }

    setBatchLog(prev => [...prev, `🏁 Concluído: ${totalProcessed} processados, ${totalErrors} erros`]);
    setBatchLog(prev => [...prev, `📊 Consolidando padrões verbais...`]);
    await loadConsolidation();
    setBatchLog(prev => [...prev, `✅ Consolidação verbal persistida`]);
    setBatchRunning(false);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-4 py-8">
          <p className="text-center text-muted-foreground py-10">Carregando dados da base viral...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <Dna className="w-6 h-6 text-primary" />
              <h1 className="font-semibold text-2xl text-foreground">DNA Viral — Consolidação da Base</h1>
            </div>
            <Button variant="outline" size="sm" onClick={() => exportPageAsPDF('DNA Viral — Consolidação da Base')} className="print:hidden">
              <FileDown className="w-4 h-4 mr-1" /> Exportar PDF
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Consolidação de métricas, ritmo, estrutura e engajamento de todos os vídeos elegíveis da biblioteca-base.
          </p>
        </div>

        {/* === Extração Semântica por Bloco — Batch === */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3 print:hidden">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2">
              <Zap className="w-4 h-4" /> Verbal DNA Engine — Extração em Lote
            </h3>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => runBatchBlockSemantics(false)}
                disabled={batchRunning}
              >
                <Play className="w-3 h-3 mr-1" />
                {batchRunning ? 'Processando...' : 'Processar Novos'}
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => runBatchBlockSemantics(true)}
                disabled={batchRunning}
              >
                <RotateCcw className="w-3 h-3 mr-1" /> Reprocessar Todos
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Extrai palavras-chave, emoções, tom verbal, frases de impacto, palavras raras/dominantes e CTA de cada bloco narrativo. Pondera por engagement_rate_relative e persiste consolidação global.
          </p>
          {batchProgress && (
            <div className="space-y-2">
              <Progress value={batchProgress.total > 0 ? (batchProgress.processed / batchProgress.total) * 100 : 0} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {batchProgress.processed}/{batchProgress.total} processados
                {batchProgress.errors > 0 && <span className="text-destructive ml-2">({batchProgress.errors} erros)</span>}
              </p>
            </div>
          )}
          {batchLog.length > 0 && (
            <div className="bg-secondary/30 rounded-md p-3 max-h-40 overflow-y-auto">
              {batchLog.map((line, i) => (
                <p key={i} className="text-xs text-muted-foreground font-mono">{line}</p>
              ))}
            </div>
          )}
        </div>

        {/* === VERBAL DNA ENGINE — Ranking por Camada === */}
        {blockConsolidation && Object.keys(blockConsolidation).length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2">
              <Trophy className="w-4 h-4" /> Verbal DNA Engine — Ranking por Camada Narrativa
            </h3>
            <p className="text-xs text-muted-foreground">
              Palavras, frases, emoções e tons verbais por tipo de bloco, ponderados por engagement_rate_relative. Dados persistidos em verbal_layer_patterns.
            </p>

            <div className="space-y-5">
              {['hook', 'setup', 'desenvolvimento', 'tensao', 'revelacao', 'payoff', 'transicao', 'loop'].map(blockType => {
                const data = blockConsolidation[blockType];
                if (!data || data.total_blocks === 0) return null;

                const typeLabels: Record<string, string> = {
                  hook: '🎣 Hook', setup: '📐 Setup', desenvolvimento: '📈 Desenvolvimento',
                  tensao: '😰 Tensão', revelacao: '💡 Revelação', payoff: '🎯 Payoff',
                  transicao: '🔄 Transição', loop: '🔁 Loop',
                };
                const maxKwCount = data.top_keywords[0]?.count || 1;

                return (
                  <div key={blockType} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-foreground">{typeLabels[blockType] || blockType}</h4>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{data.total_blocks} blocos</span>
                        <span>{data.total_videos} vídeos</span>
                        {data.avg_engagement_rate != null && (
                          <span className="text-primary font-medium">
                            Eng. Rate médio: {(data.avg_engagement_rate * 100).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Keywords bar chart */}
                    {data.top_keywords.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Palavras-chave</p>
                        {data.top_keywords.slice(0, 8).map((kw) => (
                          <div key={kw.word} className="flex items-center gap-2">
                            <span className="text-xs text-foreground w-24 truncate font-mono">{kw.word}</span>
                            <div className="flex-1 h-3 bg-secondary/40 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary/70 transition-all"
                                style={{ width: `${(kw.count / maxKwCount) * 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-6 text-right">{kw.count}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Engagement-weighted words */}
                    {data.engagement_weighted_words && data.engagement_weighted_words.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">📊 Palavras ponderadas por Engagement Rate</p>
                        <div className="flex flex-wrap gap-1">
                          {data.engagement_weighted_words.slice(0, 10).map(vw => (
                            <span key={vw.word} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                              {vw.word} <span className="text-muted-foreground">({vw.score.toFixed(2)})</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Emotional words + rare + dominant */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {data.top_emotional_words.length > 0 && (
                        <>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Emocionais:</span>
                          {data.top_emotional_words.slice(0, 6).map(ew => (
                            <span key={ew.word} className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                              {ew.word} ({ew.count})
                            </span>
                          ))}
                        </>
                      )}
                    </div>

                    {data.top_rare_words && data.top_rare_words.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Raras:</span>
                        {data.top_rare_words.slice(0, 5).map(rw => (
                          <span key={rw.word} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground">
                            {rw.word} ({rw.count})
                          </span>
                        ))}
                      </div>
                    )}

                    {data.top_dominant_words && data.top_dominant_words.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Dominantes:</span>
                        {data.top_dominant_words.slice(0, 5).map(dw => (
                          <span key={dw.word} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground font-semibold">
                            {dw.word} ({dw.count})
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Dominant emotion + tone + intensity */}
                    <div className="flex flex-wrap gap-3 text-[10px]">
                      {data.dominant_emotion && (
                        <span className="px-2 py-0.5 rounded-md bg-accent text-accent-foreground">
                          Emoção: {data.dominant_emotion.value} ({data.dominant_emotion.count}/{data.dominant_emotion.total})
                        </span>
                      )}
                      {data.dominant_tone && (
                        <span className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                          Tom: {data.dominant_tone.value} ({data.dominant_tone.count}/{data.dominant_tone.total})
                        </span>
                      )}
                      {data.avg_intensity != null && (
                        <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                          Intensidade média: {data.avg_intensity.toFixed(1)}/5
                        </span>
                      )}
                    </div>

                    {/* Strong phrases */}
                    {data.top_strong_phrases.length > 0 && (
                      <div className="space-y-0.5 mt-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Frases de impacto</p>
                        {data.top_strong_phrases.slice(0, 3).map(sp => (
                          <p key={sp.word} className="text-xs text-foreground/80 italic pl-2 border-l-2 border-primary/30">
                            "{sp.word}" <span className="text-muted-foreground not-italic">×{sp.count}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Engagement-weighted phrases */}
                    {data.engagement_weighted_phrases && data.engagement_weighted_phrases.length > 0 && (
                      <div className="space-y-0.5 mt-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">📊 Frases ponderadas por Engagement Rate</p>
                        {data.engagement_weighted_phrases.slice(0, 3).map(vp => (
                          <p key={vp.word} className="text-xs text-primary/80 italic pl-2 border-l-2 border-primary/50">
                            "{vp.word}" <span className="text-muted-foreground not-italic">score: {vp.score.toFixed(2)}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {blockType !== 'loop' && <div className="border-t border-border/50" />}
                  </div>
                );
              })}
            </div>

            {/* CTA Consolidation */}
            {ctaConsolidation && ctaConsolidation.total > 0 && (
              <div className="border-t border-border pt-4 space-y-3">
                <h4 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2">
                  📣 Consolidação CTA ({ctaConsolidation.total} vídeos com CTA)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  {ctaConsolidation.top_types.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Tipos dominantes</span>
                      {ctaConsolidation.top_types.slice(0, 3).map(t => (
                        <p key={t.type} className="font-medium text-foreground">{t.type} ({t.count})</p>
                      ))}
                    </div>
                  )}
                  {ctaConsolidation.top_emotions.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Emoções CTA</span>
                      {ctaConsolidation.top_emotions.slice(0, 3).map(e => (
                        <p key={e.emotion} className="font-medium text-foreground">{e.emotion} ({e.count})</p>
                      ))}
                    </div>
                  )}
                  {ctaConsolidation.top_actions.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Ações CTA</span>
                      {ctaConsolidation.top_actions.slice(0, 3).map(a => (
                        <p key={a.action} className="font-medium text-foreground">{a.action} ({a.count})</p>
                      ))}
                    </div>
                  )}
                  {ctaConsolidation.avg_position != null && (
                    <div>
                      <span className="text-muted-foreground">Posição média CTA</span>
                      <p className="font-bold text-foreground text-sm">{ctaConsolidation.avg_position.toFixed(1)}s</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* === GRANULAR LINGUISTIC ANALYSIS === */}
        {granularConsolidation && Object.keys(granularConsolidation).length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2">
              <Activity className="w-4 h-4" /> Análise Linguística Granular — Palavras & Frases por Camada
            </h3>
            <p className="text-xs text-muted-foreground">
              Dados extraídos palavra-a-palavra e frase-a-frase de cada bloco narrativo, com classificação, intensidade linguística e ponderação por engagement_rate_relative.
            </p>

            <div className="space-y-5">
              {['hook', 'setup', 'desenvolvimento', 'tensao', 'revelacao', 'payoff', 'transicao', 'loop'].map(blockType => {
                const data = granularConsolidation[blockType];
                if (!data || (data.total_words === 0 && data.total_phrases === 0)) return null;

                const typeLabels: Record<string, string> = {
                  hook: '🎣 Hook', setup: '📐 Setup', desenvolvimento: '📈 Desenvolvimento',
                  tensao: '😰 Tensão', revelacao: '💡 Revelação', payoff: '🎯 Payoff',
                  transicao: '🔄 Transição', loop: '🔁 Loop',
                };

                const categoryLabels: Record<string, string> = {
                  afirmacao: 'Afirmação', pergunta: 'Pergunta', negacao: 'Negação',
                  misterio: 'Mistério', alerta: 'Alerta', promessa: 'Promessa',
                  revelacao: 'Revelação', provocacao: 'Provocação', cta: 'CTA',
                };

                return (
                  <div key={blockType} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-foreground">{typeLabels[blockType] || blockType}</h4>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{data.total_words} palavras</span>
                        <span>{data.total_phrases} frases</span>
                        <span>{data.total_videos} vídeos</span>
                        {data.avg_phrase_strength != null && (
                          <span className="text-primary font-medium">Força média: {data.avg_phrase_strength}</span>
                        )}
                      </div>
                    </div>

                    {/* Top weighted words with flags */}
                    {data.top_weighted_words.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">🔥 Palavras por peso viral</p>
                        <div className="flex flex-wrap gap-1">
                          {data.top_weighted_words.slice(0, 15).map(w => (
                            <span key={w.word} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                              {w.word}
                              <span className="text-muted-foreground">({w.total_score.toFixed(1)})</span>
                              {w.emotional > 0 && <span title="Emocional">💔</span>}
                              {w.rare > 0 && <span title="Rara">💎</span>}
                              {w.impact > 0 && <span title="Impacto">⚡</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Phrase categories distribution */}
                    {data.phrase_categories.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Classificação de frases</p>
                        <div className="flex flex-wrap gap-1">
                          {data.phrase_categories.map(pc => (
                            <span key={pc.category} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                              {categoryLabels[pc.category] || pc.category}: {pc.count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Top strength phrases */}
                    {data.top_strength_phrases.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">💪 Frases com maior intensidade linguística</p>
                        {data.top_strength_phrases.slice(0, 5).map((p, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-[10px] font-bold text-primary shrink-0 mt-0.5">{p.strength}</span>
                            <p className="text-xs text-foreground italic flex-1">"{p.phrase}"</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground shrink-0">
                              {categoryLabels[p.category] || p.category}
                            </span>
                            {p.is_emotional && <span className="text-[10px]">💔</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Top viral-weighted phrases */}
                    {data.top_viral_phrases.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">🔥 Frases por peso viral</p>
                        {data.top_viral_phrases.slice(0, 3).map((p, i) => (
                          <p key={i} className="text-xs text-primary/80 italic pl-2 border-l-2 border-primary/50">
                            "{p.phrase}" <span className="text-muted-foreground not-italic">peso: {p.weighted.toFixed(1)} | força: {p.strength}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {blockType !== 'loop' && <div className="border-t border-border/50" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {consolidationLoading && (
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <p className="text-sm text-muted-foreground">Carregando consolidação semântica por bloco...</p>
          </div>
        )}

        {/* === Contexto Operacional + Auditoria === */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          {/* Contexto da Base */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4" /> Contexto Operacional
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Total na biblioteca</p>
                <p className="text-lg font-bold text-foreground">{totalAllVideos}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Processados</p>
                <p className="text-lg font-bold text-foreground">{totalVideos}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Elegíveis DNA</p>
                <p className="text-lg font-bold text-primary">{eligible.length}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Fora do DNA</p>
                <p className="text-lg font-bold text-muted-foreground">{totalVideos - eligible.length}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Engagement Groups */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4" /> Estado do Engagement
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary/40 rounded-md p-3 text-center">
                <p className="text-lg font-bold text-emerald-500">{engagementGroups.completo}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Completo</p>
                <p className="text-[10px] text-muted-foreground">views + likes + comments</p>
              </div>
              <div className="bg-secondary/40 rounded-md p-3 text-center">
                <p className="text-lg font-bold text-amber-500">{engagementGroups.parcial}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Parcial</p>
                <p className="text-[10px] text-muted-foreground">pelo menos 1 preenchido</p>
              </div>
              <div className="bg-secondary/40 rounded-md p-3 text-center">
                <p className="text-lg font-bold text-muted-foreground">{engagementGroups.ausente}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Ausente</p>
                <p className="text-[10px] text-muted-foreground">sem dados</p>
              </div>
            </div>
          </div>

          {/* Engagement Sources */}
          {Object.keys(engagementSources).length > 0 && (
            <>
              <div className="border-t border-border" />
              <div>
                <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4" /> Origem do Engagement
                </h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(engagementSources).sort((a, b) => b[1] - a[1]).map(([key, count]) => (
                    <span key={key} className="inline-flex items-center gap-1 bg-secondary/60 rounded-full px-3 py-1 text-xs text-foreground">
                      {key} <span className="font-bold">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="border-t border-border" />

          {/* Auditoria do Recálculo */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2">
                <Clock className="w-4 h-4" /> Auditoria do Recálculo Automático
              </h3>
              {audit.lastRecalculation && (() => {
                const status = getRecalcStatus(audit);
                return (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${status.color}`}>
                    {status.label === 'OK' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    {status.label}
                  </span>
                );
              })()}
            </div>
            {audit.lastRecalculation ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Último recálculo</p>
                  <p className="text-sm font-medium text-foreground">
                    {new Date(audit.lastRecalculation).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="text-xs text-muted-foreground">{timeAgo(audit.lastRecalculation)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Recalculados</p>
                  <p className="text-sm font-medium text-foreground">{audit.totalRecalculated || '—'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Score total</p>
                  <p className="text-sm font-medium text-foreground">{audit.totalScore || '—'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Soma dos pesos</p>
                  <div className="flex items-center gap-1">
                    {audit.totalPeso && Math.abs(parseFloat(audit.totalPeso) - 100) < 0.1 ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    )}
                    <p className="text-sm font-medium text-foreground">{audit.totalPeso ? `${audit.totalPeso}%` : '—'}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Tolerância</p>
                  <p className="text-xs text-muted-foreground">99.9% – 100.1%</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum recálculo registrado ainda.</p>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Fórmula Oficial */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-primary flex items-center gap-2 mb-2">
              <Percent className="w-4 h-4" /> Fórmula Oficial
            </h3>
            <div className="bg-secondary/40 rounded-md p-3">
              <p className="text-xs font-mono text-foreground leading-relaxed">
                engagement_rate_relative = engagement_rate / max_engagement_rate
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                engagement_rate = (likes + comments) / views — derivado diretamente da base MVP
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Normalização relativa ao máximo do dataset. Sem pesos inventados.
              </p>
            </div>
          </div>
        </div>

        {/* === EMPTY STATE === */}
        {eligible.length === 0 ? (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-6 text-center space-y-4">
              <ShieldAlert className="w-12 h-12 mx-auto text-amber-400" />
              <h2 className="text-lg font-semibold text-foreground">Nenhum vídeo elegível para análise de engajamento</h2>
              <div className="text-sm text-muted-foreground space-y-2 max-w-md mx-auto">
                <p>A base ainda não possui vídeos com dados reais de engajamento confirmados.</p>
                <p>Para consolidar a análise, é necessário:</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-4 max-w-md mx-auto text-left space-y-2 text-xs text-muted-foreground">
                <p>1. Abrir um vídeo processado na biblioteca</p>
                <p>2. Ir para a aba <strong className="text-foreground">Ficha Técnica</strong></p>
                <p>3. Preencher <strong className="text-foreground">views</strong>, <strong className="text-foreground">likes</strong> e <strong className="text-foreground">comentários</strong> reais</p>
                <p>4. Salvar os dados de engajamento</p>
                <p>5. O vídeo se tornará elegível automaticamente</p>
              </div>

              {/* Base stats */}
              <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto pt-4 border-t border-border">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{totalVideos}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Vídeos processados</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-amber-400">0</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Elegíveis DNA</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-muted-foreground">—</p>
                  <p className="text-[10px] text-muted-foreground uppercase">DNA consolidado</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* === POPULATED STATE === */
          <div className="space-y-6">
            {/* Totals summary */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-xs uppercase tracking-wider mb-4 font-semibold text-primary flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Totais da Base de Engajamento
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{eligible.length}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Vídeos elegíveis</p>
                  <p className="text-[10px] text-muted-foreground">de {totalVideos} processados</p>
                </div>
                <div className="text-center">
                  <Eye className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-2xl font-bold text-foreground">{totalViews.toLocaleString('pt-BR')}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Views totais</p>
                </div>
                <div className="text-center">
                  <Heart className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-2xl font-bold text-foreground">{totalLikes.toLocaleString('pt-BR')}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Likes totais</p>
                </div>
                <div className="text-center">
                  <MessageCircle className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-2xl font-bold text-foreground">{totalComments.toLocaleString('pt-BR')}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Comentários totais</p>
                </div>
              </div>
            </div>

            {/* Engagement Ranking */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-xs uppercase tracking-wider mb-2 font-semibold text-primary flex items-center gap-2">
                <Trophy className="w-4 h-4" /> Ranking por Engagement Rate Relativo
              </h3>
              <p className="text-[10px] text-muted-foreground mb-4">
                Posição relativa baseada em engagement_rate normalizado — derivado da base MVP
              </p>

              {/* Normalization stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Maior views</span>
                  <p className="font-bold text-foreground">{engagementStats.max_views.toLocaleString('pt-BR')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Maior likes</span>
                  <p className="font-bold text-foreground">{engagementStats.max_likes.toLocaleString('pt-BR')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Maior comments</span>
                  <p className="font-bold text-foreground">{engagementStats.max_comments.toLocaleString('pt-BR')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Maior eng. rate</span>
                  <p className="font-bold text-foreground">{(engagementStats.max_engagement_rate * 100).toFixed(2)}%</p>
                </div>
              </div>

              <div className="space-y-3">
                {engagementRanking.map((v, i) => (
                  <div key={v.id} className="flex items-center gap-3">
                    <span className={`text-sm font-bold w-6 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{v.titulo}</p>
                      <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                        <span>Views: {v.views.toLocaleString()}</span>
                        <span>Likes: {v.likes.toLocaleString()}</span>
                        <span>Comments: {v.comments.toLocaleString()}</span>
                        <span>Eng: {(v.engagement_rate * 100).toFixed(2)}%</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-primary">{v.dataset_weight_pct.toFixed(1)}%</p>
                      <p className="text-[10px] text-muted-foreground">Relativo: {v.engagement_rate_relative.toFixed(4)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Total validation */}
              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Percent className="w-3 h-3" /> Soma total dos pesos no dataset
                </span>
                <span className="text-sm font-bold text-primary">{engagementStats.total_dataset_weight.toFixed(1)}%</span>
              </div>

              {/* Weight bar chart */}
              <div className="mt-4">
                <ResponsiveContainer width="100%" height={Math.max(120, engagementRanking.length * 40)}>
                  <BarChart data={engagementRanking} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
                    <YAxis type="category" dataKey="titulo" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={120} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, 'Peso no Dataset']} />
                    <Bar dataKey="dataset_weight_pct" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Consolidated rhythm metrics */}
            {avgRhythm && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-muted-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" /> Ritmo Médio da Base
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Duração média</span>
                    <p className="font-bold text-foreground text-sm">{avgRhythm.avgDuracao.toFixed(3)}s</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Blocos médios</span>
                    <p className="font-bold text-foreground text-sm">{avgRhythm.avgBlocos.toFixed(1)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tempo médio/bloco</span>
                    <p className="font-bold text-foreground text-sm">{avgRhythm.avgBlockDur.toFixed(3)}s</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Densidade média</span>
                    <p className="font-bold text-foreground text-sm">{avgRhythm.avgDensidade.toFixed(3)} blocos/s</p>
                  </div>
                </div>
              </div>
            )}

            {/* Hook & Payoff médios */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-primary flex items-center gap-2">
                <Dna className="w-4 h-4" /> DNA Narrativo Consolidado
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Hook médio</span>
                  <p className="font-bold text-foreground text-sm">
                    {avgHookPayoff.avgHookTime !== null ? `${avgHookPayoff.avgHookTime.toFixed(3)}s (${avgHookPayoff.avgHookPct!.toFixed(1)}%)` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{avgHookPayoff.hookCount} vídeo(s)</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payoff médio</span>
                  <p className="font-bold text-foreground text-sm">
                    {avgHookPayoff.avgPayoffTime !== null ? `${avgHookPayoff.avgPayoffTime.toFixed(3)}s (${avgHookPayoff.avgPayoffPct!.toFixed(1)}%)` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{avgHookPayoff.payoffCount} vídeo(s)</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Viradas médias</span>
                  <p className="font-bold text-foreground text-sm">{avgTurns.avgTurns.toFixed(3)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Tempo médio entre viradas</span>
                  <p className="font-bold text-foreground text-sm">{avgTurns.avgTurnTime > 0 ? `${avgTurns.avgTurnTime.toFixed(3)}s` : '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Loop detectado</span>
                  <p className="font-bold text-foreground text-sm">{eligible.filter(v => v.loop_detectado).length}/{eligible.length} vídeos</p>
                </div>
              </div>
            </div>

            {/* Expanded Hook Model */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-primary flex items-center gap-2">
                <Zap className="w-4 h-4" /> Modelo Expandido do Gancho
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Início médio do hook</span>
                  <p className="font-bold text-foreground text-sm">{avgHookPayoff.hookStartMean !== null ? `${avgHookPayoff.hookStartMean.toFixed(3)}s` : '—'}</p>
                  {avgHookPayoff.hookStartMin !== null && (
                    <p className="text-[10px] text-muted-foreground">min: {avgHookPayoff.hookStartMin.toFixed(3)}s · max: {avgHookPayoff.hookStartMax!.toFixed(3)}s · med: {avgHookPayoff.hookStartMedian!.toFixed(3)}s</p>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Duração média do hook</span>
                  <p className="font-bold text-foreground text-sm">{avgHookPayoff.avgHookTime !== null ? `${avgHookPayoff.avgHookTime.toFixed(3)}s` : '—'}</p>
                  {avgHookPayoff.hookDurationMin !== null && (
                    <p className="text-[10px] text-muted-foreground">min: {avgHookPayoff.hookDurationMin.toFixed(3)}s · max: {avgHookPayoff.hookDurationMax!.toFixed(3)}s · med: {avgHookPayoff.hookDurationMedian!.toFixed(3)}s</p>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">1º Impacto médio</span>
                  <p className="font-bold text-foreground text-sm">{avgHookPayoff.firstImpactMean !== null ? `${avgHookPayoff.firstImpactMean.toFixed(3)}s` : '—'}</p>
                  {avgHookPayoff.firstImpactMin !== null && (
                    <p className="text-[10px] text-muted-foreground">min: {avgHookPayoff.firstImpactMin.toFixed(3)}s · max: {avgHookPayoff.firstImpactMax!.toFixed(3)}s · med: {avgHookPayoff.firstImpactMedian!.toFixed(3)}s</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">{avgHookPayoff.firstImpactCount} vídeo(s)</p>
                </div>
              </div>
            </div>

            {/* Verbal DNA Consolidation */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-primary flex items-center gap-2">
                <Dna className="w-4 h-4" /> DNA Verbal Consolidado
              </h3>
              {verbalDNA.hasData ? (
                <div className="space-y-4">
                  {verbalDNA.topKeywords.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">Palavras-chave mais frequentes nos hooks</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {verbalDNA.topKeywords.map(([kw, count]) => (
                          <span key={kw} className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">{kw} ({count})</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {verbalDNA.dominantHookTypes.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Tipos de gancho dominantes</span>
                        {verbalDNA.dominantHookTypes.map(([t, c]) => (
                          <p key={t} className="font-medium text-foreground text-sm">{t} ({c})</p>
                        ))}
                      </div>
                    )}
                    {verbalDNA.topPhrasePatterns.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Padrões de frase</span>
                        {verbalDNA.topPhrasePatterns.map(([p, c]) => (
                          <p key={p} className="font-medium text-foreground text-sm">{p} ({c})</p>
                        ))}
                      </div>
                    )}
                    {verbalDNA.dominantHookEmotions.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Emoções verbais do hook</span>
                        {verbalDNA.dominantHookEmotions.map(([e, c]) => (
                          <p key={e} className="font-medium text-foreground text-sm">{e} ({c})</p>
                        ))}
                      </div>
                    )}
                    {verbalDNA.avgEmotionIntensity !== null && (
                      <div>
                        <span className="text-muted-foreground">Intensidade emocional média</span>
                        <p className="font-bold text-foreground text-sm">{verbalDNA.avgEmotionIntensity.toFixed(1)}%</p>
                      </div>
                    )}
                    {verbalDNA.dominantCtaTypes.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Tipos de CTA dominantes</span>
                        {verbalDNA.dominantCtaTypes.map(([t, c]) => (
                          <p key={t} className="font-medium text-foreground text-sm">{t} ({c})</p>
                        ))}
                      </div>
                    )}
                    {verbalDNA.avgCtaIntrusion !== null && (
                      <div>
                        <span className="text-muted-foreground">Intrusão CTA média</span>
                        <p className="font-bold text-foreground text-sm">{verbalDNA.avgCtaIntrusion.toFixed(1)}/100</p>
                      </div>
                    )}
                    {verbalDNA.avgCtaFlowBreak !== null && (
                      <div>
                        <span className="text-muted-foreground">Quebra de fluxo CTA média</span>
                        <p className="font-bold text-foreground text-sm">{verbalDNA.avgCtaFlowBreak.toFixed(1)}/100</p>
                      </div>
                    )}
                    {verbalDNA.progressionTypes.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Progressão narrativa</span>
                        {verbalDNA.progressionTypes.map(([t, c]) => (
                          <p key={t} className="font-medium text-foreground text-sm">{t} ({c})</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">Nenhum dado verbal registrado ainda.</p>
                  <p className="text-xs text-muted-foreground mt-1">Os campos verbais serão preenchidos pela análise de IA nas próximas etapas.</p>
                </div>
              )}
            </div>

            {avgStructure.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">📊 Estrutura Narrativa Média da Base</h4>
                <div className="flex items-center gap-4 flex-col sm:flex-row">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={avgStructure} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name} ${value}%`}>
                        {avgStructure.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, '% do tempo']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 min-w-[140px]">
                    {avgStructure.map(d => (
                      <div key={d.name} className="flex items-center gap-2 text-xs">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                        <span className="text-foreground">{d.name}</span>
                        <span className="text-muted-foreground">{d.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Emotional distribution */}
            {emotionDistribution.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">🎭 Distribuição Emocional Média da Base</h4>
                <div className="flex items-center gap-4 flex-col sm:flex-row">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={emotionDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name} ${value}%`}>
                        {emotionDistribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, '% do tempo']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 min-w-[140px]">
                    {emotionDistribution.map(d => (
                      <div key={d.name} className="flex items-center gap-2 text-xs">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                        <span className="text-foreground">{d.icon} {d.name}</span>
                        <span className="text-muted-foreground">{d.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Dominant patterns */}
            {dominantPatterns.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> Padrões Dominantes da Base
                </h3>
                <ul className="space-y-2">
                  {dominantPatterns.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <span className="text-primary font-bold">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* DNA Base V1 - Structural Aggregation */}
            <DNABaseV1 />

            {/* Disclaimer */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-center">
              <p className="text-xs text-amber-400 font-medium">
                ⚠ Esta consolidação representa a base de referência estrutural, não uma avaliação de qualidade.
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                O DNA consolidado será usado como referência estrutural para comparação de novos vídeos em etapa futura.
              </p>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
