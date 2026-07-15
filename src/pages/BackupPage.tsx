import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Download, Upload, Database, FileJson, FileSpreadsheet, Shield, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const TABLES = ['videos', 'video_blocks', 'video_transcripts', 'processing_queue', 'video_logs'] as const;
const SEGMENTS = ['meme', 'curiosidade', 'misterio', 'terror', 'historia_real', 'narrativa_biblica'] as const;

function today() {
  return new Date().toISOString().split('T')[0];
}

export default function BackupPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [segmento, setSegmento] = useState<string>('all');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [clearExisting, setClearExisting] = useState(false);

  async function downloadBackupJSON() {
    setLoading('json');
    try {
      const { data, error } = await supabase.functions.invoke('backup-export', {
        body: { format: 'json', segmento: segmento !== 'all' ? segmento : undefined },
      });
      if (error) throw error;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const prefix = segmento !== 'all' ? `backup_${segmento}` : 'full_backup';
      a.href = url;
      a.download = `${prefix}_${today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup JSON exportado com sucesso');
    } catch (e: any) {
      toast.error(`Erro ao exportar: ${e.message}`);
    } finally {
      setLoading(null);
    }
  }

  async function downloadTableCSV(table: string) {
    setLoading(`csv-${table}`);
    try {
      const { data, error } = await supabase.functions.invoke('backup-export', {
        body: { format: 'csv', table, segmento: segmento !== 'all' ? segmento : undefined },
      });
      if (error) throw error;

      const csvContent = typeof data === 'string' ? data : JSON.stringify(data);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${table}_backup_${today()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`CSV de ${table} exportado`);
    } catch (e: any) {
      toast.error(`Erro ao exportar ${table}: ${e.message}`);
    } finally {
      setLoading(null);
    }
  }

  async function downloadAllCSVs() {
    for (const table of TABLES) {
      await downloadTableCSV(table);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  async function handleRestore() {
    if (!restoreFile) { toast.error('Selecione um arquivo JSON'); return; }
    setLoading('restore');
    setRestoreResult(null);
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);

      if (!backup.videos && !backup.video_blocks) {
        throw new Error('Arquivo não contém dados de backup válidos');
      }

      const { data, error } = await supabase.functions.invoke('backup-restore', {
        body: { backup, clear_existing: clearExisting },
      });
      if (error) throw error;
      setRestoreResult(data);
      toast.success('Restauração concluída');
    } catch (e: any) {
      toast.error(`Erro na restauração: ${e.message}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Backup & Restauração</h1>
            <p className="text-sm text-muted-foreground">Proteção completa dos dados do ViralDNA</p>
          </div>
        </div>

        {/* Segment Filter */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4" /> Filtro de Segmento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={segmento} onValueChange={setSegmento}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Todos os segmentos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os segmentos</SelectItem>
                {SEGMENTS.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              {segmento === 'all' ? 'Exportará todos os vídeos' : `Exportará apenas vídeos do segmento "${segmento}"`}
            </p>
          </CardContent>
        </Card>

        {/* JSON Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileJson className="w-4 h-4" /> Backup Completo (JSON)
            </CardTitle>
            <CardDescription>
              Arquivo único com todos os dados para restauração completa
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={downloadBackupJSON} disabled={loading === 'json'} className="gap-2">
              {loading === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Exportar Backup JSON
            </Button>
          </CardContent>
        </Card>

        {/* CSV Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Exportação CSV (por tabela)
            </CardTitle>
            <CardDescription>
              Arquivos CSV individuais para cada tabela
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={downloadAllCSVs} disabled={!!loading} variant="outline" className="gap-2 mb-3">
              <Download className="w-4 h-4" /> Exportar Todos os CSVs
            </Button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TABLES.map(table => (
                <Button
                  key={table}
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadTableCSV(table)}
                  disabled={loading === `csv-${table}`}
                  className="justify-start gap-2 text-xs"
                >
                  {loading === `csv-${table}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
                  {table}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Restore */}
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <Upload className="w-4 h-4" /> Restaurar Backup
            </CardTitle>
            <CardDescription>
              Restaurar dados a partir de um arquivo JSON de backup
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <input
                type="file"
                accept=".json"
                onChange={e => setRestoreFile(e.target.files?.[0] || null)}
                className="text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-sm file:font-medium hover:file:bg-primary/90 text-muted-foreground"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={clearExisting}
                onChange={e => setClearExisting(e.target.checked)}
                className="rounded border-border"
              />
              Limpar dados existentes antes de restaurar
            </label>

            {clearExisting ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={!restoreFile || !!loading} className="gap-2">
                    {loading === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                    Restaurar (com limpeza)
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmar restauração destrutiva</AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso irá APAGAR todos os dados existentes e substituí-los pelo backup.
                      Esta ação não pode ser desfeita. Tem certeza?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRestore}>Confirmar Restauração</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                onClick={handleRestore}
                disabled={!restoreFile || !!loading}
                variant="outline"
                className="gap-2"
              >
                {loading === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Restaurar (merge/upsert)
              </Button>
            )}

            {restoreResult && (
              <div className="bg-card border border-border rounded-lg p-4 text-xs space-y-2">
                <p className="flex items-center gap-2 text-primary font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Restauração concluída em {restoreResult.restored_at}
                </p>
                {restoreResult.results && Object.entries(restoreResult.results).map(([table, r]: [string, any]) => (
                  <div key={table} className="flex items-center gap-3">
                    <span className="text-muted-foreground w-36">{table}</span>
                    <span className="text-foreground">+{r.inserted} inseridos</span>
                    {r.deleted > 0 && <span className="text-destructive">-{r.deleted} removidos</span>}
                    {r.errors?.length > 0 && <span className="text-destructive">{r.errors.length} erros</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
