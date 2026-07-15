import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, Dna } from "lucide-react";

const reports = [
  { title: "DNA Viral", desc: "Análise de DNA viral completa", url: "/dna-viral" },
  { title: "DNA V2", desc: "DNA Base V2 com snapshots", url: "/dna-v2" },
  { title: "Verbal Intelligence", desc: "Inteligência verbal consolidada", url: "/verbal-intelligence" },
];

export default function ReportsDNAPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">DNA Reports</h1>
      <div className="grid gap-4">
        {reports.map((r) => (
          <Link key={r.url} to={r.url}>
            <Card className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Dna className="h-4 w-4 text-purple-400" />
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
