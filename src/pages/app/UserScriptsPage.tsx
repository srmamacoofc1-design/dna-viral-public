import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Eye, Copy, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { toast } from "sonner";

export default function UserScriptsPage() {
  const { user } = useAuth();
  const [scripts, setScripts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("promoted_scripts")
        .select("*")
        .eq("user_id", user.id)
        .order("promoted_at", { ascending: false })
        .limit(50);
      setScripts(data || []);
      setLoading(false);
    };
    load();
  }, [user]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Trophy className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Scripts Finais</h1>
      </div>

      {loading && <p className="text-muted-foreground">Carregando...</p>}

      {!loading && scripts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum script promovido ainda. Gere seu primeiro roteiro!
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {scripts.map((s) => (
          <Card key={s.id} className="hover:border-primary/30 transition-colors">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{s.script_title}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(s.promoted_at), "dd/MM/yyyy HH:mm")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {s.script_text?.substring(0, 120)}...
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge>{s.script_status}</Badge>
                  <Badge variant="outline">v{s.validation_version}</Badge>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" onClick={() => setSelected(s)}>
                        <Eye className="h-3 w-3 mr-1" /> Ver
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>{selected?.script_title}</DialogTitle>
                      </DialogHeader>
                      {selected && (
                        <div className="space-y-4">
                          <div className="flex gap-2 flex-wrap">
                            <Badge>{selected.script_status}</Badge>
                            <Badge variant="outline">{selected.validation_status}</Badge>
                            <Badge variant="secondary">v{selected.validation_version}</Badge>
                          </div>
                          <div className="bg-muted/50 rounded-lg p-4">
                            <pre className="whitespace-pre-wrap text-sm">{selected.script_text}</pre>
                          </div>
                          {selected.script_blocks && (
                            <div className="space-y-2">
                              <h3 className="font-medium text-sm">Blocos</h3>
                              {(Array.isArray(selected.script_blocks) ? selected.script_blocks : []).map((b: any, i: number) => (
                                <div key={i} className="bg-card border rounded p-3 text-sm">
                                  <span className="font-medium text-primary">{b.slot_label || b.block_type || `Bloco ${i + 1}`}</span>
                                  <p className="text-muted-foreground mt-1">{b.generated_text || b.text}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                navigator.clipboard.writeText(selected.script_text);
                                toast.success("Roteiro copiado!");
                              }}
                            >
                              <Copy className="h-3 w-3 mr-1" /> Copiar
                            </Button>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>Assembly: {selected.source_script_assembly_id}</p>
                            <p>Blueprint: {selected.source_blueprint_id || "—"}</p>
                            <p>Generation Context: {selected.source_generation_context_id || "—"}</p>
                          </div>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(s.script_text);
                      toast.success("Copiado!");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
