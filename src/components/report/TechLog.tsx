import { Terminal } from 'lucide-react';
import type { Video, ProcessingLog } from '@/types/video';

interface Props {
  video: Video;
  logs: ProcessingLog[];
}

export function TechLog({ video, logs }: Props) {
  const totalProcessingMs = logs.reduce((sum, l) => sum + (l.duracao_ms || 0), 0);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
        <Terminal className="w-4 h-4 text-primary" />
        Log Técnico
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Modelo transcrição</span>
          <p className="font-medium text-foreground">Gemini 2.5 Flash</p>
        </div>
        <div>
          <span className="text-muted-foreground">Modelo análise</span>
          <p className="font-medium text-foreground">Gemini 2.5 Flash</p>
        </div>
        <div>
          <span className="text-muted-foreground">Tempo processamento</span>
          <p className="font-medium text-foreground">{totalProcessingMs > 0 ? `${(totalProcessingMs / 1000).toFixed(1)}s` : '—'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Tamanho do vídeo</span>
          <p className="font-medium text-foreground">{video.tamanho ? `${(video.tamanho / 1e6).toFixed(1)} MB` : '—'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Formato</span>
          <p className="font-medium text-foreground">{video.codec || '—'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Resolução</span>
          <p className="font-medium text-foreground">{video.resolucao || '—'}</p>
        </div>
      </div>

      {logs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-1">
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-2 text-[10px] font-mono">
              <span className={log.status === 'success' ? 'text-green-400' : log.status === 'error' ? 'text-red-400' : 'text-amber-400'}>
                {log.status === 'success' ? '✔' : log.status === 'error' ? '✘' : '⚠'}
              </span>
              <span className="text-muted-foreground">{log.etapa}</span>
              <span className="text-foreground flex-1 truncate">{log.mensagem}</span>
              {log.duracao_ms && <span className="text-muted-foreground">{log.duracao_ms}ms</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
