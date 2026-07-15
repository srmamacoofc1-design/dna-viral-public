import { useEffect, useState, useRef } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { BarChart3, TrendingUp, Zap, Hash, AlertTriangle, Dna, Star, Layers, Activity, Download, Printer, Shield, Brain, FileDown } from 'lucide-react';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { SEGMENTOS, ESTILOS_VISUAIS, EMOCOES, TIPO_BLOCOS } from '@/types/video';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ConsistencyValidator } from '@/components/report/ConsistencyValidator';
import { PerformanceCorrelationReport } from '@/components/report/PerformanceCorrelationReport';

type VideoRow = Tables<'videos'>;
type BlockRow = Tables<'video_blocks'>;

function StatCard({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: React.ElementType }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function DistributionList({ title, items }: { title: string; items: { label: string; count: number; pct: number }[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">{title}</h4>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="text-sm text-foreground flex-1">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.count}</span>
            <div className="w-20 h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${item.pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground w-10 text-right">{item.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mt-8 mb-4">
      <Icon className="w-5 h-5 text-primary" />
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
    </div>
  );
}

function PatternCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h4 className="text-sm font-medium text-foreground mb-2">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function mapRowToVideoLike(row: VideoRow) {
  return {
    ...row,
    origem: row.origem || '',
    data_envio: row.created_at,
    duracao: row.duracao != null ? Number(row.duracao) : undefined,
    tamanho: row.tamanho != null ? Number(row.tamanho) : undefined,
    tempo_gancho: row.tempo_gancho != null ? Number(row.tempo_gancho) : undefined,
    duracao_gancho: row.duracao_gancho != null ? Number(row.duracao_gancho) : undefined,
    tempo_primeiro_evento: row.tempo_primeiro_evento != null ? Number(row.tempo_primeiro_evento) : undefined,
    tempo_primeira_revelacao: row.tempo_primeira_revelacao != null ? Number(row.tempo_primeira_revelacao) : undefined,
    tempo_payoff: row.tempo_payoff != null ? Number(row.tempo_payoff) : undefined,
    gancho_detectado: row.gancho_detectado ?? undefined,
    loop_detectado: row.loop_detectado ?? undefined,
  } as any;
}

function avg(arr: number[]): string {
  if (!arr.length) return '—';
  return (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3);
}

function mode<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  const freq = new Map<T, number>();
  arr.forEach(v => freq.set(v, (freq.get(v) || 0) + 1));
  let best: T = arr[0], bestCount = 0;
  freq.forEach((count, val) => { if (count > bestCount) { best = val; bestCount = count; } });
  return best;
}

function getBlockSequence(blocks: BlockRow[]): string {
  return blocks
    .sort((a, b) => a.bloco_id - b.bloco_id)
    .map(b => {
      const t = TIPO_BLOCOS.find(tb => tb.value === b.tipo_bloco);
      return t?.label || b.tipo_bloco;
    })
    .join(' → ');
}

function getEmotionSequence(blocks: BlockRow[]): string {
  const seq = blocks
    .sort((a, b) => a.bloco_id - b.bloco_id)
    .filter(b => b.emocao)
    .map(b => {
      const e = EMOCOES.find(em => em.value === b.emocao);
      return e ? `${e.icon} ${e.label}` : '';
    })
    .filter(Boolean)
    .join(' → ');
  return seq || 'Sequência emocional não disponível';
}

export default function ReportPage() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [allBlocks, setAllBlocks] = useState<BlockRow[]>([]);
  const [allTranscripts, setAllTranscripts] = useState<Tables<'video_transcripts'>[]>([]);
  const [loading, setLoading] = useState(true);
  const reportRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    exportPageAsPDF('Relatório DNA da Biblioteca');
  };

  const handleSavePDF = () => {
    exportPageAsPDF('Relatório DNA da Biblioteca');
  };

  useEffect(() => {
    Promise.all([
      supabase.from('videos').select('*'),
      supabase.from('video_blocks').select('*').order('bloco_id'),
      supabase.from('video_transcripts').select('*'),
    ]).then(([vRes, bRes, tRes]) => {
      setVideos(vRes.data || []);
      setAllBlocks(bRes.data || []);
      setAllTranscripts(tRes.data || []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <AppLayout><div className="max-w-4xl mx-auto px-4 py-20 text-center text-muted-foreground">Carregando...</div></AppLayout>;
  }

  const completed = videos.filter(v => v.status === 'completed');
  const total = videos.length;
  const totalCompleted = completed.length;
  const totalBlocos = completed.reduce((s, v) => s + (v.numero_blocos || 0), 0);
  const totalHooks = completed.filter(v => v.gancho_detectado).length;
  const totalLoops = completed.filter(v => v.loop_detectado).length;

  const withDuracao = completed.filter(v => v.duracao);
  const avgDuracao = avg(withDuracao.map(v => Number(v.duracao)));
  // Hook médio = duração do bloco HOOK (tempo_fim - tempo_inicio)
  const hookDurations = completed.map(v => {
    const hookBlock = allBlocks.find(b => b.video_id === v.id && b.tipo_bloco === 'hook');
    return hookBlock ? Number(hookBlock.tempo_fim) - Number(hookBlock.tempo_inicio) : null;
  }).filter((d): d is number => d !== null);
  const avgHook = avg(hookDurations);
  const withRev = completed.filter(v => v.tempo_primeira_revelacao !== null);
  const avgRev = avg(withRev.map(v => Number(v.tempo_primeira_revelacao)));
  const withPayoff = completed.filter(v => v.tempo_payoff !== null);
  const avgPayoff = avg(withPayoff.map(v => Number(v.tempo_payoff)));

  // Distributions
  const segDist = SEGMENTOS.map(s => {
    const count = completed.filter(v => v.segmento === s.value).length;
    return { label: `${s.icon} ${s.label}`, count, pct: totalCompleted ? Math.round(count / totalCompleted * 100) : 0 };
  }).filter(s => s.count > 0);

  const estDist = ESTILOS_VISUAIS.map(e => {
    const count = completed.filter(v => v.estilo_visual === e.value).length;
    return { label: `${e.icon} ${e.label}`, count, pct: totalCompleted ? Math.round(count / totalCompleted * 100) : 0 };
  }).filter(s => s.count > 0);

  const emoDist = EMOCOES.map(e => {
    const count = completed.filter(v => v.emocao_predominante === e.value).length;
    return { label: `${e.icon} ${e.label}`, count, pct: totalCompleted ? Math.round(count / totalCompleted * 100) : 0 };
  }).filter(s => s.count > 0).sort((a, b) => b.count - a.count);

  // Use engagement_percentile_display (percentile-based, 0-100) como métrica observacional
  const scores = completed
    .filter(v => v.engagement_percentile_display != null || v.engagement_rate_relative != null)
    .map(v => ({ video: v, score: v.engagement_percentile_display != null ? Math.round(Number(v.engagement_percentile_display)) : Math.round(Number(v.engagement_rate_relative) * 100) }));
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b.score, 0) / scores.length) : 0;
  const videosWithScore = scores.length;
  const videosWithoutScore = completed.length - videosWithScore;

  // === A) PADRÕES RECORRENTES ===
  const hookTypes = completed.filter(v => v.tipo_gancho).map(v => v.tipo_gancho!);
  const mostCommonHookType = mode(hookTypes);
  const hookTypeLabel = mostCommonHookType ? (
    { visual: 'Visual', texto: 'Texto', acao: 'Ação', pergunta: 'Pergunta' }[mostCommonHookType] || mostCommonHookType
  ) : '—';

  const duracaoRanges = withDuracao.map(v => {
    const d = Number(v.duracao);
    if (d <= 15) return '0-15s';
    if (d <= 30) return '16-30s';
    if (d <= 60) return '31-60s';
    return '60s+';
  });
  const mostCommonDuration = mode(duracaoRanges) || '—';
  const loopPct = totalCompleted ? Math.round(totalLoops / totalCompleted * 100) : 0;

  // Block sequence patterns
  const videoBlockMap = new Map<string, BlockRow[]>();
  allBlocks.forEach(b => {
    const arr = videoBlockMap.get(b.video_id) || [];
    arr.push(b);
    videoBlockMap.set(b.video_id, arr);
  });

  const blockSequences = Array.from(videoBlockMap.values()).map(blocks => getBlockSequence(blocks));
  const seqFreq = new Map<string, number>();
  blockSequences.forEach(s => seqFreq.set(s, (seqFreq.get(s) || 0) + 1));
  const sortedSeqs = Array.from(seqFreq.entries()).sort((a, b) => b[1] - a[1]);
  const topSeqCount = sortedSeqs[0]?.[1] || 0;
  const hasDominantSeq = sortedSeqs.filter(s => s[1] === topSeqCount).length === 1;
  const topSequences = sortedSeqs.slice(0, 3);

  const emotionSequences = Array.from(videoBlockMap.values()).map(blocks => getEmotionSequence(blocks));
  const emoSeqFreq = new Map<string, number>();
  emotionSequences.forEach(s => emoSeqFreq.set(s, (emoSeqFreq.get(s) || 0) + 1));
  const topEmoSequences = Array.from(emoSeqFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const recurrentPatterns = [
    `Tipo de hook mais frequente: ${hookTypeLabel}`,
    `Duração média do hook: ${avgHook}s`,
    `Posição média da 1ª revelação: ${avgRev}s`,
    `Posição média do payoff: ${avgPayoff}s`,
    `Faixa de duração mais comum: ${mostCommonDuration}`,
    `Loop detectado em ${loopPct}% dos vídeos`,
    ...(hasDominantSeq
      ? topSequences.map(([seq, count]) => `Sequência narrativa (${count}x): ${seq}`)
      : [`Estrutura dominante: nenhuma (empate entre ${sortedSeqs.filter(s => s[1] === topSeqCount).length} estruturas)`]),
    ...topEmoSequences.map(([seq, count]) => `Sequência emocional (${count}x): ${seq}`),
  ];

  // === B) PADRÕES POR SEGMENTO ===
  const segmentAnalysis = SEGMENTOS.map(seg => {
    const vids = completed.filter(v => v.segmento === seg.value);
    if (!vids.length) return null;
    const segBlocks = allBlocks.filter(b => vids.some(v => v.id === b.video_id));
    const segHookType = mode(vids.filter(v => v.tipo_gancho).map(v => v.tipo_gancho!));
    const segEmotion = mode(vids.filter(v => v.emocao_predominante).map(v => v.emocao_predominante!));

    return {
      label: `${seg.icon} ${seg.label}`,
      count: vids.length,
      items: [
        `Hook médio: ${avg(vids.map(v => { const hb = allBlocks.find(b => b.video_id === v.id && b.tipo_bloco === 'hook'); return hb ? Number(hb.tempo_fim) - Number(hb.tempo_inicio) : null; }).filter((d): d is number => d !== null))}s`,
        `Revelação média: ${avg(vids.filter(v => v.tempo_primeira_revelacao !== null).map(v => Number(v.tempo_primeira_revelacao)))}s`,
        `Payoff médio: ${avg(vids.filter(v => v.tempo_payoff !== null).map(v => Number(v.tempo_payoff)))}s`,
        `Emoção predominante: ${segEmotion ? EMOCOES.find(e => e.value === segEmotion)?.label || segEmotion : '—'}`,
        `Tipo de hook mais comum: ${segHookType || '—'}`,
        `Blocos narrativos: ${segBlocks.length}`,
        (() => {
          const segSeqs = vids.map(v => videoBlockMap.get(v.id)).filter(Boolean).map(blocks => getBlockSequence(blocks!));
          const segSeqFreq = new Map<string, number>();
          segSeqs.forEach(s => segSeqFreq.set(s, (segSeqFreq.get(s) || 0) + 1));
          const segSorted = Array.from(segSeqFreq.entries()).sort((a, b) => b[1] - a[1]);
          const segTopCount = segSorted[0]?.[1] || 0;
          const segHasDominant = segSorted.filter(s => s[1] === segTopCount).length === 1;
          if (!segSorted.length) return '';
          return segHasDominant ? `Estrutura mais recorrente: ${segSorted[0][0]}` : 'Sem estrutura dominante (empate)';
        })(),
      ].filter(Boolean),
    };
  }).filter(Boolean);

  // === C) PADRÕES POR ESTILO VISUAL ===
  const styleAnalysis = ESTILOS_VISUAIS.map(est => {
    const vids = completed.filter(v => v.estilo_visual === est.value);
    if (!vids.length) return null;
    const estEmotion = mode(vids.filter(v => v.emocao_predominante).map(v => v.emocao_predominante!));

    return {
      label: `${est.icon} ${est.label}`,
      count: vids.length,
      items: [
        `Duração média: ${avg(vids.filter(v => v.duracao).map(v => Number(v.duracao)))}s`,
        `Emoção predominante: ${estEmotion ? EMOCOES.find(e => e.value === estEmotion)?.label || estEmotion : '—'}`,
        `Hook médio: ${avg(vids.map(v => { const hb = allBlocks.find(b => b.video_id === v.id && b.tipo_bloco === 'hook'); return hb ? Number(hb.tempo_fim) - Number(hb.tempo_inicio) : null; }).filter((d): d is number => d !== null))}s`,
        `Payoff médio: ${avg(vids.filter(v => v.tempo_payoff !== null).map(v => Number(v.tempo_payoff)))}s`,
        `Loop: ${vids.filter(v => v.loop_detectado).length}/${vids.length}`,
      ],
    };
  }).filter(Boolean);

  // === D) PADRÕES POR IDIOMA ===
  const langGroups = new Map<string, VideoRow[]>();
  completed.forEach(v => {
    const lang = v.idioma || 'pt';
    const arr = langGroups.get(lang) || [];
    arr.push(v);
    langGroups.set(lang, arr);
  });
  const langAnalysis = Array.from(langGroups.entries()).map(([lang, vids]) => ({
    label: lang.toUpperCase(),
    count: vids.length,
    items: [
      `Duração média: ${avg(vids.filter(v => v.duracao).map(v => Number(v.duracao)))}s`,
      `Blocos médios: ${avg(vids.filter(v => v.numero_blocos).map(v => v.numero_blocos!))}`,
      `Hook médio: ${avg(vids.map(v => { const hb = allBlocks.find(b => b.video_id === v.id && b.tipo_bloco === 'hook'); return hb ? Number(hb.tempo_fim) - Number(hb.tempo_inicio) : null; }).filter((d): d is number => d !== null))}s`,
      `Payoff médio: ${avg(vids.filter(v => v.tempo_payoff !== null).map(v => Number(v.tempo_payoff)))}s`,
    ],
  }));

  // === E) ESTRUTURAS REPLICÁVEIS ===
  const replicableStructures: string[] = [];
  // Detect common patterns
  const hookEarlyPayoffLate = completed.filter(v =>
    v.tempo_gancho !== null && Number(v.tempo_gancho) <= 2 &&
    v.tempo_payoff !== null && v.duracao && Number(v.tempo_payoff) > Number(v.duracao) * 0.75
  );
  if (hookEarlyPayoffLate.length > 0) {
    replicableStructures.push(`Hook imediato (0-2s) + Payoff tardio (>75% da duração) — ${hookEarlyPayoffLate.length} vídeo(s)`);
  }

  const questionHooks = completed.filter(v => v.tipo_gancho === 'pergunta');
  if (questionHooks.length > 0) {
    const avgPay = avg(questionHooks.filter(v => v.tempo_payoff !== null).map(v => Number(v.tempo_payoff)));
    replicableStructures.push(`Hook por pergunta + payoff médio em ${avgPay}s — ${questionHooks.length} vídeo(s)`);
  }

  const shortMemes = completed.filter(v => v.segmento === 'meme' && v.duracao && Number(v.duracao) <= 20);
  if (shortMemes.length > 0) {
    replicableStructures.push(`Meme curto (≤20s) com impacto rápido — ${shortMemes.length} vídeo(s)`);
  }

  const mysteryTension = completed.filter(v =>
    (v.segmento === 'misterio' || v.segmento === 'terror') &&
    v.emocao_predominante && ['tensao', 'medo', 'curiosidade'].includes(v.emocao_predominante)
  );
  if (mysteryTension.length > 0) {
    replicableStructures.push(`Mistério/Terror com tensão emocional dominante — ${mysteryTension.length} vídeo(s)`);
  }

  const loopVideos = completed.filter(v => v.loop_detectado && v.gancho_detectado);
  if (loopVideos.length > 0) {
    replicableStructures.push(`Hook + Loop detectado (estrutura circular) — ${loopVideos.length} vídeo(s)`);
  }

  if (replicableStructures.length === 0) {
    replicableStructures.push('Poucos vídeos para detectar padrões replicáveis. Adicione mais vídeos à biblioteca.');
  }

  // === F) RANKING DE VÍDEOS MAIS REPLICÁVEIS ===
  const rankedVideos = scores
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return (
    <AppLayout>
      <div ref={reportRef} className="max-w-4xl mx-auto px-4 py-8 pb-20 print:px-0 print:py-0 print:max-w-none">
        <div className="mb-8 print:mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-6 h-6 text-primary" />
              <h1 className="font-semibold text-2xl text-foreground">Relatório DNA da Biblioteca</h1>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={handleSavePDF}>
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Salvar PDF</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Imprimir</span>
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Análise de padrões narrativos, estruturas replicáveis e DNA viral da biblioteca.
          </p>
        </div>

        {total === 0 ? (
          <p className="text-center text-muted-foreground py-20">Nenhum vídeo na biblioteca.</p>
        ) : (
          <div className="space-y-2">
            {/* G) DATA SOURCE TRANSPARENCY — dynamic values */}
            {(() => {
              const v2Count = completed.filter(v => v.block_segmentation_version === 'v2_refined').length;
              const v1Count = completed.filter(v => v.block_segmentation_version !== 'v2_refined').length;
              const avgAlign = completed.filter(v => v.avg_alignment_score != null).length > 0
                ? (completed.filter(v => v.avg_alignment_score != null).reduce((s, v) => s + Number(v.avg_alignment_score), 0) / completed.filter(v => v.avg_alignment_score != null).length).toFixed(1)
                : '—';
              const totalBlocksNow = allBlocks.length;
              return (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Transparência dos dados</p>
                    <p><span className="text-green-400 font-medium">✔ Real:</span> Transcrição via IA (Gemini Speech-to-Text), blocos narrativos via análise IA, metadados técnicos, timing (hook/revelação/payoff), tipo gancho, emoção, segmento, estilo visual, engagement rate</p>
                    <p><span className="text-green-400 font-medium">✔ Funcional:</span> Vídeos enviados por link (Google Drive) são baixados e processados automaticamente pelo pipeline</p>
                    <p><span className="text-green-400 font-medium">✔ Visual:</span> Extração real de frames (scene detection), análise visual por IA (Gemini Vision) em {totalBlocksNow} blocos, alinhamento texto-visual (média: {avgAlign})</p>
                    <p><span className="text-green-400 font-medium">✔ Segmentação:</span> {v2Count} vídeo(s) em v2_refined, {v1Count} em v1_legacy{v1Count > 0 ? ' (reprocessamento em andamento)' : ''}</p>
                  </div>
                </div>
              );
            })()}

            {/* General stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <StatCard icon={Hash} label="Total Vídeos" value={total} />
              <StatCard icon={BarChart3} label="Processados" value={totalCompleted} />
              <StatCard icon={Zap} label="Hooks" value={totalHooks} />
              <StatCard icon={TrendingUp} label="Loops" value={totalLoops} />
            </div>

            {/* Structure */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Estrutura Narrativa (médias reais)</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-muted-foreground text-xs">Hook</span><p className="font-bold text-foreground">{avgHook}s</p></div>
                <div><span className="text-muted-foreground text-xs">1ª Revelação</span><p className="font-bold text-foreground">{avgRev}s</p></div>
                <div><span className="text-muted-foreground text-xs">Payoff</span><p className="font-bold text-foreground">{avgPayoff}s</p></div>
                <div><span className="text-muted-foreground text-xs">Duração</span><p className="font-bold text-foreground">{avgDuracao}s</p></div>
              </div>
            </div>

            {/* Engagement Rate */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <h4 className="text-xs text-primary uppercase tracking-wider mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4" /> Engagement Rate Médio (Observacional)
              </h4>
              <p className="text-3xl font-bold text-foreground">{avgScore}<span className="text-lg text-muted-foreground">/100</span></p>
              <p className="text-xs text-muted-foreground mt-1">
                Fórmula: engagement_rate = (likes + comments) / views, normalizado dentro do dataset · {videosWithScore} vídeo(s) com dados
                {videosWithoutScore > 0 && ` · ${videosWithoutScore} aguardando dados`}
              </p>
            </div>

            {/* Distributions */}
            <div className="grid md:grid-cols-2 gap-4">
              {emoDist.length > 0 && <DistributionList title="Emoções" items={emoDist} />}
              {segDist.length > 0 && <DistributionList title="Segmentos" items={segDist} />}
              {estDist.length > 0 && <DistributionList title="Estilos Visuais" items={estDist} />}
            </div>

            {/* A) PADRÕES RECORRENTES */}
            <SectionTitle icon={TrendingUp} title="Padrões Recorrentes" />
            <PatternCard title="Padrões detectados na biblioteca" items={recurrentPatterns} />

            {/* B) PADRÕES POR SEGMENTO */}
            {segmentAnalysis.length > 0 && (
              <>
                <SectionTitle icon={Layers} title="Padrões por Segmento" />
                <div className="grid md:grid-cols-2 gap-3">
                  {segmentAnalysis.map(seg => seg && (
                    <PatternCard key={seg.label} title={`${seg.label} (${seg.count})`} items={seg.items} />
                  ))}
                </div>
              </>
            )}

            {/* C) PADRÕES POR ESTILO VISUAL */}
            {styleAnalysis.length > 0 && (
              <>
                <SectionTitle icon={Layers} title="Padrões por Estilo Visual" />
                <div className="grid md:grid-cols-2 gap-3">
                  {styleAnalysis.map(est => est && (
                    <PatternCard key={est.label} title={`${est.label} (${est.count})`} items={est.items} />
                  ))}
                </div>
              </>
            )}

            {/* D) PADRÕES POR IDIOMA */}
            {langAnalysis.length > 0 && (
              <>
                <SectionTitle icon={Layers} title="Padrões por Idioma" />
                <div className="grid md:grid-cols-2 gap-3">
                  {langAnalysis.map(la => (
                    <PatternCard key={la.label} title={`${la.label} (${la.count})`} items={la.items} />
                  ))}
                </div>
              </>
            )}

            {/* E) DNA REPLICÁVEL */}
            <SectionTitle icon={Dna} title="DNA Replicável — Estruturas Detectadas" />
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-3">Templates narrativos recorrentes identificados na biblioteca, prontos para replicação.</p>
              <ul className="space-y-2">
                {replicableStructures.map((s, i) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-2">
                    <Dna className="w-3 h-3 text-primary mt-1 shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* F) RANKING */}
            {rankedVideos.length > 0 && (
              <>
                <SectionTitle icon={Star} title="Ranking — Vídeos Mais Replicáveis" />
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {rankedVideos.map((item, i) => {
                    const seg = SEGMENTOS.find(s => s.value === item.video.segmento);
                    const est = ESTILOS_VISUAIS.find(e => e.value === item.video.estilo_visual);
                    return (
                      <div key={item.video.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="text-lg font-bold text-primary w-8">{i + 1}.</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{item.video.titulo || 'Sem título'}</p>
                          <p className="text-xs text-muted-foreground">
                            {seg ? `${seg.icon} ${seg.label}` : 'Aguardando'} · {est ? `${est.icon} ${est.label}` : 'Aguardando'}
                            {item.video.gancho_detectado && ' · Hook ✓'}
                            {item.video.loop_detectado && ' · Loop ✓'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-lg font-bold ${item.score >= 70 ? 'text-primary' : item.score >= 40 ? 'text-muted-foreground' : 'text-destructive'}`}>
                            {item.score}
                          </span>
                          <span className="text-xs text-muted-foreground">/100</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* G) ANÁLISE CONSOLIDADA */}
            {totalCompleted > 0 && (() => {
              const duracoes = completed.filter(v => v.duracao).map(v => Number(v.duracao));
              const avgDur = duracoes.length ? duracoes.reduce((a, b) => a + b, 0) / duracoes.length : 0;
              const blocosCounts = completed.map(v => v.numero_blocos || 0);
              const avgBlocos = blocosCounts.length ? blocosCounts.reduce((a, b) => a + b, 0) / blocosCounts.length : 0;
              
              // Rhythm: avg blocks/duration
              const rhythms = completed.filter(v => v.duracao && v.numero_blocos).map(v => (v.numero_blocos! / Number(v.duracao)));
              const avgRhythm = rhythms.length ? rhythms.reduce((a, b) => a + b, 0) / rhythms.length : 0;

              // Word density from transcripts
              const totalWords = allTranscripts.reduce((sum, t) => sum + t.texto.split(/\s+/).filter(Boolean).length, 0);
              const totalAudioDur = duracoes.reduce((a, b) => a + b, 0);
              const avgDensity = totalAudioDur > 0 ? totalWords / totalAudioDur : 0;

              // Dominant pattern  
              const dominantSeg = mode(completed.map(v => v.segmento));
              const dominantEst = mode(completed.map(v => v.estilo_visual));

              // Block type distribution chart
              const blockTypeDist = TIPO_BLOCOS.map(t => {
                const count = allBlocks.filter(b => b.tipo_bloco === t.value).length;
                return { name: t.label, value: count, color: t.color };
              }).filter(d => d.value > 0);

              // Duration distribution chart
              const durationBuckets = [
                { name: '0-15s', count: completed.filter(v => v.duracao && Number(v.duracao) <= 15).length },
                { name: '16-30s', count: completed.filter(v => v.duracao && Number(v.duracao) > 15 && Number(v.duracao) <= 30).length },
                { name: '31-60s', count: completed.filter(v => v.duracao && Number(v.duracao) > 30 && Number(v.duracao) <= 60).length },
                { name: '60s+', count: completed.filter(v => v.duracao && Number(v.duracao) > 60).length },
              ].filter(d => d.count > 0);

              // Avg stimulus interval across all videos
              const allIntervals: number[] = [];
              videoBlockMap.forEach(blocks => {
                const sorted = [...blocks].sort((a, b) => a.bloco_id - b.bloco_id);
                for (let i = 1; i < sorted.length; i++) {
                  allIntervals.push(Number(sorted[i].tempo_inicio) - Number(sorted[i - 1].tempo_inicio));
                }
              });
              const avgInterval = allIntervals.length ? allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length : 0;

              return (
                <>
                  <SectionTitle icon={Activity} title="Análise Consolidada da Biblioteca" />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <StatCard icon={Hash} label="Média duração" value={`${avgDur.toFixed(3)}s`} />
                    <StatCard icon={Layers} label="Média blocos" value={avgBlocos.toFixed(1)} />
                    <StatCard icon={Activity} label="Média ritmo" value={`${(avgRhythm * 100).toFixed(3)} blocos/100s`} />
                    <StatCard icon={TrendingUp} label="Padrão dominante" value={dominantSeg ? SEGMENTOS.find(s => s.value === dominantSeg)?.label || dominantSeg : '—'} />
                    <StatCard icon={BarChart3} label="Intervalo médio" value={`${avgInterval.toFixed(3)}s`} />
                    <StatCard icon={Zap} label="Densidade média" value={`${avgDensity.toFixed(3)} p/s`} />
                  </div>

                  {/* Duration distribution chart */}
                  {durationBuckets.length > 0 && (
                    <div className="bg-card border border-border rounded-lg p-4 mt-4">
                      <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">📊 Distribuição de Duração</h4>
                      <ResponsiveContainer width="100%" height={150}>
                        <BarChart data={durationBuckets}>
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                          <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} />
                          <Tooltip contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Block type distribution chart */}
                  {blockTypeDist.length > 0 && (
                    <div className="bg-card border border-border rounded-lg p-4 mt-4">
                      <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">🥧 Tipos de Bloco na Biblioteca</h4>
                      <div className="flex items-center gap-4">
                        <ResponsiveContainer width="50%" height={180}>
                          <PieChart>
                            <Pie data={blockTypeDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                              {blockTypeDist.map((d, i) => (
                                <Cell key={i} fill={d.color} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-1">
                          {blockTypeDist.map(d => (
                            <div key={d.name} className="flex items-center gap-2 text-xs">
                              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                              <span className="text-foreground">{d.name}</span>
                              <span className="text-muted-foreground">{d.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Consistency Validator — batch mode */}
            <SectionTitle icon={Shield} title="Validação de Consistência Global" />
            <ConsistencyValidator batchMode />

            {/* DNA V2 + Correlações */}
            <SectionTitle icon={Brain} title="DNA Base V2 & Correlações" />
            <PerformanceCorrelationReport />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
