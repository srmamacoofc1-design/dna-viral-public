import { Eye, Heart, MessageCircle, Weight, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { Video } from '@/types/video';
import { isEligibleForDNA, DNA_WEIGHT_CONFIG, ENGAGEMENT_STATUS_LABELS } from '@/types/video';

interface Props {
  video: Video;
  libraryTotals: { views: number; likes: number; comments: number; eligibleCount: number };
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function PerformanceWeight({ video, libraryTotals }: Props) {
  const eligible = isEligibleForDNA(video);
  const statusInfo = ENGAGEMENT_STATUS_LABELS[video.engagement_status];

  const v = video.views ?? 0;
  const l = video.likes ?? 0;
  const c = video.comments ?? 0;

  const pViews = eligible ? pct(v, libraryTotals.views) : 0;
  const pLikes = eligible ? pct(l, libraryTotals.likes) : 0;
  const pComments = eligible ? pct(c, libraryTotals.comments) : 0;

  const weight = eligible && (libraryTotals.views + libraryTotals.likes + libraryTotals.comments > 0)
    ? pViews * DNA_WEIGHT_CONFIG.views + pLikes * DNA_WEIGHT_CONFIG.likes + pComments * DNA_WEIGHT_CONFIG.comments
    : 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-4 flex items-center gap-2 font-semibold text-primary">
        <Weight className="w-4 h-4" />
        Performance Weight — Base de Engagement
      </h3>

      {/* Engagement status badge */}
      <div className={`flex items-center gap-2 mb-4 text-xs font-medium ${statusInfo.color}`}>
        {eligible ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
        <span>{statusInfo.icon} {statusInfo.label}</span>
      </div>

      {!eligible ? (
        <div className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <p className="text-xs text-amber-400 font-medium mb-1">⚠ Dados de engajamento ausentes ou não confirmados</p>
            <p className="text-xs text-muted-foreground">
              Este vídeo <strong className="text-foreground">não participa da base de engagement</strong> porque não possui dados reais de engajamento confirmados.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Preencha views, likes e comentários na aba Ficha com dados reais da plataforma de publicação para incluir este vídeo na base de engagement.
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            O engagement rate relativo será recalculado quando novos dados forem adicionados.
          </p>
        </div>
      ) : (
        <>
          {/* Eligibility confirmation */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 mb-4">
            <p className="text-[10px] text-green-400 text-center font-medium">
              ✔ Elegível para base de engagement — dados reais confirmados
            </p>
          </div>

          {/* Raw metrics */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="text-center">
              <Eye className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-lg font-bold text-foreground">{v.toLocaleString('pt-BR')}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Views</p>
            </div>
            <div className="text-center">
              <Heart className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-lg font-bold text-foreground">{l.toLocaleString('pt-BR')}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Likes</p>
            </div>
            <div className="text-center">
              <MessageCircle className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-lg font-bold text-foreground">{c.toLocaleString('pt-BR')}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Comentários</p>
            </div>
          </div>

          {/* Base info */}
          <p className="text-[10px] text-muted-foreground text-center mb-3">
            Base: {libraryTotals.eligibleCount} vídeo(s) elegível(is) · {libraryTotals.views.toLocaleString('pt-BR')} views · {libraryTotals.likes.toLocaleString('pt-BR')} likes · {libraryTotals.comments.toLocaleString('pt-BR')} comentários
          </p>

          {/* Proportional participation */}
          <div className="space-y-3 mb-5">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Participação em Views</span>
                <span className="font-medium text-foreground">{pViews.toFixed(1)}%</span>
              </div>
              <Progress value={pViews} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Participação em Likes</span>
                <span className="font-medium text-foreground">{pLikes.toFixed(1)}%</span>
              </div>
              <Progress value={pLikes} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Participação em Comentários</span>
                <span className="font-medium text-foreground">{pComments.toFixed(1)}%</span>
              </div>
              <Progress value={pComments} className="h-2" />
            </div>
          </div>

          {/* Performance Weight */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Performance Weight</p>
            <p className="text-2xl font-bold text-primary">{weight.toFixed(1)}%</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Peso ponderado: Views {DNA_WEIGHT_CONFIG.views * 100}% · Likes {DNA_WEIGHT_CONFIG.likes * 100}% · Comentários {DNA_WEIGHT_CONFIG.comments * 100}%
            </p>
          </div>

          <div className="mt-3 space-y-1">
            <p className="text-[10px] text-muted-foreground text-center">
              Performance Weight representa a participação proporcional deste vídeo dentro da base de engagement, com base em views, likes e comentários reais.
            </p>
            <p className="text-[10px] text-muted-foreground text-center font-medium">
              ⚠ Performance Weight NÃO é avaliação de qualidade. É uma métrica observacional de participação proporcional.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
