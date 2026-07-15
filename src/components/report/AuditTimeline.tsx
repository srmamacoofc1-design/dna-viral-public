import { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronRight, ArrowRight, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface AuditEntry {
  id: string;
  created_at: string;
  table_name: string;
  record_id: string;
  change_type: string;
  field_name: string | null;
  previous_value: string | null;
  new_value: string | null;
  changed_by: string;
}

interface Props {
  videoId: string;
}

const CHANGE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  insert: { label: 'Criado', color: 'text-emerald-400', icon: '➕' },
  update: { label: 'Atualizado', color: 'text-blue-400', icon: '✏️' },
  delete: { label: 'Removido', color: 'text-destructive', icon: '🗑️' },
};

const TABLE_LABELS: Record<string, string> = {
  videos: '🎬 Vídeo',
  video_blocks: '🧱 Blocos',
  video_transcripts: '📝 Transcrição',
  video_logs: '📋 Logs',
  processing_queue: '⚙️ Fila',
  semantic_patterns: '🧠 Semântica',
  block_semantic_patterns: '🔬 Semântica/Bloco',
  block_word_patterns: '📖 Palavras',
  block_phrase_patterns: '💬 Frases',
  cta_profiles: '📣 CTA',
  extraction_logs: '🔍 Extração',
  data_consistency_reports: '✅ Validação',
  video_metadata: '🏷️ Metadata',
};

export function AuditTimeline({ videoId }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      // Get audit entries for this video (direct match on record_id or from related tables)
      const { data } = await supabase
        .from('audit_trail')
        .select('*')
        .or(`record_id.eq.${videoId},new_value.ilike.%${videoId}%,previous_value.ilike.%${videoId}%`)
        .order('created_at', { ascending: false })
        .limit(200);
      setEntries((data as any[]) || []);
      setLoading(false);
    }
    load();
  }, [videoId]);

  if (loading) return <div className="text-xs text-muted-foreground">Carregando audit trail...</div>;
  if (entries.length === 0) return null;

  // Group by date + table
  const grouped: Record<string, AuditEntry[]> = {};
  for (const e of entries) {
    const dateKey = format(new Date(e.created_at), 'dd/MM/yyyy HH:mm');
    const key = `${dateKey}|${e.table_name}|${e.change_type}`;
    (grouped[key] ||= []).push(e);
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Stats
  const insertCount = entries.filter(e => e.change_type === 'insert').length;
  const updateCount = entries.filter(e => e.change_type === 'update').length;
  const deleteCount = entries.filter(e => e.change_type === 'delete').length;
  const tablesAffected = new Set(entries.map(e => e.table_name)).size;

  function exportCsv() {
    const headers = ['data', 'tabela', 'tipo', 'record_id', 'campo', 'valor_anterior', 'valor_novo', 'alterado_por'];
    const rows = entries.map(e => [
      e.created_at,
      e.table_name,
      e.change_type,
      e.record_id,
      e.field_name || '',
      (e.previous_value || '').replace(/"/g, '""'),
      (e.new_value || '').replace(/"/g, '""'),
      e.changed_by,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_trail_${videoId.substring(0, 8)}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider flex items-center gap-2 font-semibold text-muted-foreground">
          <History className="w-4 h-4 text-primary" />
          Audit Trail — Histórico de Alterações
        </h3>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
        >
          <Download className="w-3 h-3" /> Exportar CSV
        </button>
      </div>

      {/* Summary */}
      <div className="flex gap-4 mb-3 text-xs flex-wrap">
        <span className="text-emerald-400">➕ {insertCount} inserts</span>
        <span className="text-blue-400">✏️ {updateCount} updates</span>
        <span className="text-destructive">🗑️ {deleteCount} deletes</span>
        <span className="text-muted-foreground">{tablesAffected} tabelas • {entries.length} registros</span>
      </div>

      {/* Timeline */}
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {Object.entries(grouped).map(([key, groupEntries]) => {
          const [dateStr, table, changeType] = key.split('|');
          const cfg = CHANGE_CONFIG[changeType] || CHANGE_CONFIG.update;
          const tableLabel = TABLE_LABELS[table] || table;
          const isExpanded = expandedGroups.has(key);
          const fieldChanges = groupEntries.filter(e => e.field_name);

          return (
            <div key={key} className="border border-border/30 rounded">
              <button
                onClick={() => toggleGroup(key)}
                className="w-full flex items-center gap-2 p-2 text-[10px] hover:bg-muted/30 transition-colors text-left"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                <span className="text-muted-foreground shrink-0">{dateStr}</span>
                <span className={cn('shrink-0', cfg.color)}>{cfg.icon} {cfg.label}</span>
                <span className="text-foreground">{tableLabel}</span>
                <span className="text-muted-foreground ml-auto">{groupEntries.length} campo(s)</span>
              </button>

              {isExpanded && fieldChanges.length > 0 && (
                <div className="px-2 pb-2 space-y-0.5 border-t border-border/20 pt-1">
                  {fieldChanges.map(e => (
                    <div key={e.id} className="flex items-start gap-2 text-[10px] pl-5">
                      <span className="text-primary font-mono shrink-0 w-32 truncate">{e.field_name}</span>
                      {e.previous_value && (
                        <span className="text-muted-foreground truncate max-w-[100px]">
                          {e.previous_value.substring(0, 40)}
                        </span>
                      )}
                      {e.previous_value && e.new_value && (
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                      {e.new_value && (
                        <span className="text-foreground truncate max-w-[100px]">
                          {e.new_value.substring(0, 40)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isExpanded && fieldChanges.length === 0 && (
                <div className="px-2 pb-2 text-[10px] text-muted-foreground pl-5 border-t border-border/20 pt-1">
                  {changeType === 'insert' ? 'Registro criado (dados completos no campo new_value)' :
                   changeType === 'delete' ? 'Registro removido' : 'Sem detalhes de campos'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
