import { Card, CardContent } from "@/components/ui/card";
import { Layers, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function BlueprintsGeneratePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          Generate Blueprint
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          A geração de Blueprints é feita na página View Blueprint, onde você pode reconstruir a qualquer momento.
        </p>
      </div>

      <Link to="/dashboard/blueprints/view">
        <Card className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer">
          <CardContent className="flex items-center justify-between py-6">
            <div>
              <p className="font-medium text-foreground">Ir para Blueprint View</p>
              <p className="text-sm text-muted-foreground mt-1">
                Visualize o blueprint atual e use Rebuild para gerar um novo
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
