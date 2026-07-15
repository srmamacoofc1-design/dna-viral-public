import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function ValidationDashPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Validate Script
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          A validação de scripts é executada dentro do Script Engine.
        </p>
      </div>

      <Link to="/dashboard/script-engine">
        <Card className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer">
          <CardContent className="flex items-center justify-between py-6">
            <div>
              <p className="font-medium text-foreground">Ir para o Script Engine</p>
              <p className="text-sm text-muted-foreground mt-1">
                Use o pipeline completo: Build Context → Assemble → Validate → Promote
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      <Link to="/dashboard/validation/results">
        <Card className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer">
          <CardContent className="flex items-center justify-between py-6">
            <div>
              <p className="font-medium text-foreground">Ver Resultados de Validação</p>
              <p className="text-sm text-muted-foreground mt-1">
                Histórico de todas as validações executadas
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
