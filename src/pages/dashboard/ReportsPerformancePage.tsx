import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3 } from "lucide-react";

const reports = [
  { title: "Temporal Report", desc: "Análise de perfis temporais", url: "/temporal" },
  { title: "Micro Events", desc: "Micro-picos e eventos", url: "/micro-events" },
  { title: "Pattern Library", desc: "Biblioteca de padrões", url: "/patterns" },
  { title: "Cost Prediction", desc: "Predição de custos", url: "/costs" },
  { title: "CTA Deep", desc: "Análise profunda de CTAs", url: "/cta-deep" },
  { title: "CTA Audit", desc: "Auditoria de CTAs", url: "/cta-audit" },
  { title: "System X-Ray", desc: "Raio-X do sistema", url: "/system-xray" },
  { title: "Data Readiness", desc: "Prontidão dos dados", url: "/data-readiness" },
  { title: "Master Readiness", desc: "Relatório Master de Prontidão", url: "/master-readiness-report" },
  { title: "Master System", desc: "Relatório Master do Sistema", url: "/master-system-report" },
];

export default function ReportsPerformancePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Performance Reports</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((r) => (
          <Link key={r.url} to={r.url}>
            <Card className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-400" />
                  {r.title}
                </CardTitle>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{r.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
