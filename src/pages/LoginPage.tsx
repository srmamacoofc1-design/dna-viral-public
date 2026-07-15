import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { MailCheck, Zap } from "lucide-react";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const resolveRedirect = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    return data?.some(row => row.role === "admin") ? "/dashboard" : "/app";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await signUp(email, password, displayName);
        if (error) {
          toast.error(error.message);
          return;
        }

        if (data.session && data.user) {
          toast.success("Conta criada e acesso liberado!");
          navigate(await resolveRedirect(data.user.id));
          return;
        }

        setPassword("");
        setPendingConfirmationEmail(email.trim());
        toast.success("Cadastro recebido. Confirme seu e-mail para continuar.");
        return;
      }

      const { error } = await signIn(email, password);
      if (error) {
        toast.error(error.message);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const dest = session?.user ? await resolveRedirect(session.user.id) : "/app";
      navigate(dest);
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!pendingConfirmationEmail) return;

    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirmationEmail,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("E-mail de confirmação reenviado.");
    } finally {
      setResending(false);
    }
  };

  const handleReturnToLogin = () => {
    setPendingConfirmationEmail(null);
    setIsSignUp(false);
    setPassword("");
    setDisplayName("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            <CardTitle className="text-2xl font-bold text-primary">ViralDNA</CardTitle>
          </div>
          <CardDescription>
            {pendingConfirmationEmail
              ? "Confirme seu e-mail para ativar a conta"
              : isSignUp
                ? "Crie sua conta para começar"
                : "Entre na sua conta"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingConfirmationEmail ? (
            <div className="space-y-5 text-center" role="status" aria-live="polite">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <MailCheck className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-foreground">Cadastro recebido!</p>
                <p className="text-sm text-muted-foreground">
                  Enviamos um link de confirmação para <strong className="text-foreground">{pendingConfirmationEmail}</strong>.
                  Abra sua caixa de entrada e confirme o cadastro antes de entrar.
                </p>
                <p className="text-xs text-muted-foreground">
                  Se não encontrar a mensagem, verifique também Spam ou Lixo eletrônico.
                </p>
              </div>
              <div className="space-y-2">
                <Button type="button" className="w-full" onClick={handleResendConfirmation} disabled={resending}>
                  {resending ? "Reenviando..." : "Reenviar e-mail de confirmação"}
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={handleReturnToLogin}>
                  Voltar para entrar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                {isSignUp && (
                  <div className="space-y-2">
                    <Label htmlFor="displayName">Nome</Label>
                    <Input
                      id="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Seu nome"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Aguarde..." : isSignUp ? "Criar conta" : "Entrar"}
                </Button>
              </form>
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {isSignUp ? "Já tem conta? Entre aqui" : "Não tem conta? Cadastre-se"}
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
