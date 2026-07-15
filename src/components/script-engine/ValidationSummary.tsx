import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ShieldCheck, ChevronDown, Wrench, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  validationResult: any;
  validationStatus: string | null;
  onRevise?: () => void;
  revising?: boolean;
}

export function ValidationSummary({ validationResult, validationStatus, onRevise, revising }: Props) {
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  const vr = validationResult;
  const globalSummary = vr?.global_summary ?? vr?.summary ?? {};
  const slotValidations = vr?.slot_validations ?? [];

  const statusColor =
    validationStatus === "approved" ? "bg-success/20 text-success border-success/30"
    : validationStatus === "needs_revision" ? "bg-warning/20 text-warning border-warning/30"
    : validationStatus === "rejected" ? "bg-destructive/20 text-destructive border-destructive/30"
    : "bg-muted text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Resultado da Validação
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`${statusColor} font-bold text-xs`}>
              {(validationStatus ?? "unknown").replace(/_/g, " ").toUpperCase()}
            </Badge>
            {onRevise && (
              <Button size="sm" variant="outline" onClick={onRevise} disabled={revising}>
                {revising ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wrench className="h-3.5 w-3.5 mr-1" />}
                Revisar Slots
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Global Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {globalSummary.overall_quality_score != null && (
            <div>
              <p className="text-xs text-muted-foreground">Quality Score</p>
              <p className="font-bold">{globalSummary.overall_quality_score}</p>
              {globalSummary.score_method && (
                <p className="text-xs text-muted-foreground">{globalSummary.score_method}</p>
              )}
            </div>
          )}
          {globalSummary.critical_failures != null && (
            <div>
              <p className="text-xs text-muted-foreground">Falhas Críticas</p>
              <p className="font-bold text-destructive">{globalSummary.critical_failures}</p>
            </div>
          )}
          {globalSummary.total_slots != null && (
            <div>
              <p className="text-xs text-muted-foreground">Total Slots</p>
              <p className="font-bold">{globalSummary.total_slots}</p>
            </div>
          )}
          {globalSummary.approved_slots != null && (
            <div>
              <p className="text-xs text-muted-foreground">Aprovados</p>
              <p className="font-bold text-success">{globalSummary.approved_slots}</p>
            </div>
          )}
        </div>

        {/* Slot Table */}
        {slotValidations.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Slot por Slot</p>
            <div className="space-y-1.5">
              {slotValidations.map((slot: any, idx: number) => {
                const isExpanded = expandedSlot === idx;
                const slotStatus = slot.slot_status ?? "unknown";
                const sc =
                  slotStatus === "approved" ? "border-success/30 bg-success/5"
                  : slotStatus === "needs_revision" ? "border-warning/30 bg-warning/5"
                  : "border-destructive/30 bg-destructive/5";

                return (
                  <Collapsible key={idx} open={isExpanded} onOpenChange={() => setExpandedSlot(isExpanded ? null : idx)}>
                    <CollapsibleTrigger className={`w-full flex items-center justify-between rounded-md border ${sc} px-3 py-2 text-left`}>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-mono text-xs text-muted-foreground w-12">Slot {slot.slot_index ?? idx}</span>
                        <span className="font-medium">{slot.slot_type ?? "—"}</span>
                        <Badge variant="outline" className="text-xs">
                          {slot.is_required ? "Obrigatório" : "Opcional"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-xs ${
                          slotStatus === "approved" ? "text-success border-success/30"
                          : slotStatus === "needs_revision" ? "text-warning border-warning/30"
                          : "text-destructive border-destructive/30"
                        }`}>
                          {slotStatus.replace(/_/g, " ")}
                        </Badge>
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-3 py-2 space-y-2">
                      {slot.criteria && Array.isArray(slot.criteria) && slot.criteria.map((c: any, ci: number) => (
                        <div key={ci} className="flex items-start gap-2 text-xs border-l-2 pl-3 py-1"
                          style={{ borderColor: c.value === true || c.value === "true" ? "hsl(var(--success))" : "hsl(var(--destructive))" }}
                        >
                          <div className="flex-1">
                            <p className="font-medium text-foreground">{c.criterion ?? c.name ?? `Critério ${ci + 1}`}</p>
                            {c.observed_evidence && <p className="text-muted-foreground mt-0.5">Observado: {JSON.stringify(c.observed_evidence)}</p>}
                            {c.expected_evidence && <p className="text-muted-foreground">Esperado: {JSON.stringify(c.expected_evidence)}</p>}
                            {c.data_source_type && <Badge variant="outline" className="text-[10px] mt-1">{c.data_source_type}</Badge>}
                          </div>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${
                            c.value === true || c.value === "true" ? "text-success border-success/30" : "text-destructive border-destructive/30"
                          }`}>
                            {c.value === true || c.value === "true" ? "PASS" : "FAIL"}
                          </Badge>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </div>
        )}

        {/* Raw JSON toggle */}
        <Collapsible open={showRawJson} onOpenChange={setShowRawJson}>
          <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ChevronDown className={`h-3 w-3 transition-transform ${showRawJson ? "rotate-180" : ""}`} />
            {showRawJson ? "Esconder" : "Ver"} JSON completo
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="relative mt-2">
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(validationResult, null, 2));
                  toast.success("JSON copiado");
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
              <pre className="text-xs bg-muted/30 border border-border rounded-md p-3 overflow-auto max-h-[400px] font-mono">
                {JSON.stringify(validationResult, null, 2)}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
