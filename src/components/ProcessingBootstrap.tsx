import { useEffect } from 'react';
import { resumePendingProcessing } from '@/lib/video-processing';
import { useAuth } from '@/hooks/useAuth';

export function ProcessingBootstrap() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    void resumePendingProcessing();

    const interval = setInterval(() => {
      void resumePendingProcessing();
    }, 30_000);

    return () => clearInterval(interval);
  }, [user, loading]);

  return null;
}
