# Módulo Financeiro e Planos no ArkPet

## Visão Geral
O módulo financeiro do ArkPet gerencia a monetização e os fluxos de cobrança do negócio em duas frentes distintas:

1. **Assinatura da Creche (Plataforma ArkPet):**
   - Cobrança recorrente da mensalidade do software através do Stripe.
   - Planos escalonados por volume de pets ativos e funcionalidades contratadas.
   - Gestão em `/assinatura`, com suporte a recuperação de pagamentos e visualização de faturas.

2. **Cobrança de Tutores (Gestão da Creche):**
   - Gestão de mensalidades de Day Use e diárias de hospedagem devidas pelos tutores à creche.
   - Controle de recebíveis, inadimplência e emissão de recibos térmicos.
   - Visível apenas para administradores da creche (`creche_admin`).

## Segurança e Acesso Restrito
- Funcionários (`staff`) e tutores (`tutor`) não têm acesso ao painel financeiro consolidado da creche.
- Tutores possuem uma visão simplificada e individual em `/tutor/financial`, restrita exclusivamente às suas próprias faturas e comprovantes de pagamento.
