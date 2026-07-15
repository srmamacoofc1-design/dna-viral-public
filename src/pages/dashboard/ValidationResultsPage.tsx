import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface AssemblyValidation {
  id: string;
  assembly_name: string;
  status: string;
  validation_status: string | null;
  validation_version: number;
  validated_at: string | null;
  created_at: string;
  validation_result: any;
}

export default function ValidationResultsPage() {
  const [rows, setRows] = useState<AssemblyValidation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("script_assemblies")
      .select("id, assembly_name, status, validation_status, validation_version, validated_at, created_at, validation_result")
      .not("validation_status", "is", null)
      .order("validated_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRows((data as AssemblyValidation[]) ?? []);
        setLoading(false);
      });
  }, []);

  function validationBadge(vs: string | null) {
    if (!vs) return null;
    if (vs === "approved") return <Badge variant="outline" className="text-xs border-green-500/40 text-green-400"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
    if (vs === "rejected") return <Badge variant="outline" className="text-xs border-red-500/40 text-red-400"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
    return <Badge variant="outline" className="text-xs border-yellow-500/40 text-yellow-400"><AlertTriangle className="h-3 w-3 mr-1" />{vs}</Badge>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Validation Results
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Resultados de validação de Script Assemblies ({rows.length} validações)
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="bg-card border-border/50">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma validação executada ainda. Use o Script Engine para validar assemblies.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const result = row.validation_result as any;
            const score = result?.overall_score ?? result?.score ?? null;
            const issues = result?.issues ?? result?.failures ?? [];
            return (
              <Card key={row.id} className="bg-card border-border/50">
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">{row.assembly_name}</span>
                      <span className="text-xs text-muted-foreground">v{row.validation_version}</span>
                    </div>
                    {validationBadge(row.validation_status)}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {row.validated_at && <span>Validado: {new Date(row.validated_at).toLocaleString("pt-BR")}</span>}
                    {score != null && <span>Score: <strong className="text-foreground">{score}</strong></span>}
                    <span className="font-mono opacity-60">{row.id.slice(0, 8)}…</span>
                  </div>
                  {Array.isArray(issues) && issues.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {issues.slice(0, 5).map((issue: any, i: number) => (
                        <div key={i} className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1">
                          {typeof issue === "string" ? issue : issue?.message ?? JSON.stringify(issue)}
                        </div>
                      ))}
                      {issues.length > 5 && (
                        <span className="text-xs text-muted-foreground/60">...e mais {issues.length - 5} issues</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
