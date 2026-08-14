import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Terms() {
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
          <h1 className="text-2xl font-bold text-foreground">Termos de Uso</h1>
          <p className="text-sm text-muted-foreground">Última atualização: Janeiro de 2025</p>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">1. Aceitação dos Termos</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ao utilizar o ArkPet, você concorda com estes Termos de Uso. Se não concordar com qualquer
              parte destes termos, não utilize o serviço.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">2. Uso do Serviço</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              O ArkPet é uma plataforma de gestão para creches de animais domésticos. O serviço é
              fornecido "como está" e pode ser alterado ou descontinuado a qualquer momento.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">3. Responsabilidades</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              O usuário é responsável pela veracidade das informações fornecidas e pelo uso adequado
              da plataforma, respeitando as leis vigentes e os direitos de terceiros.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">4. Contato</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Para dúvidas sobre estes termos, entre em contato conosco através dos canais de
              suporte disponíveis na plataforma.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
