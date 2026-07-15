import { AppLayout } from '@/components/AppLayout';
import { VideoUploadForm } from '@/components/VideoUploadForm';
import { Zap } from 'lucide-react';

export default function UploadPage() {
  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="w-6 h-6 text-primary" />
            <h1 className="font-semibold text-2xl text-foreground">Ingestão de Vídeo</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Envie vídeos para processamento, classificação narrativa e catalogação na biblioteca viral.
          </p>
        </div>
        <VideoUploadForm />
      </div>
    </AppLayout>
  );
}
