# RELATÓRIO DE AUDITORIA TÉCNICA — MÓDULO FINANCEIRO ARKPET
**Data:** 2026-08-05  
**Escopo:** Pós-refatoração Fases 1–13  
**Auditor:** Arquiteto de Software Sênior (auditoria automatizada + análise manual)

---

## LEGENDA DE SEVERIDADE

| Nível | Critério |
|-------|----------|
| **CRÍTICO** | Perda de dados, cobrança duplicada, corrupção financeira, acesso indevido a recursos de outra creche |
| **ALTO** | Inconsistência financeira, race condition provável em produção, caminhos de rollback ausentes |
| **MÉDIO** | Risco operacional com baixa frequência, observabilidade comprometida, violação de invariante em edge cases |
| **BAIXO** | Qualidade de código, manutenibilidade, hardcodes sem impacto financeiro direto |

---

## PARTE I — INVENTÁRIO DE ACHADOS

---

### F-01 · Venda POS não cria registro em `ordersTable`
| Campo | Valor |
|-------|-------|
| **Severidade** | ALTO |
| **Arquivo** | `artifacts/api-server/src/routes/financial.ts` |
| **Método** | `POST /creches/:crecheId/financial/pos/sale` |
| **Linha aprox.** | 870–980 |
| **Fluxo** | POS → Invoice → Stock |
| **Impacto** | O painel de Pedidos (`/orders`) não exibe nenhuma venda POS. Relatórios financeiros de vendas ficam incompletos. Conciliação estoque×receita impossível via `ordersTable`. |
| **Causa raiz** | A rota cria `invoicesTable` + `invoiceItemsTable` + decrementa estoque via `stock_transactions`, mas nunca insere em `ordersTable`. |
| **Correção proposta** | Dentro da mesma transação da venda POS, inserir registro em `ordersTable` com `type: 'pos'`, `status: 'paid'`, e `ordersItemsTable` espelhando os itens do carrinho. Usar `services/orders.ts::createOrder` após adequação de schema. |
| **Risco da correção** | Médio — requer schema `ordersTable.type` ter o valor `'pos'` (schema drift existente). |
| **Compatibilidade** | Nenhum endpoint muda. Resposta JSON da rota POS permanece idêntica. |
| **Rollback** | Remover o bloco de inserção em `ordersTable` da transação POS. |
| **Testes necessários** | Venda POS → verificar que `ordersTable` contém registro com `type='pos'`; verificar que `invoicesTable` e `ordersTable` têm mesmo tutor/total. |

---

### F-02 · Venda POS sem idempotência — retry cria cobrança duplicada
| Campo | Valor |
|-------|-------|
| **Severidade** | CRÍTICO |
| **Arquivo** | `artifacts/api-server/src/routes/financial.ts` |
| **Método** | `POST /creches/:crecheId/financial/pos/sale` |
| **Linha aprox.** | 870 |
| **Fluxo** | POS → Invoice |
| **Impacto** | Timeout de rede + retry do cliente cria segunda fatura com mesmos itens. Tutor é cobrado duas vezes. Estoque é decrementado duas vezes. |
| **Causa raiz** | Nenhum campo de idempotência (`idempotency_key`) é verificado. Não existe `UNIQUE` constraint em `invoicesTable` para o par `(tutorId, referenceId, referenceType)`. |
| **Correção proposta** | Aceitar header `X-Idempotency-Key` ou body field `idempotencyKey`. Verificar `invoicesTable` por `(crecheId, idempotencyKey)` antes de processar. Inserir o `idempotencyKey` no invoice e adicionar `UNIQUE(creche_id, idempotency_key)` via migração. |
| **Risco da correção** | Baixo — campo nullable, sem impacto em clientes existentes. |
| **Compatibilidade** | Adição de campo opcional ao body — retrocompatível. |
| **Rollback** | Remover a verificação de idempotência; campo pode ficar nullable sem efeito. |
| **Testes necessários** | POST POS com mesmo `idempotencyKey` duas vezes → segunda resposta deve retornar invoice existente sem criar novo. |

---

