import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, TrendingUp } from "lucide-react";

const reports = [
  { title: "Relatório de Engagement", desc: "Análise observacional de engagement e padrões narrativos", url: "/report" },
  { title: "Léxico Narrativo", desc: "Análise do léxico recorrente na base", url: "/lexicon" },
  { title: "Combinações Narrativas", desc: "Motor de combinações verbais", url: "/combinacoes" },
];

export default function ReportsViralPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Relatórios de Engagement e Padrões</h1>
      <div className="grid gap-4">
        {reports.map((r) => (
          <Link key={r.url} to={r.url}>
            <Card className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-400" />
                  {r.title}
                </CardTitle>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{r.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
