import React from "react";
import { useLocation, Link } from "wouter";
import { useRegisterCreche } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { AlertCircle, ArrowLeft, PartyPopper } from "lucide-react";

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
      onError: (err: Error) => {
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
    <div className="min-h-svh w-full flex flex-col bg-background font-sans">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 py-12">
        
        {/* Header */}
        <div className="mb-8 w-full flex flex-col items-center text-center">
          <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <img
              src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
              alt="ArkPet"
              className="h-12 w-12 object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">Crie sua conta</h1>
          <p className="text-sm text-muted-foreground px-4">
            Gerencie sua creche com o ArkPet em minutos.
          </p>
        </div>

        {/* Card do Formulário */}
        <div className="w-full bg-card rounded-2xl border border-border p-6 shadow-sm">
          
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <span className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${step >= 1 ? "bg-primary" : "bg-muted"}`} />
              <span className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${step >= 2 ? "bg-primary" : "bg-muted"}`} />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {step === 1 ? "Dados pessoais" : "Dados da creche"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {step === 1 ? "Etapa 1 de 2 — Responsável pela conta" : "Etapa 2 de 2 — Informações do negócio"}
            </p>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={handleStep1} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name" className="pl-1 text-sm font-medium text-foreground">Nome completo</Label>
                <Input 
                  id="name" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="Maria Silva" 
                  required 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="pl-1 text-sm font-medium text-foreground">E-mail</Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  placeholder="maria@creche.com.br" 
                  required 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="pl-1 text-sm font-medium text-foreground">Senha</Label>
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
                <Label htmlFor="confirmPassword" className="pl-1 text-sm font-medium text-foreground">Confirmar senha</Label>
                <Input 
                  id="confirmPassword" 
                  type="password" 
                  value={confirmPassword} 
                  onChange={e => setConfirmPassword(e.target.value)} 
                  required 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              <Button type="submit" className="w-full h-12 text-base font-medium mt-2">Continuar</Button>
            </form>
          ) : (
            <form onSubmit={handleStep2} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="crecheName" className="pl-1 text-sm font-medium text-foreground">Nome da creche</Label>
                <Input 
                  id="crecheName" 
                  value={crecheName} 
                  onChange={e => setCrecheName(e.target.value)} 
                  placeholder="Creche Patinhas Felizes" 
                  required 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crechePhone" className="pl-1 text-sm font-medium text-foreground flex items-center justify-between">
                  Telefone
                  <span className="text-xs text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full">Opcional</span>
                </Label>
                <Input 
                  id="crechePhone" 
                  value={crechePhone} 
                  onChange={e => setCrechePhone(e.target.value)} 
                  placeholder="(11) 99999-9999" 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crecheAddress" className="pl-1 text-sm font-medium text-foreground flex items-center justify-between">
                  Endereço
                  <span className="text-xs text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full">Opcional</span>
                </Label>
                <Input 
                  id="crecheAddress" 
                  value={crecheAddress} 
                  onChange={e => setCrecheAddress(e.target.value)} 
                  placeholder="Rua das Flores, 100" 
                  className="h-12 text-base md:text-sm"
                />
              </div>
              
              {/* Copy Informativo (Zero Trial API) */}
              <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
                <div className="flex items-start gap-3">
                  <PartyPopper className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-foreground leading-relaxed">
                    Você terá <span className="font-bold">10 dias de teste grátis</span> com até 10 pets cadastrados.
                  </p>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="w-full sm:flex-1 h-12 text-base font-medium bg-card hover:bg-accent/50" 
                  onClick={() => { setError(null); setStep(1); }}
                >
                  <ArrowLeft className="h-5 w-5 mr-2 text-muted-foreground" />
                  Voltar
                </Button>
                <Button 
                  type="submit" 
                  className="w-full sm:flex-[2] h-12 text-base font-medium" 
                  isLoading={registerMutation.isPending}
                >
                  Criar creche
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Login Link */}
        <div className="w-full mt-8 text-center px-4">
          <p className="text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link href="/login" className="text-foreground hover:text-primary transition-colors font-medium py-2 inline-block">
              Entrar
            </Link>
          </p>
        </div>

      </div>
    </div>
  );
}
