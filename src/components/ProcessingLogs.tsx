import type { ProcessingLog } from '@/types/video';
import { CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  logs: ProcessingLog[];
}

const statusIcons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
};

export function ProcessingLogs({ logs }: Props) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-foreground">Logs de Processamento</h3>
      <div className="space-y-1">
        {logs.map((log) => {
          const Icon = statusIcons[log.status];
          return (
            <div
              key={log.id}
              className={cn(
                'flex items-center gap-3 py-2 px-3 rounded-lg text-sm',
                log.status === 'error' && 'bg-destructive/5',
                log.status === 'warning' && 'bg-warning/5',
              )}
            >
              <Icon className={cn(
                'w-4 h-4 shrink-0',
                log.status === 'success' && 'text-success',
                log.status === 'error' && 'text-destructive',
                log.status === 'warning' && 'text-warning',
              )} />
              <span className="text-xs text-muted-foreground w-24 shrink-0">{log.etapa}</span>
              <span className="text-foreground flex-1">{log.mensagem}</span>
              {log.duracao_ms && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Clock className="w-3 h-3" />
                  {log.duracao_ms}ms
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground border-t border-border pt-3">
        Tempo total: {logs.reduce((acc, l) => acc + (l.duracao_ms || 0), 0).toLocaleString()}ms
      </div>
    </div>
  );
}
