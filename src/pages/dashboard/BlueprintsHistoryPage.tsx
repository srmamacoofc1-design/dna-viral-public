import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Layers, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

interface BlueprintRow {
  id: string;
  blueprint_name: string;
  status: string;
  block_count_expected: number | null;
  dominant_emotion: string | null;
  created_at: string;
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

export default function BlueprintsHistoryPage() {
  const [rows, setRows] = useState<BlueprintRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("blueprint_contexts")
      .select("id, blueprint_name, status, block_count_expected, dominant_emotion, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRows((data as BlueprintRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="h-6 w-6 text-primary" />
          Blueprint History
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Histórico de Blueprints gerados ({rows.length} registros)
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card className="bg-card border-border/50">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum Blueprint gerado ainda.
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
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground text-sm">{row.blueprint_name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{new Date(row.created_at).toLocaleString("pt-BR")}</span>
                      {row.block_count_expected != null && <span>{row.block_count_expected} blocos</span>}
                      {row.dominant_emotion && <span>{row.dominant_emotion}</span>}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-xs ${color}`}>
                    <Icon className="h-3 w-3 mr-1" />
                    {row.status.toUpperCase()}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
