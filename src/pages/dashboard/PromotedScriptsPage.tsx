import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Eye, X, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PromotedScript {
  id: string;
  script_title: string;
  script_text: string;
  script_status: string;
  validation_status: string | null;
  validation_version: number;
  promoted_at: string;
  created_at: string;
  source_script_assembly_id: string;
  source_blueprint_id: string | null;
  source_generation_context_id: string | null;
  promotion_trace: Record<string, unknown>;
  script_blocks: unknown[];
}

export default function PromotedScriptsPage() {
  const [selectedScript, setSelectedScript] = useState<PromotedScript | null>(null);

  const { data: scripts, isLoading } = useQuery({
    queryKey: ["promoted-scripts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promoted_scripts")
        .select("*")
        .order("promoted_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PromotedScript[];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <Trophy className="h-6 w-6 text-primary" />
            Promoted Scripts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Roteiros finais aprovados e promovidos — dados persistidos no banco.
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {scripts?.length ?? 0} registros
        </Badge>
      </div>

      {isLoading && (
        <Card className="bg-card border-border/50">
          <CardContent className="py-8 text-center text-muted-foreground">
            Carregando scripts promovidos...
          </CardContent>
        </Card>
      )}

      {!isLoading && (!scripts || scripts.length === 0) && (
        <Card className="bg-card border-border/50">
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum script promovido encontrado. Use o Script Engine para gerar, validar e promover roteiros.
          </CardContent>
        </Card>
      )}

      {!isLoading && scripts && scripts.length > 0 && (
        <div className="space-y-3">
          {scripts.map((s) => (
            <Card key={s.id} className="bg-card border-border/50 hover:border-primary/30 transition-colors">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium text-foreground truncate">
                        {s.script_title}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                      {s.script_text.slice(0, 200)}
                      {s.script_text.length > 200 ? "…" : ""}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {s.script_status}
                      </Badge>
                      {s.validation_status && (
                        <Badge
                          variant={s.validation_status === "approved" ? "default" : "outline"}
                          className="text-xs"
                        >
                          {s.validation_status}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        v{s.validation_version}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.promoted_at).toLocaleDateString("pt-BR")}{" "}
                        {new Date(s.promoted_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedScript(s)}
                    className="shrink-0"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Abrir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedScript} onOpenChange={() => setSelectedScript(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              {selectedScript?.script_title}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant="secondary">{selectedScript?.script_status}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Validação:</span>{" "}
                  <Badge variant={selectedScript?.validation_status === "approved" ? "default" : "outline"}>
                    {selectedScript?.validation_status ?? "—"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Versão:</span>{" "}
                  v{selectedScript?.validation_version}
                </div>
                <div>
                  <span className="text-muted-foreground">Promovido em:</span>{" "}
                  {selectedScript && new Date(selectedScript.promoted_at).toLocaleString("pt-BR")}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Assembly ID:</span>{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {selectedScript?.source_script_assembly_id}
                  </code>
                </div>
              </div>

              {/* Full script */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-2">Roteiro Completo</h3>
                <div className="bg-muted/50 rounded-lg p-4 text-sm whitespace-pre-wrap text-foreground leading-relaxed">
                  {selectedScript?.script_text}
                </div>
              </div>

              {/* Blocks */}
              {selectedScript?.script_blocks && Array.isArray(selectedScript.script_blocks) && selectedScript.script_blocks.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-2">
                    Blocos ({(selectedScript.script_blocks as unknown[]).length})
                  </h3>
                  <div className="space-y-2">
                    {(selectedScript.script_blocks as Array<{ slot_label?: string; block_type?: string; generated_text?: string }>).map((block, i) => (
                      <div key={i} className="bg-muted/30 rounded p-3 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {block.slot_label || block.block_type || `Bloco ${i + 1}`}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {block.generated_text || JSON.stringify(block).slice(0, 150)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
