import { useEffect, useState } from 'react';
import { Shield, AlertTriangle, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ConsistencyIssue {
  id: string;
  video_id: string;
  validation_step: string;
  issue_type: string;
  severity: string;
  field_name: string | null;
  current_value: string | null;
  expected_rule: string;
  created_at: string;
}

interface Props {
  videoId?: string; // single video mode
  batchMode?: boolean; // all videos mode
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; label: string }> = {
  error: { icon: XCircle, color: 'text-destructive', label: 'Erro' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', label: 'Aviso' },
  info: { icon: CheckCircle2, color: 'text-blue-400', label: 'Info' },
};

const STEP_LABELS: Record<string, string> = {
  timestamps: '⏱️ Timestamps',
  block_overlap: '📐 Sobreposição',
  required_fields: '📋 Campos Obrigatórios',
  cta_coherence: '📣 Coerência CTA',
  raw_vs_calculated: '🔢 Raw vs Calculated',
};

export function ConsistencyValidator({ videoId, batchMode }: Props) {
  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [lastResult, setLastResult] = useState<{ validated: number; issues: number } | null>(null);

  const loadIssues = async () => {
    setLoading(true);
    let query = supabase.from('data_consistency_reports').select('*').order('severity').order('validation_step');
    if (videoId) query = query.eq('video_id', videoId);
    const { data } = await query.limit(500);
    setIssues((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadIssues(); }, [videoId]);

  const runValidation = async () => {
    setValidating(true);
    try {
      const payload = videoId ? { video_id: videoId } : {};
      const { data, error } = await supabase.functions.invoke('validate-data-consistency', { body: payload });
      if (error) throw error;
      setLastResult(data);
      await loadIssues();
    } catch (e) {
      console.error('Validation error:', e);
    }
    setValidating(false);
  };

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  const grouped = issues.reduce<Record<string, ConsistencyIssue[]>>((acc, i) => {
    (acc[i.validation_step] ||= []).push(i);
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider flex items-center gap-2 font-semibold text-muted-foreground">
          <Shield className="w-4 h-4 text-primary" />
          Validação de Consistência
        </h3>
        <Button size="sm" variant="outline" onClick={runValidation} disabled={validating} className="text-xs h-7">
          {validating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          {batchMode ? 'Validar Todos' : 'Validar'}
        </Button>
      </div>

      {lastResult && (
        <div className="text-xs text-muted-foreground mb-3 bg-muted/30 rounded p-2">
          Última validação: {lastResult.validated} vídeo(s) — {lastResult.issues} inconsistência(s)
        </div>
      )}

      {/* Summary */}
      <div className="flex gap-4 mb-3 text-xs">
        <span className={cn('flex items-center gap-1', errorCount > 0 ? 'text-destructive' : 'text-emerald-400')}>
          <XCircle className="w-3 h-3" /> {errorCount} erros
        </span>
        <span className={cn('flex items-center gap-1', warningCount > 0 ? 'text-amber-400' : 'text-emerald-400')}>
          <AlertTriangle className="w-3 h-3" /> {warningCount} avisos
        </span>
        {issues.length === 0 && !loading && (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> Sem inconsistências
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
        </div>
      ) : issues.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {Object.entries(grouped).map(([step, stepIssues]) => (
            <div key={step} className="border border-border/50 rounded p-2">
              <div className="text-[10px] font-semibold text-primary mb-1">
                {STEP_LABELS[step] || step}
              </div>
              <div className="space-y-0.5">
                {stepIssues.map(issue => {
                  const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.warning;
                  const Icon = cfg.icon;
                  return (
                    <div key={issue.id} className="flex items-start gap-2 text-[10px]">
                      <Icon className={cn('w-3 h-3 shrink-0 mt-0.5', cfg.color)} />
                      <div className="flex-1 min-w-0">
                        <span className="text-foreground">{issue.issue_type}</span>
                        {issue.field_name && (
                          <span className="text-muted-foreground ml-1">({issue.field_name})</span>
                        )}
                        <div className="text-muted-foreground truncate">
                          {issue.expected_rule}
                          {issue.current_value && <span className="ml-1 text-foreground">→ {issue.current_value}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