### F-03 · `BillingService.addCharge` reabre invoices pagas/estornadas/anuladas
| Campo | Valor |
|-------|-------|
| **Severidade** | CRÍTICO |
| **Arquivo** | `artifacts/api-server/src/services/billing.ts` |
| **Método** | `BillingService.addCharge` |
| **Linha aprox.** | 356–359 |
| **Fluxo** | Qualquer cobrança pós-checkout → Invoice |
| **Impacto** | Um consumível adicionado após checkout (quando a fatura mensal já foi paga) redefine `status = 'pending'` e `amount` da fatura paga. O tutor recebe nova cobrança sobre uma fatura que já liquidou. Equivalente a criar uma dívida fantasma. |
| **Causa raiz** | O bloco de merge de ciclo mensal em `addCharge` faz `SET status = 'pending'` incondicionalmente ao atualizar o `amount`, mesmo quando `existingInvoice.status` é `'paid'`, `'refunded'` ou `'voided'`. |
| **Correção proposta** | Antes do SET, verificar: se `existingInvoice.status` estiver em `['paid', 'refunded', 'voided']`, NÃO reutilizar essa fatura — criar nova fatura `pending` para o próximo ciclo ou retornar erro indicando que o ciclo já foi encerrado. |
| **Risco da correção** | Alto — altera lógica central de billing. Necessita mapeamento de todos os callers de `addCharge`. |
| **Compatibilidade** | Interno ao serviço. Nenhum endpoint ou payload público muda. |
| **Rollback** | Reverter bloco de status check em `addCharge`. |
| **Testes necessários** | Invoice mensal paga → addCharge → verificar que nova invoice é criada em vez de reabrir a paga; verificar que `amount` da paga não muda. |

---

### F-04 · `addCharge` com `existingInvoiceId` inválido cria item órfão
| Campo | Valor |
|-------|-------|
| **Severidade** | ALTO |
| **Arquivo** | `artifacts/api-server/src/services/billing.ts` |
| **Método** | `BillingService.addCharge` |
| **Linha aprox.** | 316–378 |
| **Fluxo** | Qualquer fluxo que passe `existingInvoiceId` |
| **Impacto** | Se `existingInvoiceId` não existe no DB, o `UPDATE invoicesTable SET amount = ...` afeta 0 linhas (silenciado). O `INSERT invoiceItemsTable` prossegue normalmente. Resultado: item sem parent invoice, total da invoice nunca é atualizado. |
| **Causa raiz** | Não há verificação do resultado do UPDATE antes de inserir o item. `db.update(...).where(...)` retorna array vazio sem erro quando 0 linhas são afetadas. |
| **Correção proposta** | Após `UPDATE`, verificar que `updatedRows.length > 0`. Se não, lançar erro e deixar a transação inteira fazer rollback. |
| **Risco da correção** | Baixo — edge case improvável em produção, mas sem overhead em fluxo normal. |
| **Compatibilidade** | Comportamento novo (erro explícito) vs. comportamento antigo (silêncio). Callers precisam estar em `try/catch`. |
| **Rollback** | Remover a verificação do length do UPDATE. |
| **Testes necessários** | `addCharge` com `existingInvoiceId=999999` (inexistente) → deve lançar erro e não inserir `invoiceItemsTable`. |

---

### F-05 · `consumePackageCredits` sem verificação de idempotência — double-consume
| Campo | Valor |
|-------|-------|
| **Severidade** | CRÍTICO |
| **Arquivo** | `artifacts/api-server/src/services/credits.ts` |
| **Método** | `consumePackageCredits` |
| **Linha aprox.** | 200–250 |
| **Fluxo** | Booking → Confirmação → Créditos |
| **Impacto** | Se `confirmBooking` for chamado duas vezes para o mesmo booking (retry, race condition, duplo clique), os créditos são consumidos duas vezes. Tutor perde dias de pacote sem ter usado. Booking aparece com o dobro de créditos debitados. |
| **Causa raiz** | A função não verifica se `bookingCreditsTable` já contém registros para o `bookingId` antes de iniciar o loop de consumo. Não há `UNIQUE(booking_id)` em `bookingCreditsTable` que impediria duplicatas. |
| **Correção proposta** | Opção A: Verificar `SELECT COUNT(*) FROM bookingCreditsTable WHERE bookingId = ?` dentro da transação com FOR UPDATE antes de consumir. Se > 0, retornar créditos já consumidos sem reprocessar. Opção B: Adicionar `UNIQUE(booking_id, package_id)` em `bookingCreditsTable` e tratar violação de constraint como "já consumido". |
| **Risco da correção** | Médio — Opção A é mais segura; Opção B requer migração. |
| **Compatibilidade** | Interno. Nenhuma API pública muda. |
| **Rollback** | Remover a verificação de idempotência. |
| **Testes necessários** | `confirmBooking` chamado duas vezes consecutivas → créditos consumidos apenas uma vez; segundo saldo igual ao primeiro. |

---

### F-06 · `consumeServiceCreditsForBooking` — mesma vulnerabilidade de double-consume
| Campo | Valor |
|-------|-------|
| **Severidade** | CRÍTICO |
| **Arquivo** | `artifacts/api-server/src/services/credits.ts` |
| **Método** | `consumeServiceCreditsForBooking` |
| **Linha aprox.** | 260–300 |
| **Fluxo** | Booking → Confirmação → Créditos de Serviço |
| **Impacto** | Idêntico ao F-05, mas para pacotes de serviços (banho, consulta). Consumo duplicado leva saldo a zero prematuramente. |
| **Causa raiz** | Não verifica `bookingServiceCreditsTable` por `bookingId` antes de inserir. |
| **Correção proposta** | Idêntica ao F-05. |
| **Risco / Rollback / Testes** | Idêntico ao F-05. |

