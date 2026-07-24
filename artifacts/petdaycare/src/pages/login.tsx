import React, { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Eye, EyeOff, User } from "lucide-react";

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
    <div className="min-h-screen w-full flex flex-col bg-[#24272c] font-sans relative overflow-hidden">
      {/* Opcional: Efeito de glow sutil no fundo */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-white/[0.02] rounded-full blur-[100px] pointer-events-none" />

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 py-8 relative z-10">
        
        {/* Logo */}
        <div className="mb-8 w-full flex flex-col items-center">
          <img
            src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`}
            alt="ArkPet"
            className="w-48 sm:w-64 object-contain -ml-2"
          />
        </div>

        {/* Card do Formulário */}
        <div className="w-full bg-[#2a2d33] rounded-[28px] p-6 sm:p-8 shadow-2xl">
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-white mb-1 tracking-tight">Bem-vindo de volta!</h1>
            <p className="text-sm text-gray-400">Entre na sua conta para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="pl-1 text-sm font-medium text-gray-200">E-mail</Label>
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
                icon={<Mail className="h-5 w-5 text-gray-500 z-10" />}
                className="h-12 bg-[#1f2125] border-transparent focus:border-[#7a8c54] focus:ring-[#7a8c54] rounded-xl text-white placeholder:text-gray-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="pl-1 text-sm font-medium text-gray-200">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  icon={<Lock className="h-5 w-5 text-gray-500 z-10" />}
                  className="pr-11 h-12 bg-[#1f2125] border-transparent focus:border-[#7a8c54] focus:ring-[#7a8c54] rounded-xl text-white placeholder:text-gray-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-500 hover:text-gray-300 transition-colors z-20"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end !mt-2">
              <Link href="/recuperar-senha" className="text-xs font-medium text-[#849857] hover:text-[#9bb366] transition-colors">
                Esqueceu a senha?
              </Link>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 rounded-xl text-white font-medium bg-[#7a8c54] hover:bg-[#687a43] active:scale-[0.98] transition-all shadow-lg shadow-[#7a8c54]/20 border-0" 
              isLoading={isSubmitting}
            >
              Entrar
            </Button>
          </form>

          {/* Divisor */}
          <div className="my-6 flex items-center">
            <div className="flex-1 h-px bg-white/5"></div>
            <span className="px-4 text-xs font-medium text-gray-500 lowercase">ou</span>
            <div className="flex-1 h-px bg-white/5"></div>
          </div>

          {/* Cadastrar botão */}
          <Link href="/cadastro" className="block w-full">
            <Button 
              type="button" 
              variant="outline"
              className="w-full h-12 rounded-xl border border-white/10 bg-transparent text-white font-medium hover:bg-white/5 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <User className="h-5 w-5 text-gray-400" />
              <span>Cadastrar minha creche</span>
            </Button>
          </Link>
        </div>
        
        {/* Termos */}
        <div className="mt-8 text-center px-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Ao continuar, você concorda com nossos<br/>
            <Link href="/termos" className="text-[#849857] hover:underline">Termos de uso</Link> 
            {" "}e{" "}
            <Link href="/privacidade" className="text-[#849857] hover:underline">Política de privacidade</Link>
          </p>
        </div>

      </div>
    </div>
  );
}
