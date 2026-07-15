import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Zap, RefreshCw, BookOpen, Filter, FileDown } from 'lucide-react';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { toast } from 'sonner';

interface LexiconWord {
  id: string;
  word: string;
  frequency_total: number;
  frequency_by_position: Record<string, number>;
  narrative_position: string | null;
  emotional_association: string | null;
  performance_weighted_score: number;
}

interface PhraseEntry {
  id: string;
  phrase_text: string;
  frequency_count: number;
  narrative_position: string | null;
  emotional_trigger: string | null;
  performance_weight: number;
}

const POSITIONS = ['hook', 'setup', 'desenvolvimento', 'tensao', 'revelacao', 'payoff', 'transicao', 'loop'];
const POS_LABELS: Record<string, string> = {
  hook: '🪝 Hook', setup: '📋 Setup', desenvolvimento: '📖 Dev', tensao: '⚡ Tensão',
  revelacao: '💡 Revelação', payoff: '🎯 Payoff', transicao: '🔄 Transição', loop: '🔁 Loop',
};

export default function LexiconPage() {
  const [words, setWords] = useState<LexiconWord[]>([]);
  const [phrases, setPhrases] = useState<PhraseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [posFilter, setPosFilter] = useState<string>('all');
  const [perfFilter, setPerfFilter] = useState<string>('all');

  const loadData = async () => {
    setLoading(true);
    const [{ data: w }, { data: p }] = await Promise.all([
      supabase.from('viral_lexicon_global').select('*').order('frequency_total', { ascending: false }).limit(500),
      supabase.from('viral_phrase_bank').select('*').order('frequency_count', { ascending: false }).limit(200),
    ]);
    setWords((w || []) as any);
    setPhrases((p || []) as any);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const runUpdate = async () => {
    setUpdating(true);
    try {
      const { error } = await supabase.functions.invoke('update-viral-lexicon', { body: {} });
      if (error) throw error;
      toast.success('Léxico viral atualizado');
      await loadData();
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || 'desconhecido'));
    }
    setUpdating(false);
  };

  // Filter words
  const filteredWords = words.filter(w => {
    if (posFilter !== 'all' && w.narrative_position !== posFilter) return false;
    if (perfFilter === 'high' && w.performance_weighted_score < 50) return false;
    if (perfFilter === 'medium' && (w.performance_weighted_score < 20 || w.performance_weighted_score >= 50)) return false;
    if (perfFilter === 'low' && w.performance_weighted_score >= 20) return false;
    return true;
  });

  const filteredPhrases = phrases.filter(p => {
    if (posFilter !== 'all' && p.narrative_position !== posFilter) return false;
    return true;
  });

  // Stats
  const activeWords = words.filter(w => w.frequency_total >= 3);
  const noisyWords = words.filter(w => w.frequency_total < 3);
  const noiseRatio = words.length > 0 ? ((noisyWords.length / words.length) * 100).toFixed(1) : '0';

  // Top words per position
  const wordsByPosition = POSITIONS.map(pos => ({
    position: pos,
    label: POS_LABELS[pos] || pos,
    words: words.filter(w => w.narrative_position === pos).slice(0, 5),
  })).filter(g => g.words.length > 0);

  return (
    <AppLayout>
      <div className="space-y-6 p-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Léxico Viral</h1>
              <p className="text-xs text-muted-foreground">Palavras e frases com maior peso narrativo e performance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => exportPageAsPDF('Léxico Viral')} className="print:hidden">
              <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
            </Button>
            <Button onClick={runUpdate} disabled={updating} size="sm">
              <RefreshCw className={`h-4 w-4 mr-1 ${updating ? 'animate-spin' : ''}`} />
              {updating ? 'Atualizando...' : 'Atualizar Léxico'}
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-primary">{activeWords.length}</div>
            <div className="text-xs text-muted-foreground">Palavras Ativas</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-muted-foreground">{noisyWords.length}</div>
            <div className="text-xs text-muted-foreground">Ruído Filtrado</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{phrases.length}</div>
            <div className="text-xs text-muted-foreground">Frases Ativas</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <div className={`text-2xl font-bold ${Number(noiseRatio) > 50 ? 'text-amber-500' : 'text-emerald-500'}`}>{noiseRatio}%</div>
            <div className="text-xs text-muted-foreground">Ratio de Ruído</div>
          </CardContent></Card>
        </div>

        {/* Top Words by Position */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">🗺️ Top Palavras por Posição Narrativa</CardTitle>
          </CardHeader>
          <CardContent>
            {wordsByPosition.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado de posição disponível.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {wordsByPosition.map(g => (
                  <div key={g.position} className="bg-muted/20 rounded-lg p-3">
                    <div className="text-sm font-medium mb-2">{g.label}</div>
                    <div className="space-y-1">
                      {g.words.map((w, i) => (
                        <div key={w.id} className="flex items-center justify-between text-xs">
                          <span className="font-mono">{i + 1}. {w.word}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">×{w.frequency_total}</span>
                            <Badge variant="outline" className="text-[10px]">{w.performance_weighted_score.toFixed(1)}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={posFilter} onValueChange={setPosFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Posição" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas posições</SelectItem>
              {POSITIONS.map(p => <SelectItem key={p} value={p}>{POS_LABELS[p] || p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={perfFilter} onValueChange={setPerfFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Performance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda performance</SelectItem>
              <SelectItem value="high">Alta (≥50)</SelectItem>
              <SelectItem value="medium">Média (20-49)</SelectItem>
              <SelectItem value="low">Baixa (&lt;20)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Words Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              📝 Palavras <Badge variant="outline">{filteredWords.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {filteredWords.slice(0, 100).map((w, i) => (
                  <div key={w.id} className="flex items-center justify-between bg-muted/10 rounded px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
                      <span className="font-mono text-sm font-medium">{w.word}</span>
                      {w.emotional_association && (
                        <Badge variant="secondary" className="text-[10px]">{w.emotional_association}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {w.narrative_position && (
                        <Badge variant="outline" className="text-[10px]">{POS_LABELS[w.narrative_position] || w.narrative_position}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">×{w.frequency_total}</span>
                      <span className={`text-xs font-bold ${w.performance_weighted_score >= 50 ? 'text-emerald-500' : w.performance_weighted_score >= 20 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                        {w.performance_weighted_score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Phrases */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              💬 Frases Virais <Badge variant="outline">{filteredPhrases.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {filteredPhrases.slice(0, 50).map((p, i) => (
                <div key={p.id} className="flex items-center justify-between bg-muted/10 rounded px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
                    <span className="font-mono text-sm">{p.phrase_text}</span>
                    {p.emotional_trigger && (
                      <Badge variant="secondary" className="text-[10px]">{p.emotional_trigger}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {p.narrative_position && (
                      <Badge variant="outline" className="text-[10px]">{POS_LABELS[p.narrative_position] || p.narrative_position}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">×{p.frequency_count}</span>
                    <span className="text-xs font-bold">{p.performance_weight.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
