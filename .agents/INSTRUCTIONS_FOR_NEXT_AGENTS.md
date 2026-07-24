# Instruções para Próximas IAs - Projeto ArkPet

Este documento foi criado para registrar as melhorias realizadas na aplicação ArkPet e estabelecer diretrizes e regras inegociáveis para qualquer IA que venha a trabalhar neste repositório no futuro.

---

## 🚀 O que foi feito nesta Refatoração

1. **Sincronização da Especificação OpenAPI (`lib/api-spec/openapi.yaml`)**:
   - Adicionadas as 10 categorias de reserva válidas (`daycare`, `night_care`, `half_daycare`, `grooming`, `bathing`, `vet_consultation`, `training`, `assessment`, `hotel`, `other`) no enum de tipos de reserva.
   - Regenerados os React Query hooks e esquemas Zod correspondentes no frontend usando a ferramenta Orval.

2. **Resolução de Gargalo de Performance (Problema N+1)**:
   - Corrigida a rota de listagem de reservas (`GET /` em `artifacts/api-server/src/routes/bookings.ts`).
   - Substituída a query repetitiva para cada reserva por uma única query SQL com `leftJoin` ligando a tabela `bookings` à tabela `pets`.

3. **Remoção de Import Dinâmico Redundante**:
   - Removido o import dinâmico desnecessário de `bookingsTable` na rota de pets (`artifacts/api-server/src/routes/pets.ts`).

