import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { History, ChevronDown, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  onSelect: (assembly: any) => void;
  currentId: string | null;
}

export function AssemblyHistory({ onSelect, currentId }: Props) {
  const [assemblies, setAssemblies] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("script_assemblies")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setAssemblies(data);
      });
  }, [currentId]);

  if (assemblies.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader className="pb-3">
          <CollapsibleTrigger className="w-full flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Histórico de Assemblies ({assemblies.length})
            </CardTitle>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-2">
            {assemblies.map((sa) => {
              const isActive = sa.id === currentId;
              const hasRevisionTrace = sa.assembly_rules?.revision_trace;
              const vs = sa.validation_status;
              const vsColor =
                vs === "approved" ? "text-success border-success/30"
                : vs === "needs_revision" ? "text-warning border-warning/30"
                : vs === "rejected" ? "text-destructive border-destructive/30"
                : "text-muted-foreground";

              return (
                <div
                  key={sa.id}
                  className={cn(
                    "rounded-md border px-4 py-3 space-y-1.5",
                    isActive ? "border-primary bg-primary/5" : "border-border bg-muted/10"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{sa.assembly_name}</span>
                      <Badge variant="outline" className="text-[10px]">{sa.status}</Badge>
                      {vs && <Badge variant="outline" className={`text-[10px] ${vsColor}`}>{vs}</Badge>}
                      {sa.status === "final" && <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Promovido</Badge>}
                      {hasRevisionTrace && <Badge variant="outline" className="text-[10px]">Revisão</Badge>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => onSelect(sa)}>
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      Abrir
                    </Button>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{new Date(sa.created_at).toLocaleString("pt-BR")}</span>
                    <span>v{sa.validation_version}</span>
                    <span className="font-mono">{sa.id.slice(0, 8)}</span>
                  </div>

                  {/* Revision trace */}
                  {hasRevisionTrace && (
                    <Collapsible open={expandedTrace === sa.id} onOpenChange={() => setExpandedTrace(expandedTrace === sa.id ? null : sa.id)}>
                      <CollapsibleTrigger className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${expandedTrace === sa.id ? "rotate-180" : ""}`} />
                        Revision trace
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <pre className="text-[10px] bg-muted/30 border border-border rounded p-2 overflow-auto max-h-[200px] font-mono mt-1">
                          {JSON.stringify(sa.assembly_rules.revision_trace, null, 2)}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
