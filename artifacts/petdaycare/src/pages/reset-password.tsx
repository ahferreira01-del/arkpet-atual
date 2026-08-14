import React from "react";
import { Link, useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const token = React.useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);

  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const mutation = useResetPassword({
    mutation: {
      onSuccess: () => setDone(true),
      onError: (err: Error) => setError(err?.message || "Não foi possível redefinir a senha."),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    mutation.mutate({ data: { token, password } } as any);
  };

  return (
    <div className="min-h-svh w-full flex flex-col bg-background font-sans">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 py-12">
        
        {/* Header */}
        <div className="mb-8 w-full flex flex-col items-center text-center">
          <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">Redefinir senha</h1>
          <p className="text-sm text-muted-foreground px-4">
            {done ? "Sua nova senha foi salva." : "Escolha uma nova senha para sua conta."}
          </p>
        </div>

        {/* Card do Formulário */}
        <div className="w-full bg-card rounded-2xl border border-border p-6 shadow-sm">
          {!token ? (
            <div className="space-y-6">
              <div className="flex items-start gap-3 p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed">
                  Link inválido ou expirado. Solicite uma nova redefinição de senha ao administrador.
                </p>
              </div>
              <Link href="/recuperar-senha" className="block w-full">
                <Button variant="outline" className="w-full h-12 text-base font-medium">
                  Solicitar novo link
                </Button>
              </Link>
            </div>
          ) : done ? (
            <div className="space-y-6">
              <div className="flex items-start gap-3 p-4 rounded-xl border border-success/20 bg-success/5 text-success">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed">
                  Senha redefinida com sucesso. Você já pode acessar sua conta com a nova senha.
                </p>
              </div>
              <Button 
                className="w-full h-12 text-base font-medium" 
                onClick={() => setLocation("/login")}
              >
                Ir para o login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-start gap-3 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="password" className="pl-1 text-sm font-medium text-foreground">
                  Nova senha
                </Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  placeholder="Mínimo 6 caracteres" 
                  required 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="pl-1 text-sm font-medium text-foreground">
                  Confirmar nova senha
                </Label>
                <Input 
                  id="confirmPassword" 
                  type="password" 
                  value={confirmPassword} 
                  onChange={e => setConfirmPassword(e.target.value)} 
                  placeholder="Repita a nova senha"
                  required 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium mt-2" 
                isLoading={mutation.isPending}
              >
                Salvar nova senha
              </Button>
            </form>
          )}
        </div>
        
      </div>
    </div>
  );
}
