import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function DNAEngineComparePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Compare DNA</h1>
      <Card className="bg-card border-border/50">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Construction className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg text-muted-foreground">Módulo de comparação entre versões de DNA</p>
          <p className="text-sm text-muted-foreground/60 mt-2">
            Funcionalidade de expansão — não bloqueia operação principal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
