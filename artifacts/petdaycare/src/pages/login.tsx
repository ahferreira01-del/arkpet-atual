import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    login({ data: { email, password } });
    setTimeout(() => setIsSubmitting(false), 1000);
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <div className="w-full max-w-sm mx-auto flex flex-col justify-center px-6 py-12">

        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
            alt="ArkPet"
            className="h-20 w-20 mb-4 opacity-90"
          />
          <span className="font-display font-bold text-2xl tracking-tight text-foreground">ArkPet</span>
          <p className="text-sm text-muted-foreground mt-1.5">
            Agendamento de cães e gatos em creche
          </p>
        </div>

        <Card className="border-border shadow-md bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Bem-vindo de volta</CardTitle>
            <CardDescription>Entre na sua conta para continuar</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@creche.com.br"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label htmlFor="password">Senha</Label>
                  <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Esqueceu a senha?
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full mt-2" size="lg" isLoading={isSubmitting}>
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
