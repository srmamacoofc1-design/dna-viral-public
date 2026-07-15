import type { VideoTranscript } from '@/types/video';

interface Props {
  transcripts: VideoTranscript[];
}

export function TranscriptionTab({ transcripts }: Props) {
  if (!transcripts.length) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <p>Nenhuma transcrição disponível.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-foreground">
        Transcrição Completa ({transcripts.length} segmentos)
      </h3>
      <div className="space-y-1">
        {transcripts.map((t) => (
          <div
            key={t.id}
            className="flex gap-3 py-2 px-3 rounded-lg hover:bg-card transition-colors group"
          >
            <span className="text-xs text-primary font-mono w-20 shrink-0 pt-0.5">
              {t.tempo_inicio}s–{t.tempo_fim}s
            </span>
            <p className="text-sm text-foreground leading-relaxed">
              "{t.texto}"
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
