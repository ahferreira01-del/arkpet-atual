import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { KeyRound, Building2, ShieldCheck, ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  return (
    <div className="min-h-svh w-full flex flex-col bg-background font-sans">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 py-12">
        
        {/* Header */}
        <div className="mb-8 w-full flex flex-col items-center text-center">
          <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">Esqueceu sua senha?</h1>
          <p className="text-sm text-muted-foreground px-4">
            A redefinição de acesso é gerenciada pelos administradores por motivos de segurança.
          </p>
        </div>

        {/* Info Cards */}
        <div className="w-full space-y-4 mb-8">
          
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Tutores e Funcionários</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Entre em contato com o <strong>administrador da sua creche</strong>. Ele possui acesso para gerar e revogar senhas temporárias imediatamente pelo sistema.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Administradores de Creche</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Caso você seja o administrador e tenha perdido o acesso, contate o <strong>Suporte ArkPet</strong> para redefinição segura da sua conta matriz.
                </p>
              </div>
            </div>
          </div>

        </div>

        {/* Actions */}
        <div className="w-full">
          <Link href="/login" className="block">
            <Button variant="outline" className="w-full h-12 text-base font-medium bg-card hover:bg-accent/50">
              <ArrowLeft className="h-5 w-5 mr-2 text-muted-foreground" />
              Voltar ao login
            </Button>
          </Link>
        </div>

      </div>
    </div>
  );
}