---

### F-07 · Booking double-confirmation sem lock otimista
| Campo | Valor |
|-------|-------|
| **Severidade** | CRÍTICO |
| **Arquivo** | `artifacts/api-server/src/routes/bookings.ts` |
| **Método** | `PUT /creches/:crecheId/bookings/:bookingId` (status → confirmed) |
| **Linha aprox.** | 330–540 |
| **Fluxo** | Booking → Confirmação |
| **Impacto** | Duas requisições concorrentes de confirmação (eg. duplo clique de admin) executam dentro de transações separadas, ambas passando pelo `SELECT` que retorna `status='pending'` antes de qualquer UPDATE. Ambas chegam ao `addCharge` → fatura mensal do tutor recebe o dobro. Os créditos F-05/F-06 também são consumidos duas vezes. |
| **Causa raiz** | A consulta `SELECT existing FROM bookingsTable WHERE id = ?` não usa `.for("update")`. Duas transações podem ler `status='pending'` simultaneamente e prosseguir para a confirmação. |
| **Correção proposta** | Adicionar `.for("update")` no SELECT inicial do booking dentro da transação. Após o lock, verificar novamente `if (existing.status !== 'pending') throw "já confirmado"`. |
| **Risco da correção** | Baixo — o `.for("update")` serializa o acesso ao registro sem mudar comportamento funcional. |
| **Compatibilidade** | Interno. Nenhum endpoint ou payload público muda. |
| **Rollback** | Remover o `.for("update")` e a segunda verificação de status. |
| **Testes necessários** | Duas requisições de confirmação concorrentes para o mesmo booking → apenas uma bem-sucedida; créditos consumidos uma vez; addCharge chamado uma vez. |

---

### F-08 · `financialSync.ts` (webhook Stripe) sem audit log financeiro
| Campo | Valor |
|-------|-------|
| **Severidade** | ALTO |
| **Arquivo** | `artifacts/api-server/src/lib/financialSync.ts` |
| **Método** | `applyFinancialStripeEvent` |
| **Linha aprox.** | 24–80 |
| **Fluxo** | Stripe Webhook → Invoice |
| **Impacto** | Pagamentos via Stripe não geram entrada em `financialAuditLogsTable`. Auditores e administradores não conseguem rastrear quando e como uma fatura foi paga via Stripe. Diferença de observabilidade vs. pagamento manual (que sí loga). |
| **Causa raiz** | `applyFinancialStripeEvent` chama `console.log` mas não `logFinancialAudit`. |
| **Correção proposta** | Adicionar chamada a `logFinancialAudit({ crecheId, userId: null, action: "stripe_payment", referenceId: invoice.id, referenceType: "invoices", details: \`Stripe session: ${event.id}\` }, tx)` dentro da transação existente. |
| **Risco da correção** | Baixo — apenas adiciona registro de auditoria. Não muda lógica. |
| **Compatibilidade** | Totalmente retrocompatível. |
| **Rollback** | Remover a chamada de log. |
| **Testes necessários** | Simular webhook `checkout.session.completed` → verificar entrada em `financialAuditLogsTable` com `action='stripe_payment'`. |

---

### F-09 · `BillingService.addCharge` sem audit log financeiro
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/services/billing.ts` |
| **Método** | `BillingService.addCharge` |
| **Linha aprox.** | 378–395 |
| **Fluxo** | Qualquer cobrança — booking, consumível, POS |
| **Impacto** | Toda cobrança adicionada à fatura do tutor não tem registro de auditoria. Impossível rastrear qual usuário/sistema originou uma cobrança suspeita. |
| **Causa raiz** | `addCharge` não chama `logFinancialAudit`. |
| **Correção proposta** | Adicionar `logFinancialAudit` no final de `addCharge`, passando o `tx` já existente. |
| **Risco da correção** | Baixo. |
| **Compatibilidade** | Totalmente retrocompatível. |
| **Rollback** | Remover a chamada. |
| **Testes necessários** | `addCharge` → verificar entrada em `financialAuditLogsTable` com tipo de charge correto. |

---

### F-10 · Scheduler sem proteção contra execução concorrente
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/lib/scheduler.ts` |
| **Método** | `markOverdueInvoices`, `cancelExpiredOrders`, `suspendOverduePastDueSubscriptions` |
| **Linha aprox.** | 395–420, 640–660, 500–560 |
| **Fluxo** | Scheduler → Invoice / Orders / Subscriptions |
| **Impacto** | Se o servidor reiniciar ou o cron disparar novamente enquanto o job anterior ainda roda (lento por volume), os jobs executam em paralelo. `markOverdueInvoices` pode atualizar as mesmas invoices duas vezes. `cancelExpiredOrders` pode cancelar pedidos já cancelados (inócuo devido ao WHERE, mas gera logs duplicados). |
| **Causa raiz** | Apenas o job de task-reminder tem flag `taskReminderRunning`. Os demais jobs não têm proteção de concorrência. |
| **Correção proposta** | Adicionar flags `let jobRunning = false` equivalentes para cada job crítico, com `try/finally` para garantir reset. |
| **Risco da correção** | Baixo. |
| **Compatibilidade** | Totalmente interna. |
| **Rollback** | Remover as flags. |
| **Testes necessários** | Job forçado a disparar duas vezes simultaneamente → verificar que segunda execução é ignorada. |

