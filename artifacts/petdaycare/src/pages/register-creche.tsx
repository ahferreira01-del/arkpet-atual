import React from "react";
import { useLocation, Link } from "wouter";
import { useRegisterCreche } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

export default function RegisterCreche() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [step, setStep] = React.useState<1 | 2>(1);

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  const [crecheName, setCrecheName] = React.useState("");
  const [crechePhone, setCrechePhone] = React.useState("");
  const [crecheAddress, setCrecheAddress] = React.useState("");

  const [error, setError] = React.useState<string | null>(null);

  const registerMutation = useRegisterCreche({
    mutation: {
      onSuccess: (data: any) => {
        if (data?.token) localStorage.setItem("auth_token", data.token);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast({ title: "Creche criada!", description: "Bem-vindo(a) ao ArkPet. Seu teste grátis começou." });
        setTimeout(() => setLocation("/"), 100);
      },
      onError: (err: any) => {
        const msg = err?.message || "Não foi possível concluir o cadastro.";
        setError(msg);
      },
    },
  });

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !password) {
      setError("Preencha todos os campos.");
      return;
    }
    if (password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setStep(2);
  };

  const handleStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!crecheName.trim()) {
      setError("Informe o nome da creche.");
      return;
    }
    registerMutation.mutate({
      data: {
        name: name.trim(),
        email: email.trim(),
        password,
        crecheName: crecheName.trim(),
        crechePhone: crechePhone.trim() || undefined,
        crecheAddress: crecheAddress.trim() || undefined,
      },
    } as any);
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
            Crie a conta da sua creche em 1 minuto
          </p>
        </div>

        <Card className="border-border shadow-md bg-card">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`h-1.5 flex-1 rounded-full ${step >= 1 ? "bg-primary" : "bg-muted"}`} />
              <span className={`h-1.5 flex-1 rounded-full ${step >= 2 ? "bg-primary" : "bg-muted"}`} />
            </div>
            <CardTitle className="text-xl">
              {step === 1 ? "Seus dados" : "Dados da creche"}
            </CardTitle>
            <CardDescription>
              {step === 1 ? "Etapa 1 de 2 — responsável pela conta" : "Etapa 2 de 2 — sobre a creche"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {step === 1 ? (
              <form onSubmit={handleStep1} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Nome completo</Label>
                  <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Maria Silva" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="maria@creche.com.br" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Senha</Label>
                  <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirmar senha</Label>
                  <Input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full mt-2" size="lg">Continuar</Button>
              </form>
            ) : (
              <form onSubmit={handleStep2} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="crecheName">Nome da creche</Label>
                  <Input id="crecheName" value={crecheName} onChange={e => setCrecheName(e.target.value)} placeholder="Creche Patinhas Felizes" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crechePhone">Telefone <span className="text-muted-foreground">(opcional)</span></Label>
                  <Input id="crechePhone" value={crechePhone} onChange={e => setCrechePhone(e.target.value)} placeholder="(11) 99999-9999" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crecheAddress">Endereço <span className="text-muted-foreground">(opcional)</span></Label>
                  <Input id="crecheAddress" value={crecheAddress} onChange={e => setCrecheAddress(e.target.value)} placeholder="Rua das Flores, 100" />
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
                  🎉 Você terá <span className="font-semibold text-foreground">10 dias de teste grátis</span> com até 10 pets cadastrados.
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" size="lg" onClick={() => { setError(null); setStep(1); }}>
                    Voltar
                  </Button>
                  <Button type="submit" className="flex-1" size="lg" isLoading={registerMutation.isPending}>
                    Criar creche
                  </Button>
                </div>
              </form>
            )}

            <p className="text-center text-sm text-muted-foreground mt-6">
              Já tem conta?{" "}
              <Link href="/login" className="text-foreground font-medium hover:underline">
                Entrar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
