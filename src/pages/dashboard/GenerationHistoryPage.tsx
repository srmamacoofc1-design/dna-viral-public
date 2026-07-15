import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

interface AssemblyRow {
  id: string;
  assembly_name: string;
  status: string;
  validation_status: string | null;
  created_at: string;
  block_count_expected: number | null;
  source_generation_context_id: string | null;
}

const statusIcon: Record<string, any> = {
  ready: CheckCircle,
  incomplete: AlertTriangle,
  no_data: XCircle,
};

const statusColor: Record<string, string> = {
  ready: "border-green-500/40 text-green-400",
  incomplete: "border-yellow-500/40 text-yellow-400",
  no_data: "border-red-500/40 text-red-400",
};

export default function GenerationHistoryPage() {
  const [rows, setRows] = useState<AssemblyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("script_assemblies")
      .select("id, assembly_name, status, validation_status, created_at, block_count_expected, source_generation_context_id")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRows((data as AssemblyRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="h-6 w-6 text-primary" />
          Script History
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Histórico de todos os Script Assemblies gerados ({rows.length} registros)
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="bg-card border-border/50">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum Script Assembly gerado ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const Icon = statusIcon[row.status] ?? XCircle;
            const color = statusColor[row.status] ?? "border-muted-foreground/30 text-muted-foreground";
            return (
              <Card key={row.id} className="bg-card border-border/50">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground text-sm">{row.assembly_name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{new Date(row.created_at).toLocaleString("pt-BR")}</span>
                      {row.block_count_expected != null && <span>{row.block_count_expected} blocos</span>}
                      <span className="font-mono opacity-60">{row.id.slice(0, 8)}…</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.validation_status && (
                      <Badge variant="outline" className="text-xs">
                        {row.validation_status}
                      </Badge>
                    )}
                    <Badge variant="outline" className={`text-xs ${color}`}>
                      <Icon className="h-3 w-3 mr-1" />
                      {row.status.toUpperCase()}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
