import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dog } from "lucide-react";

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

      <div className="relative z-10 w-full max-w-md mx-auto flex flex-col justify-center px-4 py-12">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
