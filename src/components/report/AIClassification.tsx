import { Brain, Pencil, Check, X } from 'lucide-react';
import { useState } from 'react';
import { SEGMENTOS, ESTILOS_VISUAIS } from '@/types/video';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

interface Props {
  video: Tables<'videos'>;
  onUpdate?: () => void;
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-bold text-foreground w-10 text-right">{value}%</span>
    </div>
  );
}

export function AIClassification({ video, onUpdate }: Props) {
  const [editingSegmento, setEditingSegmento] = useState(false);
  const [editingEstilo, setEditingEstilo] = useState(false);
  const [saving, setSaving] = useState(false);

  const segmentoIa = video.segmento_ia;
  const estiloIa = video.estilo_visual_ia;
  const confSegmento = video.confianca_segmento ?? 0;
  const confEstilo = video.confianca_estilo ?? 0;

  const segmentoLabel = SEGMENTOS.find(s => s.value === (segmentoIa || video.segmento));
  const estiloLabel = ESTILOS_VISUAIS.find(e => e.value === (estiloIa || video.estilo_visual));

  const hasAiClassification = segmentoIa || estiloIa;

  const handleSave = async (field: 'segmento' | 'estilo_visual', value: string) => {
    setSaving(true);
    try {
      const updatePayload: Record<string, string> = { [field]: value };
      const { error } = await supabase.from('videos').update(updatePayload as any).eq('id', video.id);
      if (error) throw error;
      toast.success('Classificação atualizada!');
      setEditingSegmento(false);
      setEditingEstilo(false);
      onUpdate?.();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider mb-4 flex items-center gap-2 font-semibold text-primary">
        <Brain className="w-4 h-4" />
        Classificação Automática por IA
      </h3>

      {!hasAiClassification && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-400">
            ⚠ Classificação por IA ainda não disponível para este vídeo. Mostrando classificação manual.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Segmento */}
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Segmento</span>
            {!editingSegmento ? (
              <button onClick={() => setEditingSegmento(true)} className="text-muted-foreground hover:text-primary">
                <Pencil className="w-3 h-3" />
              </button>
            ) : (
              <button onClick={() => setEditingSegmento(false)} className="text-muted-foreground hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {editingSegmento ? (
            <div className="space-y-1">
              {SEGMENTOS.map(s => (
                <button
                  key={s.value}
                  onClick={() => handleSave('segmento', s.value)}
                  disabled={saving}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-secondary flex items-center gap-2"
                >
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                  {s.value === video.segmento && <Check className="w-3 h-3 text-primary ml-auto" />}
                </button>
              ))}
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-foreground flex items-center gap-2">
                {segmentoLabel?.icon} {segmentoLabel?.label || segmentoIa || video.segmento}
                {segmentoIa && segmentoIa !== video.segmento && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    Manual: {SEGMENTOS.find(s => s.value === video.segmento)?.label}
                  </span>
                )}
              </p>
              {segmentoIa && <ConfidenceBar value={confSegmento} />}
            </>
          )}
        </div>

        {/* Estilo Visual */}
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Estilo Visual</span>
            {!editingEstilo ? (
              <button onClick={() => setEditingEstilo(true)} className="text-muted-foreground hover:text-primary">
                <Pencil className="w-3 h-3" />
              </button>
            ) : (
              <button onClick={() => setEditingEstilo(false)} className="text-muted-foreground hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {editingEstilo ? (
            <div className="space-y-1">
              {ESTILOS_VISUAIS.map(e => (
                <button
                  key={e.value}
                  onClick={() => handleSave('estilo_visual', e.value)}
                  disabled={saving}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-secondary flex items-center gap-2"
                >
                  <span>{e.icon}</span>
                  <span>{e.label}</span>
                  {e.value === video.estilo_visual && <Check className="w-3 h-3 text-primary ml-auto" />}
                </button>
              ))}
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-foreground flex items-center gap-2">
                {estiloLabel?.icon} {estiloLabel?.label || estiloIa || video.estilo_visual}
                {estiloIa && estiloIa !== video.estilo_visual && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    Manual: {ESTILOS_VISUAIS.find(e => e.value === video.estilo_visual)?.label}
                  </span>
                )}
              </p>
              {estiloIa && <ConfidenceBar value={confEstilo} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
