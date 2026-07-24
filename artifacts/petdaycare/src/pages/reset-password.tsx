import React from "react";
import { Link, useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="min-h-screen w-full flex bg-background">
      <div className="w-full max-w-sm mx-auto flex flex-col justify-center px-6 py-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`} alt="ArkPet" className="h-20 w-20 mb-4 opacity-90" />
          <span className="font-display font-bold text-2xl tracking-tight text-foreground">ArkPet</span>
        </div>

        <Card className="border-border shadow-md bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Redefinir senha</CardTitle>
            <CardDescription>
              {done ? "Tudo certo!" : "Escolha uma nova senha para sua conta."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!token ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Link inválido. Solicite uma nova redefinição de senha.
                </div>
                <Link href="/recuperar-senha">
                  <Button variant="outline" className="w-full" size="lg">Solicitar novo link</Button>
                </Link>
              </div>
            ) : done ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-sm text-muted-foreground">
                  Senha redefinida com sucesso. Você já pode entrar com a nova senha.
                </div>
                <Button className="w-full" size="lg" onClick={() => setLocation("/login")}>Ir para o login</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="password">Nova senha</Label>
                  <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
                  <Input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full mt-2" size="lg" isLoading={mutation.isPending}>
                  Redefinir senha
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
