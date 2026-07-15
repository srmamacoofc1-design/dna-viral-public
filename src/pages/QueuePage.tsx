import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { QueueList } from '@/components/QueueList';
import { UploadHistory } from '@/components/UploadHistory';
import { ReprocessV2Panel } from '@/components/ReprocessV2Panel';
import { ListOrdered, History, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';

export default function QueuePage() {
  const [activeTab, setActiveTab] = useState('queue');
  const { isAdmin } = useAuth();

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <ListOrdered className="w-6 h-6 text-primary" />
            <h1 className="font-semibold text-2xl text-foreground">Fila de Processamento</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Acompanhe o status de cada vídeo na pipeline de processamento.
          </p>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="queue" className="flex-1 gap-2">
              <ListOrdered className="w-4 h-4" /> Fila Ativa
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1 gap-2">
              <History className="w-4 h-4" /> Histórico de Uploads
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="reprocess" className="flex-1 gap-2">
                <RefreshCw className="w-4 h-4" /> Reprocessar v2
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="queue">
            <QueueList />
          </TabsContent>
          <TabsContent value="history">
            <UploadHistory />
          </TabsContent>
          {isAdmin && (
            <TabsContent value="reprocess">
              <ReprocessV2Panel onJobStarted={() => setActiveTab('queue')} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
