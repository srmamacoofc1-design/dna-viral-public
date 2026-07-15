import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import type { RunState } from "@/pages/dashboard/ScriptEnginePage";

interface Props {
  run: RunState;
}

export function RunStatusCard({ run }: Props) {
  const rows = [
    { label: "Modo", value: run.mode },
    { label: "Generation Context", value: run.generation_context_id?.slice(0, 12) ?? "—" },
    { label: "Script Assembly", value: run.script_assembly_id?.slice(0, 12) ?? "—" },
    { label: "Validation Status", value: run.validation_status ?? "—" },
    { label: "Promoted Script", value: run.promoted_script_id?.slice(0, 12) ?? "—" },
    { label: "Versão", value: run.validation_version ?? "—" },
    { label: "Último passo", value: run.last_step ?? "—" },
    { label: "Estado atual", value: run.overall_state },
    { label: "Auto-run", value: run.auto_run ? `SIM (${run.auto_run_attempt}/${run.max_auto_revisions})` : "NÃO" },
    { label: "Progresso", value: `${run.progress_pct}%` },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Status Operacional
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {rows.map((r) => (
            <div key={r.label} className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{r.label}</p>
              <p className="text-sm font-mono font-medium text-foreground truncate">
                {String(r.value)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
