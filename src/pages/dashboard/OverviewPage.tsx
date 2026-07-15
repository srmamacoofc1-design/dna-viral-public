import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Dna, FileText, Layers, Video, BarChart3, Wand2, CheckCircle, Clock } from "lucide-react";

interface Stats {
  totalVideos: number;
  totalDNA: number;
  totalBlocks: number;
  totalTemplates: number;
  totalBlueprints: number;
  totalGenContexts: number;
  totalAssemblies: number;
  totalPromoted: number;
  totalDNAFormal: number;
  totalDNAObjects: number;
}

interface StatusInfo {
  dnaObjectStatus: string | null;
  templateStatus: string | null;
  blueprintStatus: string | null;
  genContextStatus: string | null;
  latestAssemblyStatus: string | null;
}

function statusLabel(status: string | null): { text: string; color: string } {
  if (!status) return { text: "Sem dados", color: "text-muted-foreground/50" };
  if (status === "ready") return { text: "✓ Ready", color: "text-green-400" };
  if (status === "incomplete") return { text: "⚠ Incomplete", color: "text-amber-400" };
  if (status === "no_data") return { text: "✗ No Data", color: "text-red-400" };
  return { text: status, color: "text-muted-foreground" };
}

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statuses, setStatuses] = useState<StatusInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [videos, dna, blocks, templates, blueprints, genCtx, assemblies, promoted, dnaFormal, dnaObjects] = await Promise.all([
        supabase.from("videos").select("id", { count: "exact", head: true }),
        supabase.from("dna_base_v2").select("id", { count: "exact", head: true }),
        supabase.from("video_blocks").select("id", { count: "exact", head: true }),
        supabase.from("template_contexts").select("id", { count: "exact", head: true }),
        supabase.from("blueprint_contexts").select("id", { count: "exact", head: true }),
        supabase.from("generation_contexts").select("id", { count: "exact", head: true }),
        supabase.from("script_assemblies").select("id", { count: "exact", head: true }),
        supabase.from("promoted_scripts").select("id", { count: "exact", head: true }),
        supabase.from("dna_base_v2_formal").select("id", { count: "exact", head: true }),
        supabase.from("dna_objects").select("id", { count: "exact", head: true }),
      ]);

      setStats({
        totalVideos: videos.count || 0,
        totalDNA: dna.count || 0,
        totalBlocks: blocks.count || 0,
        totalTemplates: templates.count || 0,
        totalBlueprints: blueprints.count || 0,
        totalGenContexts: genCtx.count || 0,
        totalAssemblies: assemblies.count || 0,
        totalPromoted: promoted.count || 0,
        totalDNAFormal: dnaFormal.count || 0,
        totalDNAObjects: dnaObjects.count || 0,
      });

      // Fetch latest statuses
      const [latestDnaObj, latestTemplate, latestBlueprint, latestGenCtx, latestAssembly] = await Promise.all([
        supabase.from("dna_objects").select("status").order("created_at", { ascending: false }).limit(1).single(),
        supabase.from("template_contexts").select("status").order("created_at", { ascending: false }).limit(1).single(),
        supabase.from("blueprint_contexts").select("status").order("created_at", { ascending: false }).limit(1).single(),
        supabase.from("generation_contexts").select("status").order("created_at", { ascending: false }).limit(1).single(),
        supabase.from("script_assemblies").select("status").order("created_at", { ascending: false }).limit(1).single(),
      ]);

      setStatuses({
        dnaObjectStatus: latestDnaObj.data?.status ?? null,
        templateStatus: latestTemplate.data?.status ?? null,
        blueprintStatus: latestBlueprint.data?.status ?? null,
        genContextStatus: latestGenCtx.data?.status ?? null,
        latestAssemblyStatus: latestAssembly.data?.status ?? null,
      });

      setLoading(false);
    })();
  }, []);

  const cards = [
    { label: "Vídeos", value: stats?.totalVideos, icon: Video, color: "text-blue-400" },
    { label: "DNA Base V2", value: stats?.totalDNA, icon: Dna, color: "text-green-400" },
    { label: "Blocos Totais", value: stats?.totalBlocks, icon: Database, color: "text-purple-400" },
    { label: "DNA Objects", value: stats?.totalDNAObjects, icon: Dna, color: "text-emerald-400" },
    { label: "DNA Formal", value: stats?.totalDNAFormal, icon: Dna, color: "text-teal-400" },
    { label: "Templates", value: stats?.totalTemplates, icon: FileText, color: "text-amber-400" },
    { label: "Blueprints", value: stats?.totalBlueprints, icon: Layers, color: "text-cyan-400" },
    { label: "Gen Contexts", value: stats?.totalGenContexts, icon: Wand2, color: "text-indigo-400" },
    { label: "Assemblies", value: stats?.totalAssemblies, icon: FileText, color: "text-orange-400" },
    { label: "Promoted Scripts", value: stats?.totalPromoted, icon: CheckCircle, color: "text-lime-400" },
  ];

  const systemRows = [
    { label: "DNA Object (mais recente)", status: statuses?.dnaObjectStatus },
    { label: "Template Context (mais recente)", status: statuses?.templateStatus },
    { label: "Blueprint Context (mais recente)", status: statuses?.blueprintStatus },
    { label: "Generation Context (mais recente)", status: statuses?.genContextStatus },
    { label: "Script Assembly (mais recente)", status: statuses?.latestAssemblyStatus },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Overview</h1>
        <p className="text-muted-foreground mt-1">Resumo geral do sistema ViralDNA — dados reais do banco</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
              <c.icon className={`h-5 w-5 ${c.color}`} />
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
              ) : (
                <p className="text-2xl font-bold text-foreground">{c.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Status Real da Cadeia (último registro)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {loading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : (
            systemRows.map((row) => {
              const s = statusLabel(row.status);
              return (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <span className="text-sm text-muted-foreground">{row.label}</span>
                  <span className={`text-sm font-medium ${s.color}`}>{s.text}</span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
