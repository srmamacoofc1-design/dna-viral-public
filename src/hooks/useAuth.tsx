import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AuthResponse, User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: "admin" | "member" | null;
  isAdmin: boolean;
  signUp: (email: string, password: string, displayName?: string) => Promise<AuthResponse>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Conveniência estritamente local enquanto a migration de bootstrap do dono
// ainda não foi publicada no Supabase. Em builds de produção DEV é false, logo
// esta exceção não concede papel algum fora do servidor de desenvolvimento.
const localOwnerEmail = import.meta.env.DEV
  ? String(import.meta.env.VITE_LOCAL_OWNER_EMAIL || "").trim().toLowerCase()
  : "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<"admin" | "member" | null>(null);
  const [roleReady, setRoleReady] = useState(false);

  const fetchRole = async (userId: string) => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error) console.error("Falha ao carregar papel do usuário:", error.message);
    // O schema legado permite uma linha por (user_id, role), portanto um mesmo
    // usuário pode ter member e admin. Nunca dependa da ordem arbitrária do banco.
    setRole(data?.some(row => row.role === "admin") ? "admin" : "member");
    setRoleReady(true);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setRoleReady(false);
          setTimeout(() => fetchRole(session.user.id), 0);
        } else {
          setRole(null);
          setRoleReady(true);
        }
        setAuthReady(true);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      } else {
        setRoleReady(true);
      }
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loading = !authReady || !roleReady;

  const signUp = async (email: string, password: string, displayName?: string) => {
    return supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const localOwnerOverride = Boolean(
    localOwnerEmail && user?.email?.trim().toLowerCase() === localOwnerEmail,
  );
  const effectiveRole: "admin" | "member" | null = localOwnerOverride ? "admin" : role;

  return (
    <AuthContext.Provider
      value={{ user, session, loading, role: effectiveRole, isAdmin: effectiveRole === "admin", signUp, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
