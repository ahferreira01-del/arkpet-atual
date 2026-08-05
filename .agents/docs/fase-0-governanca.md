# FASE 0 — GOVERNANÇA DO DOMÍNIO FINANCEIRO
**Versão:** 1.0 · **Data:** Agosto 2026  
**Papel:** Arquiteto de Software Sênior — DDD / Event-Driven / Multi-tenant SaaS  
**Base:** Auditoria técnica completa (`.agents/docs/financial-module-audit.md`)  
**Restrição absoluta:** 100% documental. Nenhum arquivo de código foi ou será modificado.

---

## ÍNDICE

1. [Etapa 1 — Mapeamento do Domínio](#etapa-1--mapeamento-do-domínio)
2. [Etapa 2 — Responsabilidade dos Módulos](#etapa-2--responsabilidade-dos-módulos)
3. [Etapa 3 — Fluxo Oficial](#etapa-3--fluxo-oficial)
4. [Etapa 4 — Fluxos Legados](#etapa-4--fluxos-legados)
5. [Etapa 5 — Eventos do Domínio](#etapa-5--eventos-do-domínio)
6. [Etapa 6 — Contratos entre Módulos](#etapa-6--contratos-entre-módulos)
7. [Etapa 7 — Invariantes do Domínio](#etapa-7--invariantes-do-domínio)
8. [Etapa 8 — Pontos de Acoplamento](#etapa-8--pontos-de-acoplamento)
9. [Etapa 9 — Pontos de Risco](#etapa-9--pontos-de-risco)
10. [Etapa 10 — Documentação Final Consolidada](#etapa-10--documentação-final-consolidada)

---

## ETAPA 1 — MAPEAMENTO DO DOMÍNIO

### 1.1 Entidades do Domínio Financeiro

---

#### `Catalogue`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Repositório de produtos e serviços disponíveis para venda ou consumo. Define preço, estoque, tipo (product / service / package / consumable) e thresholds de alerta. |
| **Quem cria** | Admin via `POST /financial/catalogue` |
| **Quem altera** | Admin via `PUT /financial/catalogue/:itemId`; sistema via dedução de estoque (orders, POS, bookings) |
| **Quem consulta** | Admin (painel financeiro), tutor (lojinha), booking flow (consumíveis), sistema de alertas de estoque |
| **Quem depende** | Order, OrderItem, TutorCredits (pelo nome do item), CatalogueStockTransaction |
| **Tabelas** | `catalogue_items`, `catalogue_stock_transactions` |
| **Services** | `routes/financial.ts` (CRUD), `routes/orders.ts` (dedução de estoque), `routes/bookings.ts` (consulta de consumíveis) |
| **Endpoints** | `GET /financial/catalogue`, `POST /financial/catalogue`, `PUT /financial/catalogue/:id`, `DELETE /financial/catalogue/:id`, `POST /financial/catalogue/:id/stock-adjustment` |

---

#### `CatalogueItem`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Unidade vendável. Carrega tipo (`product`, `service`, `package`, `consumable`), preço, `creditsAmount`, `stockQuantity`, `minStockAlert`, `reorderThreshold`. |
| **Quem cria** | Admin |
| **Quem altera** | Admin (dados), sistema (estoque via orders/POS/bookings) |
| **Quem consulta** | Todos os fluxos de venda e consumo |
| **Quem depende** | Order, Invoice (via charges), TutorCredits (via `creditsAmount`), CatalogueStockTransaction |
| **Tabelas** | `catalogue_items` |
| **Services** | `services/credits.ts` (lê `creditsAmount`), `routes/orders.ts` (lê e decrementa stock) |
| **Endpoints** | (herdados do Catalogue acima) |

---

#### `Order`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Representa uma intenção de compra do tutor ou uma venda balcão (POS). Agrega itens, registra canal (`store` / `pos`), rastreia status de pagamento e entrega. |
| **Quem cria** | Tutor via `POST /orders` (loja), Admin via `POST /financial/pos-sale` (POS) |
| **Quem altera** | Admin (status: delivered, cancelled), sistema (status: paid via BillingService) |
| **Quem consulta** | Admin (painel), tutor (histórico), sistema (liberação de créditos) |
| **Quem depende** | Invoice (uma invoice por order), OrderItem (N itens), TutorServiceCredits (pacotes de serviço) |
| **Tabelas** | `orders`, `order_items` |
| **Services** | `services/billing.ts` (atualiza status para `paid`), `services/credits.ts` (libera créditos após pagamento) |
| **Endpoints** | `GET /orders`, `POST /orders`, `PUT /orders/:id/status`, `GET /financial/orders` |

---

#### `OrderItem`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Linha de um pedido. Vincula o pedido a um CatalogueItem com quantidade e preço unitário. |
| **Quem cria** | Sistema junto com o Order |
| **Quem altera** | Não é alterado após criação |
| **Quem consulta** | Admin, tutor (detalhe do pedido) |
| **Quem depende** | Order, CatalogueItem |
| **Tabelas** | `order_items` |
| **Services** | `routes/orders.ts` |
| **Endpoints** | (herdados do Order) |

---

#### `Invoice`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Documento financeiro que representa o que o tutor deve pagar. Pode ser de ciclo mensal (`monthly_cycle`) ou avulso (`avulso`). Agrega InvoiceItems, rastreia status, valor total, data de vencimento. |
| **Quem cria** | `BillingService.addCharge` (automaticamente ao adicionar uma cobrança) |
| **Quem altera** | `BillingService` (status, amount), `financialSync.ts` (marca paid via Stripe), Admin via endpoints de gestão |
| **Quem consulta** | Admin (painel), tutor (carteira), scheduler (lembretes), analytics, reports |
| **Quem depende** | InvoiceItem, Transaction, TutorCredits, TutorServiceCredits, Order |
| **Tabelas** | `invoices` |
| **Services** | `services/billing.ts` (toda a lógica de ciclo de vida), `lib/financialSync.ts` (pagamento via Stripe) |
| **Endpoints** | `GET /financial/invoices`, `GET /financial/invoices/:id`, `PUT /financial/invoices/:id/status`, `POST /financial/invoices/:id/void`, `POST /financial/invoices/:id/refund`, `POST /financial/invoices/:id/pay-manual`, `POST /financial/invoices/:id/approve-receipt` |

---

#### `InvoiceItem`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Linha de cobrança dentro de uma invoice. Descreve o que está sendo cobrado (reserva, consumível, produto, pacote). |
| **Quem cria** | `BillingService.addCharge` |
| **Quem altera** | Admin via `refundInvoiceItem` |
| **Quem consulta** | Admin, tutor, `CreditService` (para determinar tipo e quantidade de créditos a liberar) |
| **Quem depende** | Invoice, (indiretamente) CatalogueItem via descrição |
| **Tabelas** | `invoice_items` |
| **Services** | `services/billing.ts`, `services/credits.ts` |
| **Endpoints** | `GET /financial/invoices/:id/items`, `POST /financial/invoices/:id/items/:itemId/refund` |

---

#### `Transaction`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Registro imutável de um movimento financeiro real (entrada ou saída de dinheiro). Prova de que um pagamento ocorreu. Nunca é alterada após criação. |
| **Quem cria** | `BillingService` (`processManualPayment`, `approveReceipt`, `refundInvoice`), `financialSync.ts` (Stripe) |
| **Quem altera** | Não é alterada — registro imutável |
| **Quem consulta** | Admin (extrato, reports, DRE, cash flow), analytics |
| **Quem depende** | Invoice (uma transaction por evento de pagamento) |
| **Tabelas** | `transactions` |
| **Services** | `services/billing.ts`, `lib/financialSync.ts` |
| **Endpoints** | `GET /financial/transactions` (leitura) |

---

#### `TutorCredits` (Créditos de Diária)
| Campo | Valor |
|---|---|
| **Responsabilidade** | Saldo de diárias (hospedagem) de um tutor dentro de um pacote comprado. Controla `totalCredits` (concedido) e `usedCredits` (consumido). |
| **Quem cria** | `CreditService.releasePurchasedCredits` após invoice de pacote ser paga |
| **Quem altera** | `routes/bookings.ts` (consumo na confirmação, restauração no cancelamento) — **viola fronteira de domínio** |
| **Quem consulta** | Admin (saldo do tutor), tutor (carteira), booking flow (verificação antes de confirmar) |
| **Quem depende** | Invoice (origem dos créditos), Booking (consumidor) |
| **Tabelas** | `tutor_credits` |
| **Services** | `services/credits.ts` (criação), `routes/bookings.ts` (consumo — acesso direto) |
| **Endpoints** | `GET /financial/credits`, `GET /financial/credits/balance` (404 — não existe) |

---

#### `TutorServiceCredits` (Créditos de Serviço)
| Campo | Valor |
|---|---|
| **Responsabilidade** | Saldo de créditos de serviços específicos (banho, consulta etc.) de um tutor dentro de um pacote comprado. Mesma estrutura que TutorCredits mas para serviços. |
| **Quem cria** | `CreditService.releasePurchasedCredits` após invoice de pacote de serviço ser paga |
| **Quem altera** | `routes/bookings.ts` (consumo), `routes/orders.ts` (revogação no cancelamento de pedido) — **violam fronteira de domínio** |
| **Quem consulta** | Admin, tutor, booking flow |
| **Quem depende** | Invoice (origem), Booking (consumidor) |
| **Tabelas** | `tutor_service_credits` |
| **Services** | `services/credits.ts` (criação), `routes/bookings.ts` e `routes/orders.ts` (acesso direto) |
| **Endpoints** | `GET /financial/service-credits` |

---

#### `Wallet`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Visão agregada do saldo financeiro do tutor. Não é uma tabela — é uma projeção calculada em tempo real a partir de `tutor_credits` e `tutor_service_credits`. |
| **Quem cria** | Não existe no banco — calculada on-demand |
| **Quem altera** | Não existe — é derivada |
| **Quem consulta** | Tutor (página financeira), admin (indicadores), booking flow (verificação de saldo), frontend badge de navegação |
| **Quem depende** | TutorCredits, TutorServiceCredits |
| **Tabelas** | Nenhuma própria — projeta `tutor_credits` + `tutor_service_credits` |
| **Services** | `routes/financial.ts` (endpoints de saldo) |
| **Endpoints** | `GET /financial/credits`, `GET /financial/service-credits`, `GET /financial/packages-balance` |

---

#### `Expense`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Despesa operacional da creche (saída de caixa não relacionada a tutor). Alimenta o DRE e Cash Flow. |
| **Quem cria** | Admin via `POST /financial/expenses` |
| **Quem altera** | Admin via `PUT /financial/expenses/:id`, `POST /financial/expenses/:id/pay` |
| **Quem consulta** | Admin (DRE, cash flow, listagem) |
| **Quem depende** | Nenhum — entidade independente |
| **Tabelas** | `expenses` |
| **Services** | `routes/financial.ts` |
| **Endpoints** | `GET /financial/expenses`, `POST /financial/expenses`, `PUT /financial/expenses/:id`, `DELETE /financial/expenses/:id`, `POST /financial/expenses/:id/pay` |

---

#### `FinancialAuditLog`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Log imutável de todas as operações financeiras significativas. Rastreabilidade para compliance e debugging. |
| **Quem cria** | `services/audit.ts` → chamado por todos os módulos financeiros |
| **Quem altera** | Não é alterado — append-only |
| **Quem consulta** | Admin (auditoria, busca global) |
| **Quem depende** | Todos os módulos financeiros (produce), nenhum (consume) |
| **Tabelas** | `financial_audit_logs` |
| **Services** | `services/audit.ts` |
| **Endpoints** | `GET /financial/audit-logs` |

---

#### `CatalogueStockTransaction`
| Campo | Valor |
|---|---|
| **Responsabilidade** | Histórico de movimentações de estoque (entradas e saídas). Rastreabilidade para auditoria de inventário. |
| **Quem cria** | Sistema a cada venda, ajuste manual ou cancelamento |
| **Quem altera** | Não é alterado — append-only |
| **Quem consulta** | Admin (histórico de estoque) |
| **Quem depende** | CatalogueItem |
| **Tabelas** | `catalogue_stock_transactions` |
| **Services** | `routes/financial.ts` (ajustes), `routes/orders.ts` (vendas) |
| **Endpoints** | `GET /financial/catalogue/:id/stock-history` |

---

#### `Payment` (conceito, não tabela própria)
| Campo | Valor |
|---|---|
| **Responsabilidade** | Evento de recebimento de dinheiro. Materializa-se como `Transaction` no banco. Os mecanismos de pagamento são: PIX manual (upload de comprovante), pagamento manual admin, Stripe Checkout. |
| **Quem cria** | Admin (manual, PIX), Stripe (automático) |
| **Quem altera** | Não alterável após criação |
| **Quem consulta** | Admin, tutor |
| **Quem depende** | Invoice (triggering), Transaction (resultado) |
| **Tabelas** | `transactions` (materialização), `invoices` (referência ao `stripePaymentIntentId`) |
| **Services** | `services/billing.ts`, `lib/financialSync.ts` |
| **Endpoints** | `POST /financial/invoices/:id/pay-manual`, `POST /financial/invoices/:id/approve-receipt`, `POST /stripe/webhook` |

---

### 1.2 Entidades fora do domínio financeiro que o cruzam

| Entidade | Domínio original | Cruzamento com financeiro |
|---|---|---|
| `Booking` | Booking Domain | Consome TutorCredits e TutorServiceCredits; gera InvoiceItems via addCharge |
| `Tutor` | User Domain | É o sujeito de Invoice, TutorCredits, Orders |
| `Creche` | Tenant Domain | Contexto de isolamento de todos os dados financeiros |
| `Subscription` | Billing/Subscription Domain | Determina limites de plano; gerenciada por subscriptionSync |

---

## ETAPA 2 — RESPONSABILIDADE DOS MÓDULOS

### `BillingService` (`services/billing.ts`)

**Pode:**
- Criar invoices de ciclo mensal ou avulsas via `addCharge`
- Adicionar charges (cobranças) a invoices existentes ou criar novas
- Receber pagamento manual via `processManualPayment`
- Aprovar comprovante PIX via `approveReceipt`
- Anular invoice via `voidInvoice`
- Reembolsar invoice via `refundInvoice`
- Verificar se tutor tem invoices vencidas via `hasOverdueInvoices`
- Calcular data de vencimento via `calculateDueDate`
- Atualizar status de `orders` para `paid` após pagamento

**Não pode:**
- Liberar créditos para o tutor
- Consumir créditos de reservas
- Criar ou alterar pedidos (Order)
- Alterar dados de booking
- Alterar estoque de catálogo
- Enviar push notifications (faz parte de chamadores, não do serviço)

**Fronteira:** BillingService é o único módulo autorizado a criar invoices, alterar o status de invoices e criar transactions. Nenhum outro módulo deve escrever diretamente nessas tabelas sem passar pelo BillingService.

---

### `CreditService` (`services/credits.ts`)

**Pode:**
- Liberar créditos de pacote de diária (`tutor_credits`) após pagamento via `releasePurchasedCredits`
- Liberar créditos de serviço (`tutor_service_credits`) após pagamento via `releasePurchasedCredits`
- Marcar invoice como `creditsReleased=true`
- Determinar o tipo e quantidade de crédito a liberar a partir dos InvoiceItems

**Não pode:**
- Criar invoices
- Criar transactions
- Criar pedidos
- Consumir créditos de reservas (isso é responsabilidade do BookingService — atualmente violado)
- Restaurar créditos de reservas (responsabilidade do BookingService — atualmente violado)
- Alterar bookings

**Fronteira:** CreditService é o único módulo autorizado a inserir linhas em `tutor_credits` e `tutor_service_credits`. O consumo e restauração dessas linhas (UPDATE de `usedCredits`) deve ser responsabilidade exclusiva do BookingService — atualmente, `routes/bookings.ts` faz esses UPDATEs diretamente, o que constitui violação de fronteira.

---

### `AuditService` (`services/audit.ts`)

**Pode:**
- Registrar qualquer operação financeira em `financial_audit_logs` via `logFinancialAudit`

**Não pode:**
- Alterar qualquer tabela financeira
- Tomar decisões de negócio
- Ser chamado fora de um contexto transacional significativo

**Fronteira:** AuditService é um serviço auxiliar transversal. Deve ser o ÚNICO produtor de `financial_audit_logs`. É consumido por todos os outros serviços financeiros.

---

### `OrderService` (`routes/orders.ts` — não existe como service formal)

**Pode (conforme código atual):**
- Criar pedidos da loja (`POST /orders`)
- Criar vendas POS (`POST /financial/pos-sale`)
- Atualizar status do pedido (entregue, cancelado)
- Deduzir estoque de catálogo
- Invocar `BillingService.addCharge` para criar invoice do pedido
- Invocar `CreditService.releasePurchasedCredits` após pagamento

**Não pode:**
- Criar transactions diretamente (deve passar por BillingService)
- Alterar invoices diretamente (deve passar por BillingService)
- Consumir créditos de reserva

**Situação atual:** A lógica de OrderService está embutida em `routes/orders.ts`, sem separação em service layer. Isso é apontado como oportunidade arquitetural no plano de refatoração (Fase 8).

---

### `BookingService` (`routes/bookings.ts` — não existe como service formal)

**Pode (conforme código atual):**
- Confirmar reservas
- Cancelar reservas
- Solicitar cobrança extra via `BillingService.addCharge`
- Verificar saldo antes de confirmar via `hasOverdueInvoices`
- Consumir `tutor_credits` e `tutor_service_credits` diretamente — **viola fronteira**
- Restaurar `tutor_credits` no cancelamento — **viola fronteira**

**Não pode:**
- Criar invoices diretamente (correto — usa BillingService)
- Criar transactions
- Criar pedidos

**Situação atual:** BookingService acessa diretamente as tabelas `tutor_credits` e `tutor_service_credits` para consumo e restauração. O domínio correto para essas operações seria um `CreditService` com métodos `consumeCredit` e `restoreCredit`. Isso é apontado como violação de fronteira crítica.

---

### `WalletService` (não existe — projeção calculada)

**Pode:**
- Calcular saldo agregado (`totalCredits - usedCredits`) via queries diretas

**Não pode:**
- Modificar qualquer tabela
- Criar créditos
- Consumir créditos

**Situação atual:** WalletService não existe como módulo formal. Os endpoints de saldo estão em `routes/financial.ts`. Isso é adequado enquanto o Wallet for apenas leitura, mas deve ser formalizado se regras de cálculo se tornarem mais complexas.

---

### `FinancialSyncService` (`lib/financialSync.ts`)

**Pode:**
- Processar eventos do webhook Stripe (`checkout.session.completed`)
- Marcar invoices como pagas
- Criar transactions de pagamento
- Invocar `CreditService.releasePurchasedCredits`

**Não pode:**
- Criar pedidos
- Alterar bookings
- Criar invoices
- Modificar catálogo

**Fronteira:** FinancialSyncService é o adaptador entre o sistema externo Stripe e o domínio financeiro interno. Deve traduzir eventos externos em chamadas a serviços internos sem conter lógica de negócio própria.

---

### `SchedulerService` (`lib/scheduler.ts`)

**Pode:**
- Enviar push notifications de lembretes de invoice
- Executar cleanup de recibos expirados (LGPD)
- Aplicar mudanças de plano agendadas
- Suspender assinaturas em atraso

**Não pode:**
- Alterar status de invoices (lê, não escreve — exceto cleanup de receiptPhotoPath)
- Criar transactions
- Liberar créditos

**Situação atual:** O scheduler lê invoices para gerar notificações mas não altera seus status. O status `overdue` é derivado em runtime (`dueDate < hoje`), não gravado pelo scheduler.

---

## ETAPA 3 — FLUXO OFICIAL

### 3.1 Fluxo oficial de compra (Tutor Store)

```
CATALOGUE
  Tutor consulta itens disponíveis com estoque > 0
  └─ GET /orders/catalogue ou GET /financial/catalogue
  
     ↓

CART (implícito no frontend — sem tabela de carrinho no backend)
  Tutor seleciona itens e quantidades
  Frontend mantém estado local do carrinho
  
     ↓

ORDER
  Tutor submete o carrinho
  └─ POST /orders
     ├─ Verifica tutor sem invoice vencida (hasOverdueInvoices)
     ├─ Abre db.transaction()
     ├─ INSERT orders (status: pending_payment)
     ├─ Para cada item:
     │    ├─ SELECT catalogue_items FOR UPDATE
     │    ├─ Verifica estoque suficiente
     │    ├─ INSERT order_items
     │    ├─ UPDATE catalogue_items (decrementa stock)
     │    └─ INSERT catalogue_stock_transactions
     └─ Fecha db.transaction()
  
     ↓

INVOICE
  BillingService.addCharge é chamado para cada item
  └─ Primeiro item: isAvulso=true → cria nova invoice avulsa
     ├─ INSERT invoices (type: avulso, status: pending)
     └─ INSERT invoice_items
  └─ Itens subsequentes: existingInvoiceId → adiciona à invoice existente
     └─ INSERT invoice_items (na mesma invoice)
  
     ↓

PAYMENT (3 caminhos possíveis)

  Caminho A — Stripe Checkout
  └─ POST /financial/stripe/checkout
     └─ Cria Stripe Checkout Session com metadata.packagePurchase=true
     └─ Redireciona tutor para página Stripe
     └─ Stripe processa pagamento
     
  Caminho B — PIX (upload de comprovante)
  └─ Tutor faz upload de comprovante
     └─ POST /financial/invoices/:id/receipt
  └─ Admin aprova comprovante
     └─ POST /financial/invoices/:id/approve-receipt
     
  Caminho C — Pagamento manual admin
  └─ POST /financial/invoices/:id/pay-manual
  
     ↓

TRANSACTION
  Criada pelo caminho de pagamento ativo:
  └─ Caminho A: financialSync.ts (checkout.session.completed webhook)
     ├─ UPDATE invoices SET status='paid'
     └─ INSERT transactions
  └─ Caminhos B e C: BillingService.processManualPayment ou approveReceipt
     ├─ UPDATE invoices SET status='paid'
     └─ INSERT transactions
  
     ↓

CREDIT RELEASE
  CreditService.releasePurchasedCredits(invoiceId)
  └─ SELECT invoice + invoice_items + catalogue_items
  └─ Para cada item do tipo 'package':
     ├─ INSERT tutor_credits (totalCredits = creditsAmount, usedCredits = 0)
     └─ UPDATE invoices SET creditsReleased = true
  └─ Para cada item do tipo 'service':
     ├─ INSERT tutor_service_credits (totalCredits = creditsAmount, usedCredits = 0)
     └─ UPDATE invoices SET creditsReleased = true
  
     ↓

WALLET (projeção)
  Saldo do tutor atualizado:
  └─ totalCredits - usedCredits (calculado on-demand)
  └─ Visível em GET /financial/credits e GET /financial/service-credits
  
     ↓

BOOKING
  Tutor agenda reserva de serviço ou diária
  └─ POST /bookings (cria reserva em status pending)
  └─ Admin confirma reserva
     └─ PUT /bookings/:id/confirm
     
     ↓

CREDIT CONSUMPTION
  Durante a confirmação da reserva:
  └─ SELECT tutor_credits FOR UPDATE
     ├─ Se balance > 0: UPDATE usedCredits + 1, INSERT booking_credits
     └─ Se balance = 0: BillingService.addCharge (cobrança avulsa)
  └─ SELECT tutor_service_credits FOR UPDATE (para serviços)
     ├─ Se balance > 0: UPDATE usedCredits + 1
     └─ Se balance = 0: BillingService.addCharge
  
     ↓

CHECKOUT (no contexto de reserva — serviço entregue)
  └─ Serviço executado na data da reserva
  └─ Admin registra check-in / check-out
  └─ Reserva marcada como completed
```

### 3.2 Fluxo oficial de venda POS (Balcão)

```
CATALOGUE
  Admin seleciona itens no modal POS
  └─ GET /financial/catalogue
  
     ↓

ORDER (POS)
  └─ POST /financial/pos-sale
     ├─ Abre db.transaction()
     ├─ INSERT orders (type: pos, status: paid — pagamento já ocorreu no balcão)
     ├─ Para cada item:
     │    ├─ SELECT catalogue_items FOR UPDATE
     │    ├─ Verifica estoque
     │    ├─ INSERT order_items
     │    └─ UPDATE catalogue_items (decrementa stock)
     ├─ BillingService.addCharge (isAvulso: true, com pagamento imediato)
     ├─ INSERT transactions (pagamento já realizado fisicamente)
     └─ Fecha db.transaction()
     
     ↓

INVOICE + TRANSACTION simultâneos
  Invoice criada já no status 'paid'
  Transaction inserida no mesmo momento
  Sem fase de PAYMENT pendente
  
     ↓

CREDIT RELEASE (se o item for pacote)
  CreditService.releasePurchasedCredits (idem ao fluxo da loja)
```

---

## ETAPA 4 — FLUXOS LEGADOS

### 4.1 Classificação de endpoints e fluxos alternativos

---

#### `POST /packages/purchase` — **LEGACY**
| Campo | Valor |
|---|---|
| **Arquivo** | `routes/financial.ts` (~L857) |
| **O que faz** | Endpoint antigo de compra de pacote de créditos. Cria invoice e redireciona para Stripe. |
| **Frontend utiliza?** | Não — nenhum componente frontend chama este endpoint |
| **Existe chamada ativa?** | Não — endpoint existe no backend mas não há `useCreateOrder` ou fetch para `/packages/purchase` no frontend |
| **Pode ser removido?** | Sim, após confirmar que nenhum cliente externo ou script o utiliza |
| **Deve permanecer?** | Não — o fluxo foi substituído por `POST /orders` |
| **Status** | **LEGACY** |
| **Risco de remoção** | Baixo — sem UI ativa |

---

#### Dois caminhos de liberação de créditos — **RISCO ATIVO**
| Campo | Valor |
|---|---|
| **Caminhos** | 1) `approveReceipt` → `releasePurchasedCredits` · 2) `financialSync.ts` → `releasePurchasedCredits` |
| **Problema** | Ambos podem ser acionados para a mesma invoice. Admin aprova PIX manualmente E Stripe webhook chega = double-release. |
| **Frontend utiliza?** | Sim (caminho 1 é via UI admin; caminho 2 é via webhook Stripe) |
| **Pode ser removido?** | Não — ambos são caminhos válidos de pagamento. Devem ser protegidos por lock, não removidos. |
| **Status** | **ACTIVE** (ambos), mas com race condition confirmada (IG-16) |

---

#### `GET /financial/credits/balance` — **OBSOLETE**
| Campo | Valor |
|---|---|
| **Arquivo** | Não existe no backend |
| **Frontend utiliza?** | Sim — hook `usePackagesBalance` chama este endpoint |
| **Existe no backend?** | Não — retorna 404 em produção |
| **Status** | **OBSOLETE** (frontend chama endpoint inexistente) |
| **Impacto** | Saldo de pacotes pode não carregar corretamente no frontend |

---

#### `PUT /financial/invoices/:id/status` — **OBSOLETE**
| Campo | Valor |
|---|---|
| **Arquivo** | Não existe no backend na forma esperada |
| **Frontend utiliza?** | Sim — hook frontend tenta chamar este endpoint |
| **Status** | **OBSOLETE** (o backend usa rotas específicas: `/void`, `/refund`, `/pay-manual`, `/approve-receipt`) |

---

#### Ciclo de invoice mensal (`monthly_cycle`) — **ACTIVE**
| Campo | Valor |
|---|---|
| **Arquivo** | `services/billing.ts` — `addCharge` com `isAvulso: false` |
| **O que faz** | Agrupa cobranças de reservas do mês em uma única invoice por tutor |
| **Problema conhecido** | Se a invoice já estiver `paid` e um novo charge chegar, ela é reaberta (bug B4 da auditoria) |
| **Status** | **ACTIVE** |

---

#### Invoice avulsa (`avulso`) — **ACTIVE**
| Campo | Valor |
|---|---|
| **Arquivo** | `services/billing.ts` — `addCharge` com `isAvulso: true` |
| **O que faz** | Invoice independente para compras da loja e POS |
| **Status** | **ACTIVE** |

---

#### Scheduler de lembrete de invoice — **ACTIVE**
| Campo | Valor |
|---|---|
| **Arquivo** | `lib/scheduler.ts` — cron `0 9 * * *` |
| **Status** | **ACTIVE** |

---

#### Cleanup de recibos PIX — **ACTIVE**
| Campo | Valor |
|---|---|
| **Arquivo** | `lib/scheduler.ts` — cron `0 4 * * *` |
| **O que faz** | Deleta imagens de comprovantes com >90 dias (LGPD) |
| **Status** | **ACTIVE** |

---

#### Subscription sync — **ACTIVE** (domínio separado)
| Campo | Valor |
|---|---|
| **Arquivo** | `lib/subscriptionSync.ts`, `lib/scheduler.ts` |
| **O que faz** | Gerencia status de assinaturas SaaS (não relacionado a créditos do tutor) |
| **Status** | **ACTIVE** — domínio separado do financeiro de tutores |

---

## ETAPA 5 — EVENTOS DO DOMÍNIO

> Os eventos abaixo são **implícitos** no código — não há sistema formal de eventos. Cada evento é materializado por um conjunto de writes no banco, sem dispatch explícito de evento.

---

### `OrderCreated`
| Campo | Valor |
|---|---|
| **Quem dispara** | `routes/orders.ts` — `POST /orders` |
| **Quem consome** | `BillingService.addCharge` (imediato, síncrono) |
| **Quem depende** | Invoice (criada como consequência), CatalogueStockTransaction (gerada junto) |
| **Altera estado** | `orders` (INSERT), `order_items` (INSERT), `catalogue_items` (UPDATE stock), `catalogue_stock_transactions` (INSERT), `invoices` (INSERT via addCharge) |
| **É persistido como evento?** | Não — apenas os writes. Sem event log formal. |

---

### `InvoiceCreated`
| Campo | Valor |
|---|---|
| **Quem dispara** | `BillingService.addCharge` |
| **Quem consome** | Nenhum consumidor formal — tutor e admin consultam via GET |
| **Quem depende** | Transaction (futura), TutorCredits (futura liberação) |
| **Altera estado** | `invoices` (INSERT), `invoice_items` (INSERT) |
| **Notificação** | Possível `sendInvoiceEmail` (não confirmado como obrigatório) |

---

### `PaymentReceived` (Manual ou PIX)
| Campo | Valor |
|---|---|
| **Quem dispara** | `BillingService.processManualPayment` ou `BillingService.approveReceipt` |
| **Quem consome** | `CreditService.releasePurchasedCredits` (síncrono, dentro da mesma tx) |
| **Quem depende** | Invoice (muda para `paid`), TutorCredits/TutorServiceCredits (ganham créditos) |
| **Altera estado** | `invoices` (UPDATE status=paid, creditsReleased), `transactions` (INSERT), `tutor_credits` ou `tutor_service_credits` (INSERT), `financial_audit_logs` (INSERT) |
| **Notificação** | Push notification ao tutor (não confirmado como obrigatório no código de billing) |

---

### `PaymentReceived` (Stripe)
| Campo | Valor |
|---|---|
| **Quem dispara** | `lib/financialSync.ts` — evento `checkout.session.completed` |
| **Quem consome** | `CreditService.releasePurchasedCredits` (somente se `metadata.packagePurchase=true`) |
| **Quem depende** | Invoice, TutorCredits/TutorServiceCredits |
| **Altera estado** | `invoices` (UPDATE paid), `transactions` (INSERT) |
| **Condição** | Créditos só são liberados se `session.metadata.packagePurchase === 'true'` |

---

### `InvoicePaid`
| Campo | Valor |
|---|---|
| **Quem dispara** | BillingService (pagamentos manuais/PIX) ou financialSync (Stripe) |
| **Quem consome** | CreditService (liberação de créditos), SchedulerService (para de enviar lembretes), frontend (invalida cache) |
| **Altera estado** | `invoices.status = 'paid'`, `invoices.creditsReleased = true` (após liberação) |

---

### `CreditsReleased`
| Campo | Valor |
|---|---|
| **Quem dispara** | `CreditService.releasePurchasedCredits` |
| **Quem consome** | Nenhum consumidor formal — tutor consulta via GET do saldo |
| **Quem depende** | Wallet (projeção atualiza), BookingService (pode agora confirmar reservas com crédito) |
| **Altera estado** | `tutor_credits` (INSERT) ou `tutor_service_credits` (INSERT), `invoices.creditsReleased = true` |
| **Notificação** | Nenhuma obrigatória no código atual |

---

### `CreditsConsumed`
| Campo | Valor |
|---|---|
| **Quem dispara** | `routes/bookings.ts` — confirmação de reserva |
| **Quem consome** | Nenhum — apenas altera o banco |
| **Quem depende** | Wallet (saldo diminui), Booking (pode prosseguir) |
| **Altera estado** | `tutor_credits.usedCredits + 1` ou `tutor_service_credits.usedCredits + 1`, `booking_credits` (INSERT) |
| **Notificação** | Nenhuma |

---

### `CreditsRestored`
| Campo | Valor |
|---|---|
| **Quem dispara** | `routes/bookings.ts` — cancelamento de reserva |
| **Quem consome** | Nenhum |
| **Quem depende** | Wallet (saldo volta), disponibilidade para nova reserva |
| **Altera estado** | `tutor_credits.usedCredits - N` |
| **Bug ativo** | `tutor_service_credits` NÃO é restaurado no cancelamento (IG-31) |

---

### `InvoiceVoided`
| Campo | Valor |
|---|---|
| **Quem dispara** | `BillingService.voidInvoice` (chamado no cancelamento de reserva ou pelo admin) |
| **Quem consome** | Nenhum consumidor formal |
| **Quem depende** | Order (deveria mudar para `cancelled` — não acontece atualmente, IG-09) |
| **Altera estado** | `invoices.status = 'voided'`, `financial_audit_logs` (INSERT) |

---

### `RefundProcessed`
| Campo | Valor |
|---|---|
| **Quem dispara** | `BillingService.refundInvoice` |
| **Quem consome** | Nenhum consumidor formal |
| **Quem depende** | Order (deveria mudar para `refunded` — não acontece, IG-10) |
| **Altera estado** | `invoices.status = 'refunded'`, `transactions` (INSERT de saída), `financial_audit_logs` |

---

### `OrderCancelled`
| Campo | Valor |
|---|---|
| **Quem dispara** | `routes/orders.ts` — `PUT /orders/:id/status` com `status=cancelled` |
| **Quem consome** | CatalogueItem (restaura estoque), TutorServiceCredits (revoga créditos de serviço) |
| **Altera estado** | `orders.status = cancelled`, `catalogue_items.stock + N`, `tutor_service_credits.totalCredits - N` (revogação) |

---

### `BookingConfirmed`
| Campo | Valor |
|---|---|
| **Quem dispara** | `routes/bookings.ts` — `PUT /bookings/:id/confirm` |
| **Quem consome** | CreditService (consome créditos), BillingService (se sem créditos, cria charge) |
| **Altera estado** | `bookings.status = confirmed`, `tutor_credits.usedCredits + 1` (ou addCharge), `booking_credits` (INSERT) |
| **Notificação** | Push notification ao tutor (fire-and-forget) |

---

### `BookingCancelled`
| Campo | Valor |
|---|---|
| **Quem dispara** | `routes/bookings.ts` — cancelamento |
| **Quem consome** | CreditService (restaura créditos de diária), Invoice (void se pendente) |
| **Altera estado** | `bookings.status = cancelled`, `tutor_credits.usedCredits - N`, `invoices.status = voided` (se pendente) |
| **Bug ativo** | `tutor_service_credits` não é restaurado (IG-31) |

---

### `LowStockDetected`
| Campo | Valor |
|---|---|
| **Quem dispara** | `routes/financial.ts` (ajuste manual) e `routes/orders.ts` (após venda) |
| **Quem consome** | `services/email.ts` — envia `sendLowStockAlertEmail` |
| **Altera estado** | Nenhum — apenas dispara e-mail |
| **Tipo** | Assíncrono — fire-and-forget (IIFE) com `.catch` |

---

## ETAPA 6 — CONTRATOS ENTRE MÓDULOS

### 6.1 Matriz de contratos diretos

```
OrderService (routes/orders.ts)
  └─► BillingService.addCharge()           contrato: (crecheId, tutorId, item, isAvulso?) → invoiceId
  └─► CreditService.releasePurchasedCredits()  contrato: (invoiceId, tx?) → void
  └─► CatalogueItem (direto — FOR UPDATE)  contrato: SELECT+UPDATE no mesmo tx
  └─► FinancialAuditLog (via AuditService) contrato: logFinancialAudit(...)

BillingService (services/billing.ts)
  └─► InvoicesTable (direto)               contrato: SELECT FOR UPDATE → UPDATE status
  └─► TransactionsTable (direto)           contrato: INSERT após UPDATE invoice
  └─► OrdersTable (direto)                 contrato: UPDATE status='paid' após pagamento
  └─► AuditService.logFinancialAudit()     contrato: após qualquer operação financeira

CreditService (services/credits.ts)
  └─► InvoicesTable (direto)               contrato: SELECT + UPDATE creditsReleased
  └─► InvoiceItemsTable (direto)           contrato: SELECT para determinar tipo/quantidade
  └─► CatalogueItemsTable (direto)         contrato: SELECT creditsAmount por nome
  └─► TutorCreditsTable (direto)           contrato: INSERT nova linha de créditos
  └─► TutorServiceCreditsTable (direto)    contrato: INSERT nova linha de créditos

BookingService (routes/bookings.ts)
  └─► BillingService.addCharge()           contrato: quando sem créditos
  └─► BillingService.hasOverdueInvoices()  contrato: verificação antes de confirmar
  └─► TutorCreditsTable (direto)           VIOLAÇÃO — deveria passar por CreditService
  └─► TutorServiceCreditsTable (direto)    VIOLAÇÃO — deveria passar por CreditService
  └─► AuditService.logFinancialAudit()     contrato: após consumo/restauração

FinancialSyncService (lib/financialSync.ts)
  └─► InvoicesTable (direto)               contrato: SELECT → UPDATE paid
  └─► TransactionsTable (direto)           contrato: INSERT
  └─► CreditService.releasePurchasedCredits()  contrato: após pagamento Stripe

SchedulerService (lib/scheduler.ts)
  └─► InvoicesTable (leitura)              contrato: SELECT pending/overdue
  └─► push.sendPushNotification()          contrato: reminder ao tutor/admin
  └─► objectStorage (leitura/escrita)      contrato: cleanup de recibos

AdminRoutes (routes/financial.ts)
  └─► BillingService (todos os métodos)    contrato: via endpoints admin
  └─► AuditService.logFinancialAudit()     contrato: após operações admin
  └─► Todas as tabelas financeiras (direto) contrato: CRUD via Drizzle
```

### 6.2 Dependências circulares identificadas

| Ciclo | Descrição | Risco |
|---|---|---|
| `BillingService → TransactionsTable ← FinancialSyncService` | Ambos escrevem transactions — não é circular, mas cria duas fontes de escrita para a mesma tabela | Médio |
| `OrderService → BillingService → OrdersTable ← OrderService` | OrderService cria o Order e BillingService atualiza seu status. Não é circular mas cria acoplamento bidirecional | Médio |
| `BookingService → TutorCreditsTable ← CreditService` | BookingService escreve diretamente onde CreditService é o responsável oficial | **Alto** |

### 6.3 Contratos ausentes (gap de design)

| Contrato que deveria existir | Situação atual |
|---|---|
| `CreditService.consumeCredit(tutorId, type, bookingId, tx)` | Não existe — BookingService acessa tutor_credits diretamente |
| `CreditService.restoreCredit(bookingId, tx)` | Não existe — cancelamento acessa diretamente |
| `OrderService` como service formal | Não existe — lógica em routes/orders.ts |
| `BookingService` como service formal | Não existe — lógica em routes/bookings.ts |

---

## ETAPA 7 — INVARIANTES DO DOMÍNIO

### 7.1 Invariantes absolutas (nunca podem ser quebradas)

| # | Invariante | Situação atual |
|---|---|---|
| INV-01 | Toda invoice com `status='paid'` deve ter pelo menos uma linha em `transactions` | ✅ Garantido pelo db.transaction() em approveReceipt, processManualPayment e financialSync |
| INV-02 | Toda transaction deve referenciar uma invoice existente | ✅ Garantido — invoice é validada antes do INSERT de transaction |
| INV-03 | Um crédito (`usedCredits`) nunca pode ser negativo | 🟠 Não há constraint no banco; guard existe na aplicação mas sem GREATEST(0,...) na restauração |
| INV-04 | `usedCredits` nunca pode ser maior que `totalCredits` | 🟠 Guard existe na aplicação (L431, L541 bookings.ts) mas sem CHECK constraint no banco |
| INV-05 | Todo crédito liberado (`tutor_credits` ou `tutor_service_credits`) deve ter `invoiceId` de origem | 🟠 Campo existe mas sem FK constraint (sem FK constraints no projeto inteiro) |
| INV-06 | `creditsReleased = true` em uma invoice implica que existe pelo menos uma linha em `tutor_credits` ou `tutor_service_credits` para aquela invoice | 🔴 Violável — creditsReleased sem UNIQUE em (invoiceId) permite double-release sem detecção |
| INV-07 | Uma invoice `paid` nunca pode voltar para `pending` | 🔴 Violada por `BillingService.addCharge` ao reabrir invoices pagas do ciclo mensal (bug B4) |
| INV-08 | Toda operação financeira significativa deve gerar registro em `financial_audit_logs` | 🟠 voidInvoice não garante audit log (sem transação atômica — IG-03) |
| INV-09 | Nenhuma operação financeira pode ficar parcialmente aplicada | 🟠 voidInvoice viola — sem db.transaction() (IG-03, IG-42) |
| INV-10 | Todo consumo de crédito deve ter registro em `booking_credits` | ✅ Garantido pelo db.transaction() na confirmação |
| INV-11 | Toda restauração de crédito deve ter consumo anterior rastreável | ✅ Para tutor_credits; 🔴 Não garantido para tutor_service_credits (IG-31) |
| INV-12 | Nenhuma venda pode gerar estoque negativo | ✅ SELECT FOR UPDATE + guard em orders.ts |
| INV-13 | Uma invoice do tipo `avulso` jamais deve acumular cobranças de ciclos diferentes | ✅ Garantido pelo design de addCharge |
| INV-14 | O saldo exibido ao tutor deve sempre refletir o banco — nunca um valor cacheado | ✅ Calculado on-demand via SELECT SUM |
| INV-15 | Uma transaction para um `stripePaymentIntentId` deve existir apenas uma vez | 🔴 Não garantido — webhook retry pode inserir duplicata (IG-27) |
| INV-16 | Pedidos gerados pela loja sempre têm uma invoice avulsa associada | 🟠 Garantido pelo fluxo mas sem FK constraint |
| INV-17 | Créditos de serviço não podem ser usados para reservas de diária e vice-versa | ✅ Separação mantida por lógica de código (bloco de diária vs bloco de serviço) |

---

## ETAPA 8 — PONTOS DE ACOPLAMENTO

### 8.1 Acoplamentos identificados e classificados

---

#### 🔴 CRÍTICO — `routes/bookings.ts` acessa `tutor_credits` e `tutor_service_credits` diretamente

| Campo | Valor |
|---|---|
| **Arquivo** | `routes/bookings.ts` L423–580 (consumo) e L607–652 (restauração) |
| **Problema** | BookingService (domínio de reservas) escreve diretamente em tabelas que pertencem ao CreditService (domínio financeiro). Viola separação de responsabilidades. |
| **Risco** | Se a lógica de crédito mudar (novo tipo, nova tabela, nova regra), é necessário alterar routes/bookings.ts — que deveria ser agnóstico a detalhes de crédito |
| **Classificação** | 🔴 CRÍTICO |

---

#### 🔴 CRÍTICO — `services/credits.ts` detecta tipo de crédito via regex no nome do item

| Campo | Valor |
|---|---|
| **Arquivo** | `services/credits.ts` L36, L40 |
| **Código** | Regex `di[aá]rias?` no nome do CatalogueItem |
| **Problema** | Lógica de domínio baseada em string de usuário. Renomear um item quebra silenciosamente a liberação de créditos. |
| **Classificação** | 🔴 CRÍTICO |

---

#### 🔴 CRÍTICO — Duas fontes de liberação de créditos para a mesma invoice

| Campo | Valor |
|---|---|
| **Arquivos** | `services/billing.ts:101,146` (approveReceipt, processManualPayment) e `lib/financialSync.ts:38` (Stripe) |
| **Problema** | Ambos chamam `releasePurchasedCredits`. Sem lock, podem executar simultaneamente para a mesma invoice. |
| **Classificação** | 🔴 CRÍTICO |

---

#### 🟠 ALTO — `routes/orders.ts` chama `releasePurchasedCredits` diretamente

| Campo | Valor |
|---|---|
| **Arquivo** | `routes/orders.ts` L395 |
| **Problema** | OrderService invoca CreditService diretamente dentro de `PUT /orders/:id/status`. Lógica de crédito acoplada ao domínio de pedidos. |
| **Classificação** | 🟠 ALTO |

---

#### 🟠 ALTO — `routes/financial.ts` acessa todas as tabelas financeiras diretamente (sem service)

| Campo | Valor |
|---|---|
| **Arquivo** | `routes/financial.ts` (~1400 linhas) |
| **Problema** | Rota de admin contém queries Drizzle diretas para invoices, transactions, expenses, catalogue, credits — sem passar por services. Duplica lógica que BillingService e CreditService já possuem. |
| **Classificação** | 🟠 ALTO |

---

#### 🟠 ALTO — `lib/financialSync.ts` escreve diretamente em `invoicesTable` e `transactionsTable`

| Campo | Valor |
|---|---|
| **Arquivo** | `lib/financialSync.ts` L18–35 |
| **Problema** | FinancialSyncService deveria chamar BillingService para marcar invoice como paga. Em vez disso, escreve diretamente, duplicando lógica de BillingService. |
| **Classificação** | 🟠 ALTO |

---

#### 🟡 MÉDIO — `routes/bookings.ts` chama `BillingService.addCharge` diretamente

| Campo | Valor |
|---|---|
| **Arquivo** | `routes/bookings.ts` L577, L1124, L1139 |
| **Problema** | BookingService conhece detalhes de faturamento. Em DDD puro, deveria emitir um evento de domínio. Na prática atual, o acoplamento é aceitável dado que não há sistema de eventos. |
| **Classificação** | 🟡 MÉDIO |

---

#### 🟡 MÉDIO — `services/credits.ts` acessa `catalogueItemsTable` via nome para determinar créditos

| Campo | Valor |
|---|---|
| **Arquivo** | `services/credits.ts` L36–80 |
| **Problema** | CreditService cruza para o domínio de Catalogue para determinar `creditsAmount`. O campo `creditsAmount` deveria estar no `InvoiceItem` para desacoplar. |
| **Classificação** | 🟡 MÉDIO |

---

#### 🟢 BAIXO — `routes/users.ts` chama `logFinancialAudit`

| Campo | Valor |
|---|---|
| **Arquivo** | `routes/users.ts` L9, L208 |
| **Problema** | Leve cruzamento de domínio para logging de auditoria financeira durante operações de usuário. Aceitável dado que AuditService é transversal. |
| **Classificação** | 🟢 BAIXO |

---

## ETAPA 9 — PONTOS DE RISCO

### 9.1 Lógica baseada em string / nome de usuário

| # | Arquivo | Linha | Risco | Descrição |
|---|---|---|---|---|
| R-01 | `credits.ts` | 36, 40 | 🔴 CRÍTICO | Regex `di[aá]rias?` decide qual tabela de crédito usar. Renomear item = bug silencioso. |
| R-02 | `credits.ts` | ~72 | 🟠 ALTO | Busca de `creditsAmount` no catálogo por nome do item do invoice. Se item for renomeado após a venda, lookup falha e crédito amount = 0. |
| R-03 | `bookings.ts` | ~548 | 🟡 MÉDIO | `normalizeServiceType` para match de crédito de serviço — baseado em string de tipo. |

### 9.2 Update sem transação atômica

| # | Arquivo | Função | Risco | Descrição |
|---|---|---|---|---|
| R-04 | `billing.ts` | `voidInvoice` | 🔴 CRÍTICO | `db.update` + `logFinancialAudit` sem `db.transaction()`. Falha parcial possível. |

### 9.3 Leitura-antes-de-escrita sem lock (race conditions)

| # | Arquivo | Função | Risco | Descrição |
|---|---|---|---|---|
| R-05 | `billing.ts` | `approveReceipt` | 🔴 CRÍTICO | SELECT invoice sem `FOR UPDATE`. Dois admins simultâneos = double payment + double credits. |
| R-06 | `billing.ts` | `processManualPayment` | 🔴 CRÍTICO | Idem. |
| R-07 | `credits.ts` | `releasePurchasedCredits` | 🔴 CRÍTICO | SELECT invoice sem `FOR UPDATE`. Two concurrent calls = double release. |
| R-08 | `orders.ts` | `PUT /status` (cancel) | 🟠 ALTO | SELECT `tutor_service_credits` sem `FOR UPDATE` antes de revogar. |
| R-09 | `financial.ts` | POST/PUT catalogue | 🟡 MÉDIO | Verificação de nome duplicado sem `FOR UPDATE`. |

### 9.4 Idempotência ausente

| # | Arquivo | Risco | Descrição |
|---|---|---|---|
| R-10 | `financialSync.ts` | 🔴 CRÍTICO | Webhook Stripe retry insere transaction duplicada (sem check de `stripePaymentIntentId` existente). |
| R-11 | `billing.ts` / `financialSync.ts` | 🔴 CRÍTICO | Dois caminhos de liberação de crédito sem idempotência garantida entre si. |

### 9.5 Múltiplas fontes de verdade

| # | Risco | Descrição |
|---|---|---|
| R-12 | 🔴 CRÍTICO | Tipo de crédito (diária vs. serviço) determinado por: (a) regex no nome e (b) `itemType` do catálogo — dois mecanismos divergem. |
| R-13 | 🟠 ALTO | Dois caminhos para marcar invoice como `paid`: `BillingService` e `financialSync.ts` — lógica duplicada sem contrato formal. |
| R-14 | 🟡 MÉDIO | Status de `orders` e `invoices` ficam desincronizados após `voidInvoice` e `refundInvoice`. |

### 9.6 Endpoints redundantes / código morto

| # | Risco | Descrição |
|---|---|---|
| R-15 | 🟠 ALTO | `POST /packages/purchase` (legacy) existe no backend sem UI ativa. |
| R-16 | 🟠 ALTO | `GET /financial/credits/balance` chamado pelo frontend mas não existe no backend (404). |
| R-17 | 🟠 ALTO | `PUT /financial/invoices/:id/status` chamado pelo frontend mas backend usa endpoints específicos (/void, /refund, etc). |

### 9.7 Inconsistência de estados

| # | Risco | Descrição |
|---|---|---|
| R-18 | 🔴 CRÍTICO | Invoice `monthly_cycle` já `paid` pode ser reaberta por novo `addCharge` (bug B4). |
| R-19 | 🔴 CRÍTICO | Cancelamento de reserva de serviço perde créditos silenciosamente (IG-31). |
| R-20 | 🟠 ALTO | Pedido permanece `pending_payment` mesmo após invoice `voided`. |
| R-21 | 🟠 ALTO | Pedido permanece `paid` mesmo após invoice `refunded`. |
| R-22 | 🟠 ALTO | `invoice_items` de invoices voided/refunded acumulam no banco indefinidamente. |

### 9.8 Ausência de constraints no banco

| # | Risco | Descrição |
|---|---|---|
| R-23 | 🔴 CRÍTICO | Sem `UNIQUE (invoice_id)` em `tutor_credits` ou `tutor_service_credits`. Double-release não tem barreira física. |
| R-24 | 🟠 ALTO | Sem `CHECK (used_credits >= 0)`. Créditos negativos são fisicamente possíveis. |
| R-25 | 🟠 ALTO | Sem `CHECK (used_credits <= total_credits)`. Overdraft é fisicamente possível. |
| R-26 | 🟠 ALTO | Ausência total de FK constraints no banco — dados órfãos não são detectados pelo banco. |

---

## ETAPA 10 — DOCUMENTAÇÃO FINAL CONSOLIDADA

### 10.1 Arquitetura atual

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOMÍNIO FINANCEIRO                           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ BillingService│  │ CreditService│  │    AuditService      │  │
│  │  billing.ts  │  │  credits.ts  │  │    audit.ts          │  │
│  │              │  │              │  │                      │  │
│  │ addCharge    │  │ releasePurch.│  │ logFinancialAudit    │  │
│  │ approveRecpt │  │ Credits()    │  │                      │  │
│  │ payManual    │  │              │  │ ← usado por todos    │  │
│  │ voidInvoice  │  │ ← ÚNICO      │  └──────────────────────┘  │
│  │ refundInvoice│  │   produtor   │                             │
│  │ hasOverdue   │  │   de credits │  ┌──────────────────────┐  │
│  └──────┬───────┘  └──────┬───────┘  │  FinancialSyncSvc    │  │
│         │                 │          │  financialSync.ts    │  │
│         │                 │          │                      │  │
│  ┌──────┴─────────────────┴───────┐  │ ← adaptador Stripe  │  │
│  │        PostgreSQL DB           │  └──────────────────────┘  │
│  │  invoices    tutor_credits     │                             │
│  │  invoice_items tuorSvcCredits  │  ┌──────────────────────┐  │
│  │  transactions  orders          │  │   SchedulerService   │  │
│  │  catalogue_items  expenses     │  │   scheduler.ts       │  │
│  │  fin_audit_logs               │  │ ← reminders, cleanup │  │
│  └────────────────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         ▲                    ▲
         │ cruza fronteira    │ cruza fronteira
         │ (violações)        │ (aceitável)
┌────────┴────────┐  ┌────────┴────────┐
│ routes/bookings │  │  routes/orders  │
│  (BookingDomain)│  │  (OrderDomain)  │
└─────────────────┘  └─────────────────┘
```

### 10.2 Fluxograma oficial

Ver Etapa 3 — fluxo oficial de compra (loja) e POS.

### 10.3 Definição oficial de cada processo

| Processo | Fluxo oficial | Fluxos legados/alternativos |
|---|---|---|
| Compra de pacote de créditos | `POST /orders` → `BillingService.addCharge` → pagamento → `CreditService.releasePurchasedCredits` | `POST /packages/purchase` (LEGACY, sem UI) |
| Venda POS | `POST /financial/pos-sale` → addCharge + transaction simultâneos | — |
| Pagamento manual | `POST /financial/invoices/:id/pay-manual` | — |
| Pagamento PIX | Upload comprovante → `POST /financial/invoices/:id/approve-receipt` | — |
| Pagamento Stripe | `POST /stripe/webhook` → `financialSync.ts` | — |
| Anulação de invoice | `POST /financial/invoices/:id/void` | — |
| Reembolso | `POST /financial/invoices/:id/refund` | — |
| Confirmação de reserva | `PUT /bookings/:id/confirm` → consume credits ou addCharge | — |
| Cancelamento de reserva | `DELETE /bookings/:id` ou status update → restore credits + voidInvoice | — |

### 10.4 Eventos do domínio

Ver Etapa 5 — mapeamento completo de 13 eventos com produtores e consumidores.

### 10.5 Contratos

Ver Etapa 6 — matriz de contratos diretos, dependências circulares e contratos ausentes.

### 10.6 Dependências

Ver documento de auditoria, Seções 14–17 (Matrizes de Dependências).

### 10.7 Fluxos legados classificados

| Fluxo | Status |
|---|---|
| `POST /packages/purchase` | **LEGACY** — remover após confirmação de não uso |
| `GET /financial/credits/balance` | **OBSOLETE** — endpoint chamado pelo frontend mas inexistente |
| `PUT /financial/invoices/:id/status` | **OBSOLETE** — substituído por endpoints específicos |
| Invoice `monthly_cycle` reopening | **ACTIVE** com bug (B4) |
| Dois caminhos de liberação de créditos | **ACTIVE** ambos — requerem lock para coexistir com segurança |

### 10.8 Riscos consolidados

Ver Etapa 9 — 26 pontos de risco classificados por severidade.

### 10.9 Invariantes

Ver Etapa 7 — 17 invariantes com status de cumprimento atual.

### 10.10 Recomendações para futuras refatorações

Em ordem de prioridade, baseadas nos critérios: impacto em produção, facilidade de rollback, independência entre mudanças.

**Prioridade 1 — Confiabilidade imediata (sem mudança arquitetural):**
1. Adicionar `db.transaction()` em `voidInvoice`
2. Adicionar `FOR UPDATE` em `approveReceipt`, `processManualPayment`, `releasePurchasedCredits`
3. Adicionar verificação de idempotência no webhook Stripe (`stripePaymentIntentId` já existente)
4. Adicionar `GREATEST(0, ...)` na restauração de `usedCredits`
5. Adicionar restauração de `tutor_service_credits` no cancelamento de reserva

**Prioridade 2 — Integridade de dados:**
6. Adicionar `CHECK (used_credits >= 0)` e `CHECK (used_credits <= total_credits)` no banco
7. Adicionar `UNIQUE (invoice_id)` em `tutor_credits` e `tutor_service_credits`
8. Sincronizar status de `orders` após `voidInvoice` e `refundInvoice`

**Prioridade 3 — Arquitetura:**
9. Criar `CreditService.consumeCredit()` e `CreditService.restoreCredit()` — eliminar acesso direto de bookings.ts
10. Criar `services/orders.ts` — extrair lógica de routes/orders.ts
11. Substituir regex de crédito por campo `itemType` explícito
12. Criar interface unificada de créditos sobre os dois sistemas

**Prioridade 4 — Housekeeping:**
13. Remover `POST /packages/purchase` (LEGACY)
14. Criar endpoints faltantes (`GET /financial/credits/balance`)
15. Job de cleanup de pedidos stale

---

## CRITÉRIOS DE ACEITE DESTA FASE

| Critério | Status |
|---|---|
| ✅ Nenhum arquivo de código foi modificado | Confirmado |
| ✅ Nenhuma regra de negócio foi alterada | Confirmado |
| ✅ Todos os fluxos documentados | Etapa 3 e 4 |
| ✅ Todas as dependências identificadas | Etapa 6 + Seções 14–17 do audit |
| ✅ Todos os eventos mapeados | Etapa 5 (13 eventos) |
| ✅ Todos os contratos definidos | Etapa 6 |
| ✅ Todas as invariantes documentadas | Etapa 7 (17 invariantes) |
| ✅ Todos os fluxos legados classificados | Etapa 4 (ACTIVE / LEGACY / OBSOLETE) |
| ✅ Uma única definição oficial por processo | Etapa 10.3 |

---

*Este documento constitui a especificação arquitetural do domínio financeiro ArkPet.*  
*Serve como base obrigatória para todas as próximas refatorações e correções.*  
*Qualquer mudança no módulo financeiro deve ser validada contra os contratos e invariantes aqui definidos.*
