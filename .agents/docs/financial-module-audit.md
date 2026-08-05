# Documentação Técnica — Módulo Financeiro ArkPet
**Versão:** 1.0 · **Data:** Agosto 2026  
**Escopo:** Auditoria completa + Regras de negócio  
**Metodologia:** Leitura de código, zero alterações

---

## ÍNDICE

1. [Arquitetura e Mapa de Responsabilidades](#1-arquitetura-e-mapa-de-responsabilidades)
2. [Fluxograma Completo](#2-fluxograma-completo)
3. [Regras de Negócio — Catálogo e Estoque](#3-regras-de-negócio--catálogo-e-estoque)
4. [Regras de Negócio — Faturas (Invoice)](#4-regras-de-negócio--faturas-invoice)
5. [Regras de Negócio — Pedidos (Orders)](#5-regras-de-negócio--pedidos-orders)
6. [Regras de Negócio — Pagamentos](#6-regras-de-negócio--pagamentos)
7. [Regras de Negócio — Créditos](#7-regras-de-negócio--créditos)
8. [Regras de Negócio — Reservas e Consumo de Créditos](#8-regras-de-negócio--reservas-e-consumo-de-créditos)
9. [Regras de Negócio — Wallet do Tutor](#9-regras-de-negócio--wallet-do-tutor)
10. [Endpoints — Mapeamento Completo](#10-endpoints--mapeamento-completo)
11. [Riscos e Bugs Identificados](#11-riscos-e-bugs-identificados)
12. [Inconsistências Estruturais](#12-inconsistências-estruturais)
13. [Oportunidades de Melhoria](#13-oportunidades-de-melhoria)

---

## 1. ARQUITETURA E MAPA DE RESPONSABILIDADES

### Arquivos principais

| Arquivo | Papel |
|---|---|
| `artifacts/api-server/src/routes/financial.ts` | Todas as rotas financeiras: catálogo, faturas, pacotes, créditos, POS, despesas, relatórios |
| `artifacts/api-server/src/routes/orders.ts` | Criação de pedidos da lojinha, status de pedidos |
| `artifacts/api-server/src/services/billing.ts` | Motor de faturamento: `addCharge`, `processManualPayment`, `approveReceipt`, `voidInvoice`, `refundInvoice` |
| `artifacts/api-server/src/services/credits.ts` | Liberação de créditos: `releasePurchasedCredits` |
| `artifacts/api-server/src/routes/bookings.ts` | Consumo e restauração de créditos nas reservas |
| `artifacts/petdaycare/src/pages/tutor/store.tsx` | Lojinha do tutor |
| `artifacts/petdaycare/src/pages/tutor/financial.tsx` | Carteira e faturas do tutor |
| `artifacts/petdaycare/src/pages/financial/index.tsx` | Painel financeiro admin |
| `artifacts/petdaycare/src/hooks/use-financial.ts` | Todos os hooks React Query financeiros |

### Tabelas de banco de dados

| Tabela | Papel |
|---|---|
| `catalogue_items` | Produtos, serviços e pacotes à venda |
| `catalogue_stock_transactions` | Histórico de movimentações de estoque |
| `invoices` | Faturas mensais e avulsas |
| `invoice_items` | Itens dentro de cada fatura |
| `orders` | Pedidos da lojinha |
| `order_items` | Itens de cada pedido |
| `transactions` | Registro de entradas e saídas financeiras |
| `financial_audit_logs` | Log de todas as ações financeiras |
| `tutor_credits` | Créditos de pacotes de diárias |
| `tutor_service_credits` | Créditos de serviços avulsos (banho, etc.) |
| `expenses` | Despesas operacionais da creche |

### Mapa de responsabilidades por etapa

| Etapa | Cria | Altera | Consulta | Dispara evento |
|---|---|---|---|---|
| **Catálogo** | `POST /catalogue` | `PUT /catalogue/:id` | `GET /catalogue` | — |
| **Carrinho** | `store.tsx` (memória) | `store.tsx` | `store.tsx` | — |
| **Pedido** | `POST /orders` | `PUT /orders/:id/status` | `GET /orders` | créditos, estoque, e-mail |
| **Fatura** | `addCharge()` | `approveReceipt`, `processManualPayment`, `voidInvoice`, `refundInvoice` | `GET /financial/invoices` | créditos, transação |
| **Pagamento** | `approveReceipt`, `processManualPayment`, Stripe webhook | — | `GET /financial/audit` | transação, créditos |
| **Créditos** | `releasePurchasedCredits()` | bookings (`usedCredits`) | `GET /packages/balance`, `GET /service-credits` | — |
| **Reservas** | `POST /bookings` | `PUT /bookings/:id` | `GET /bookings` | deduz créditos |
| **Wallet** | — | — | `tutor/financial.tsx` | — |

---

## 2. FLUXOGRAMA COMPLETO

### 2.1 Lojinha → Pedido → Fatura → Créditos

```
[TUTOR: Lojinha]
       │
       ▼
GET /financial/catalogue
  → filtra isActive=true (tutor) ou todos (admin)
  → retorna mediaUrls como paths brutos de object storage
       │
       ▼
Carrinho (estado local React)
  → addToCart: valida stockQuantity do cache local
  → updateQuantity: não revalida contra BD
       │
       ▼
POST /orders (db.transaction)
  ├── sortedReqItems por ID → previne deadlock
  ├── SELECT FOR UPDATE catalogue_item
  │     ├── produto: decrementa stockQuantity, verifica minStockAlert
  │     └── serviço/pacote: sem decremento de estoque
  ├── Para cada item:
  │     ├── 1º item: addCharge(isAvulso=true) → cria invoice avulsa
  │     └── demais: addCharge(existingInvoiceId) → acumula na mesma invoice
  ├── INSERT orders
  └── INSERT order_items
  [async pós-tx] → e-mail alerta estoque baixo
       │
       ▼
[TUTOR: Modal PIX — invoice criada, créditos NÃO liberados]
       │
       ▼
POST /storage/uploads/direct → upload comprovante
POST /financial/invoices/:id/upload-receipt
  → salva receiptPhotoPath
  → status: "awaiting_confirmation"
  → logFinancialAudit (fora de transação)
       │
       ▼
[ADMIN: aprova comprovante]
POST /financial/invoices/:id/approve-receipt (db.transaction)
  ├── SELECT invoice (SEM FOR UPDATE — risco de race condition)
  ├── valida: status ≠ paid/voided/refunded
  ├── UPDATE invoices SET status='paid'
  ├── INSERT transactions (income)
  ├── logFinancialAudit
  ├── releasePurchasedCredits(invoiceId)
  │     ├── SELECT invoice_items WHERE invoiceId
  │     ├── filtra packageItems (itemType='package' OU regex /di[aá]rias?/)
  │     ├── filtra serviceItems (itemType='service')
  │     ├── Para cada packageItem:
  │     │     ├── SELECT catalogue_item WHERE name=description (sem lock)
  │     │     ├── usa creditsAmount do catalogue → INSERT tutor_credits
  │     │     └── fallback: regex na description
  │     ├── Para cada serviceItem:
  │     │     ├── SELECT catalogue_item WHERE name=description AND type='service'
  │     │     └── INSERT tutor_service_credits
  │     └── UPDATE invoices SET creditsReleased=true
  └── UPDATE orders SET status='paid'
       │
       ▼
[TUTOR: Minha Carteira exibe créditos disponíveis]
```

### 2.2 Invoice Mensal (reservas recorrentes)

```
[Check-in / reserva confirmada]
       │
       ▼
BillingService.addCharge(isAvulso=false)
  ├── SELECT tutor.mensalidadeDia
  ├── getCycleDates(mensalidadeDia, itemDate)
  │     → cycleStart = dia após fim do ciclo anterior
  │     → cycleEnd = dueDate = mensalidadeDia do mês de referência
  ├── SELECT invoice WHERE tutorId + cycleStart + cycleEnd FOR UPDATE
  │     ├── existe + status em {paid, refunded, voided}
  │     │     → REABRE: status='pending', soma amount  ← ⚠️ risco
  │     ├── existe + outro status
  │     │     → soma ao amount, mantém status
  │     └── não existe
  │           → INSERT nova invoice
  └── INSERT invoice_items
```

### 2.3 POS Sale (venda balcão)

```
POST /financial/pos-sale (db.transaction)
  ├── SELECT FOR UPDATE catalogue_item (se produto)
  ├── BillingService.addCharge(isAvulso=true)
  ├── INSERT transactions
  └── UPDATE catalogueItems.stockQuantity (se produto)
```

### 2.4 Consumo de créditos (reserva confirmada)

```
PUT /bookings/:id (status → confirmed)
  ├── Pacotes de diárias:
  │     ├── SELECT tutor_credits ORDER BY expirationDate (SEM FOR UPDATE — risco)
  │     ├── tenta "piggyback" (mesmo tutor, mesmo dia, mesmo pacote multi-pet)
  │     └── UPDATE usedCredits + 1
  ├── Serviços:
  │     ├── SELECT tutor_service_credits WHERE catalogueItemId (SEM FOR UPDATE — risco)
  │     └── UPDATE usedCredits + 1
  └── [cancelamento reverte ambos]
```

---

## 3. REGRAS DE NEGÓCIO — CATÁLOGO E ESTOQUE

### RN-CAT-01: Tipos de item
- `service` — Serviço prestado (sem estoque). Ao ser pago, gera `tutor_service_credits`.
- `package` — Pacote de diárias. Requer `creditsAmount > 0`. Ao ser pago, gera `tutor_credits`.
- `product` — Produto físico. Possui `stockQuantity` gerenciado.
- **Fonte:** `financial.ts:84, 133, 1263`

### RN-CAT-02: Criação de item
- Nome deve ser único entre itens **ativos** da mesma creche.
- `stockQuantity > 0` na criação → INSERT em `catalogue_stock_transactions` com `type='in'`.
- `creditsAmount` obrigatório apenas para `type='package'`.
- `mediaUrls` aceita array de strings com paths `/objects/` ou URLs completas.
- `basePrice` em reais (o backend multiplica por 100 para Stripe).
- **Fonte:** `financial.ts:140–206`

### RN-CAT-03: Atualização de item
- Nome não pode conflitar com outro item ativo da mesma creche.
- `stockQuantity` NÃO é atualizado via `PUT /catalogue/:id` — apenas via endpoint dedicado de ajuste.
- `maxPetsPerDay` só é gravado se `type='package'`.
- Audit log gerado com `action='stock_adjustment'`.
- **Fonte:** `financial.ts:207–265`

### RN-CAT-04: Exclusão de item
- Exclusão **física** (`DELETE`). Sem soft-delete.
- Não há guard contra exclusão de itens com estoque restante ou histórico de transações.
- **Fonte:** `financial.ts:565–580`

### RN-CAT-05: Flag `isActive`
- Tutores veem apenas itens com `isActive=true`.
- Admins podem passar `includeInactive=true` para ver todos.
- POS só aceita itens ativos.
- **Fonte:** `financial.ts:121, 1254`

### RN-CAT-06: Ajuste de estoque manual
- `delta` não pode ser zero.
- `newQuantity = atual + delta` não pode ser negativo (erro 400 "Estoque insuficiente").
- Usa `SELECT FOR UPDATE` + `UPDATE ... SET stockQuantity = stockQuantity + delta` (atômico).
- Se `newQuantity <= minStockAlert` após ajuste → e-mail assíncrono para `creche_admin`.
- INSERT em `catalogue_stock_transactions`.
- **Fonte:** `financial.ts:406–492`

### RN-CAT-07: Alerta de estoque baixo
- Disparado assincronamente (não bloqueia a resposta) quando `newQuantity <= minStockAlert`.
- Campo no schema: `minStockAlert` (BD) = `reorderThreshold` (API/frontend) — **nomes diferentes**.
- Disparo ocorre em: ajuste manual, compra via POS, compra via pedido da lojinha.
- **Fonte:** `financial.ts:465–492, orders.ts:188–217`

### RN-CAT-08: Precificação por tamanho (`pricingBySize`)
- Campos: `priceSmall`, `priceMedium`, `priceLarge`.
- Se preenchidos, sobrepõem `basePrice` dependendo do porte do pet na reserva.
- **Fonte:** `financial.ts:65, 129, 173–175`

---

## 4. REGRAS DE NEGÓCIO — FATURAS (INVOICE)

### RN-INV-01: Tipos de fatura

| Tipo | Como é criada | `cycleStart` | `cycleEnd` | `dueDate` |
|---|---|---|---|---|
| **Mensal** | `addCharge` sem `isAvulso` | Dia após fim do ciclo anterior | `mensalidadeDia` do mês de referência | Igual ao `cycleEnd` |
| **Avulsa** | `addCharge` com `isAvulso=true` | Data do item | Data do item | Data do item |

### RN-INV-02: Cálculo do ciclo mensal (`getCycleDates`)
- Usa `mensalidadeDia` do tutor (default: 10).
- Data de referência UTC para evitar problemas de timezone no servidor.
- Se `txDate.getUTCDate() > mensalidadeDia`: ciclo termina no próximo mês.
- `cycleEnd` = `mensalidadeDia` do mês calculado, clamped pelo último dia do mês.
- `cycleStart` = dia após o `cycleEnd` do ciclo anterior.
- **Fonte:** `billing.ts:212–248`

### RN-INV-03: Reutilização de fatura mensal
- `addCharge` busca invoice com `tutorId + cycleStart + cycleEnd` usando `SELECT FOR UPDATE`.
- Se encontrada: soma o novo valor ao `amount` existente.
- **Se status for `paid`, `refunded` ou `voided`: reabre com status `pending`.**
- Se não encontrada: cria nova invoice.
- **Fonte:** `billing.ts:289–323`

### RN-INV-04: Máquina de estados da fatura

```
             ┌─────────────────────────────────────────┐
             │          Nova charge mensal               │
             ▼                                         │
          pending ──upload comprovante──► awaiting_confirmation
             │                                    │
             │  (venceu)                           │ approve-receipt
             ▼                                    │  ou pay-manual
          overdue ─────────────────────────────────┤
             │                                    │
             └──────────── pay-manual ─────────────┤
                                                   ▼
                                                 paid ──► refunded
                                                   │
                                              void (antes de paid)
                                                   ▼
                                                voided
```

| Transição | Condição de entrada | Condição de bloqueio |
|---|---|---|
| `→ awaiting_confirmation` | Upload de comprovante | — |
| `→ paid` | `processManualPayment` ou `approveReceipt` | Já está `paid`, `voided` ou `refunded` |
| `→ voided` | `voidInvoice` | Já está `paid`, `refunded` ou `voided` |
| `→ refunded` | `refundInvoice` | Status ≠ `paid` |
| `→ pending` (reabertura) | Nova charge mensal adicionada | Nunca bloqueado — **risco crítico** |

**Fonte:** `billing.ts:66–206, financial.ts:683`

### RN-INV-05: `processManualPayment`
1. SELECT invoice (SEM FOR UPDATE — risco)
2. Valida status ≠ `paid`/`voided`/`refunded`
3. UPDATE status → `paid`, `paymentMethod`
4. INSERT `transactions` (income, `paymentMethod` informado)
5. `logFinancialAudit` (dentro da transação)
6. `releasePurchasedCredits(invoiceId)`
7. UPDATE `orders` SET status=`paid` onde `invoiceId` corresponde

**Fonte:** `billing.ts:66–108`

### RN-INV-06: `approveReceipt`
1. SELECT invoice (SEM FOR UPDATE — risco)
2. Valida status ≠ `paid`/`voided`/`refunded`
3. UPDATE status → `paid`
4. INSERT `transactions` (income, `paymentMethod = invoice.paymentMethod || 'pix'`)
5. `logFinancialAudit` (dentro da transação)
6. `releasePurchasedCredits(invoiceId)`
7. UPDATE `orders` SET status=`paid`

**Fonte:** `billing.ts:111–153`

### RN-INV-07: `voidInvoice`
- **NÃO está em transação** — risco de parcialidade.
- Valida status ≠ `paid`/`refunded`/`voided`.
- UPDATE status → `voided`.
- `logFinancialAudit`.
- **Não reverte itens do invoice nem créditos eventualmente liberados.**

**Fonte:** `billing.ts:156–175`

### RN-INV-08: `refundInvoice`
- Requer status = `paid` (única condição).
- UPDATE status → `refunded`.
- INSERT `transactions` (expense, mesmo método de pagamento original).
- `logFinancialAudit`.
- **Não reverte créditos liberados.**

**Fonte:** `billing.ts:177–206`

### RN-INV-09: Upload de comprovante
- Dois passos: upload do arquivo para Object Storage → POST com `receiptPhotoPath`.
- Muda status para `awaiting_confirmation`.
- `logFinancialAudit` chamado **fora de transação** (risco de inconsistência silenciosa).
- **Fonte:** `financial.ts:666–700`

### RN-INV-10: Stripe Checkout para fatura
- `POST /financial/invoices/:id/stripe-checkout` cria sessão Stripe.
- Salva `stripePaymentIntentId` na invoice.
- **Webhook Stripe NÃO chama `releasePurchasedCredits`** — créditos nunca liberados automaticamente via Stripe.
- **Fonte:** `financial.ts:274–306`

### RN-INV-11: Overdue
- Calculado na query: invoice `pending` onde `dueDate < hoje`.
- Status `overdue` não é gravado automaticamente — é derivado em tempo de consulta.
- `hasOverdueInvoices()` retorna boolean para bloquear novas reservas se `overdue=true`.
- **Fonte:** `billing.ts:43–63`

---

## 5. REGRAS DE NEGÓCIO — PEDIDOS (ORDERS)

### RN-ORD-01: Criação de pedido
- Toda a lógica dentro de `db.transaction`.
- Items ordenados por ID antes de qualquer lock (previne deadlock).
- `SELECT FOR UPDATE` em cada `catalogue_item`.
- **Estoque**: apenas `type='product'` tem estoque decrementado.
- **Fatura**: todos os itens vão para uma única invoice avulsa (primeiro item cria com `isAvulso=true`, demais acumulam com `existingInvoiceId`).
- **Fonte:** `orders.ts:45–185`

### RN-ORD-02: Validação de estoque no pedido
- Se `type='product'` e `stockQuantity < quantity` → erro 400 "Estoque insuficiente para o item: X".
- Decremento usa SQL atômico: `stockQuantity - quantity`.
- Após decremento, se `newQuantity <= minStockAlert` → agendado e-mail de alerta (assíncrono, pós-transação).
- **Fonte:** `orders.ts:78–96`

### RN-ORD-03: Status de pedido

| Status | Significado |
|---|---|
| `pending_payment` | Criado, aguardando pagamento |
| `paid` | Invoice paga |
| `preparing` | Em preparação |
| `ready_for_pickup` | Pronto para retirada |
| `delivering` | Em entrega |
| `delivered` | Entregue |
| `cancelled` | Cancelado |

### RN-ORD-04: Liberação de créditos por status de pedido
- Créditos liberados quando status muda para `paid`, `delivered` ou `ready_for_pickup`.
- `releasePurchasedCredits` chamado em **transação separada** após o `UPDATE` do status — sem rollback integrado.
- **Fonte:** `orders.ts:387–391`

### RN-ORD-05: Cancelamento de pedido
- Estoque restaurado apenas para itens `type ≠ 'service'`.
- INSERT em `catalogue_stock_transactions` com `type='in'`, `reason='Cancelamento de Pedido'`.
- Créditos de serviços revogados: decrementa `totalCredits` (não `usedCredits`) nos `tutor_service_credits` — apenas créditos não usados.
- Invoice vinculada ao pedido: UPDATE status → `voided`.
- UPDATE `invoices SET creditsReleased=false` (permite re-liberação se reativado).
- **Fonte:** `orders.ts:300–380`

---

## 6. REGRAS DE NEGÓCIO — PAGAMENTOS

### RN-PAY-01: Pagamento Manual (`processManualPayment`)
- Métodos aceitos: `stripe`, `pix`, `cash`, `credit_card`, `bank_slip`.
- Gera `transaction` do tipo `income` com o método informado.
- Atualiza `orders` vinculados para `paid`.
- Libera créditos (ver RN-CRE-01).

### RN-PAY-02: Aprovação de Comprovante (`approveReceipt`)
- Gera `transaction` do tipo `income` com `paymentMethod = invoice.paymentMethod || 'pix'` (fallback para PIX se não definido).
- Atualiza `orders` vinculados para `paid`.
- Libera créditos (ver RN-CRE-01).

### RN-PAY-03: PIX
- QR Code gerado no frontend com `pixKey` da creche.
- Se `pixKey` for null → modal exibe aviso (sem QR inválido).
- Após pagamento, tutor faz upload manual do comprovante.
- Pagamento confirmado pelo admin via `approveReceipt`.

### RN-PAY-04: Stripe
- Sessão de checkout criada via `POST /financial/invoices/:id/stripe-checkout`.
- `unit_amount` na sessão Stripe: `Math.round(Number(item.basePrice))` — **BUG: deveria ser `basePrice * 100`**.
- Webhook Stripe recebe `checkout.session.completed` mas **não chama `releasePurchasedCredits`**.
- `stripePaymentIntentId` salvo no invoice.

### RN-PAY-05: POS Sale
- Cria invoice avulsa (`isAvulso=true`).
- Pagamento considerado imediato (INSERT `transactions` na mesma transação).
- Decrementa estoque de produtos (com `SELECT FOR UPDATE`).
- `isAvulso=true` obrigatório — não deve inflar invoice mensal.

### RN-PAY-06: Refund
- Só para invoices `paid`.
- Gera `transaction` do tipo `expense`.
- **Não reverte créditos liberados.**

### RN-PAY-07: Void
- Para qualquer invoice não-`paid`/`refunded`/`voided`.
- Não está em transação — risco de parcialidade.
- **Não reverte créditos se liberados antes do void.**

---

## 7. REGRAS DE NEGÓCIO — CRÉDITOS

### RN-CRE-01: Acionamento de `releasePurchasedCredits`
Chamado por:
- `approveReceipt` (billing.ts:146)
- `processManualPayment` (billing.ts:101)
- `PUT /orders/:id/status` quando status ∈ {`paid`, `delivered`, `ready_for_pickup`} (orders.ts:387)

### RN-CRE-02: Guard contra double release
- Se `invoice.creditsReleased = true` → função retorna imediatamente sem fazer nada.
- **Risco:** Guard lido sem `FOR UPDATE` — duas aprovações concorrentes podem passar ao mesmo tempo.

### RN-CRE-03: Filtro de itens para liberação de créditos
```
packageItems = invoice_items onde:
  itemType === "package"
  OU description bate com /di[aá]rias?/i

serviceItems = invoice_items onde:
  itemType === "service"
```
- Se nenhum dos dois → função retorna sem fazer nada, sem marcar `creditsReleased`.

### RN-CRE-04: Determinação de quantidade de créditos (pacotes)
1. Busca `catalogue_item` onde `name = packageItem.description` (por nome — frágil).
2. Se encontrado e `creditsAmount > 0`: usa `creditsAmount`.
3. Senão: tenta regex `(\d+)\s+di[aá]rias?/i` na description.
4. Se regex falhar: **`continue`** — item é ignorado silenciosamente.
5. Quantidade final: `baseCredits × packageItem.quantity`.

### RN-CRE-05: Criação de créditos de pacote (`tutor_credits`)
- INSERT com: `crecheId`, `tutorId`, `totalCredits`, `usedCredits=0`, `maxPetsPerDay`, `expirationDate = hoje + 1 ano`.
- `maxPetsPerDay` vem do `catalogue_item`; default 1 se não encontrado.

### RN-CRE-06: Criação de créditos de serviço (`tutor_service_credits`)
- Busca `catalogue_item` onde `name = description AND type='service'`.
- Se não encontrado → crédito ignorado silenciosamente.
- INSERT com: `crecheId`, `tutorId`, `catalogueItemId`, `totalCredits = serviceItem.quantity`.

### RN-CRE-07: Finalização da liberação
- Se `creditsAdded = false` (nenhum crédito inserido) → retorna sem marcar `creditsReleased`.
- Se `creditsAdded = true` → UPDATE `invoices SET creditsReleased=true` + `logFinancialAudit`.

### RN-CRE-08: Expiração de créditos de pacote
- `expirationDate` gravado como `hoje + 1 ano`.
- Consulta de saldo filtra: `expirationDate IS NULL OR expirationDate >= hoje`.
- Créditos expirados não são deletados — ficam na tabela, apenas ignorados pelo filtro.

### RN-CRE-09: Consulta de saldo de pacotes (`GET /financial/packages/balance`)
- Filtra `tutor_credits` onde:
  - `usedCredits < totalCredits`
  - `expirationDate IS NULL OR >= hoje`
  - `tutorId = tutorId do request` (tutor) ou `crecheId = crecheId` (admin)
- Retorna: `totalCredits`, `usedCredits`, `availableCredits`, `packages[]`, `nearestExpiration`.

### RN-CRE-10: Consulta de créditos de serviço (`GET /financial/service-credits`)
- Filtra `tutor_service_credits` onde `usedCredits < totalCredits`.
- Retorna com join em `catalogue_items` para nome do serviço.

### RN-CRE-11: Concessão administrativa de créditos (`POST /financial/packages`)
- Endpoint existe mas **não tem UI ativa**.
- Insere diretamente em `tutor_credits` com `totalCredits`, `expirationDate`, `maxPetsPerDay` fornecidos.

### RN-CRE-12: Quando créditos NÃO são liberados
| Situação | Motivo |
|---|---|
| Pagamento via Stripe checkout | Webhook não chama `releasePurchasedCredits` |
| `invoice.creditsReleased = true` | Guard de double release |
| Nenhum item do tipo package ou service na invoice | `packageItems.length === 0 && serviceItems.length === 0` |
| Regex falha na description E catalogue lookup falha | `continue` silencioso |
| `creditsAdded` permanece false | Sem INSERT, sem flag |
| Invoice cancelada (void) sem pagamento | Nunca passou por approve/manual |

---

## 8. REGRAS DE NEGÓCIO — RESERVAS E CONSUMO DE CRÉDITOS

### RN-BOK-01: Dedução de créditos de pacote
- Acionado quando booking muda para status `confirmed`.
- Busca `tutor_credits` ORDER BY `expirationDate` ASC (consome os mais próximos de vencer primeiro).
- **Sem `FOR UPDATE`** — race condition possível.

### RN-BOK-02: Lógica de "piggyback" (multi-pet)
- Condição: mesmo tutor, mesma data, mesmo `catalogueItemId`, `maxPetsPerDay > 1`.
- Efeito: booking adicional é encaixado no mesmo crédito do dia, sem dedurar crédito extra.
- Se não couber: deduz novo crédito (`usedCredits + 1`).

### RN-BOK-03: Dedução de créditos de serviço
- Acionado quando booking é do tipo serviço e status muda para `confirmed`.
- Normaliza nome do serviço antes de buscar.
- Sem `FOR UPDATE` antes do UPDATE — race condition possível.

### RN-BOK-04: Restauração de créditos no cancelamento
- Decrementa `usedCredits` nos `tutor_credits` (pacotes).
- Decrementa `usedCredits` nos `tutor_service_credits` (serviços).
- **Sem guard mínimo de 0** — `usedCredits` pode ir a negativo em edge cases.

### RN-BOK-05: Bloqueio por overdue
- Antes de confirmar reserva, verifica `hasOverdueInvoices(tutorId)`.
- Se true: reserva bloqueada com erro.
- **Fonte:** `orders.ts:209`

---

## 9. REGRAS DE NEGÓCIO — WALLET DO TUTOR

### RN-WAL-01: Exibição de diárias
- Fonte: `GET /financial/packages/balance`
- Exibe `availableCredits` = soma de todos `tutor_credits` válidos não expirados.

### RN-WAL-02: Exibição de serviços
- Fonte: `GET /financial/service-credits`
- Lista cada tipo de serviço com `totalCredits - usedCredits` disponíveis.

### RN-WAL-03: Exibição de faturas
- Fonte: `GET /financial/invoices?tutorId=X`
- Mostra todas as invoices do tutor: pending, awaiting_confirmation, paid, overdue.

### RN-WAL-04: `crecheId` fallback hardcoded
- Se `user.crecheId` for null/undefined, usa `1` como padrão.
- **Risco em ambientes multi-creche.**

---

## 10. ENDPOINTS — MAPEAMENTO COMPLETO

### 10.1 Endpoints financeiros e status de uso

| Endpoint | Arquivo | Linha | Status Frontend |
|---|---|---|---|
| `GET /financial/catalogue` | `financial.ts` | 111 | ✅ Chamado |
| `POST /financial/catalogue` | `financial.ts` | 140 | ✅ Chamado |
| `PUT /financial/catalogue/:id` | `financial.ts` | 207 | ✅ Chamado |
| `DELETE /financial/catalogue/:id` | `financial.ts` | 565 | ✅ Chamado |
| `POST /financial/catalogue/:id/stock-adjustment` | `financial.ts` | 406 | ✅ Chamado |
| `GET /financial/catalogue/:id/stock-transactions` | `financial.ts` | 504 | ✅ Chamado |
| `GET /financial/invoices` | `financial.ts` | ~270 | ✅ Chamado |
| `POST /financial/invoices/:id/stripe-checkout` | `financial.ts` | 274 | ✅ Chamado |
| `GET /financial/invoices/:id/receipt-url` | `financial.ts` | 308 | ✅ Chamado |
| `GET /financial/invoices/:id/receipt-data` | `financial.ts` | 348 | ✅ Chamado |
| `POST /financial/invoices/:id/upload-receipt` | `financial.ts` | 666 | ✅ Chamado |
| `POST /financial/invoices/:id/pay-manual` | `financial.ts` | 703 | ✅ Chamado |
| `POST /financial/invoices/:id/approve-receipt` | `financial.ts` | 716 | ✅ Chamado |
| `POST /financial/invoices/:id/void` | `financial.ts` | 728 | ✅ Chamado |
| `POST /financial/invoices/:id/refund` | `financial.ts` | 740 | ✅ Chamado |
| `POST /financial/invoices/:id/refund-item` | `financial.ts` | 1363 | ✅ Chamado |
| `GET /financial/service-credits` | `financial.ts` | 756 | ✅ Chamado |
| `GET /financial/packages` | `financial.ts` | 802 | ❌ **Nunca chamado** |
| `POST /financial/packages` | `financial.ts` | 829 | ❌ **Nunca chamado** |
| `POST /financial/packages/purchase` | `financial.ts` | 857 | ⚠️ Hook existe, sem UI ativa |
| `GET /financial/packages/balance` | `financial.ts` | 956 | ✅ Chamado |
| `GET /financial/dashboard/cash-flow` | `financial.ts` | 1002 | ✅ Chamado |
| `GET /financial/dashboard/dre` | `financial.ts` | 1051 | ✅ Chamado |
| `GET /financial/expenses` | `financial.ts` | 1110 | ✅ Chamado |
| `POST /financial/expenses` | `financial.ts` | 1120 | ✅ Chamado |
| `PUT /financial/expenses/:id` | `financial.ts` | 1145 | ✅ Chamado |
| `DELETE /financial/expenses/:id` | `financial.ts` | 1201 | ✅ Chamado |
| `POST /financial/expenses/:id/pay` | `financial.ts` | 1164 | ✅ Chamado |
| `POST /financial/pos-sale` | `financial.ts` | 1233 | ✅ Chamado |
| `GET /financial/audit` | `financial.ts` | 1457 | ✅ Chamado |
| `POST /orders` | `orders.ts` | 45 | ✅ Chamado |
| `GET /orders` | `orders.ts` | 233 | ✅ Chamado |
| `PUT /orders/:id/status` | `orders.ts` | 294 | ✅ Chamado |

### 10.2 Endpoints chamados pelo frontend mas inexistentes no backend

| Endpoint (frontend) | Hook | Impacto |
|---|---|---|
| `PUT /financial/invoices/:id/status` | `use-financial.ts:175` | 404 em produção |
| `GET /financial/credits/balance` | `use-financial.ts:563` | 404 em produção |
| `GET /financial/catalogue/:id/batches` | `use-financial.ts:953` | 404 em produção |
| `POST /financial/catalogue/:id/batches` | `use-financial.ts:968` | 404 em produção |

---

## 11. RISCOS E BUGS IDENTIFICADOS

### 🔴 CRÍTICO

| # | Bug/Risco | Arquivo | Linha | Descrição |
|---|---|---|---|---|
| B1 | **Stripe cobra valor errado** | `financial.ts` | ~919 | `Math.round(Number(basePrice))` sem `× 100`. Pacote de R$250 → Stripe cobra R$2,50. |
| B2 | **Stripe não libera créditos** | `stripe.ts` | — | `checkout.session.completed` não chama `releasePurchasedCredits`. |
| B3 | **Double release de créditos** | `credits.ts` | 25 | Guard `creditsReleased` sem `FOR UPDATE`. Duas aprovações simultâneas duplicam créditos. |
| B4 | **Invoice mensal reaberta por nova charge** | `billing.ts` | 302–305 | `addCharge` mensal reabre invoice `paid` ao somar nova reserva. |
| B5 | **Race condition: usedCredits** | `bookings.ts` | ~442 | SELECT sem FOR UPDATE antes de UPDATE. Dois bookings simultâneos podem superar o saldo. |

### 🟠 ALTO

| # | Bug/Risco | Arquivo | Linha | Descrição |
|---|---|---|---|---|
| B6 | **Status do pedido atualizado antes dos créditos** | `orders.ts` | ~388 | `releasePurchasedCredits` em tx separada. Falha → pedido `delivered`, créditos nunca liberados. |
| B7 | **Créditos 0 se item renomeado** | `credits.ts` | 58 | Lookup por nome. Se admin renomear o item após venda, créditos não são liberados. |
| B8 | **Double pay: dois admins aprovam ao mesmo tempo** | `billing.ts` | ~113 | `approveReceipt` sem `FOR UPDATE`. Duas transações de income para a mesma invoice. |
| B9 | **`usedCredits` pode exceder `totalCredits`** | `bookings.ts` | ~442 | Sem guard de limite superior. |
| B10 | **Endpoint `PUT /invoices/:id/status` inexistente** | `use-financial.ts` | ~175 | 404 em produção. |
| B11 | **Endpoint `GET /credits/balance` inexistente** | `use-financial.ts` | ~563 | 404 em produção. |

### 🟡 MÉDIO

| # | Risco | Arquivo | Linha |
|---|---|---|---|
| B12 | `POST /catalogue` sem transação (3 inserts) | `financial.ts` | ~140 |
| B13 | `PUT /catalogue/:id` sem transação | `financial.ts` | ~207 |
| B14 | `voidInvoice` sem transação | `billing.ts` | ~156 |
| B15 | `logFinancialAudit` fora de transação no upload-receipt | `financial.ts` | ~683 |
| B16 | `crecheId = 1` hardcoded se usuário sem crecheId | `tutor/financial.tsx` | ~27 |
| B17 | Estoque local no carrinho pode estar stale | `store.tsx` | ~40 |
| B18 | `GET /catalogue/:id/batches` e `POST` — endpoints inexistentes | `use-financial.ts` | ~953/968 |

---

## 12. INCONSISTÊNCIAS ESTRUTURAIS

### IC-01: Dois caminhos de compra de pacote coexistentes

| Aspecto | `/packages/purchase` (legado) | `/orders` (atual) |
|---|---|---|
| UI ativa | ❌ Não | ✅ Sim |
| Hook | `usePurchasePackage` (órfão) | `useCreateOrder` |
| `itemType` gravado | `"package"` | `catItem.type` (corrigido) |
| `description` gravada | `"${creditsAmount} diárias"` | `catItem.name` |
| Stripe | ✅ Integrado | ❌ Não |
| isAvulso | ✅ Explícito | ✅ Explícito |

**Impacto:** Itens comprados pelo caminho legado têm `description="10 diárias"` enquanto novos têm `description="Pacote Mensal"`. A regex de fallback em `releasePurchasedCredits` funciona para o legado mas não para nomes arbitrários.

### IC-02: Dois sistemas de crédito sem unificação

| | `tutor_credits` | `tutor_service_credits` |
|---|---|---|
| Para | Diárias (reservas) | Serviços avulsos (banho) |
| Expiração | ✅ `expirationDate` | ❌ Não tem |
| `maxPetsPerDay` | ✅ | ❌ |
| `catalogueItemId` | ❌ | ✅ |
| Piggyback | ✅ Implementado | ❌ Não |

### IC-03: Nomes de campos divergentes entre BD e API

| BD | API/Schema | Onde |
|---|---|---|
| `minStockAlert` | `reorderThreshold` | `catalogue_items` |
| `basePrice` | `price` (alias no GET) | `catalogue_items` |

### IC-04: Valores monetários como `varchar` no BD
- `invoices.amount`, `invoice_items.amount`, `orders.subtotal/total/deliveryFee` são `varchar`.
- Todo código faz `parseFloat()` manual.
- `toFixed(2)` pode gerar erro de arredondamento em ponto flutuante.

### IC-05: `calculateDueDate` vs `getCycleDates` — funções duplicadas
- `calculateDueDate`: usa timezone local do servidor (`new Date()`).
- `getCycleDates`: usa UTC (`Date.UTC`).
- Para servidores em UTC-3, podem produzir datas diferentes próximas à meia-noite.

### IC-06: Exclusão física de catalogue_items
- `DELETE /catalogue/:id` deleta fisicamente sem verificar histórico de pedidos, stock transactions ou invoice_items vinculados.
- Cria referências órfãs em `order_items` e `invoice_items`.

---

## 13. OPORTUNIDADES DE MELHORIA

### 🏗️ Arquitetura

| # | Proposta | Problema que resolve |
|---|---|---|
| M01 | Remover endpoint legado `/packages/purchase` e hook `usePurchasePackage` | IC-01, código morto |
| M02 | Adicionar `catalogueItemId` em `invoice_items` | Elimina lookup frágil por nome (B7), torna `releasePurchasedCredits` determinístico |
| M03 | Migrar campos monetários para `numeric(10,2)` | IC-04, elimina `parseFloat` manual |
| M04 | Unificar `tutor_credits` e `tutor_service_credits` com campo `creditType` | IC-02, simplifica consumo e relatórios |
| M05 | Soft-delete em `catalogue_items` (`isActive=false`) em vez de DELETE físico | IC-06, preserva integridade referencial |

### 🔒 Concorrência e Atomicidade

| # | Proposta | Problema que resolve |
|---|---|---|
| M06 | Adicionar `FOR UPDATE` em `approveReceipt`/`processManualPayment` | B8 |
| M07 | Adicionar `FOR UPDATE` em `releasePurchasedCredits` antes de checar `creditsReleased` | B3 |
| M08 | Adicionar `FOR UPDATE` em dedução de créditos nos bookings | B5 |
| M09 | Mover `releasePurchasedCredits` para dentro da tx de `PUT /orders/:id/status` | B6 |
| M10 | Envolver `voidInvoice` em transação | B14 |
| M11 | Envolver `POST /catalogue` e `PUT /catalogue/:id` em transação | B12, B13 |
| M12 | Mover `logFinancialAudit` do upload-receipt para dentro de tx | B15 |

### 🐛 Correções diretas

| # | Proposta | Problema que resolve |
|---|---|---|
| M13 | Corrigir `Math.round(basePrice)` → `Math.round(basePrice * 100)` no Stripe | B1 |
| M14 | Adicionar `releasePurchasedCredits` no webhook Stripe `checkout.session.completed` | B2 |
| M15 | Adicionar guard `MAX(0, usedCredits - 1)` na restauração de créditos | B9 |
| M16 | Implementar ou remover `PUT /financial/invoices/:id/status` | B10 |
| M17 | Implementar ou remover `GET /financial/credits/balance` | B11 |
| M18 | Remover hooks de `/batches` sem backend correspondente | B18 |

### ✨ Qualidade

| # | Proposta | Benefício |
|---|---|---|
| M19 | Padronizar `minStockAlert`/`reorderThreshold` em um único nome | IC-03 |
| M20 | Remover alias `price` e usar `basePrice` diretamente no GET /catalogue | IC-03 |
| M21 | Substituir `crecheId = 1` fallback por erro explícito | B16 |
| M22 | Botão de "Liberar Créditos" manual no admin para invoices pagas com `creditsReleased=false` | Operação sem SQL direto |
| M23 | Invalidar `dashboard-kpis` após `useApproveReceipt` | Cache stale na dashboard |
| M24 | Revalidar estoque via API no `handleCheckout` antes de submeter | B17 |
| M25 | Unificar timezone: usar UTC em todas as operações de data (eliminar `calculateDueDate` local) | IC-05 |

---

## RESUMO EXECUTIVO

```
┌──────────────────────────────────────────────────────────────────┐
│  REGRAS DE NEGÓCIO DOCUMENTADAS           ~60 regras (RN-*)     │
│                                                                  │
│  BUGS IDENTIFICADOS                       18                    │
│  ├─ Críticos (produção em risco)           5  (B1–B5)           │
│  ├─ Altos (perda de dados possível)        6  (B6–B11)          │
│  └─ Médios (inconsistência silenciosa)     7  (B12–B18)         │
│                                                                  │
│  INCONSISTÊNCIAS ESTRUTURAIS               6  (IC-01 a IC-06)   │
│  ENDPOINTS MORTOS/ÓRFÃOS                   6                    │
│  ENDPOINTS INEXISTENTES CHAMADOS           4                    │
│  OPORTUNIDADES DE MELHORIA                25  (M01–M25)         │
│                                                                  │
│  PRIORIDADE MÁXIMA:                                             │
│  B1 (Stripe cobra errado)                                       │
│  B2 (Stripe não libera créditos)                                │
│  B3 (double-release de créditos)                                │
│  B4 (invoice mensal reaberta)                                   │
│  B5 (race condition usedCredits)                                │
└──────────────────────────────────────────────────────────────────┘
```
