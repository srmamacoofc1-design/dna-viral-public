import { useEffect, useState } from 'react';
import { Shield, AlertTriangle, CheckCircle2, XCircle, Database, FlaskConical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { ExtractionLog } from '@/types/video';
import { cn } from '@/lib/utils';

interface Props {
  videoId: string;
}

const SOURCE_LABELS: Record<string, { label: string; icon: string }> = {
  transcription: { label: 'Transcrição', icon: '🎙️' },
  visual_detection: { label: 'Detecção Visual', icon: '👁️' },
  metadata_import: { label: 'Importação', icon: '📥' },
  manual_entry: { label: 'Manual', icon: '✏️' },
  calculated: { label: 'Calculado', icon: '🔢' },
  ai_extraction: { label: 'IA', icon: '🤖' },
};

const ORIGIN_COLORS: Record<string, string> = {
  raw: 'text-emerald-400',
  calculated: 'text-blue-400',
};

export function ExtractionAuditLog({ videoId }: Props) {
  const [logs, setLogs] = useState<ExtractionLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('extraction_logs')
        .select('*')
        .eq('video_id', videoId)
        .order('extraction_step')
        .order('field_name');
      setLogs((data as any[]) || []);
      setLoading(false);
    }
    load();
  }, [videoId]);

  if (loading) return <div className="text-xs text-muted-foreground">Carregando logs de extração...</div>;
  if (logs.length === 0) return null;

  const totalFields = logs.length;
  const errorFields = logs.filter(l => l.error_flag).length;
  const avgConfidence = Math.round(logs.reduce((s, l) => s + l.confidence_score, 0) / totalFields);
  const rawCount = logs.filter(l => l.origin_level === 'raw').length;

  const grouped = logs.reduce<Record<string, ExtractionLog[]>>((acc, l) => {
    const step = l.extraction_step.split(':').slice(0, 2).join(':');
    (acc[step] ||= []).push(l);
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold text-muted-foreground">
        <Shield className="w-4 h-4 text-primary" />
        Rastreabilidade e Integridade dos Dados
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted/30 rounded p-2 text-center">
          <Database className="w-4 h-4 mx-auto text-primary mb-1" />
          <div className="text-lg font-bold text-foreground">{totalFields}</div>
          <div className="text-[10px] text-muted-foreground">Campos rastreados</div>
        </div>
        <div className="bg-muted/30 rounded p-2 text-center">
          <FlaskConical className="w-4 h-4 mx-auto text-blue-400 mb-1" />
          <div className="text-lg font-bold text-foreground">{avgConfidence}%</div>
          <div className="text-[10px] text-muted-foreground">Confiança média</div>
        </div>
        <div className="bg-muted/30 rounded p-2 text-center">
          <CheckCircle2 className="w-4 h-4 mx-auto text-emerald-400 mb-1" />
          <div className="text-lg font-bold text-foreground">{rawCount}</div>
          <div className="text-[10px] text-muted-foreground">Dados raw</div>
        </div>
        <div className="bg-muted/30 rounded p-2 text-center">
          <AlertTriangle className={cn('w-4 h-4 mx-auto mb-1', errorFields > 0 ? 'text-amber-400' : 'text-emerald-400')} />
          <div className="text-lg font-bold text-foreground">{errorFields}</div>
          <div className="text-[10px] text-muted-foreground">Não detectados</div>
        </div>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {Object.entries(grouped).map(([step, stepLogs]) => (
          <div key={step} className="border border-border/50 rounded p-2">
            <div className="text-[10px] font-mono font-semibold text-primary mb-1">{step}</div>
            <div className="space-y-0.5">
              {stepLogs.map(log => {
                const src = SOURCE_LABELS[log.source_type] || { label: log.source_type, icon: '❓' };
                return (
                  <div key={log.id} className="flex items-center gap-2 text-[10px]">
                    {log.error_flag ? (
                      <XCircle className="w-3 h-3 text-destructive shrink-0" />
                    ) : log.confidence_score >= 80 ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    )}
                    <span className="text-muted-foreground w-28 shrink-0 truncate">{log.field_name}</span>
                    <span className={cn('w-8 shrink-0 text-right font-mono',
                      log.confidence_score >= 80 ? 'text-emerald-400' : log.confidence_score >= 50 ? 'text-amber-400' : 'text-destructive'
                    )}>
                      {log.confidence_score}%
                    </span>
                    <span className="shrink-0">{src.icon}</span>
                    <span className={cn('shrink-0', ORIGIN_COLORS[log.origin_level] || 'text-muted-foreground')}>
                      {log.origin_level}
                    </span>
                    <span className="text-muted-foreground flex-1 truncate">
                      {log.extracted_value ? log.extracted_value.substring(0, 60) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
