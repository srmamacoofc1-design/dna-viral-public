import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Eye, Copy, FileVideo, FileText, Wand2, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";

interface RunItem {
  id: string;
  created_at: string;
  execution_mode: string;
  pipeline_status: string;
  reference_video_id: string | null;
  generation_context_id: string | null;
  script_assembly_id: string | null;
  promoted_script_id: string | null;
  estimated_duration_seconds: number | null;
  actual_duration_seconds: number | null;
  validation_status: string | null;
}

export default function UserHistoryPage() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScript, setSelectedScript] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("reference_generation_runs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setRuns((data as RunItem[]) || []);
      setLoading(false);
    };
    load();
  }, [user]);

  const getModeIcon = (mode: string) => {
    if (mode === "video") return <FileVideo className="h-4 w-4" />;
    if (mode === "theme") return <Wand2 className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  const getModeLabel = (mode: string) => {
    if (mode === "video") return "Vídeo";
    if (mode === "theme") return "Tema";
    return "Transformar";
  };

  const getStatusVariant = (status: string) => {
    if (status === "completed" || status === "promoted") return "default";
    if (status === "running") return "secondary";
    if (status === "error" || status === "failed") return "destructive";
    return "outline";
  };

  const openPromotedScript = async (promId: string) => {
    const { data } = await supabase.from("promoted_scripts").select("*").eq("id", promId).single();
    setSelectedScript(data);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <History className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Histórico de Gerações</h1>
      </div>

      {loading && <p className="text-muted-foreground">Carregando...</p>}

      {!loading && runs.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma geração encontrada. Comece criando seu primeiro roteiro!
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {runs.map((r) => (
          <Card key={r.id} className="hover:border-primary/30 transition-colors">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getModeIcon(r.execution_mode)}
                  <div>
                    <p className="font-medium text-sm">{getModeLabel(r.execution_mode)}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(r.created_at), "dd/MM/yyyy HH:mm")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getStatusVariant(r.pipeline_status)}>
                    {r.pipeline_status}
                  </Badge>
                  {r.promoted_script_id && (
                    <Badge className="bg-primary/20 text-primary border-primary/30">
                      Promovido
                    </Badge>
                  )}
                  {r.estimated_duration_seconds && (
                    <span className="text-xs text-muted-foreground">
                      ~{Math.round(r.estimated_duration_seconds)}s
                    </span>
                  )}
                  {r.promoted_script_id && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => openPromotedScript(r.promoted_script_id!)}>
                          <Eye className="h-3 w-3 mr-1" /> Abrir
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>{selectedScript?.script_title || "Roteiro"}</DialogTitle>
                        </DialogHeader>
                        {selectedScript && (
                          <div className="space-y-4">
                            <div className="flex gap-2 flex-wrap">
                              <Badge>{selectedScript.script_status}</Badge>
                              <Badge variant="outline">{selectedScript.validation_status}</Badge>
                              <Badge variant="secondary">v{selectedScript.validation_version}</Badge>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-4">
                              <pre className="whitespace-pre-wrap text-sm">{selectedScript.script_text}</pre>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                navigator.clipboard.writeText(selectedScript.script_text);
                                import("sonner").then(m => m.toast.success("Roteiro copiado!"));
                              }}
                            >
                              <Copy className="h-3 w-3 mr-1" /> Copiar
                            </Button>
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
