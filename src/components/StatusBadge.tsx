import { Badge } from '@/components/ui/badge';
import type { ProcessingStatus } from '@/types/video';
import { cn } from '@/lib/utils';

const statusConfig: Record<ProcessingStatus, { label: string; className: string }> = {
  pending: { label: 'Pendente', className: 'bg-warning/15 text-warning border-warning/30' },
  processing: { label: 'Processando', className: 'bg-info/15 text-info border-info/30 animate-pulse' },
  completed: { label: 'Concluído', className: 'bg-success/15 text-success border-success/30' },
  failed: { label: 'Falhou', className: 'bg-destructive/15 text-destructive border-destructive/30' },
};

export function StatusBadge({ status, className }: { status: ProcessingStatus; className?: string }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', config.className, className)}>
      {config.label}
    </Badge>
  );
}
