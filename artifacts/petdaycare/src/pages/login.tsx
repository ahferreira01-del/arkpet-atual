import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dog, ShieldAlert, KeyRound, Users, UserCircle } from "lucide-react";

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

  const handleDemo = (roleEmail: string) => {
    setEmail(roleEmail);
    setPassword("password");
    setIsSubmitting(true);
    login({ data: { email: roleEmail, password: "password" } });
    setTimeout(() => setIsSubmitting(false), 1000);
  };

  return (
    <div className="min-h-screen w-full flex relative overflow-hidden bg-background">
      <div className="absolute inset-0 z-0 opacity-40">
        <img
          src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
          alt="Fundo luxuoso"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/50 to-transparent" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-auto flex flex-col justify-center px-4 py-12 lg:ml-[15%]">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.5)]">
            <Dog className="h-7 w-7 text-white" />
          </div>
          <span className="font-display font-bold text-3xl tracking-tight text-white">LuxePets</span>
        </div>

        <Card className="border-white/10 shadow-2xl shadow-black/50 backdrop-blur-2xl bg-black/40">
          <CardHeader>
            <CardTitle className="text-2xl">Bem-vindo de volta</CardTitle>
            <CardDescription className="text-gray-400">Entre na sua conta para continuar</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-300">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@creche.com.br"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="password" className="text-gray-300">Senha</Label>
                  <a href="#" className="text-xs text-primary hover:underline">Esqueceu a senha?</a>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full mt-4" size="lg" isLoading={isSubmitting}>
                Entrar
              </Button>
            </form>

            <div className="mt-8">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-transparent px-2 text-muted-foreground backdrop-blur-sm">Acesso Rápido (Demo)</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-6">
                <Button variant="outline" onClick={() => handleDemo('master@petdaycare.com')} className="h-auto py-3 flex flex-col gap-1 items-center justify-center">
                  <ShieldAlert className="h-4 w-4 mb-1" /> Master Admin
                </Button>
                <Button variant="outline" onClick={() => handleDemo('ana@petparadise.com.br')} className="h-auto py-3 flex flex-col gap-1 items-center justify-center text-primary border-primary/30 bg-primary/5">
                  <KeyRound className="h-4 w-4 mb-1" /> Admin de Creche
                </Button>
                <Button variant="outline" onClick={() => handleDemo('bruno@petparadise.com.br')} className="h-auto py-3 flex flex-col gap-1 items-center justify-center">
                  <Users className="h-4 w-4 mb-1" /> Funcionário
                </Button>
                <Button variant="outline" onClick={() => handleDemo('tutor@petparadise.com.br')} className="h-auto py-3 flex flex-col gap-1 items-center justify-center">
                  <UserCircle className="h-4 w-4 mb-1" /> Tutor
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
