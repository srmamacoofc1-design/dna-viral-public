import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileText, Copy, ChevronDown, Award } from "lucide-react";
import { toast } from "sonner";

interface Props {
  assembly: any;
  promoted: any;
}

export function ScriptPreview({ assembly, promoted }: Props) {
  const [expandBlocks, setExpandBlocks] = useState(false);

  if (!assembly && !promoted) return null;

  const blocks = assembly?.script_blocks ?? [];
  const fullText = Array.isArray(blocks)
    ? blocks
        .sort((a: any, b: any) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
        .map((b: any) => b.generated_text ?? "")
        .filter(Boolean)
        .join("\n\n")
    : "";

  const promotedText = promoted?.script_text ?? "";
  const showingPromoted = !!promoted;

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Texto copiado");
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {showingPromoted ? <Award className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
            {showingPromoted ? "Script Final Promovido" : "Preview do Assembly"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-xs ${showingPromoted ? "text-primary border-primary/30" : "text-muted-foreground"}`}>
              {showingPromoted ? "FINAL" : "DRAFT"}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyText(showingPromoted ? promotedText : fullText)}
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copiar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showingPromoted && (
          <div className="text-xs text-muted-foreground space-y-1 mb-3">
            <p>Título: <strong className="text-foreground">{promoted.script_title}</strong></p>
            <p>Promovido em: {new Date(promoted.promoted_at).toLocaleString("pt-BR")}</p>
            <p>Validação v{promoted.validation_version}</p>
          </div>
        )}

        {/* Full text preview */}
        <div className="bg-muted/20 border border-border rounded-md p-4">
          <pre className="text-sm whitespace-pre-wrap font-sans text-foreground leading-relaxed">
            {showingPromoted ? promotedText : fullText || "Sem texto gerado"}
          </pre>
        </div>

        {/* Blocks detail */}
        {!showingPromoted && blocks.length > 0 && (
          <Collapsible open={expandBlocks} onOpenChange={setExpandBlocks}>
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ChevronDown className={`h-3 w-3 transition-transform ${expandBlocks ? "rotate-180" : ""}`} />
              {expandBlocks ? "Esconder" : "Expandir"} blocos ({blocks.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-2">
              {blocks
                .sort((a: any, b: any) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
                .map((block: any, idx: number) => (
                  <div key={idx} className="rounded-md border border-border bg-muted/10 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">Slot {block.slot_index ?? idx}</span>
                        <span className="text-sm font-medium">{block.slot_type ?? "—"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {block.word_count && <span className="text-xs text-muted-foreground">{block.word_count}w</span>}
                        <Badge variant="outline" className="text-[10px]">{block.slot_status ?? block.status ?? "draft"}</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{block.generated_text ?? "—"}</p>
                  </div>
                ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Promotion trace */}
        {showingPromoted && promoted.promotion_trace && (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ChevronDown className="h-3 w-3" />
              Ver promotion trace
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="text-xs bg-muted/30 border border-border rounded-md p-3 overflow-auto max-h-[300px] font-mono mt-2">
                {JSON.stringify(promoted.promotion_trace, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
