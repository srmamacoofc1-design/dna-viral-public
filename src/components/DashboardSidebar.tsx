import {
  LayoutDashboard,
  Dna,
  FileText,
  Layers,
  Wand2,
  ShieldCheck,
  Scan,
  Trophy,
  ChevronDown,
  Users,
  LogOut,
  Upload,
  ListOrdered,
  Library,
  BarChart3,
  Database,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const mainItems = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Nova Geração", url: "/app", icon: Wand2 },
];

const viralBase = [
  {
    title: "Base Viral",
    icon: Database,
    sub: [
      { title: "Ingestão de Vídeo", url: "/old-home" },
      { title: "Fila de Processamento", url: "/queue" },
      { title: "Biblioteca", url: "/library" },
      { title: "Importar Planilha", url: "/import" },
      { title: "DNA Viral", url: "/dna-viral" },
      { title: "DNA V2", url: "/dna-v2" },
      { title: "Léxico Viral", url: "/lexicon" },
      { title: "Coortes", url: "/cohorts" },
      { title: "Padrões", url: "/patterns" },
      { title: "Combinações", url: "/combinacoes" },
      { title: "CTA Deep", url: "/cta-deep" },
      { title: "CTA Audit", url: "/cta-audit" },
      { title: "Inteligência Verbal", url: "/verbal-intelligence" },
      { title: "Relatório Master", url: "/report" },
      { title: "Backup", url: "/backup" },
    ],
  },
];

const modules = [
  {
    title: "DNA Engine",
    icon: Dna,
    sub: [
      { title: "Build DNA Objects", url: "/dashboard/dna-engine/build" },
      { title: "View DNA Objects", url: "/dashboard/dna-engine/view" },
    ],
  },
  {
    title: "Templates",
    icon: FileText,
    sub: [
      { title: "Template Library", url: "/dashboard/templates" },
    ],
  },
  {
    title: "Blueprints",
    icon: Layers,
    sub: [
      { title: "View Blueprint", url: "/dashboard/blueprints/view" },
      { title: "Blueprint History", url: "/dashboard/blueprints/history" },
    ],
  },
  {
    title: "Generation",
    icon: Wand2,
    sub: [
      { title: "Script Engine", url: "/dashboard/script-engine" },
      { title: "Promoted Scripts", url: "/dashboard/promoted" },
      { title: "Generate Context", url: "/dashboard/generation" },
      { title: "Script History", url: "/dashboard/generation/history" },
      { title: "Script Assembly", url: "/dashboard/script-assembly" },
    ],
  },
  {
    title: "Validation",
    icon: ShieldCheck,
    sub: [
      { title: "Validation Results", url: "/dashboard/validation/results" },
    ],
  },
];
const bottomItems = [
  { title: "Usuários", url: "/dashboard/users", icon: Users },
  { title: "Raio-X", url: "/system-xray", icon: Scan },
];

export function DashboardSidebar() {
  const { signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;
  const isModuleActive = (sub: { url: string }[]) =>
    sub.some((s) => currentPath.startsWith(s.url));

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarContent className="bg-card/50">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-border/30">
          {!collapsed && (
            <h2 className="text-lg font-bold text-primary tracking-tight">
              ViralDNA
            </h2>
          )}
          {collapsed && (
            <span className="text-primary font-bold text-lg">V</span>
          )}
        </div>

        {/* Main */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-muted/50"
                      activeClassName="bg-primary/15 text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Base Viral */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider">
            Base Viral
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {viralBase.map((mod) => (
                <Collapsible
                  key={mod.title}
                  defaultOpen={isModuleActive(mod.sub)}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        className={cn(
                          "w-full justify-between hover:bg-muted/50",
                          isModuleActive(mod.sub) && "text-primary"
                        )}
                      >
                        <span className="flex items-center">
                          <mod.icon className="mr-2 h-4 w-4 shrink-0" />
                          {!collapsed && <span>{mod.title}</span>}
                        </span>
                        {!collapsed && (
                          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    {!collapsed && (
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {mod.sub.map((sub) => (
                            <SidebarMenuSubItem key={sub.url}>
                              <SidebarMenuSubButton asChild>
                                <NavLink
                                  to={sub.url}
                                  className="hover:bg-muted/50 text-sm"
                                  activeClassName="text-primary font-medium"
                                >
                                  {sub.title}
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    )}
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Modules */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider">
            Módulos
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {modules.map((mod) => (
                <Collapsible
                  key={mod.title}
                  defaultOpen={isModuleActive(mod.sub)}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        className={cn(
                          "w-full justify-between hover:bg-muted/50",
                          isModuleActive(mod.sub) && "text-primary"
                        )}
                      >
                        <span className="flex items-center">
                          <mod.icon className="mr-2 h-4 w-4 shrink-0" />
                          {!collapsed && <span>{mod.title}</span>}
                        </span>
                        {!collapsed && (
                          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    {!collapsed && (
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {mod.sub.map((sub) => (
                            <SidebarMenuSubItem key={sub.url}>
                              <SidebarMenuSubButton asChild>
                                <NavLink
                                  to={sub.url}
                                  className="hover:bg-muted/50 text-sm"
                                  activeClassName="text-primary font-medium"
                                >
                                  {sub.title}
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    )}
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Bottom */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {bottomItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-muted/50"
                      activeClassName="bg-primary/15 text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={signOut} className="hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                  <LogOut className="mr-2 h-4 w-4 shrink-0" />
                  {!collapsed && <span>Sair</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
