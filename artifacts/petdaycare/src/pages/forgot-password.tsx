import React from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KeyRound, Building2, ShieldCheck } from "lucide-react";

export default function ForgotPassword() {
  return (
    <div className="min-h-screen w-full flex bg-background">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[50%] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-sm mx-auto flex flex-col justify-center px-6 py-12 z-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`} alt="ArkPet" className="h-20 w-20 mb-4 opacity-90" />
          <span className="font-display font-bold text-2xl tracking-tight text-foreground">ArkPet</span>
        </div>

        <Card className="border-border shadow-md bg-card">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-xl">Esqueceu sua senha?</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              A redefinição de senha é feita pelo administrador da sua creche. Sem necessidade de e-mail.
            </p>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <Building2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Tutores e funcionários</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Entre em contato com o administrador da sua creche. Ele pode gerar uma nova senha temporária diretamente pelo sistema.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <ShieldCheck className="h-4 w-4 text-violet-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Administradores de creche</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Entre em contato com o suporte ArkPet para redefinir o acesso.
                  </p>
                </div>
              </div>
            </div>

            <Link href="/login">
              <Button variant="outline" className="w-full mt-2" size="lg">
                Voltar ao login
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