4. **Modularização Completa da Tela de Detalhes do Pet**:
   - A tela gigante `artifacts/petdaycare/src/pages/pets/detail.tsx` (~1539 linhas) foi dividida em componentes modulares.
   - Criados os arquivos correspondentes na nova pasta de componentes `artifacts/petdaycare/src/pages/pets/components/`:
     - [overview-tab.tsx](file:///c:/Users/Andre/Downloads/Pet-Daycare-Master/artifacts/petdaycare/src/pages/pets/components/overview-tab.tsx): Visão geral do Pet, contendo horários de alimentação, passeios e pertences.
     - [plan-tab.tsx](file:///c:/Users/Andre/Downloads/Pet-Daycare-Master/artifacts/petdaycare/src/pages/pets/components/plan-tab.tsx): Configuração da rotina planejada do pet (alimentação e passeios).
     - [qr-tab.tsx](file:///c:/Users/Andre/Downloads/Pet-Daycare-Master/artifacts/petdaycare/src/pages/pets/components/qr-tab.tsx): Exibição e download do QR Code de identificação do pet.
     - [medical-tab.tsx](file:///c:/Users/Andre/Downloads/Pet-Daycare-Master/artifacts/petdaycare/src/pages/pets/components/medical-tab.tsx): Aba de saúde com controle de vacinas e medicamentos.
     - [timeline-tab.tsx](file:///c:/Users/Andre/Downloads/Pet-Daycare-Master/artifacts/petdaycare/src/pages/pets/components/timeline-tab.tsx): Aba de linha do tempo com publicações e fotos diárias.
   - O arquivo [detail.tsx](file:///c:/Users/Andre/Downloads/Pet-Daycare-Master/artifacts/petdaycare/src/pages/pets/detail.tsx) principal foi simplificado para apenas 374 linhas, atuando como o orquestrador que importa e monta as abas.

5. **Implementação Integral do Módulo Financeiro, Stripe e LGPD**:
   - **Esquema de Dados**: Tabelas `catalogue_items`, `booking_consumables`, `tutor_credits`, `invoices`, `invoice_items`, `expenses`, `transactions` e `financial_audit_logs` adicionadas, mantendo isolamento por `crecheId` e sem uso de restrições de chaves estrangeiras (Foreign Keys) físicas.
   - **Correções e Evoluções do Módulo Financeiro (Julho 2026)**: 
     - **Lógica de Pacotes de Diárias e Excedentes (`tutor_credits`)**: Atualizado o fluxo de checkout das reservas para usar o valor oficial do serviço "Daycare" cadastrado em `catalogue_items` na hora de cobrar diárias avulsas (excedentes ao pacote do tutor), eliminando valores fixos (hardcoded).
     - **Gestão de Consumo Extra**: O modal de lançamento de consumo pela creche foi reestruturado para ser claro (com botão de confirmação explícito). Foi garantido que o preço aplicado ao lançamento sempre puxe exatamente do cadastro no catálogo em tempo real. Além disso, a creche agora pode revisar, visualizar e remover os consumíveis adicionados (caso não executados) antes de fechar a fatura.
     - **Transparência de Faturas para o Tutor**: A rotina de fechamento de reserva (`bookings.ts`) foi refatorada para realizar um `JOIN` com a tabela `catalogue_items`. Isso garante que a fatura gerada detalhe nomes precisos dos serviços (ex: "Banho", "Ração") na `invoice_items` em vez de strings genéricas ("Consumível #ID").
     - **Visualização de Detalhes (Frontend)**: Adicionado um novo Modal de Detalhes (`InvoiceDetailsModal` com ícone Eye) no painel financeiro do Tutor para que o mesmo possa conferir a discriminação exata de tudo que está sendo cobrado em uma fatura.
     - **Correção da Liquidação de Despesas (Erro 500)**: Correção crítica na rota de baixa de despesas (`POST /expenses/:id/pay`). Foi removida a coluna inexistente `status: "pending"`, a associação em `transactions` foi ajustada para usar `expenseId` (substituindo o obsoleto padrão polimórfico `referenceId` neste caso), e implementado optional chaining `req.body?.paymentMethod` para evitar crash quando o frontend envia body vazio. Adicionalmente, implementamos verificação prévia no banco com respostas 404 e 400 amigáveis caso a despesa não exista ou já esteja paga.
   - **Checkout Engine (`bookings.ts`)**: Fluxo transacional de check-out reconstruído. Agora, ao finalizar um check-out, o sistema deduz créditos de pacote ativo do tutor, totaliza os `consumables` (adicionais), gera faturas (`invoices`) automáticas e logs de auditoria correspondentes em `financial_audit_logs`.
   - **Integração com Webhook Stripe**: Rotas ajustadas para validar a assinatura nativa do webhook HMAC consumindo requisições raw (`express.raw()`) e convertendo pagamentos confirmados do Stripe em atualizações para `transactionsTable` e marcação de imutabilidade (Status da fatura travado).
   - **Segurança Criptográfica**: Implementação de módulo utilitário `crypto.ts` com cifra `AES-256-GCM` de via dupla e uso obrigatório de `process.env.ENCRYPTION_KEY` para mascaramento de campos de identificação do tutor (CPF e Telefone na tabela `users`).
   - **Privacidade e LGPD**: 
     - Criada rota `POST /api/users/:userId/anonymize` para realizar soft delete, excluindo permanentemente PII (nome, email, cpf, telefone e avatar) para a string `"ANON_ID"` permitindo que o histórico do fluxo de caixa e o DRE não fiquem inconsistentes.
     - Implementado CRON job programado diário (em `scheduler.ts`) para deletar o binário no Storage Cloud de recibos Pix com mais de 90 dias após o fechamento da fatura.
     - Bloqueado o acesso direto às fotos dos comprovantes; a rota `GET /storage/objects/*` agora possui restrição de middleware (`authenticate`), evitando vazamento do path por meio de URLs não-autenticadas.

6. **Refatoração de UX e Arquitetura de Informação (Frontend)**:
   - **Quick Wins:** Removidos links financeiros do menu da role `staff`. Refinamento da Home do Tutor para agrupar acesso rápido aos check-ins e comunicação.
   - **Realocação e Fluxos:** A aprovação de reservas foi consolidada na aba "Pendentes" da tela `/bookings`. Adição do atalho "Lançar Consumo Extra" via modais, encurtando o fluxo de 4 para 2 cliques.
   - **Fusão do Painel Operacional:** As telas fragmentadas de Tarefas (`/tasks`) e Passeios (`/walks`) foram unificadas em um único painel ágil (`/staff/board`), utilizando Tabs (wouter + shadcn) sincronizadas com a URL para facilitar transições e atualizações da equipe em tempo real.
   - **Divisão Financeira:** A página gigante `/financial` foi fragmentada em Abas semânticas persistidas na URL (Fluxo de Caixa, Contas a Receber, Contas a Pagar, Catálogo de Serviços), reduzindo drasticamente a carga cognitiva na gestão.

---

## ⚠️ Regras de Ouro e Restrições Inegociáveis (Replit e Banco de Dados)

Qualquer IA trabalhando neste código **DEVE** seguir estritamente as seguintes diretrizes para evitar a quebra do ambiente de produção e da integração contínua:

### 1. Integração com Replit (Não Quebrar de Forma Alguma)
* **Arquivos de Configuração**: Nunca modifique, renomeie ou delete os arquivos `.replit`, `replit.md`, `.replitignore` ou arquivos de metadados gerados pelo Replit.
* **Variáveis de Ambiente e Domínios**: A aplicação depende de rotas e webhooks construídos dinamicamente a partir da variável `REPLIT_DOMAINS` ou domínios autogerados pelo ambiente Replit. Mantenha essas referências intactas.
* **Autenticação Personalizada**: O mecanismo de autenticação utiliza assinaturas JWT personalizadas com criptografia SHA-256 e chaves secretas específicas. Não altere o fluxo de login ou validação de tokens para bibliotecas padrão sem garantir total compatibilidade.

### 2. Convenções do Banco de Dados (Drizzle ORM)
* **Sem Chaves Estrangeiras Físicas (No Foreign Keys)**: Por decisão de arquitetura e compatibilidade com o esquema leve implementado no banco de dados Postgres no Replit, os relacionamentos entre tabelas são controlados estritamente ao nível de aplicação no Drizzle ORM. **NÃO crie restrições físicas de Foreign Key (`references(...)`) no banco de dados.** Mantenha a integridade apenas de forma lógica nas queries.

### 3. Ambiente Local de Desenvolvimento (Windows vs Linux Replit)
* **Dependência do esbuild**: O workspace possui overrides em `pnpm-workspace.yaml` que bloqueiam por padrão dependências de plataformas específicas como Windows, pois o Replit roda sobre Linux.
* Ao rodar e compilar localmente em ambiente Windows, se o Orval/esbuild falhar acusando a falta da biblioteca nativa para Win32, use o seguinte comando no diretório raiz para contornar temporariamente e instalar a dependência:
  ```bash
  pnpm install @esbuild/win32-x64@0.27.3 --ignore-scripts
  ```
* Use `npx pnpm <comando>` caso a CLI do `pnpm` não esteja exposta no PATH global do sistema Windows do usuário.

---

## 🛠️ Como Validar as Alterações

Antes de enviar ou dar o trabalho por encerrado, valide sempre a integridade da aplicação compilando o projeto inteiro:
```bash
# Executa a checagem de tipos em todos os pacotes e compila o monorepo
npx pnpm run build
```
Assegure-se de que nenhum erro de TypeScript (`tsc`) ou lint seja reportado no frontend ou no backend.
