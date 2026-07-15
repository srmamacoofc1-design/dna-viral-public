import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Upload, ListOrdered, Library, BarChart3, Menu, X, Dna, Shield, FileSpreadsheet, ShieldCheck, BookOpen, Users, Zap, Timer, Activity, Layers, Combine, DollarSign, Search, Brain, Scan, FileText, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { path: '/app', label: 'Nova Geração', icon: Zap },
  { path: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { path: '/old-home', label: 'Upload', icon: Upload },
  { path: '/queue', label: 'Fila', icon: ListOrdered },
  { path: '/library', label: 'Biblioteca', icon: Library },
  { path: '/report', label: 'Relatório', icon: BarChart3 },
  { path: '/dna-viral', label: 'DNA Viral', icon: Dna },
  { path: '/dna-v2', label: 'DNA V2', icon: Dna },
  { path: '/import', label: 'Importar', icon: FileSpreadsheet },
  { path: '/lexicon', label: 'Léxico', icon: BookOpen },
  { path: '/cohorts', label: 'Coortes', icon: Users },
  { path: '/cta-deep', label: 'CTA Deep', icon: Zap },
  { path: '/temporal', label: 'Temporal', icon: Timer },
  { path: '/micro-events', label: 'Micro-Picos', icon: Activity },
  { path: '/patterns', label: 'Padrões', icon: Layers },
  { path: '/combinacoes', label: 'Combinações', icon: Combine },
  { path: '/validation', label: 'Validação', icon: ShieldCheck },
  { path: '/costs', label: 'Custos AI', icon: DollarSign },
  { path: '/cta-audit', label: 'Auditoria CTA', icon: Search },
  { path: '/verbal-intelligence', label: 'Intel. Verbal', icon: Brain },
  { path: '/backup', label: 'Backup', icon: Shield },
  { path: '/system-xray', label: 'Raio-X', icon: Scan },
  { path: '/data-readiness', label: 'Readiness', icon: ShieldCheck },
  { path: '/master-readiness-report', label: 'Master Report', icon: Shield },
  { path: '/master-system-report', label: 'System Report', icon: FileText },
];

const memberNavItems = [
  { path: '/app', label: 'Nova Geração', icon: Zap },
  { path: '/old-home', label: 'Adicionar vídeos', icon: Upload },
  { path: '/queue', label: 'Fila', icon: ListOrdered },
  { path: '/library', label: 'Biblioteca e Presets', icon: Library },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAdmin } = useAuth();
  const visibleNavItems = isAdmin ? navItems : memberNavItems;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="w-full px-4 h-14 flex items-center gap-4">
          <Link to="/old-home" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg text-foreground">ViralDNA</span>
          </Link>

          <nav className="hidden md:flex flex-1 min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path}
                  className={cn('flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary')}>
                  <Icon className="w-4 h-4" />{item.label}
                </Link>
              );
            })}
          </nav>

          <button className="md:hidden ml-auto text-muted-foreground" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <AnimatePresence>
          {mobileOpen && (
            <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="md:hidden border-t border-border overflow-hidden">
              <div className="p-2 flex flex-col gap-1">
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = location.pathname === item.path;
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setMobileOpen(false)}
                      className={cn('flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors',
                        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary')}>
                      <Icon className="w-4 h-4" />{item.label}
                    </Link>
                  );
                })}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