---

### F-11 · Receipt cleanup deleta comprovantes de invoices pagas sem verificar status
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/lib/scheduler.ts` |
| **Método** | `deleteOldReceipts` |
| **Linha aprox.** | 584–625 |
| **Fluxo** | Scheduler → Storage → Invoice |
| **Impacto** | Comprovantes de pagamento de invoices pagas são deletados após 90 dias sem distinção de status. Por LGPD isso pode ser intencional, mas conflita com obrigação de guarda de comprovantes fiscais (5 anos no Brasil). |
| **Causa raiz** | Query usa `WHERE receiptPhotoPath IS NOT NULL AND updatedAt <= cutoff` sem filtrar por `status`. Invoices `paid` têm seus comprovantes deletados igual a `voided`. |
| **Correção proposta** | Adicionar `AND status NOT IN ('paid')` ao WHERE, ou configurar o TTL em 1825 dias (5 anos) para invoices pagas. |
| **Risco da correção** | Baixo. |
| **Compatibilidade** | Interna. |
| **Rollback** | Remover o filtro de status. |
| **Testes necessários** | Invoice paga com 91 dias → comprovante NÃO deve ser deletado. Invoice voided com 91 dias → comprovante DEVE ser deletado. |

---

### F-12 · `releasePurchasedCredits` sempre insere nova linha em vez de acumular
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/services/credits.ts` |
| **Método** | `releasePurchasedCredits` |
| **Linha aprox.** | 103–115 |
| **Fluxo** | Pagamento de pacote → Créditos |
| **Impacto** | Se `releasePurchasedCredits` for chamado duas vezes para a mesma invoice (eg. webhook duplicado, retry), duas linhas são criadas em `tutorServiceCreditsTable` para o mesmo item. O tutor recebe créditos dobrados. |
| **Causa raiz** | `INSERT INTO tutorServiceCreditsTable (...)` sem verificação prévia de existência para a mesma `invoiceId`. A proteção `creditsReleased = true` existe em `invoicesTable` (prevenindo double-release), mas se a flag não for persistida atomicamente em todas as situações, a inserção duplicada é possível. |
| **Correção proposta** | Adicionar `ON CONFLICT (invoice_id, catalogue_item_id) DO UPDATE SET total_credits = total_credits + EXCLUDED.total_credits` em vez de INSERT puro, ou adicionar `UNIQUE(invoice_id, catalogue_item_id)` em `tutorServiceCreditsTable`. |
| **Risco da correção** | Baixo — a proteção `creditsReleased` já bloqueia a maioria dos casos; isso é defesa em profundidade. |
| **Compatibilidade** | Interna. |
| **Rollback** | Remover a constraint / lógica de upsert. |
| **Testes necessários** | `releasePurchasedCredits` chamado duas vezes na mesma invoice → créditos totais iguais à compra original (sem dobro). |

---

