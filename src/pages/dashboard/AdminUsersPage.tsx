import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Eye, Clock, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";

interface UserProfile {
  user_id: string;
  display_name: string | null;
  created_at: string;
}

interface UserWithStats extends UserProfile {
  role: string;
  total_runs: number;
  promoted_count: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserRuns, setSelectedUserRuns] = useState<any[]>([]);
  const [selectedUserName, setSelectedUserName] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      
      // Get profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name, created_at")
        .order("created_at", { ascending: false });

      if (!profiles) { setLoading(false); return; }

      // Get roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role");

      // Get run counts per user
      const { data: runs } = await supabase
        .from("reference_generation_runs")
        .select("user_id");

      const { data: promoted } = await supabase
        .from("promoted_scripts")
        .select("user_id");

      const roleMap = new Map((roles || []).map(r => [r.user_id, r.role]));
      const runCounts = new Map<string, number>();
      const promCounts = new Map<string, number>();

      (runs || []).forEach(r => {
        if (r.user_id) runCounts.set(r.user_id, (runCounts.get(r.user_id) || 0) + 1);
      });
      (promoted || []).forEach(p => {
        if (p.user_id) promCounts.set(p.user_id, (promCounts.get(p.user_id) || 0) + 1);
      });

      const result: UserWithStats[] = profiles.map(p => ({
        ...p,
        role: roleMap.get(p.user_id) || "member",
        total_runs: runCounts.get(p.user_id) || 0,
        promoted_count: promCounts.get(p.user_id) || 0,
      }));

      setUsers(result);
      setLoading(false);
    };
    load();
  }, []);

  const viewUserRuns = async (userId: string, name: string) => {
    setSelectedUserName(name);
    const { data } = await supabase
      .from("reference_generation_runs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setSelectedUserRuns(data || []);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Gestão de Usuários</h1>
      </div>

      {loading && <p className="text-muted-foreground">Carregando...</p>}

      <div className="grid gap-4">
        {users.map((u) => (
          <Card key={u.user_id}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-primary font-bold">
                      {(u.display_name || "?")[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium">{u.display_name || "Sem nome"}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Desde {format(new Date(u.created_at), "dd/MM/yyyy")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                    <Shield className="h-3 w-3 mr-1" />
                    {u.role}
                  </Badge>
                  <div className="text-right text-sm">
                    <p><span className="font-medium">{u.total_runs}</span> gerações</p>
                    <p><span className="font-medium">{u.promoted_count}</span> promovidos</p>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" onClick={() => viewUserRuns(u.user_id, u.display_name || "Usuário")}>
                        <Eye className="h-3 w-3 mr-1" /> Ver Runs
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Runs de {selectedUserName}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-2">
                        {selectedUserRuns.length === 0 && <p className="text-muted-foreground">Nenhum run encontrado.</p>}
                        {selectedUserRuns.map((r: any) => (
                          <div key={r.id} className="border rounded p-3 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">{r.execution_mode}</span>
                              <Badge variant="outline">{r.pipeline_status}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(r.created_at), "dd/MM/yyyy HH:mm")} • ID: {r.id.substring(0, 8)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
