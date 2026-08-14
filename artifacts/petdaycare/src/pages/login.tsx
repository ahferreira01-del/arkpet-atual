import React, { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Eye, EyeOff, User, ArrowRight } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    login({ data: { email: email.trim().toLowerCase(), password } });
    setTimeout(() => setIsSubmitting(false), 1000);
  };

  return (
    <div className="min-h-svh w-full flex flex-col bg-background font-sans">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 py-12">
        
        {/* Logo */}
        <div className="mb-8 w-full flex flex-col items-center">
          <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <img
              src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
              alt="ArkPet"
              className="h-12 w-12 object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">Bem-vindo de volta</h1>
          <p className="text-sm text-muted-foreground text-center px-4">
            Acesse o sistema da sua creche
          </p>
        </div>

        {/* Card do Formulário */}
        <div className="w-full bg-card rounded-2xl border border-border p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="pl-1 text-sm font-medium text-foreground">
                E-mail
              </Label>
              <div className="relative">
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="pl-10 h-12 text-base md:text-sm"
                />
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between pl-1 pr-1">
                <Label htmlFor="password" className="text-sm font-medium text-foreground">
                  Senha
                </Label>
                <Link href="/recuperar-senha" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors py-1">
                  Esqueceu a senha?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="pl-10 pr-12 h-12 text-base md:text-sm"
                />
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-medium mt-2" 
              isLoading={isSubmitting}
            >
              Entrar
            </Button>
          </form>
        </div>
        
        {/* Cadastrar botão (Fora do card para visual limpo) */}
        <div className="w-full mt-8 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ou</span>
            <div className="flex-1 h-px bg-border"></div>
          </div>

          <Link href="/cadastro" className="block w-full">
            <Button 
              type="button" 
              variant="outline"
              className="w-full h-12 flex items-center justify-between px-5 bg-card hover:bg-accent/50"
            >
              <div className="flex items-center gap-3 text-muted-foreground">
                <User className="h-5 w-5" />
                <span className="font-medium text-foreground">Cadastrar minha creche</span>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </Button>
          </Link>
        </div>

        {/* Termos */}
        <div className="mt-8 text-center px-4 w-full max-w-[280px]">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ao continuar, você concorda com nossos<br/>
            <Link href="/termos" className="text-foreground hover:text-primary transition-colors py-1 inline-block">Termos de uso</Link> 
            {" "}e{" "}
            <Link href="/privacidade" className="text-foreground hover:text-primary transition-colors py-1 inline-block">Política de privacidade</Link>
          </p>
        </div>

      </div>
    </div>
  );
}