### F-13 · `cancelOrder` lê créditos sem FOR UPDATE
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/services/orders.ts` |
| **Método** | `cancelOrder` |
| **Linha aprox.** | 289–320 |
| **Fluxo** | Cancelamento de Pedido → Créditos / Estoque |
| **Impacto** | Cancelamento concorrente do mesmo pedido pode restaurar créditos duas vezes se dois processos lerem o mesmo estado antes de qualquer UPDATE. |
| **Causa raiz** | SELECT em `tutorServiceCreditsTable` e `orderItemsTable` dentro de `cancelOrder` sem `.for("update")`. |
| **Correção proposta** | Adicionar `FOR UPDATE` no SELECT do pedido antes de processar o cancelamento, e verificar `order.status !== 'cancelled'` após o lock. |
| **Risco da correção** | Baixo. |
| **Compatibilidade** | Interna. |
| **Rollback** | Remover o FOR UPDATE. |
| **Testes necessários** | Dois cancelamentos concorrentes do mesmo pedido → estoque restaurado uma vez; créditos restaurados uma vez. |

---

### F-14 · Presigned upload sem restrição de Content-Type/tamanho na assinatura
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/lib/objectStorage.ts` |
| **Método** | Geração de URL presigned (PUT) |
| **Linha aprox.** | 278–310 |
| **Fluxo** | Upload → Storage |
| **Impacto** | Cliente pode fazer upload de um executável de 1 GB com uma URL gerada para uma "foto de pet". O servidor não valida MIME nem tamanho no GCS após o upload. |
| **Causa raiz** | A assinatura GCS não inclui `Content-Type` nem `Content-Length` como cabeçalhos condicionais. Qualquer tipo/tamanho é aceito. |
| **Correção proposta** | Incluir `Content-Type` na assinatura (obrigando o cliente a fazer PUT com o tipo correto) e `x-goog-content-length-range` para limitar o tamanho máximo (eg. 10 MB). |
| **Risco da correção** | Baixo — clientes que já enviam o Content-Type correto não são afetados. |
| **Compatibilidade** | Clientes precisam enviar `Content-Type` no header do PUT. |
| **Rollback** | Remover restrições da assinatura. |
| **Testes necessários** | Upload presigned com Content-Type errado → deve ser rejeitado pelo GCS. Upload > 10 MB → deve ser rejeitado. |

---

