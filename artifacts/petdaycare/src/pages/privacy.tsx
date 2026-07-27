import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#24272c] flex flex-col items-center justify-start px-6 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              ← Voltar
            </Button>
          </Link>
        </div>

        <div className="bg-[#2a2d33] rounded-[28px] p-8 shadow-2xl space-y-6 text-gray-300">
          <h1 className="text-2xl font-bold text-white">Política de Privacidade</h1>
          <p className="text-sm text-gray-400">Última atualização: Janeiro de 2025</p>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">1. Dados Coletados</h2>
            <p className="text-sm leading-relaxed">
              O ArkPet coleta dados necessários para o funcionamento da plataforma, incluindo nome,
              e-mail, informações dos pets cadastrados e histórico de reservas.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">2. Uso dos Dados</h2>
            <p className="text-sm leading-relaxed">
              Os dados coletados são utilizados exclusivamente para prestação do serviço e
              comunicação relacionada ao uso da plataforma. Não compartilhamos dados pessoais
              com terceiros sem consentimento, exceto quando exigido por lei.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">3. Segurança</h2>
            <p className="text-sm leading-relaxed">
              Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso
              não autorizado, alteração, divulgação ou destruição.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">4. Seus Direitos (LGPD)</h2>
            <p className="text-sm leading-relaxed">
              Conforme a Lei Geral de Proteção de Dados (LGPD), você tem direito ao acesso,
              correção, exclusão e portabilidade dos seus dados. Entre em contato conosco
              para exercer esses direitos.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">5. Contato</h2>
            <p className="text-sm leading-relaxed">
              Para dúvidas sobre privacidade e proteção de dados, utilize os canais de suporte
              disponíveis na plataforma.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
