import { AppLayout } from '@/components/AppLayout';
import { VideoLibrary } from '@/components/VideoLibrary';
import { Button } from '@/components/ui/button';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { Library, FileDown, Sparkles, Cog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function LibraryPage() {
  const { isAdmin } = useAuth();
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Library className="w-6 h-6 text-primary" />
            <h1 className="font-semibold text-2xl text-foreground">Biblioteca Viral</h1>
            <div className="ml-auto flex flex-wrap gap-2 print:hidden">
              <Button asChild size="sm">
                <Link to="/app"><Sparkles className="w-4 h-4 mr-1" /> Gerar Roteiro</Link>
              </Button>
              {isAdmin && (
                <Button asChild variant="outline" size="sm">
                  <Link to="/dashboard/script-engine"><Cog className="w-4 h-4 mr-1" /> Script Engine</Link>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => exportPageAsPDF('Biblioteca Viral')}>
                <FileDown className="w-4 h-4 mr-1" /> Exportar PDF
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Vídeos processados com ficha técnica, timeline e blocos narrativos prontos para análise.
          </p>
        </div>
        <VideoLibrary />
      </div>
    </AppLayout>
  );
}
