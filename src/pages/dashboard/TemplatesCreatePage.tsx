import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function TemplatesCreatePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Create Template</h1>
      <p className="text-sm text-muted-foreground">
        Templates são gerados automaticamente a partir do DNA Object. Use a página Template Library para gerar ou reconstruir.
      </p>
      <Link to="/dashboard/templates">
        <Card className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer">
          <CardContent className="flex items-center justify-between py-6">
            <span className="font-medium text-foreground">Ir para Template Library</span>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
