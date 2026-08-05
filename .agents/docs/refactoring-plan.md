# Plano de Refatoração — Módulo Financeiro ArkPet
**Versão:** 1.0 · **Data:** Agosto 2026  
**Base:** Auditoria técnica `.agents/docs/financial-module-audit.md`  
**Escopo:** Melhoria de arquitetura sem alteração de comportamento funcional  
**Restrições:**
- Nenhum comportamento funcional pode mudar
- O usuário final não pode perceber nenhuma alteração
- A API pública permanece 100% compatível (mesmas rotas, mesmos payloads)
- O banco de dados permanece compatível (sem DROP, sem renomeações de coluna)
- Não implementar — apenas planejar

---

## ÍNDICE

1. [Princípios do Plano](#1-princípios-do-plano)
2. [Mapa de Fases](#2-mapa-de-fases)
3. [Fase 1 — Atomicidade: Transações Faltantes](#fase-1--atomicidade-transações-faltantes)
4. [Fase 2 — Locks de Linha: FOR UPDATE nos Caminhos Críticos](#fase-2--locks-de-linha-for-update-nos-caminhos-críticos)
5. [Fase 3 — Idempotência de Webhook Stripe](#fase-3--idempotência-de-webhook-stripe)
6. [Fase 4 — Guard de Underflow em usedCredits](#fase-4--guard-de-underflow-em-usedcredits)
7. [Fase 5 — Restauração de Créditos de Serviço no Cancelamento](#fase-5--restauração-de-créditos-de-serviço-no-cancelamento)
8. [Fase 6 — Sincronização de Status Invoice ↔ Order](#fase-6--sincronização-de-status-invoice--order)
9. [Fase 7 — Extração: Credits de Serviço para services/credits.ts](#fase-7--extração-credits-de-serviço-para-servicescreditsts)
10. [Fase 8 — Extração: Lógica de Pedido de routes/orders.ts para services/orders.ts](#fase-8--extração-lógica-de-pedido-de-routesordersts-para-servicesordersts)
11. [Fase 9 — Consolidação: Interface Unificada de Créditos](#fase-9--consolidação-interface-unificada-de-créditos)
12. [Fase 10 — Frontend: Cache Invalidation Faltante](#fase-10--frontend-cache-invalidation-faltante)
13. [Fase 11 — Banco: Constraints de Integridade](#fase-11--banco-constraints-de-integridade)
14. [Fase 12 — Cleanup: Dados Stale e Órfãos](#fase-12--cleanup-dados-stale-e-órfãos)
15. [Ordem de Execução Recomendada](#15-ordem-de-execução-recomendada)
16. [Dependências entre Fases](#16-dependências-entre-fases)

---

## 1. PRINCÍPIOS DO PLANO

### Classificação de cada fase

Cada fase é classificada por **tipo** e **risco**:

| Tipo | Descrição |
|---|---|
| 🔒 **Confiabilidade** | Adiciona atomicidade, locks e idempotência. Happy-path idêntico; comportamento sob concorrência melhora. |
| 🏗️ **Arquitetura** | Move código entre camadas sem alterar o que o código faz. Zero mudança semântica. |
| 🧹 **Consistência** | Padroniza padrões divergentes no codebase. Zero mudança semântica. |
| 🖥️ **Frontend** | Ajusta invalidação de cache e organização de hooks. Zero mudança de API. |
| 🗄️ **Banco** | Adiciona constraints. Apenas additive — nunca remove colunas ou renomeia. |

| Risco | Descrição |
|---|---|
| 🟢 **Baixo** | Mudança cirúrgica, difícil de quebrar |
| 🟡 **Médio** | Múltiplos arquivos; requer testes antes de deploy |
| 🔴 **Alto** | Toca camada de serviço crítica; requer staging |

### Estrutura de cada fase

Cada fase contém:
- **Objetivo** — o que melhora e por quê
- **Achados da auditoria** — IGs e bugs que motivam a fase
- **Arquivos afetados** — lista precisa
- **O que NÃO muda** — garantia explícita de compatibilidade
- **Checklist de implementação** — passos atômicos
- **Testes obrigatórios** — o que deve passar antes de considerar a fase completa
- **Rollback** — como desfazer sem consequências

---

## 2. MAPA DE FASES

```
Fase  Tipo           Risco   Duração estimada   Bloqueia
────────────────────────────────────────────────────────────
  1   🔒 Conf.       🟢      1–2h               Fase 2
  2   🔒 Conf.       🟡      2–3h               Fase 3, 5
  3   🔒 Conf.       🟢      1h                 —
  4   🔒 Conf.       🟢      30min              —
  5   🔒 Conf.       🟡      2–3h               Fase 9
  6   🔒 Conf.       🟡      2h                 —
  7   🏗️ Arq.        🟡      3–4h               Fase 9
  8   🏗️ Arq.        🟡      3–4h               Fase 9
  9   🏗️ Arq.        🔴      4–6h               —
 10   🖥️ Frontend    🟢      1h                 —
 11   🗄️ Banco       🟡      1–2h               —
 12   🧹 Consist.    🟢      2h                 —
```

**Sequência obrigatória:** Fases 1–6 devem preceder Fases 7–9.  
**Fases independentes entre si:** 3, 4, 10, 11, 12 podem ser executadas em qualquer ordem.

---

## FASE 1 — Atomicidade: Transações Faltantes

**Tipo:** 🔒 Confiabilidade · **Risco:** 🟢 Baixo

### Objetivo
`voidInvoice` em `billing.ts` executa um `db.update` seguido de um `logFinancialAudit` sem envolvê-los em `db.transaction()`. Se o audit log falhar, a invoice fica com status `voided` sem nenhum registro de quem e quando realizou a operação. A fase adiciona a transação sem alterar nenhum comportamento observável.

### Achados que motivam esta fase
- **IG-03** — `voidInvoice` sem `db.transaction()` (billing.ts:156–175)
- **IG-42** — Audit log fora de transação após UPDATE

### Arquivos afetados
```
artifacts/api-server/src/services/billing.ts   ← única mudança
```

### O que NÃO muda
- Assinatura de `voidInvoice(invoiceId, reason, userId)`
- Resposta de qualquer endpoint que chama `voidInvoice`
- Schema do banco (nenhuma coluna nova)
- Comportamento no happy-path (invoice ainda é marcada `voided`)

### Checklist de implementação
- [ ] Identificar todas as chamadas a `voidInvoice` no codebase (bookings.ts, financial.ts)
- [ ] Envolver o corpo de `voidInvoice` em `return db.transaction(async (tx) => { ... })`
- [ ] Substituir `db.update(...)` por `tx.update(...)` dentro da função
- [ ] Passar `tx` como parâmetro para `logFinancialAudit` (ou chamar `logFinancialAudit` dentro do bloco `tx`)
- [ ] Verificar que nenhum chamador de `voidInvoice` já está dentro de uma transação (nesting — Drizzle suporta transações aninhadas via savepoints)
- [ ] Verificar que `logFinancialAudit` aceita `tx` como parâmetro (já aceita em outros usos — confirmar)

### Testes obrigatórios
```
CENÁRIO 1: Fluxo normal
  - Chamar voidInvoice com invoice válida
  - Verificar: invoice.status = 'voided' no banco
  - Verificar: registro existe em financial_audit_logs
  - Verificar: ambos os registros têm timestamp próximo

CENÁRIO 2: Rollback (simulação)
  - Forçar falha no logFinancialAudit (mock que lança erro)
  - Verificar: invoice.status permanece 'pending' (não ficou 'voided')
  - Verificar: nenhum registro em financial_audit_logs

CENÁRIO 3: Endpoints que usam voidInvoice
  - POST /bookings/:id/cancel → verificar que cancelamento ainda funciona
  - PUT /financial/invoices/:id/void → verificar resposta idêntica
```

### Rollback
Reverter para a versão sem `db.transaction()` em `voidInvoice`. Nenhum dado de banco é afetado — a change é puramente no comportamento de erro, não no happy-path.

---

## FASE 2 — Locks de Linha: FOR UPDATE nos Caminhos Críticos

**Tipo:** 🔒 Confiabilidade · **Risco:** 🟡 Médio

### Objetivo
Três funções realizam o padrão "lê → decide → escreve" sem bloquear a linha no SELECT, permitindo race conditions sob concorrência:
1. `approveReceipt` — dois admins aprovam o mesmo comprovante simultaneamente
2. `processManualPayment` — mesmo problema
3. `releasePurchasedCredits` — dois processos leem `creditsReleased=false` e ambos inserem créditos

A adição de `.for('update')` nos SELECTs relevantes elimina a race sem alterar o resultado em condições normais (acesso serial).

### Achados que motivam esta fase
- **IG-15** — `approveReceipt` sem `FOR UPDATE` (billing.ts:113)
- **IG-16** — `releasePurchasedCredits` sem `FOR UPDATE` (credits.ts:19)
- **IG-47** — `processManualPayment` sem `FOR UPDATE` (billing.ts:68)

### Arquivos afetados
```
artifacts/api-server/src/services/billing.ts   ← approveReceipt, processManualPayment
artifacts/api-server/src/services/credits.ts   ← releasePurchasedCredits
```

### O que NÃO muda
- Nenhuma assinatura de função muda
- Nenhum endpoint muda resposta ou status code
- Nenhuma coluna de banco muda
- Comportamento com um único request simultâneo é idêntico
- A diferença é visível somente com dois requests concorrentes para o mesmo recurso

### Checklist de implementação
- [ ] Em `billing.ts` — `approveReceipt`: adicionar `.for('update')` no SELECT de `invoicesTable` dentro de `db.transaction()` (deve ser a primeira operação da transação)
- [ ] Em `billing.ts` — `processManualPayment`: idem
- [ ] Em `credits.ts` — `releasePurchasedCredits`: adicionar `.for('update')` no SELECT de `invoicesTable` (linha ~19). Como a função recebe `tx` do chamador, o lock é aplicado no contexto da transação do chamador
- [ ] Verificar que todos os SELECTs com `.for('update')` estão dentro de `db.transaction()` — FOR UPDATE fora de transação é ignorado silenciosamente pelo PostgreSQL
- [ ] Confirmar que Drizzle ORM da versão usada no projeto suporta `.for('update')` (confirmar via `node_modules`)

### Testes obrigatórios
```
CENÁRIO 1: approveReceipt — fluxo normal
  - Chamar approveReceipt para invoice 'pending'
  - Verificar: status = 'paid', transaction inserida, creditsReleased = true

CENÁRIO 2: approveReceipt — idempotência
  - Chamar approveReceipt para invoice já 'paid'
  - Verificar: retorna erro adequado (não duplica transaction)

CENÁRIO 3: processManualPayment — fluxo normal
  - Resultado idêntico ao atual

CENÁRIO 4: releasePurchasedCredits — creditsReleased=true
  - Chamar com invoice que já tem creditsReleased=true
  - Verificar: nenhum crédito novo inserido, função retorna sem erro

CENÁRIO 5: Concorrência simulada (integração)
  - Disparar dois approveReceipt para a mesma invoice em paralelo
  - Verificar: apenas uma transaction inserida, status='paid' uma única vez
  - Verificar: creditsReleased=true, tutor_credits incrementado apenas uma vez
```

### Rollback
Remover os `.for('update')` adicionados. Zero impacto em dados — locks são mecanismo de leitura, não alteram linhas.

---

## FASE 3 — Idempotência de Webhook Stripe

**Tipo:** 🔒 Confiabilidade · **Risco:** 🟢 Baixo

### Objetivo
`applyFinancialStripeEvent` em `financialSync.ts` insere um registro em `transactionsTable` sem verificar se já existe uma transaction para aquele `stripePaymentIntentId`. O Stripe garante entrega "at least once" — retries são normais. Um webhook duplicado gera uma transaction duplicada para a mesma invoice.

### Achados que motivam esta fase
- **IG-06** / **IG-27** — webhook retry insere transaction duplicada (financialSync.ts:~11, 28)

### Arquivos afetados
```
artifacts/api-server/src/lib/financialSync.ts   ← única mudança
```

### O que NÃO muda
- Endpoint de webhook (`POST /api/stripe/webhook`) não muda
- Resposta HTTP ao Stripe (200 OK) não muda — Stripe espera 200 mesmo em duplicatas
- Comportamento no primeiro recebimento é idêntico

### Checklist de implementação
- [ ] Antes do INSERT em `transactionsTable`, adicionar SELECT verificando se já existe `transaction WHERE stripePaymentIntentId = session.payment_intent`
- [ ] Se existir: sair da função com `return` sem erro (idempotência — Stripe ainda recebe 200)
- [ ] Se não existir: prosseguir com o fluxo atual
- [ ] O SELECT de verificação deve estar **dentro do mesmo `db.transaction()`** que o INSERT (evitar TOCTOU)
- [ ] Verificar que `transactionsTable` tem coluna `stripePaymentIntentId` (confirmar schema)
- [ ] Avaliar adicionar `stripePaymentIntentId` como parâmetro do log para rastreabilidade

### Testes obrigatórios
```
CENÁRIO 1: Primeiro webhook — fluxo normal
  - Simular checkout.session.completed
  - Verificar: invoice marcada paid, 1 transaction inserida, créditos liberados

CENÁRIO 2: Webhook duplicado (retry)
  - Simular mesmo evento duas vezes com mesmo payment_intent_id
  - Verificar: apenas 1 transaction na tabela
  - Verificar: invoice.status continua 'paid' (não muda)
  - Verificar: tutor_credits.usedCredits não duplicado

CENÁRIO 3: Webhooks diferentes (dois pagamentos distintos)
  - Simular dois eventos com payment_intent_ids diferentes
  - Verificar: 2 transactions, 2 invoices pagas corretamente
```

### Rollback
Remover o SELECT de verificação de duplicata. Zero impacto em dados históricos — apenas futuras duplicatas voltam a ser possíveis.

---

## FASE 4 — Guard de Underflow em usedCredits

**Tipo:** 🔒 Confiabilidade · **Risco:** 🟢 Baixo

### Objetivo
No cancelamento de reserva em `bookings.ts`, a restauração de créditos usa subtração direta (`usedCredits - creditsConsumed`) sem piso em zero. Se houve ajuste manual de créditos ou uma anomalia anterior, `usedCredits` pode ficar negativo — o que não tem significado semântico e pode quebrar displays de saldo.

### Achados que motivam esta fase
- **IG-37** — `usedCredits` pode ir negativo na restauração (bookings.ts:639)

### Arquivos afetados
```
artifacts/api-server/src/routes/bookings.ts   ← mudança cirúrgica (~2 linhas)
```

### O que NÃO muda
- Nenhuma API muda
- Comportamento normal (usedCredits > creditsConsumed): resultado idêntico
- Diferença aparece apenas em edge case de estado inconsistente pré-existente

### Checklist de implementação
- [ ] Localizar o UPDATE de restauração de `tutor_credits` no cancelamento (~L639)
- [ ] Substituir `usedCredits: sql\`${tutorCreditsTable.usedCredits} - ${c.creditsConsumed}\`` por expressão com `GREATEST(0, ...)`:  
  `usedCredits: sql\`GREATEST(0, ${tutorCreditsTable.usedCredits} - ${c.creditsConsumed})\``
- [ ] Aplicar o mesmo padrão em qualquer outro ponto do arquivo onde usedCredits é decrementado (buscar todas as ocorrências)
- [ ] Verificar que `GREATEST` é suportado pelo PostgreSQL (é uma função nativa — sim)

### Testes obrigatórios
```
CENÁRIO 1: Restauração normal
  - Reserva confirmada (usedCredits += 1)
  - Reserva cancelada (usedCredits -= 1)
  - Verificar: usedCredits = valor original (sem alteração de comportamento)

CENÁRIO 2: Restauração com estado inconsistente (edge case)
  - Forçar usedCredits = 0 no banco diretamente
  - Cancelar reserva que tinha creditsConsumed = 1
  - Verificar: usedCredits = 0 (GREATEST evitou negativo)
  - Verificar: nenhum erro lançado
```

### Rollback
Reverter a expressão GREATEST para a subtração direta. Sem impacto em dados.

---

## FASE 5 — Restauração de Créditos de Serviço no Cancelamento

**Tipo:** 🔒 Confiabilidade · **Risco:** 🟡 Médio

### Objetivo
O bloco de cancelamento de reserva em `bookings.ts` restaura créditos de diária (`tutor_credits`) mas **não restaura** créditos de serviço (`tutor_service_credits`). Quando uma reserva de serviço (banho, consulta etc.) é cancelada, o crédito consumido é silenciosamente perdido — o tutor paga sem receber o serviço e não recupera o crédito.

Esta é a única fase do plano que corrige um comportamento incorreto existente. O comportamento esperado (crédito retorna ao cancelar) é o que qualquer usuário assumiria ser o correto.

### Achados que motivam esta fase
- **IG-31** — `tutor_service_credits` não restaurado no cancelamento (bookings.ts:607–652)

### Arquivos afetados
```
artifacts/api-server/src/routes/bookings.ts   ← adição de bloco de restauração
```

### O que NÃO muda
- Assinatura do endpoint de cancelamento
- Resposta HTTP (status code, payload)
- Fluxo para reservas de diária (tutor_credits) — já funcionava
- Schema do banco

### Checklist de implementação
- [ ] Ler o bloco de restauração de `tutor_credits` (~L607–640) para entender o padrão exato
- [ ] Identificar como a função de cancelamento sabe quais créditos foram consumidos (via `booking_credits` ou diretamente do booking?)
- [ ] Verificar se `booking_credits` ou outra tabela registra o `itemType` do crédito consumido (diária vs. serviço)
- [ ] Adicionar SELECT de `tutor_service_credits` consumidos pela reserva, dentro do mesmo `db.transaction()`
- [ ] Adicionar UPDATE de restauração com `usedCredits - creditsConsumed` (com GREATEST do Fase 4) para cada linha de serviço encontrada
- [ ] O UPDATE deve estar dentro da mesma transação do cancelamento (já existe `db.transaction()` no cancelamento — apenas adicionar dentro)
- [ ] Verificar que o cancelamento de serviço que gerou **cobrança** (não crédito) não é afetado — esses seguem o caminho de `voidInvoice`, não de restauração de crédito

### Testes obrigatórios
```
CENÁRIO 1: Cancelamento de reserva de serviço com crédito
  - Confirmar reserva de serviço (banho) que consome 1 service credit
  - Verificar: tutor_service_credits.usedCredits aumentou
  - Cancelar a reserva
  - Verificar: tutor_service_credits.usedCredits voltou ao valor anterior
  - Verificar: nenhuma invoice foi gerada ou alterada

CENÁRIO 2: Cancelamento de reserva de diária (regressão)
  - Confirmar reserva de diária
  - Cancelar
  - Verificar: tutor_credits.usedCredits restaurado (comportamento atual preservado)

CENÁRIO 3: Cancelamento de reserva sem créditos (cobrança direta)
  - Confirmar reserva que gerou addCharge (sem créditos)
  - Cancelar
  - Verificar: invoice pendente é voided (comportamento atual preservado)
  - Verificar: nenhum crédito é alterado

CENÁRIO 4: Rollback de falha
  - Simular erro no UPDATE de service_credits
  - Verificar: booking não é cancelado, nada persiste
```

### Rollback
Remover o bloco de restauração de `tutor_service_credits`. Sem alteração de dados históricos — reservas já canceladas antes desta fase não são retroativamente corrigidas.

---

## FASE 6 — Sincronização de Status Invoice ↔ Order

**Tipo:** 🔒 Confiabilidade · **Risco:** 🟡 Médio

### Objetivo
`voidInvoice` e `refundInvoice` em `billing.ts` atualizam o status da invoice mas **não sincronizam** o `ordersTable`. Pedidos ficam com status desatualizado (`pending_payment` quando a invoice foi anulada; `paid` quando a invoice foi reembolsada). O painel admin exibe estados contraditórios.

### Achados que motivam esta fase
- **IG-09** — `voidInvoice` não atualiza `ordersTable` (billing.ts:156)
- **IG-10** — `refundInvoice` não atualiza `ordersTable` (billing.ts:177)
- **IG-24** — pedido fica `pending_payment` com invoice voided
- **IG-25** — pedido fica `paid` com invoice refunded

### Arquivos afetados
```
artifacts/api-server/src/services/billing.ts   ← voidInvoice, refundInvoice
```

### O que NÃO muda
- Assinatura das funções (`voidInvoice`, `refundInvoice`)
- Respostas dos endpoints que as chamam
- Schema da tabela `orders` (coluna `status` já existe)
- Comportamento de invoices sem order associado (avulso de booking — deve ser tratado com `WHERE invoiceId IS NOT NULL`)

### Checklist de implementação
- [ ] Verificar que `ordersTable` tem coluna `status` e quais valores são válidos (ex: `pending_payment`, `paid`, `cancelled`, `refunded`)
- [ ] Verificar que `invoicesTable` tem coluna `orderId` ou similar para poder fazer o JOIN/UPDATE
- [ ] Em `voidInvoice`: dentro do `db.transaction()` (já adicionado na Fase 1), adicionar UPDATE em `ordersTable` com `status = 'cancelled'` WHERE `invoiceId = invoiceId AND status != 'delivered'` (não cancelar pedidos já entregues)
- [ ] Em `refundInvoice`: adicionar UPDATE com `status = 'refunded'` WHERE `invoiceId = invoiceId`
- [ ] Usar `UPDATE ... WHERE EXISTS (SELECT 1 FROM orders WHERE invoiceId = ?)` para não falhar quando invoice não tem order (reservas/consumíveis avulsos)
- [ ] Verificar que `approveReceipt` já atualiza `ordersTable.status = 'paid'` — confirmar que esta parte não regride

### Testes obrigatórios
```
CENÁRIO 1: voidInvoice com pedido associado
  - Criar pedido + invoice
  - Chamar voidInvoice
  - Verificar: invoice.status = 'voided'
  - Verificar: orders.status = 'cancelled'

CENÁRIO 2: voidInvoice sem pedido (invoice de reserva)
  - Chamar voidInvoice para invoice sem orderId
  - Verificar: invoice.status = 'voided'
  - Verificar: nenhum erro; nenhum orders afetado

CENÁRIO 3: refundInvoice com pedido
  - Chamar refundInvoice
  - Verificar: invoice.status = 'refunded'
  - Verificar: orders.status = 'refunded'

CENÁRIO 4: approveReceipt (regressão)
  - Verificar que orders.status = 'paid' após aprovação (comportamento atual preservado)
```

### Rollback
Remover os UPDATEs adicionados em `voidInvoice` e `refundInvoice`. Sem impacto em dados históricos — pedidos voltam a ficar desatualizados como antes.

---

## FASE 7 — Extração: Créditos de Serviço para services/credits.ts

**Tipo:** 🏗️ Arquitetura · **Risco:** 🟡 Médio

### Objetivo
Toda a lógica de consumo e restauração de `tutor_service_credits` está diretamente em `routes/bookings.ts` (~L526–580, ~L607–652). Lógica de domínio em arquivos de rota viola a separação de responsabilidades e dificulta reutilização. A lógica de `tutor_credits` (diárias) segue o mesmo padrão incorreto.

Esta fase extrai ambas para `services/credits.ts`, sem alterar o comportamento.

### Achados que motivam esta fase
- **IC-04** (Inconsistência Estrutural) — lógica de crédito duplicada entre route e service
- **M08** — oportunidade de melhoria: centralizar lógica de crédito

### Arquivos afetados
```
artifacts/api-server/src/services/credits.ts   ← novas funções a criar
artifacts/api-server/src/routes/bookings.ts    ← substituir blocos inline por chamadas
```

### O que NÃO muda
- Nenhuma rota
- Nenhuma resposta de API
- Nenhuma tabela de banco
- A lógica em si (mesmas queries, mesmos locks, mesmo comportamento)

### Novas funções propostas para services/credits.ts
```typescript
// Consumir crédito de pacote de diária
consumePackageCredit(tx, tutorId, crecheId, bookingId): Promise<ConsumedCredit | null>

// Restaurar crédito de pacote de diária
restorePackageCredit(tx, bookingId): Promise<void>

// Consumir crédito de serviço
consumeServiceCredit(tx, tutorId, crecheId, serviceType, bookingId): Promise<ConsumedCredit | null>

// Restaurar crédito de serviço
restoreServiceCredit(tx, bookingId): Promise<void>
```

### Checklist de implementação
- [ ] Ler integralmente os blocos de crédito em `bookings.ts` (L423–580 e L607–652) antes de qualquer extração
- [ ] Criar as 4 funções em `credits.ts` copiando exatamente o código dos blocos, incluindo locks (`FOR UPDATE`) e transações
- [ ] Substituir os blocos em `bookings.ts` por chamadas às novas funções (passando `tx` existente)
- [ ] Verificar que as novas funções aceitam o `tx` da transação pai (não criam transação própria)
- [ ] Verificar que os tipos TypeScript batem (sem `any` na interface das novas funções)
- [ ] Rodar `tsc --build` em `lib/api-client-react` e `lib/db` para verificar que não há drift de tipos

### Testes obrigatórios
```
CENÁRIO 1: Confirmação de reserva com pacote de diária
  - Resultado idêntico ao atual (mesma dedução)

CENÁRIO 2: Confirmação de reserva de serviço
  - Resultado idêntico ao atual

CENÁRIO 3: Cancelamento com restauração de diária
  - Resultado idêntico ao atual

CENÁRIO 4: Cancelamento com restauração de serviço (+ Fase 5)
  - Verificar restauração correta

CENÁRIO 5: Confirmação sem créditos (fallback para cobrança)
  - Verificar que o fallback para addCharge ainda funciona
```

### Rollback
Revert do arquivo `credits.ts` para a versão anterior + revert de `bookings.ts` para os blocos inline. Sem impacto em banco.

---

## FASE 8 — Extração: Lógica de Pedido de routes/orders.ts para services/orders.ts

**Tipo:** 🏗️ Arquitetura · **Risco:** 🟡 Médio

### Objetivo
`routes/orders.ts` contém lógica de domínio inline: criação de pedido + dedução de estoque + criação de invoice + liberação de créditos. Esta lógica é difícil de testar unitariamente e não pode ser reutilizada sem passar pela rota HTTP.

### Arquivos afetados
```
artifacts/api-server/src/services/orders.ts   ← novo arquivo a criar
artifacts/api-server/src/routes/orders.ts     ← substituir blocos inline por chamadas
```

### O que NÃO muda
- Nenhuma rota HTTP
- Nenhum payload de request/response
- Nenhuma tabela de banco
- A lógica em si

### Funções propostas para services/orders.ts
```typescript
// Criar pedido da loja (tutor store)
createTutorOrder(params: CreateOrderParams): Promise<OrderResult>

// Criar pedido POS (balcão)
createPosOrder(params: CreatePosParams): Promise<OrderResult>

// Cancelar pedido (revogação de créditos + estoque)
cancelOrder(orderId, crecheId): Promise<void>

// Confirmar entrega
markOrderDelivered(orderId, crecheId): Promise<void>
```

### Checklist de implementação
- [ ] Criar `services/orders.ts` com as funções acima
- [ ] Cada função deve aceitar `db` ou uma conexão gerenciada externamente (para testabilidade)
- [ ] As funções devem ser chamadas por `routes/orders.ts` — a rota apenas valida input, chama o serviço, e formata a resposta
- [ ] Preservar todos os locks (`FOR UPDATE` em catalogue_items)
- [ ] Preservar todas as transações
- [ ] Rodar `tsc --build` após a mudança

### Testes obrigatórios
```
CENÁRIO 1: POST /orders (loja) — fluxo completo
  - Pedido criado, estoque decrementado, invoice gerada, créditos liberados (se pacote)

CENÁRIO 2: POST /orders (POS)
  - Venda concluída, pagamento registrado, estoque decrementado

CENÁRIO 3: PUT /orders/:id/status = cancelled
  - Estoque restaurado, créditos revogados (se serviço), pedido cancelado

CENÁRIO 4: PUT /orders/:id/status = delivered
  - Status atualizado, nenhum efeito colateral

CENÁRIO 5: Estoque insuficiente
  - Pedido rejeitado com erro adequado
```

### Rollback
Remover `services/orders.ts` e reverter `routes/orders.ts` para os blocos inline.

---

## FASE 9 — Consolidação: Interface Unificada de Créditos

**Tipo:** 🏗️ Arquitetura · **Risco:** 🔴 Alto

### Objetivo
Existem dois sistemas de crédito com estruturas diferentes e lógicas duplicadas:
- `tutor_credits` — diárias (quantidade usada/total por pacote)
- `tutor_service_credits` — serviços (por tipo de serviço, mesma estrutura mas semântica diferente)

A distinção entre eles é feita por regex (`di[aá]rias?`) no nome do item de catálogo — altamente frágil. Esta fase não unifica as tabelas (sem schema change), mas cria uma **interface de serviço comum** que abstrai qual tabela usar, baseada em `itemType` em vez de regex.

### Dependências
**Deve vir após Fases 5, 7 e 8** — as funções extraídas naquelas fases são refatoradas aqui.

### Achados que motivam esta fase
- **IG-29** — regex `di[aá]rias?` para detectar tipo de crédito (credits.ts:36,40)
- **IC-06** — dois sistemas de crédito com lógica duplicada
- **M14** — oportunidade: abstração sobre tipos de crédito

### Arquivos afetados
```
artifacts/api-server/src/services/credits.ts   ← refatoração das funções da Fase 7
artifacts/api-server/src/routes/bookings.ts    ← uso da nova interface (se necessário)
```

### O que NÃO muda
- Tabelas de banco (nenhuma mudança de schema)
- API pública
- Comportamento de consumo e restauração

### Interface proposta
```typescript
type CreditType = 'package' | 'service'

interface CreditOperation {
  consume(tx, tutorId, crecheId, type: CreditType, bookingId): Promise<ConsumedCredit | null>
  restore(tx, bookingId, type: CreditType): Promise<void>
  getBalance(tutorId, crecheId, type: CreditType): Promise<number>
}
```

A implementação interna decide qual tabela usar baseada em `type`, eliminando o regex.

### Checklist de implementação
- [ ] Mapear todos os pontos onde a distinção diária/serviço é feita por regex
- [ ] Verificar que `itemType` (ou campo equivalente) está disponível em todos os call sites
- [ ] Criar a interface `CreditOperation` em `credits.ts`
- [ ] Implementar as duas estratégias (`package` → `tutor_credits`, `service` → `tutor_service_credits`)
- [ ] Substituir todos os usos do regex pela nova interface
- [ ] Testar todos os caminhos (diária, serviço, fallback)

### Testes obrigatórios
```
CENÁRIO 1: Item de catálogo com nome padrão ("Pacote de Diárias")
  - Confirmar que type='package', tutor_credits é usado

CENÁRIO 2: Item de catálogo com nome customizado ("Mensalidade Premium")
  - Confirmar que type='package' (do itemType), não do nome

CENÁRIO 3: Item de catálogo de serviço (banho, consulta)
  - Confirmar que type='service', tutor_service_credits é usado

CENÁRIO 4: Regressão — todos os fluxos existentes
  - Loja, POS, confirmação, cancelamento
```

### Rollback
Reverter para regex nos pontos onde a distinção era feita. Sem impacto em banco.

---

## FASE 10 — Frontend: Cache Invalidation Faltante

**Tipo:** 🖥️ Frontend · **Risco:** 🟢 Baixo

### Objetivo
Após aprovação de pagamento (`approveReceipt`, `processManualPayment`), três query keys não são invalidadas:
- `dashboard-kpis` — KPIs do painel ficam desatualizados
- `packages-balance` — saldo de pacotes do tutor pode mostrar valor antigo após créditos liberados
- `service-credits` — mesma situação

### Achados que motivam esta fase
- Cache invalidation map (Seção 15.3 do documento de auditoria): 3 gaps identificados

### Arquivos afetados
```
artifacts/petdaycare/src/pages/financial/index.tsx   ← onSuccess/onSettled das mutations
artifacts/petdaycare/src/hooks/use-financial.ts      ← se invalidação é centralizada nos hooks
```

### O que NÃO muda
- Nenhuma API
- Nenhum banco
- Apenas quais queries são invalidadas após mutations — comportamento para o usuário melhora (dados mais frescos)

### Checklist de implementação
- [ ] Localizar onde `useApproveReceipt` e `usePayManualInvoice` invalidam queries (provavelmente `onSuccess` dos hooks em `use-financial.ts`)
- [ ] Adicionar `queryClient.invalidateQueries(['dashboard-kpis', crecheId])` após aprovação
- [ ] Adicionar `queryClient.invalidateQueries(['packages-balance', crecheId, tutorId])` após aprovação
- [ ] Adicionar `queryClient.invalidateQueries(['service-credits', crecheId, tutorId])` após aprovação
- [ ] Verificar o formato exato das query keys usadas no projeto (podem ter estrutura de array diferente)
- [ ] Verificar que não há loop de re-fetches (invalidar dashboard-kpis que dispara outras queries que invalidam outras)

### Testes obrigatórios
```
CENÁRIO 1: Aprovação de comprovante
  - Aprovar pagamento de pacote de créditos
  - Verificar (visual/DOM): packages-balance atualiza sem reload manual
  - Verificar (visual/DOM): KPIs do dashboard atualizam

CENÁRIO 2: Pagamento manual
  - Mesmo fluxo
  - Sem regressão nos outros displays financeiros
```

### Rollback
Remover as invalidações adicionadas. Queries voltam ao comportamento stale anterior. Sem impacto em banco.

---

## FASE 11 — Banco: Constraints de Integridade

**Tipo:** 🗄️ Banco · **Risco:** 🟡 Médio

### Objetivo
Adicionar constraints ao banco que tornem fisicamente impossíveis os estados inválidos identificados na auditoria, sem alterar o schema visível à aplicação.

**Importante:** Todas as constraints propostas são **additive** (nenhum DROP, nenhum RENAME, nenhum ALTER COLUMN). Serão aplicadas via `ALTER TABLE ... ADD CONSTRAINT` fora do Drizzle (usando psql diretamente, para não forçar `drizzle-kit push` com perguntas interativas).

### Achados que motivam esta fase
- **IG-17** — sem UNIQUE constraint em credits/invoiceId
- **IG-37** — usedCredits pode ser negativo

### Constraints propostas

```sql
-- 1. Impede créditos negativos (tutor_credits)
ALTER TABLE tutor_credits
  ADD CONSTRAINT chk_used_credits_non_negative
  CHECK (used_credits >= 0);

-- 2. Impede usedCredits > totalCredits (tutor_credits)
ALTER TABLE tutor_credits
  ADD CONSTRAINT chk_used_le_total
  CHECK (used_credits <= total_credits);

-- 3. Mesmo para service credits
ALTER TABLE tutor_service_credits
  ADD CONSTRAINT chk_svc_used_credits_non_negative
  CHECK (used_credits >= 0);

ALTER TABLE tutor_service_credits
  ADD CONSTRAINT chk_svc_used_le_total
  CHECK (used_credits <= total_credits);

-- 4. Uma única entrada de crédito por invoice (impede double-release)
-- ATENÇÃO: Somente adicionar se não houver linhas duplicadas no banco atual
-- Verificar primeiro: SELECT invoice_id, COUNT(*) FROM tutor_credits GROUP BY invoice_id HAVING COUNT(*) > 1
ALTER TABLE tutor_credits
  ADD CONSTRAINT uq_tutor_credits_invoice
  UNIQUE (invoice_id);

ALTER TABLE tutor_service_credits
  ADD CONSTRAINT uq_svc_credits_invoice
  UNIQUE (invoice_id);
```

### Checklist de implementação
- [ ] **ANTES DE QUALQUER ALTER:** verificar se há dados inválidos que violam as constraints propostas
  - `SELECT COUNT(*) FROM tutor_credits WHERE used_credits < 0`
  - `SELECT COUNT(*) FROM tutor_credits WHERE used_credits > total_credits`
  - `SELECT invoice_id, COUNT(*) FROM tutor_credits GROUP BY invoice_id HAVING COUNT(*) > 1`
  - Idem para `tutor_service_credits`
- [ ] Se houver dados inválidos: documentar e **não adicionar** a constraint correspondente — corrigir os dados primeiro
- [ ] Adicionar as constraints que passarem na verificação via psql (não via drizzle-kit push)
- [ ] Testar que a aplicação ainda funciona após cada constraint
- [ ] Adicionar as constraints ao schema Drizzle (`lib/db/schema`) sem alterar as colunas — apenas o objeto TypeScript, para manter o schema em sync

### Testes obrigatórios
```
CENÁRIO 1: Inserção válida
  - Criar crédito com valores dentro dos limites
  - Verificar: sucesso

CENÁRIO 2: Tentativa de violar constraint
  - Tentar SET used_credits = -1 via SQL direto
  - Verificar: PostgreSQL lança constraint violation

CENÁRIO 3: Aplicação normal não é afetada
  - Rodar fluxo completo de compra + confirmação de reserva + cancelamento
  - Verificar: sem erros novos
```

### Rollback
```sql
ALTER TABLE tutor_credits DROP CONSTRAINT IF EXISTS chk_used_credits_non_negative;
ALTER TABLE tutor_credits DROP CONSTRAINT IF EXISTS chk_used_le_total;
ALTER TABLE tutor_credits DROP CONSTRAINT IF EXISTS uq_tutor_credits_invoice;
ALTER TABLE tutor_service_credits DROP CONSTRAINT IF EXISTS chk_svc_used_credits_non_negative;
ALTER TABLE tutor_service_credits DROP CONSTRAINT IF EXISTS chk_svc_used_le_total;
ALTER TABLE tutor_service_credits DROP CONSTRAINT IF EXISTS uq_svc_credits_invoice;
```

---

## FASE 12 — Cleanup: Dados Stale e Órfãos

**Tipo:** 🧹 Consistência · **Risco:** 🟢 Baixo

### Objetivo
Adicionar jobs de manutenção ao scheduler existente para evitar acúmulo de dados stale sem valor operacional. Nenhum dado com valor histórico é removido — apenas estados incoerentes que nunca serão resolvidos.

### Achados que motivam esta fase
- **IG-11** / **IG-23** — pedidos em `pending_payment` sem pagamento ficam no banco indefinidamente
- **IG-19, IG-20, IG-22** — `invoice_items` de invoices voided/refunded acumulam indefinidamente

### Arquivos afetados
```
artifacts/api-server/src/lib/scheduler.ts   ← novos jobs
```

### O que NÃO muda
- Nenhuma API
- Nenhum dado com status operacional (paid, delivered, active)
- Apenas dados em estados terminais sem utilidade

### Jobs propostos

```
JOB: Pedidos stale cleanup
  Cron: 0 3 * * *  (3h BRT, diário — junto ao receipt cleanup existente)
  Lógica:
    SELECT orders WHERE status='pending_payment'
      AND created_at < NOW() - INTERVAL '30 days'
    UPDATE orders SET status='expired'
  Não deleta — apenas marca como 'expired' para auditoria
  Falha: silenciosa (log de erro, não relança)

JOB: Não incluído — invoice_items de invoices voided
  Decisão: NÃO limpar invoice_items órfãos automaticamente.
  Motivo: invoice_items têm valor de auditoria histórica (mostram o que foi cobrado
  antes do void/refund). Manter para rastreabilidade.
  A inconsistência é cosmética (aparecem em GET /invoices/:id/items para invoices
  voided) — pode ser filtrado na query sem apagar os dados.
```

### Checklist de implementação
- [ ] Verificar que o enum de status de `ordersTable` aceita o valor `'expired'` (ou adicionar ao enum no schema Drizzle se necessário)
- [ ] Adicionar job no `scheduler.ts` após o job de receipt cleanup
- [ ] O intervalo de 30 dias é configurável via constante — definir `STALE_ORDER_TTL_DAYS = 30`
- [ ] Adicionar log estruturado de quantos pedidos foram marcados como expirados em cada execução
- [ ] Verificar que nenhuma query de listagem de pedidos para o admin inclui status `'expired'` (ou filtrar adequadamente)

### Testes obrigatórios
```
CENÁRIO 1: Pedido stale (>30 dias pending)
  - Criar pedido em pending_payment com data antiga
  - Rodar job manualmente
  - Verificar: status = 'expired'

CENÁRIO 2: Pedido recente (< 30 dias)
  - Verificar: não é afetado

CENÁRIO 3: Pedido paid/delivered
  - Verificar: não é afetado independente da data

CENÁRIO 4: API de listagem de pedidos (admin)
  - Verificar: pedidos 'expired' não aparecem no painel (ou aparecem em seção separada)
```

### Rollback
Remover o job do scheduler. Os pedidos marcados como `expired` permanecem — se necessário, reverter com `UPDATE orders SET status='pending_payment' WHERE status='expired'`.

---

## 15. ORDEM DE EXECUÇÃO RECOMENDADA

### Trilha A — Confiabilidade (máximo impacto, menor risco)
Execute na ordem: **1 → 2 → 3 → 4 → 5 → 6**

Cada fase é independente das outras nesta trilha (exceto que Fase 1 deve preceder Fase 2 para que `voidInvoice` já tenha transação antes de receber lock).

### Trilha B — Arquitetura (médio prazo)
Execute após Trilha A completa: **7 → 8 → 9**

A Fase 9 depende das Fases 7 e 8 estarem completas.

### Trilha C — Independentes (a qualquer momento)
Fases **3, 4, 10, 11, 12** são completamente independentes e podem ser intercaladas na Trilha A.

### Sequência recomendada completa
```
Sprint 1 (baixo risco, alto retorno):
  Fase 1  — voidInvoice + transação
  Fase 3  — idempotência webhook Stripe
  Fase 4  — guard underflow usedCredits
  Fase 10 — cache invalidation frontend

Sprint 2 (confiabilidade core):
  Fase 2  — locks FOR UPDATE
  Fase 5  — restauração service credits
  Fase 6  — sync invoice ↔ order
  Fase 11 — constraints de banco

Sprint 3 (arquitetura):
  Fase 7  — extração credits service
  Fase 8  — extração orders service

Sprint 4 (consolidação):
  Fase 9  — interface unificada de créditos
  Fase 12 — cleanup de dados stale
```

---

## 16. DEPENDÊNCIAS ENTRE FASES

```
Fase 1 (atomicidade voidInvoice)
  └── requerida por → Fase 6 (sync invoice↔order usa tx da Fase 1)

Fase 2 (locks FOR UPDATE)
  └── requerida por → Fase 5 (cancelamento usa tx com lock)

Fase 5 (restauração svc credits)
  └── requerida por → Fase 7 (extração presume restauração já correta)

Fase 7 (extração credits)
  └── requerida por → Fase 9 (interface unificada refatora funções da Fase 7)

Fase 8 (extração orders)
  └── requerida por → Fase 9 (idem)

Independentes (sem dependência): Fases 3, 4, 10, 11, 12
```

---

## APÊNDICE — INVARIANTES A PRESERVAR EM TODAS AS FASES

As seguintes invariantes devem ser verificadas como **condição de saída** de qualquer fase:

| # | Invariante |
|---|---|
| INV-01 | Toda invoice com `status='paid'` tem pelo menos uma linha em `transactionsTable` |
| INV-02 | Todo `tutor_credits` com `creditsReleased=true` tem `usedCredits <= totalCredits` |
| INV-03 | Toda confirmação de reserva que consome crédito tem registro em `booking_credits` |
| INV-04 | Nenhum endpoint HTTP muda sua assinatura (path, method, request body shape, response shape) |
| INV-05 | `drizzle-kit push` não propõe DROP de nenhuma coluna ou tabela |
| INV-06 | `tsc --build` em `lib/db` e `lib/api-client-react` passa sem erros após cada fase |
| INV-07 | O saldo exibido ao tutor é sempre calculado do banco (`totalCredits - usedCredits`) — nunca de cache |
| INV-08 | Nenhuma migração de dados é feita (dados existentes não são alterados, apenas novos comportamentos) |
