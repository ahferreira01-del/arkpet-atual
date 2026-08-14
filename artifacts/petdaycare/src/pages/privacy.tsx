import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start px-6 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              ← Voltar
            </Button>
          </Link>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm space-y-6 text-card-foreground">
          <h1 className="text-2xl font-bold text-foreground">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground">Última atualização: Janeiro de 2025</p>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">1. Dados Coletados</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              O ArkPet coleta dados necessários para o funcionamento da plataforma, incluindo nome,
              e-mail, informações dos pets cadastrados e histórico de reservas.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">2. Uso dos Dados</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Os dados coletados são utilizados exclusivamente para prestação do serviço e
              comunicação relacionada ao uso da plataforma. Não compartilhamos dados pessoais
              com terceiros sem consentimento, exceto quando exigido por lei.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">3. Segurança</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso
              não autorizado, alteração, divulgação ou destruição.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">4. Seus Direitos (LGPD)</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Conforme a Lei Geral de Proteção de Dados (LGPD), você tem direito ao acesso,
              correção, exclusão e portabilidade dos seus dados. Entre em contato conosco
              para exercer esses direitos.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">5. Contato</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Para dúvidas sobre privacidade e proteção de dados, utilize os canais de suporte
              disponíveis na plataforma.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
