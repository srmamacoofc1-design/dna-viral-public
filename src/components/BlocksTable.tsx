import { useState, useEffect } from 'react';
import type { VideoBlock } from '@/types/video';
import { TIPO_BLOCOS, EMOCOES } from '@/types/video';
import { Image, Brain, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BlockSemantics {
  block_id: string;
  block_type: string;
  block_text: string | null;
  block_keywords: string[];
  block_emotional_words: string[];
  block_repeated_words: string[];
  block_strong_phrases: string[];
  block_emotional_type: string | null;
  block_emotional_intensity: number | null;
  block_verbal_tone: string | null;
}

interface Props {
  blocks: VideoBlock[];
  activeBlockId?: string;
  videoId: string;
}

const TONE_COLORS: Record<string, string> = {
  urgente: 'text-red-400',
  misterioso: 'text-purple-400',
  íntimo: 'text-pink-400',
  técnico: 'text-blue-400',
  alarmante: 'text-orange-400',
  familiar: 'text-green-400',
  provocativo: 'text-amber-400',
  emocional: 'text-rose-400',
  curioso: 'text-cyan-400',
};

const INTENSITY_BARS = ['bg-muted', 'bg-yellow-500/60', 'bg-amber-500/70', 'bg-orange-500/80', 'bg-red-500/90'];

function intensityFromEmotion(emocao: string): number {
  const map: Record<string, number> = {
    impacto: 9, medo: 8, tensao: 7, surpresa: 7,
    curiosidade: 6, expectativa: 5, alivio: 3,
  };
  return map[emocao] || 5;
}

export function BlocksTable({ blocks, activeBlockId, videoId }: Props) {
  const [semantics, setSemantics] = useState<Record<string, BlockSemantics>>({});
  const [extracting, setExtracting] = useState(false);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [hasSemantics, setHasSemantics] = useState(false);

  // Load existing semantics
  useEffect(() => {
    if (!videoId) return;
    const load = async () => {
      const { data } = await supabase
        .from('block_semantic_patterns' as any)
        .select('*')
        .eq('video_id', videoId);
      if (data && data.length > 0) {
        const map: Record<string, BlockSemantics> = {};
        data.forEach((row: any) => {
          map[row.block_id] = {
            block_id: row.block_id,
            block_type: row.block_type,
            block_text: row.block_text,
            block_keywords: row.block_keywords || [],
            block_emotional_words: row.block_emotional_words || [],
            block_repeated_words: row.block_repeated_words || [],
            block_strong_phrases: row.block_strong_phrases || [],
            block_emotional_type: row.block_emotional_type,
            block_emotional_intensity: row.block_emotional_intensity,
            block_verbal_tone: row.block_verbal_tone,
          };
        });
        setSemantics(map);
        setHasSemantics(true);
      }
    };
    load();
  }, [videoId]);

  const handleExtract = async () => {
    setExtracting(true);
    toast.info('Extraindo camada semântica por bloco...');
    try {
      const { data, error } = await supabase.functions.invoke('extract-block-semantics', {
        body: { video_id: videoId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      toast.success(`Extração concluída: ${data.blocks_processed} blocos processados`);

      // Reload semantics
      const { data: fresh } = await supabase
        .from('block_semantic_patterns' as any)
        .select('*')
        .eq('video_id', videoId);
      if (fresh) {
        const map: Record<string, BlockSemantics> = {};
        fresh.forEach((row: any) => {
          map[row.block_id] = {
            block_id: row.block_id,
            block_type: row.block_type,
            block_text: row.block_text,
            block_keywords: row.block_keywords || [],
            block_emotional_words: row.block_emotional_words || [],
            block_repeated_words: row.block_repeated_words || [],
            block_strong_phrases: row.block_strong_phrases || [],
            block_emotional_type: row.block_emotional_type,
            block_emotional_intensity: row.block_emotional_intensity,
            block_verbal_tone: row.block_verbal_tone,
          };
        });
        setSemantics(map);
        setHasSemantics(true);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erro na extração semântica');
    } finally {
      setExtracting(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedBlocks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">Blocos Narrativos ({blocks.length})</h3>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={handleExtract}
          disabled={extracting || blocks.length === 0}
        >
          {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
          {hasSemantics ? 'Reextrair Semântica' : 'Extrair Semântica'}
        </Button>
      </div>

      <div className="space-y-2">
        {blocks.slice(0, 30).map((block) => {
          const tipo = TIPO_BLOCOS.find(t => t.value === block.tipo_bloco);
          const emo = EMOCOES.find(e => e.value === block.emocao);
          const intensity = intensityFromEmotion(block.emocao);
          const isActive = activeBlockId === block.id;
          const sem = semantics[block.id];
          const isExpanded = expandedBlocks.has(block.id);

          return (
            <div
              key={block.id}
              id={`block-${block.id}`}
              className={`bg-card border rounded-lg p-3 space-y-2 transition-colors ${isActive ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-16 h-12 rounded bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                  {block.frame_url && block.frame_url !== '/placeholder.svg' ? (
                    <img src={block.frame_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Image className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-primary">{block.tempo_inicio}s–{block.tempo_fim}s</span>
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                      style={{ backgroundColor: `${tipo?.color}20`, color: tipo?.color }}>
                      {tipo?.label}
                    </span>
                    <span className="text-xs">{emo?.icon} {emo?.label}</span>
                    <span className="text-xs text-muted-foreground">{intensity}/10</span>
                  </div>
                  {block.texto && (
                    <p className="text-sm text-foreground mt-1 leading-relaxed">"{block.texto}"</p>
                  )}
                </div>

                {sem && (
                  <button
                    onClick={() => toggleExpand(block.id)}
                    className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {/* Semantic data panel */}
              {sem && isExpanded && (
                <div className="border-t border-border pt-3 mt-2 space-y-3 text-xs">
                  {/* Tone + Emotion + Intensity */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-muted-foreground">Tom:</span>
                    <span className={`font-medium ${TONE_COLORS[sem.block_verbal_tone || ''] || 'text-foreground'}`}>
                      {sem.block_verbal_tone || '—'}
                    </span>
                    <span className="text-muted-foreground ml-2">Emoção:</span>
                    <span className="font-medium text-foreground">{sem.block_emotional_type || '—'}</span>
                    <span className="text-muted-foreground ml-2">Intensidade:</span>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(i => (
                        <div
                          key={i}
                          className={`w-3 h-2 rounded-sm ${i <= (sem.block_emotional_intensity || 0) ? INTENSITY_BARS[Math.min(i - 1, 4)] : 'bg-muted/30'}`}
                        />
                      ))}
                    </div>
                    <span className="text-muted-foreground">{sem.block_emotional_intensity}/5</span>
                  </div>

                  {/* Keywords */}
                  {sem.block_keywords.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Palavras-chave:</span>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {sem.block_keywords.map((w, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Emotional words */}
                  {sem.block_emotional_words.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Palavras emocionais:</span>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {sem.block_emotional_words.map((w, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-rose-500/10 text-rose-400 rounded text-[10px]">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Repeated words */}
                  {sem.block_repeated_words.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Palavras repetidas:</span>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {sem.block_repeated_words.map((w, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded text-[10px]">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Strong phrases */}
                  {sem.block_strong_phrases.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Frases marcantes:</span>
                      <div className="mt-1 space-y-0.5">
                        {sem.block_strong_phrases.map((p, i) => (
                          <p key={i} className="text-foreground italic">"{p}"</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Small indicator if has semantics but collapsed */}
              {sem && !isExpanded && (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Brain className="w-3 h-3" />
                  <span className={TONE_COLORS[sem.block_verbal_tone || ''] || ''}>
                    {sem.block_verbal_tone}
                  </span>
                  <span>· {sem.block_emotional_type} · {sem.block_emotional_intensity}/5</span>
                  {sem.block_keywords.length > 0 && (
                    <span>· {sem.block_keywords.slice(0, 3).join(', ')}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {blocks.length > 30 && (
          <p className="text-xs text-muted-foreground text-center py-3">+ {blocks.length - 30} blocos adicionais</p>
        )}
      </div>
    </div>
  );
}
