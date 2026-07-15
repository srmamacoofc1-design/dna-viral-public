import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface Stats {
  totalAssemblies: number;
  totalPromoted: number;
  latestAssemblyStatus: string | null;
  latestValidationStatus: string | null;
}

export function HeaderStats() {
  const [stats, setStats] = useState<Stats>({
    totalAssemblies: 0,
    totalPromoted: 0,
    latestAssemblyStatus: null,
    latestValidationStatus: null,
  });

  useEffect(() => {
    async function load() {
      const [aRes, pRes, latestA] = await Promise.all([
        supabase.from("script_assemblies").select("id", { count: "exact", head: true }),
        supabase.from("promoted_scripts").select("id", { count: "exact", head: true }),
        supabase.from("script_assemblies").select("status, validation_status").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setStats({
        totalAssemblies: aRes.count ?? 0,
        totalPromoted: pRes.count ?? 0,
        latestAssemblyStatus: latestA.data?.status ?? null,
        latestValidationStatus: latestA.data?.validation_status ?? null,
      });
    }
    load();
  }, []);

  const items = [
    { label: "Assemblies", value: stats.totalAssemblies },
    { label: "Promovidos", value: stats.totalPromoted },
    { label: "Último Status", value: stats.latestAssemblyStatus ?? "—" },
    { label: "Última Validação", value: stats.latestValidationStatus ?? "—" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="text-lg font-bold text-foreground mt-0.5">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
