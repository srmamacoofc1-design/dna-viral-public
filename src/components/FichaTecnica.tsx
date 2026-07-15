import { useNavigate } from 'react-router-dom';
import type { Video } from '@/types/video';
import { SEGMENTOS, ESTILOS_VISUAIS, EMOCOES } from '@/types/video';
import { StatusBadge } from '@/components/StatusBadge';
import { EngagementBadge, getEngagementPercentile, getPercentileBand } from '@/components/EngagementBadge';
import { Clock, Monitor, Film, HardDrive, Globe, Zap, Hash, BarChart3, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface FichaProps {
  video: Video;
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 min-w-0">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground font-medium break-all">{value || <span className="text-muted-foreground italic">não detectado</span>}</p>
      </div>
    </div>
  );
}

export function FichaTecnica({ video }: FichaProps) {
  const navigate = useNavigate();
  const seg = SEGMENTOS.find(s => s.value === video.segmento);
  const est = ESTILOS_VISUAIS.find(e => e.value === video.estilo_visual);
  const emo = EMOCOES.find(e => e.value === video.emocao_predominante);
  const score = getEngagementPercentile(video);

  const deleteVideo = async () => {
    const { error } = await supabase.from('videos').delete().eq('id', video.id);
    if (error) { toast.error('Erro ao apagar vídeo'); return; }
    toast.success('Vídeo apagado');
    navigate('/library');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-lg text-foreground">{video.titulo || 'Sem título'}</h2>
          <p className="text-sm text-muted-foreground mt-1">{video.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <EngagementBadge percentile={score} />
          <StatusBadge status={video.status} />
        </div>
      </div>

      {/* Viral Score */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs text-primary uppercase tracking-wider flex items-center gap-2"><Zap className="w-4 h-4" /> Engagement Percentile</h3>
          <p className="text-3xl font-bold text-foreground mt-1">{score != null ? `P${score}` : '—'}</p>
        </div>
        {score != null && (
          <EngagementBadge percentile={score} size="lg" showBand={true} />
        )}
      </div>

      {/* Dados Técnicos */}
      <div className="bg-card rounded-lg p-4 border border-border">
        <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">Dados Técnicos</h3>
        <div className="grid grid-cols-2 gap-x-6">
          <InfoRow icon={Clock} label="Duração" value={video.duracao ? `${video.duracao}s` : undefined} />
          <InfoRow icon={Monitor} label="Resolução" value={video.resolucao} />
          <InfoRow icon={Film} label="FPS" value={video.fps} />
          <InfoRow icon={HardDrive} label="Tamanho" value={video.tamanho ? `${(video.tamanho / 1e6).toFixed(1)} MB` : undefined} />
          <InfoRow icon={Globe} label="Idioma" value={video.idioma} />
          <InfoRow icon={Hash} label="Codec" value={video.codec} />
          <InfoRow icon={BarChart3} label="Frames" value={video.numero_frames} />
          <InfoRow icon={BarChart3} label="Blocos" value={video.numero_blocos} />
        </div>
      </div>

      {/* Classificação */}
      <div className="bg-card rounded-lg p-4 border border-border">
        <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">Classificação</h3>
        <div className="grid grid-cols-2 gap-x-6">
          <InfoRow icon={BarChart3} label="Segmento" value={seg ? `${seg.icon} ${seg.label}` : 'Aguardando classificação'} />
          <InfoRow icon={Film} label="Estilo Visual" value={est ? `${est.icon} ${est.label}` : 'Aguardando classificação'} />
          <InfoRow icon={BarChart3} label="Tipo Viral" value={video.tipo_viral} />
          <InfoRow icon={BarChart3} label="Emoção Predominante" value={emo ? `${emo.icon} ${emo.label}` : undefined} />
          <InfoRow icon={BarChart3} label="Intensidade" value={video.intensidade_emocional} />
        </div>
      </div>

      {/* Gancho */}
      {video.gancho_detectado && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <h3 className="font-semibold text-xs text-primary uppercase tracking-wider mb-3 flex items-center gap-2"><Zap className="w-4 h-4" /> Gancho Detectado</h3>
          <div className="grid grid-cols-2 gap-x-6">
            <InfoRow icon={Clock} label="Início" value={video.tempo_gancho != null ? `${Number(video.tempo_gancho).toFixed(3)}s` : '—'} />
            <InfoRow icon={Clock} label="Duração" value={video.duracao_gancho != null ? `${Number(video.duracao_gancho).toFixed(3)}s` : '—'} />
            <InfoRow icon={Zap} label="Tipo" value={video.tipo_gancho} />
          </div>
        </div>
      )}

      {/* Estrutura */}
      <div className="bg-card rounded-lg p-4 border border-border">
        <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">Estrutura Narrativa</h3>
        <div className="grid grid-cols-2 gap-x-6">
          <InfoRow icon={Clock} label="1º Evento" value={video.tempo_primeiro_evento != null ? `${Number(video.tempo_primeiro_evento).toFixed(3)}s` : undefined} />
          <InfoRow icon={Clock} label="1ª Revelação" value={video.tempo_primeira_revelacao != null ? `${Number(video.tempo_primeira_revelacao).toFixed(3)}s` : undefined} />
          <InfoRow icon={Clock} label="Payoff" value={video.tempo_payoff != null ? `${Number(video.tempo_payoff).toFixed(3)}s` : undefined} />
          <InfoRow icon={BarChart3} label="Loop Detectado" value={video.loop_detectado ? 'Sim ↻' : 'Não'} />
          <InfoRow icon={Clock} label="1º Impacto" value={video.first_impact_time != null ? `${Number(video.first_impact_time).toFixed(3)}s` : undefined} />
        </div>
      </div>

      {/* Camada Verbal do Gancho */}
      {(video.hook_text || video.hook_phrase_pattern || video.hook_type_verbal || video.hook_emotion_verbal) && (
        <div className="bg-card rounded-lg p-4 border border-border">
          <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">🗣️ Análise Verbal do Gancho</h3>
          <div className="grid grid-cols-2 gap-x-6">
            {video.hook_text && <InfoRow icon={BarChart3} label="Texto do hook" value={video.hook_text} />}
            {video.hook_phrase_pattern && <InfoRow icon={BarChart3} label="Padrão de frase" value={video.hook_phrase_pattern} />}
            {video.hook_type_verbal && <InfoRow icon={BarChart3} label="Tipo verbal" value={video.hook_type_verbal} />}
            {video.hook_emotion_verbal && <InfoRow icon={BarChart3} label="Emoção verbal" value={video.hook_emotion_verbal} />}
            {video.hook_emotion_intensity != null && <InfoRow icon={BarChart3} label="Intensidade emocional" value={`${video.hook_emotion_intensity}%`} />}
            {video.hook_keywords && Array.isArray(video.hook_keywords) && video.hook_keywords.length > 0 && (
              <InfoRow icon={BarChart3} label="Palavras-chave" value={(video.hook_keywords as string[]).join(', ')} />
            )}
          </div>
        </div>
      )}

      {/* Progressão Narrativa */}
      {(video.narrative_progression_type || video.micro_turn_count != null) && (
        <div className="bg-card rounded-lg p-4 border border-border">
          <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">📈 Progressão Narrativa</h3>
          <div className="grid grid-cols-2 gap-x-6">
            {video.narrative_progression_type && <InfoRow icon={BarChart3} label="Tipo de progressão" value={video.narrative_progression_type} />}
            {video.micro_turn_count != null && <InfoRow icon={BarChart3} label="Micro-viradas" value={video.micro_turn_count} />}
            {video.micro_turn_types && Array.isArray(video.micro_turn_types) && (
              <InfoRow icon={BarChart3} label="Tipos de virada" value={(video.micro_turn_types as string[]).join(', ')} />
            )}
          </div>
        </div>
      )}

      {/* Payoff Verbal */}
      {(video.payoff_text || video.payoff_type || video.payoff_emotion) && (
        <div className="bg-card rounded-lg p-4 border border-border">
          <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">🎯 Análise Verbal do Payoff</h3>
          <div className="grid grid-cols-2 gap-x-6">
            {video.payoff_text && <InfoRow icon={BarChart3} label="Texto do payoff" value={video.payoff_text} />}
            {video.payoff_type && <InfoRow icon={BarChart3} label="Tipo" value={video.payoff_type} />}
            {video.payoff_emotion && <InfoRow icon={BarChart3} label="Emoção" value={video.payoff_emotion} />}
          </div>
        </div>
      )}

      {/* CTA */}
      {(video.cta_text || video.cta_type || video.cta_position_time != null) && (
        <div className="bg-card rounded-lg p-4 border border-border">
          <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">📢 Classificação de CTA</h3>
          <div className="grid grid-cols-2 gap-x-6">
            {video.cta_text && <InfoRow icon={BarChart3} label="Texto" value={video.cta_text} />}
            {video.cta_type && <InfoRow icon={BarChart3} label="Tipo" value={video.cta_type} />}
            {video.cta_position_time != null && <InfoRow icon={Clock} label="Posição" value={`${Number(video.cta_position_time).toFixed(3)}s`} />}
            {video.cta_intrusion_score != null && <InfoRow icon={BarChart3} label="Intrusão" value={`${video.cta_intrusion_score}/100`} />}
            {video.cta_flow_break_score != null && <InfoRow icon={BarChart3} label="Quebra de fluxo" value={`${video.cta_flow_break_score}/100`} />}
          </div>
        </div>
      )}

      {/* Origem */}
      <div className="bg-card rounded-lg p-4 border border-border">
        <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-3">Origem</h3>
        <div className="grid grid-cols-2 gap-x-6">
          <InfoRow icon={Globe} label="Fonte" value={video.origem} />
          <InfoRow icon={BarChart3} label="Tipo Entrada" value={video.tipo_entrada} />
          <InfoRow icon={Clock} label="Enviado em" value={new Date(video.data_envio).toLocaleString('pt-BR')} />
        </div>
      </div>

      {/* Delete */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10">
            <Trash2 className="w-4 h-4 mr-2" /> Apagar Vídeo
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar vídeo?</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja apagar este vídeo? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteVideo} className="bg-destructive text-destructive-foreground">Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
