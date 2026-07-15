import { useState, useRef } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileSpreadsheet, Upload, RefreshCw, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ImportResult {
  total_lidas: number;
  importados: number;
  atualizados?: number;
  ignorados: number;
  erros: number;
  detalhes: Array<{
    linha: number;
    codigo: string | null;
    status: 'importado' | 'atualizado' | 'ignorado' | 'erro';
    motivo?: string;
  }>;
}

export default function ImportPage() {
  const [sheetUrl, setSheetUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const doImport = async (payload: { csv_text?: string; sheet_url?: string }) => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('import-spreadsheet', {
        body: payload,
      });
      if (error) throw error;
      setResult(data as ImportResult);
      toast({
        title: '✅ Importação concluída',
        description: `${data.importados} novos, ${data.atualizados || 0} atualizados, ${data.ignorados} ignorados, ${data.erros} erros`,
      });
    } catch (err: any) {
      toast({ title: 'Erro na importação', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSheetImport = () => {
    if (!sheetUrl.trim()) {
      toast({ title: 'URL obrigatória', description: 'Cole a URL da Google Sheet.', variant: 'destructive' });
      return;
    }
    doImport({ sheet_url: sheetUrl.trim() });
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      doImport({ csv_text: text });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSyncNew = () => {
    if (!sheetUrl.trim()) {
      toast({ title: 'URL obrigatória', description: 'Configure a URL da planilha primeiro.', variant: 'destructive' });
      return;
    }
    doImport({ sheet_url: sheetUrl.trim() });
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <FileSpreadsheet className="w-6 h-6 text-primary" />
            <h1 className="font-semibold text-2xl text-foreground">Importar por Planilha</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Importe vídeos de uma Google Sheet ou CSV. Colunas aceitas: <code className="text-xs bg-secondary px-1 rounded">codigo_planilha, link_drive_video, link_imagem_engajamento</code>
            <br />
            <span className="text-xs text-muted-foreground/70">
              O vídeo é processado pelo link do Drive. Título e engajamento são extraídos automaticamente da <strong className="text-foreground">imagem de engajamento</strong> (print da plataforma).
              Opcionalmente, use <code className="text-xs bg-secondary px-1 rounded">link_plataforma</code> como fallback.
            </span>
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <h2 className="text-sm font-medium text-foreground">Google Sheet (URL pública)</h2>
          <p className="text-xs text-muted-foreground">
            A planilha deve estar configurada como <strong className="text-foreground">acessível a qualquer pessoa com o link</strong>.
          </p>
          <Input
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="bg-secondary border-border"
          />
          <div className="flex gap-3">
            <Button onClick={handleSheetImport} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Importar da Planilha
            </Button>
            <Button variant="outline" onClick={handleSyncNew} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Buscar vídeos novos
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <h2 className="text-sm font-medium text-foreground">Upload de CSV</h2>
          <p className="text-xs text-muted-foreground">
            Exporte a planilha como CSV e faça upload aqui.
          </p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />}
            Selecionar CSV
          </Button>
        </div>

        {result && (
          <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <h2 className="text-sm font-medium text-foreground">Resultado da Importação</h2>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{result.total_lidas}</p>
                <p className="text-xs text-muted-foreground">Linhas lidas</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-400">{result.importados}</p>
                <p className="text-xs text-muted-foreground">Importados</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-400">{result.atualizados || 0}</p>
                <p className="text-xs text-muted-foreground">Atualizados</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-400">{result.ignorados}</p>
                <p className="text-xs text-muted-foreground">Ignorados</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-400">{result.erros}</p>
                <p className="text-xs text-muted-foreground">Erros</p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border sticky top-0 bg-card">
                  <tr>
                    <th className="text-left py-2 px-2">Linha</th>
                    <th className="text-left py-2 px-2">Código</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {result.detalhes.map((d, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 px-2 text-muted-foreground">{d.linha}</td>
                      <td className="py-2 px-2 text-foreground">{d.codigo || '—'}</td>
                      <td className="py-2 px-2">
                        <span className={cn(
                          'inline-flex items-center gap-1',
                          d.status === 'importado' && 'text-green-400',
                          d.status === 'atualizado' && 'text-blue-400',
                          d.status === 'ignorado' && 'text-amber-400',
                          d.status === 'erro' && 'text-red-400',
                        )}>
                          {d.status === 'importado' && <CheckCircle className="w-3 h-3" />}
                          {d.status === 'atualizado' && <CheckCircle className="w-3 h-3" />}
                          {d.status === 'ignorado' && <AlertTriangle className="w-3 h-3" />}
                          {d.status === 'erro' && <XCircle className="w-3 h-3" />}
                          {d.status}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{d.motivo || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