### F-15 · Arquivo órfão quando upload GCS tem sucesso mas DB write falha
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/routes/storage.ts` |
| **Método** | `POST /storage/uploads/direct` |
| **Linha aprox.** | 58–120 |
| **Fluxo** | Upload → Storage → DB |
| **Impacto** | O arquivo é enviado ao GCS. Se o cliente falhar ao chamar a API subsequente que persiste o `objectPath` no DB, o arquivo fica órfão no bucket. Sem limpeza automática, gera custo e eventual exposição. |
| **Causa raiz** | A arquitetura de upload é two-step intencional (GCS + DB separados), sem transação distribuída. |
| **Correção proposta** | (1) Curto prazo: logar o `objectPath` no nível de WARN quando o upload GCS tem sucesso, facilitando recuperação manual. (2) Médio prazo: job diário que lista arquivos GCS sem referência em DB com mais de 24h e os deleta. (3) Não há opção de tornar GCS+DB atômicos sem sagas. |
| **Risco da correção** | Baixo (log) / Médio (cleanup job) |
| **Compatibilidade** | Totalmente retrocompatível. |
| **Rollback** | Remover o log e/ou o job. |
| **Testes necessários** | Upload GCS bem-sucedido → simular falha no DB → verificar log de WARN com objectPath. |

---

### F-16 · Push subscription — race condition entre SELECT e INSERT
| Campo | Valor |
|-------|-------|
| **Severidade** | BAIXO |
| **Arquivo** | `artifacts/api-server/src/routes/push.ts` |
| **Método** | `POST /creches/:crecheId/push/subscribe` |
| **Linha aprox.** | 34–99 |
| **Fluxo** | Login → Push |
| **Impacto** | Dois POSTs simultâneos com o mesmo endpoint (improváveis, mas possíveis em fluxos de PWA em recarga dupla) podem ambos passar pelo SELECT e ambos inserir, criando duplicatas que causam notificações duplicadas. |
| **Causa raiz** | SELECT + INSERT sem transação atômica ou `ON CONFLICT DO NOTHING/UPDATE`. |
| **Correção proposta** | Usar `INSERT INTO push_subscriptions (...) ON CONFLICT (endpoint) DO UPDATE SET updated_at = NOW()` em vez do SELECT+INSERT manual. |
| **Risco da correção** | Baixo — requer que `endpoint` seja UNIQUE, o que semanticamente é correto. |
| **Compatibilidade** | Interna. |
| **Rollback** | Reverter para SELECT+INSERT. |
| **Testes necessários** | Dois POSTs com mesmo endpoint → apenas 1 linha na tabela. |

---

### F-17 · Seleção de catálogo no checkout por normalização de string frágil
| Campo | Valor |
|-------|-------|
| **Severidade** | ALTO |
| **Arquivo** | `artifacts/api-server/src/routes/bookings.ts` |
| **Método** | Lógica de checkout / complete-service |
| **Linha aprox.** | 408 |
| **Fluxo** | Booking → Checkout → Billing |
| **Impacto** | O código faz match entre `booking.type` e `catalogueItem.name` via `name.toLowerCase().replace(/\s+/g, "_") === existing.type`. Se o administrador renomear um item no catálogo (ex.: "Banho" → "Banho Completo"), todos os bookings existentes daquele tipo falharão em encontrar o preço e usarão `price = 0`. |
| **Causa raiz** | `bookingsTable.type` armazena o nome normalizado em vez do `catalogueItemId`. |
| **Correção proposta** | Curto prazo: adicionar fallback que, ao não encontrar pelo nome normalizado, busca pelo `catalogueItemId` diretamente do booking (se `booking.catalogueItemId` existir). Longo prazo: migrar `bookingsTable` para armazenar `catalogueItemId` em vez de `type` normalizado. |
| **Risco da correção** | Médio — altera schema de longo prazo; curto prazo é seguro. |
| **Compatibilidade** | Nenhum endpoint público muda. |
| **Rollback** | Remover o fallback por ID. |
| **Testes necessários** | Renomear item de catálogo → confirmação de booking existente → preço correto mantido. |

---

### F-18 · `complete-service` bypassa billing e créditos inteiramente
| Campo | Valor |
|-------|-------|
| **Severidade** | ALTO |
| **Arquivo** | `artifacts/api-server/src/routes/bookings.ts` |
| **Método** | `POST /creches/:crecheId/bookings/:bookingId/complete-service` |
| **Linha aprox.** | ~900–960 |
| **Fluxo** | Booking de serviço → Cobrança |
| **Impacto** | Serviços do tipo `SERVICE_BOOKING_TYPES` (banho, consulta, etc.) completados via `complete-service` nunca geram cobrança em `invoicesTable`. O tutor usa o serviço gratuitamente se não tiver crédito de serviço para consumir. |
| **Causa raiz** | A rota `complete-service` só chama `consumeServiceCreditsForBooking` (consume créditos), mas se não houver créditos disponíveis, não chama `BillingService.addCharge` como fallback. |
| **Correção proposta** | Após `consumeServiceCreditsForBooking`, verificar se `daysToBill > 0` (créditos insuficientes). Se sim, chamar `addCharge` com `isAvulso: true` para o valor do serviço. |
| **Risco da correção** | Médio — altera comportamento de serviços sem pacote. Precisa de validação com regras de negócio. |
| **Compatibilidade** | Nenhuma API pública muda. |
| **Rollback** | Remover o `addCharge` do `complete-service`. |
| **Testes necessários** | Booking de serviço sem crédito → `complete-service` → verificar cobrança em `invoicesTable`. |

---

### F-19 · ACL de storage granularidade apenas em nível de creche (tutor vê fotos de outros tutores)
| Campo | Valor |
|-------|-------|
| **Severidade** | BAIXO |
| **Arquivo** | `artifacts/api-server/src/lib/objectAcl.ts` |
| **Método** | `canAccessObjectEntity` (grupo `CRECHE_MEMBER`) |
| **Linha aprox.** | 79 |
| **Fluxo** | Storage → ACL → Tutor |
| **Impacto** | Um tutor da creche A pode acessar fotos de qualquer pet da creche A via path-based ACL ou GCS metadata ACL com grupo `CRECHE_MEMBER`, incluindo fotos de pets de outros tutores. Impacto de privacidade, não de integridade financeira. |
| **Causa raiz** | O grupo `CRECHE_MEMBER` valida apenas que o usuário pertence à creche, sem validar se o pet pertence ao tutor. |
| **Correção proposta** | Para arquivos com `entity_type = 'pet'`, adicionar verificação adicional que o `tutorId` do pet === `userId` do requisitante quando o role for `'tutor'`. |
| **Risco da correção** | Médio — requer JOIN em `petsTable` na lógica de ACL. |
| **Compatibilidade** | Tutores que já acessam fotos de outros pets (cenário improvável mas possível) passariam a receber 403. |
| **Rollback** | Remover a verificação de tutorId. |
| **Testes necessários** | Tutor A tenta acessar foto do pet do tutor B na mesma creche → deve receber 403. |

---

### F-20 · `financialSync.ts` — silent early return sem log de WARN em casos de metadados ausentes
| Campo | Valor |
|-------|-------|
| **Severidade** | MÉDIO |
| **Arquivo** | `artifacts/api-server/src/lib/financialSync.ts` |
| **Método** | `applyFinancialStripeEvent` |
| **Linha aprox.** | 24–40 |
| **Fluxo** | Stripe Webhook → Invoice |
| **Impacto** | Webhook Stripe com `metadata.invoiceId` ausente (eg. sessão criada fora da plataforma, ou bug de integração) retorna sem erro e sem log de WARN. O operador não sabe que um pagamento não foi reconhecido. |
| **Causa raiz** | `if (!invoiceIdStr) return;` sem logging. |
| **Correção proposta** | Trocar `return` silencioso por `console.warn("[financialSync] webhook sem invoiceId — session:", event.id)`. |
| **Risco da correção** | Zero. |
| **Compatibilidade** | Totalmente retrocompatível. |
| **Rollback** | Remover o log. |
| **Testes necessários** | Enviar webhook sem metadata → verificar log de WARN no servidor. |

---

### F-21 · `hasOverdueInvoices` não-transacional antes da inserção POS
| Campo | Valor |
|-------|-------|
| **Severidade** | BAIXO |
| **Arquivo** | `artifacts/api-server/src/routes/financial.ts` |
| **Método** | Verificação de inadimplência antes do POS |
| **Linha aprox.** | ~870 |
| **Fluxo** | POS → Validação de crédito |
| **Impacto** | Entre o `hasOverdueInvoices` (read) e o `INSERT invoice` (write) dentro da transação, o status do tutor pode mudar. Tutor inadimplente pode passar na verificação e ter nova venda registrada. Impacto operacional baixo pois a venda avulsa é independente de crédito. |
| **Causa raiz** | Verificação de inadimplência fora da transação principal de inserção. |
| **Correção proposta** | Mover a verificação de inadimplência para dentro da transação POS ou aceitar o TOCTOU como risco gerenciável dado o baixo impacto. |
| **Risco da correção** | Baixo. |
| **Compatibilidade** | Interna. |
| **Rollback** | Mover verificação de volta para fora. |
| **Testes necessários** | Invoice de tutor marcada como overdue durante a venda POS → venda é bloqueada. |

---

## PARTE II — INVENTÁRIO DE FLUXOS SEM ACHADOS CRÍTICOS

| Fluxo | Status | Observação |
|-------|--------|------------|
| `processManualPayment` | ✅ OK | FOR UPDATE + status check + audit log presentes |
| `approveReceipt` | ✅ OK | FOR UPDATE + estado terminal validado + audit log |
| `voidInvoice` | ✅ OK | FOR UPDATE + estado terminal + audit log |
| `refundInvoice` | ✅ OK | FOR UPDATE + restrição `status='paid'` + audit log |
| `applyFinancialStripeEvent` | ⚠️ Falta audit log (F-08) | Idempotência: OK (FOR UPDATE + status check) |
| Webhook Stripe (idempotência) | ✅ OK | `last_stripe_event_at` CAS presente |
| `restoreBookingPackageCredits` | ✅ OK | GREATEST(0,...) proteção underflow presente |
| `restoreBookingServiceCredits` | ✅ OK | GREATEST(0,...) proteção underflow presente |
| `cancelBooking` — créditos | ✅ OK | Ambas as restorações chamadas corretamente |
| `cancelBooking` — void invoice | ✅ OK | `status='voided'` aplicado em invoices pending |
| `createOrder` stock lock | ✅ OK | FOR UPDATE em `catalogueItemsTable` em ordem determinística |
| Stock negativo via PUT catálogo | ✅ FIXADO | `stockQuantity` removido do schema Zod de PUT (Phase 13) |
| Stock negativo via adjustment | ✅ OK | `GREATEST(0, ...)` protege via SQL |
| Invoice overdue marker (races) | ✅ Baixo risco | Query filtra `status IN ('pending','overdue')` — `paid` nunca marcado overdue |
| Push 410/404 handling | ✅ OK | Limpa subscription ao receber 410/404 |
| Push host-based cleanup | ✅ FIXADO | Implementado em Phase 13 |
| GET bookings `data` vs `items` | ✅ FIXADO | Ambas chaves retornadas (Phase 13) |
| Checkout double-charge | ✅ FIXADO | Base price removida do checkout (Phase 13) |

---

## PARTE III — PLANO DE CORREÇÃO PRIORIZADO

### Critérios de Priorização
1. **Risco financeiro** — perda ou duplicação de dinheiro real
2. **Frequência** — quanto mais comum o fluxo, maior a urgência
3. **Independência** — menor dependência de outros fixes primeiro
4. **Facilidade de rollback** — mudanças reversíveis primeiro

---

### FASE 14-A — CRÍTICOS (implementar juntos, mesma sessão)

| Prioridade | ID | Título | Arquivos |
|------------|----|--------|----------|
| 1 | F-07 | FOR UPDATE no SELECT de booking antes de confirmar | `routes/bookings.ts` |
| 2 | F-05 | Idempotência em `consumePackageCredits` | `services/credits.ts` |
| 3 | F-06 | Idempotência em `consumeServiceCreditsForBooking` | `services/credits.ts` |
| 4 | F-03 | Bloquear reabrir invoice paga/void em `addCharge` | `services/billing.ts` |
| 5 | F-02 | Idempotência no POS sale (idempotencyKey) | `routes/financial.ts` |

**Dependências:** F-07 deve ser feito primeiro (torna F-05/F-06 menos urgentes, mas não os elimina). F-03 é independente dos demais.

---

### FASE 14-B — ALTOS (segunda sessão)

| Prioridade | ID | Título | Arquivos |
|------------|----|--------|----------|
| 6 | F-08 | Audit log no Stripe webhook | `lib/financialSync.ts` |
| 7 | F-01 | Criar ordersTable record no POS | `routes/financial.ts`, `services/orders.ts` |
| 8 | F-17 | Fallback por catalogueItemId no checkout | `routes/bookings.ts` |
| 9 | F-18 | `complete-service` sem cobrança fallback | `routes/bookings.ts` |
| 10 | F-04 | Validar UPDATE rows em `addCharge` com `existingInvoiceId` | `services/billing.ts` |
| 11 | F-13 | FOR UPDATE em `cancelOrder` | `services/orders.ts` |

---

### FASE 14-C — MÉDIOS / OBSERVABILIDADE

| Prioridade | ID | Título | Arquivos |
|------------|----|--------|----------|
| 12 | F-09 | Audit log em `addCharge` | `services/billing.ts` |
| 13 | F-12 | `releasePurchasedCredits` — upsert em vez de insert | `services/credits.ts` |
| 14 | F-10 | Flags de concorrência nos jobs do scheduler | `lib/scheduler.ts` |
| 15 | F-11 | Filtrar status `paid` no receipt cleanup | `lib/scheduler.ts` |
| 16 | F-20 | WARN log em Stripe sem metadata | `lib/financialSync.ts` |
| 17 | F-15 | Log WARN de orphan file + job de cleanup | `routes/storage.ts` |
| 18 | F-14 | Content-Type + size bound na URL presigned | `lib/objectStorage.ts` |

---

### FASE 14-D — BAIXOS / BACKLOG

| Prioridade | ID | Título | Arquivos |
|------------|----|--------|----------|
| 19 | F-16 | `ON CONFLICT` na subscription de push | `routes/push.ts` |
| 20 | F-19 | ACL por tutor-pet (privacidade) | `lib/objectAcl.ts` |
| 21 | F-21 | `hasOverdueInvoices` dentro da transação POS | `routes/financial.ts` |

---

## PARTE IV — CASOS DE TESTE CONSOLIDADOS

```
[ ] F-02: POST POS com mesmo idempotencyKey × 2 → 200 + mesmo invoiceId (sem duplicata)
[ ] F-03: addCharge em invoice paga → nova invoice criada, paga não modificada
[ ] F-04: addCharge com existingInvoiceId=999 → erro 500, nenhum invoiceItem inserido
[ ] F-05: confirmBooking × 2 concorrente → créditos debitados 1 vez, addCharge chamado 1 vez
[ ] F-06: mesmo acima para service credits
[ ] F-07: PUT booking status=confirmed × 2 simultâneo → 1 sucesso, 1 "já confirmado"
[ ] F-08: webhook Stripe pago → entrada em financialAuditLogsTable com action='stripe_payment'
[ ] F-09: addCharge → entrada em financialAuditLogsTable com tipo correto
[ ] F-11: invoice paga com updatedAt = 91 dias atrás → receiptPhotoPath NÃO deletado
[ ] F-12: releasePurchasedCredits × 2 mesma invoice → créditos = quantidade original (não dobrada)
[ ] F-13: cancelOrder × 2 simultâneo → estoque e créditos restaurados 1 vez
[ ] F-14: upload presigned com Content-Type errado → 400/403 do GCS
[ ] F-17: renomear item catálogo → confirmação de booking existente → preço mantido via ID
[ ] F-18: complete-service sem crédito → addCharge chamado com valor do serviço
[ ] F-19: tutor A GET foto pet tutor B (mesma creche) → 403
[ ] F-20: webhook Stripe sem metadata.invoiceId → log WARN no servidor
```

---

## SUMÁRIO EXECUTIVO

| Severidade | Quantidade | Status |
|------------|------------|--------|
| CRÍTICO | 4 | 🔴 Aguardando Fase 14-A |
| ALTO | 7 | 🟠 Aguardando Fase 14-B |
| MÉDIO | 7 | 🟡 Aguardando Fase 14-C |
| BAIXO | 3 | 🟢 Backlog Fase 14-D |
| **Total** | **21** | |

**Já corrigidos nas fases anteriores (13):** double-charge no checkout, stock negativo via PUT catálogo, stock-transactions missing-table, push stale cleanup, bookings data/items alias, medical parent validation.

**Risco principal ativo:** A combinação de F-07 + F-05 + F-06 significa que um duplo clique de admin em "Confirmar reserva" pode gerar cobrança duplicada e consumo duplo de créditos de pacote. Este é o único cenário atualmente reproduzível sem ferramentas especiais e com impacto financeiro direto real.
