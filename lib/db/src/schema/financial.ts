import { pgTable, serial, integer, numeric, varchar, timestamp, date, boolean, pgEnum, text, check, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { crechesTable } from "./creches";
import { usersTable } from "./users";
import { bookingsTable } from "./bookings";

// Enums
export const invoiceStatusEnum = pgEnum("invoice_status", ["pending", "awaiting_confirmation", "paid", "overdue", "voided", "refunded"]);
export const transactionTypeEnum = pgEnum("transaction_type", ["income", "expense"]);
export const paymentMethodEnum = pgEnum("payment_method", ["stripe", "pix", "cash", "credit_card", "bank_slip", "credits"]);
export const itemTypeEnum = pgEnum("item_type", ["service", "product", "package", "day_use"]);
export const auditActionEnum = pgEnum("audit_action", [
  "invoice_create", 
  "invoice_void", 
  "invoice_refund", 
  "payment_receipt_upload", 
  "payment_approve", 
  "manual_payment_register", 
  "stock_adjustment", 
  "credits_purchase", 
  "credits_deduct",
  "sensitive_data_read", // Log de leitura para LGPD
  "tutor_anonymize"      // Log de deleção/anonimização para LGPD
]);

// 1. Catálogo de Serviços e Produtos (Preços e Estoque)
export const catalogueItemsTable = pgTable("catalogue_items", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: itemTypeEnum("type").notNull(), // 'service' ou 'product'
  basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
  
  // Preços dinâmicos baseados no porte do pet (aplicável a serviços)
  priceSmall: numeric("price_small", { precision: 10, scale: 2 }),
  priceMedium: numeric("price_medium", { precision: 10, scale: 2 }),
  priceLarge: numeric("price_large", { precision: 10, scale: 2 }),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
  
  // Controle de Estoque (aplicável a produtos)
  stockQuantity: integer("stock_quantity").default(0).notNull(),
  minStockAlert: integer("min_stock_alert").default(5).notNull(),
  trackStock: boolean("track_stock").default(false).notNull(),
  
  creditsAmount: integer("credits_amount"),
  maxPetsPerDay: integer("max_pets_per_day").default(1).notNull(),
  
  description: text("description"),
  category: varchar("category", { length: 100 }),
  sku: varchar("sku", { length: 50 }),
  barcode: varchar("barcode", { length: 255 }),
  mediaUrls: jsonb("media_urls").default('[]'),
  
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  barcodeIdx: uniqueIndex("barcode_creche_idx").on(table.crecheId, table.barcode),
}));

export const catalogueItemsRelations = relations(catalogueItemsTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [catalogueItemsTable.crecheId],
    references: [crechesTable.id],
  }),
}));

// 2. Consumo de Adicionais e Produtos nas Reservas
export const bookingConsumablesTable = pgTable("booking_consumables", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  itemId: integer("item_id").notNull(), // Referência a catalogueItemsTable
  quantity: integer("quantity").default(1).notNull(),
  chargedPrice: numeric("charged_price", { precision: 10, scale: 2 }).notNull(), // Preço capturado no momento do consumo
  addedBy: integer("added_by").notNull(), // Referência a usersTable (Staff)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bookingConsumablesRelations = relations(bookingConsumablesTable, ({ one }) => ({
  booking: one(bookingsTable, {
    fields: [bookingConsumablesTable.bookingId],
    references: [bookingsTable.id],
  }),
  item: one(catalogueItemsTable, {
    fields: [bookingConsumablesTable.itemId],
    references: [catalogueItemsTable.id],
  }),
  addedByUser: one(usersTable, {
    fields: [bookingConsumablesTable.addedBy],
    references: [usersTable.id],
  }),
}));

// 2b. Serviços Adicionais Planejados da Reserva (booking_services)
// Distinto de booking_consumables (operacional, adicionado pelo staff durante a estadia).
// Estes são escolhidos pelo tutor no momento da criação, processados na confirmação.
export const bookingServiceStatusEnum = pgEnum("booking_service_status", [
  "pending", "confirmed", "cancelled",
]);

export const bookingServicesTable = pgTable("booking_services", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  catalogueItemId: integer("catalogue_item_id").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  status: bookingServiceStatusEnum("status").default("pending").notNull(),
  // Rastreamento financeiro por add-on (idempotência + cancelamento por item)
  consumedCredit: boolean("consumed_credit").default(false).notNull(),
  // ID exato do tutor_service_credits consumido — necessário para restauração precisa
  tutorServiceCreditId: integer("tutor_service_credit_id"),
  charged: boolean("charged").default(false).notNull(),
  invoiceItemId: integer("invoice_item_id"),            // FK para invoice_items quando faturado
  capturedPrice: numeric("captured_price", { precision: 10, scale: 2 }), // preço capturado na criação
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("booking_services_booking_idx").on(t.bookingId),
  index("booking_services_catalogue_idx").on(t.catalogueItemId),
]);

export const bookingServicesRelations = relations(bookingServicesTable, ({ one }) => ({
  booking: one(bookingsTable, {
    fields: [bookingServicesTable.bookingId],
    references: [bookingsTable.id],
  }),
  item: one(catalogueItemsTable, {
    fields: [bookingServicesTable.catalogueItemId],
    references: [catalogueItemsTable.id],
  }),
}));

// 3. Pacotes de Créditos dos Tutores (Mensalidades / Diárias Pré-pagas)
export const tutorCreditsTable = pgTable("tutor_credits", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  tutorId: integer("tutor_id").notNull(), // Referência ao tutor (usersTable)
  totalCredits: integer("total_credits").notNull(), // Total comprado
  usedCredits: integer("used_credits").default(0).notNull(), // Consumido
  maxPetsPerDay: integer("max_pets_per_day").default(1).notNull(),
  expirationDate: date("expiration_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  checkUsedCreditsZero: check("check_used_credits_zero", sql`${table.usedCredits} >= 0`),
  checkUsedCreditsMax: check("check_used_credits_max", sql`${table.usedCredits} <= ${table.totalCredits}`)
}));

export const tutorCreditsRelations = relations(tutorCreditsTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [tutorCreditsTable.crecheId],
    references: [crechesTable.id],
  }),
  tutor: one(usersTable, {
    fields: [tutorCreditsTable.tutorId],
    references: [usersTable.id],
  }),
}));

// 3.5. Carteira de Serviços Avulsos (Service Wallet)
export const tutorServiceCreditsTable = pgTable("tutor_service_credits", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  tutorId: integer("tutor_id").notNull(),
  catalogueItemId: integer("catalogue_item_id").notNull(),
  totalCredits: integer("total_credits").notNull(),
  usedCredits: integer("used_credits").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  checkUsedServiceCreditsZero: check("check_used_service_credits_zero", sql`${table.usedCredits} >= 0`),
  checkUsedServiceCreditsMax: check("check_used_service_credits_max", sql`${table.usedCredits} <= ${table.totalCredits}`)
}));

export const tutorServiceCreditsRelations = relations(tutorServiceCreditsTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [tutorServiceCreditsTable.crecheId],
    references: [crechesTable.id],
  }),
  tutor: one(usersTable, {
    fields: [tutorServiceCreditsTable.tutorId],
    references: [usersTable.id],
  }),
  item: one(catalogueItemsTable, {
    fields: [tutorServiceCreditsTable.catalogueItemId],
    references: [catalogueItemsTable.id],
  }),
}));

// Tabela de ligação: rastreia de qual pacote a reserva consumiu o crédito
export const bookingCreditsTable = pgTable("booking_credits", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(), // não colocamos fk direta p/ bookings pra evitar ciclo ou adicionamos? 
  tutorCreditId: integer("tutor_credit_id").notNull().references(() => tutorCreditsTable.id),
  creditsConsumed: integer("credits_consumed").notNull(),
  consumedDate: date("consumed_date"), // Rastreia para qual dia a diária/carona foi consumida
  createdAt: timestamp("created_at").defaultNow().notNull(),
  restoredAt: timestamp("restored_at"), // Quando a reserva foi cancelada e os créditos estornados
});

export const bookingCreditsRelations = relations(bookingCreditsTable, ({ one }) => ({
  tutorCredit: one(tutorCreditsTable, {
    fields: [bookingCreditsTable.tutorCreditId],
    references: [tutorCreditsTable.id],
  }),
}));

// 3.7. Rastreamento de créditos de SERVIÇO consumidos por reserva (Fase 5 — migração aditiva)
// Permite a restauração correta ao cancelar uma reserva.
export const bookingServiceCreditsTable = pgTable("booking_service_credits", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  tutorServiceCreditId: integer("tutor_service_credit_id").notNull().references(() => tutorServiceCreditsTable.id),
  creditsConsumed: integer("credits_consumed").notNull(),
  restoredAt: timestamp("restored_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bookingServiceCreditsRelations = relations(bookingServiceCreditsTable, ({ one }) => ({
  tutorServiceCredit: one(tutorServiceCreditsTable, {
    fields: [bookingServiceCreditsTable.tutorServiceCreditId],
    references: [tutorServiceCreditsTable.id],
  }),
}));

// 4. Cabeçalho de Faturas (Contas a Receber)
export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  tutorId: integer("tutor_id"),
  bookingId: integer("booking_id"), // Pode ser nulo se for fatura avulsa ou venda direta
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 10, scale: 2 }).default("0.00"),
  dueDate: date("due_date").notNull(),
  status: invoiceStatusEnum("status").default("pending").notNull(),
  creditsReleased: boolean("credits_released").default(false).notNull(),
  paymentMethod: paymentMethodEnum("payment_method"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  receiptPhotoPath: text("receipt_photo_path"), // Caminho privado no storage ou data URI base64 (sem limite de tamanho)
  cycleStart: date("cycle_start"),
  cycleEnd: date("cycle_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tutor_cycle_unique_idx").on(t.tutorId, t.cycleStart, t.cycleEnd)
]);

export const invoicesRelations = relations(invoicesTable, ({ one, many }) => ({
  creche: one(crechesTable, {
    fields: [invoicesTable.crecheId],
    references: [crechesTable.id],
  }),
  tutor: one(usersTable, {
    fields: [invoicesTable.tutorId],
    references: [usersTable.id],
  }),
  booking: one(bookingsTable, {
    fields: [invoicesTable.bookingId],
    references: [bookingsTable.id],
  }),
  items: many(invoiceItemsTable),
}));

// 5. Detalhes dos Itens da Fatura (Itemização)
// Fase 14: snapshot histórico — tudo necessário para reconstruir a compra sem consultar Catalogue
export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  description: varchar("description", { length: 255 }).notNull(), // Ex: "Diária Daycare", "Banho Porte G", "Ração BarkBox"
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  itemDate: timestamp("item_date"),
  petId: integer("pet_id"),
  bookingId: integer("booking_id"),
  orderId: integer("order_id"),
  itemType: varchar("item_type", { length: 50 }),
  // ─── Fase 14: Snapshot histórico ───────────────────────────────────────────
  catalogueItemId: integer("catalogue_item_id"),          // FK para catalogueItemsTable (nullable por compatibilidade)
  snapshotName: varchar("snapshot_name", { length: 255 }), // Nome capturado no momento da compra
  snapshotPrice: numeric("snapshot_price", { precision: 10, scale: 2 }), // Preço unitário no momento da compra
  creditsAmount: integer("credits_amount"),               // Qtd de créditos que este item concede (packages/services)
  snapshotMaxPets: integer("snapshot_max_pets"),          // maxPetsPerDay capturado (para packages multi-pet)
  snapshotExpirationDays: integer("snapshot_expiration_days"), // Dias até expirar (padrão 365)
  refundedQuantity: integer("refunded_quantity").default(0).notNull(), // Qtd já estornada do item
  // ─── R37.B: Snapshot Comercial Aditivo do Tutor ───────────────────────────
  baseUnitPrice: numeric("base_unit_price", { precision: 10, scale: 2 }),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }),
  finalPrice: numeric("final_price", { precision: 10, scale: 2 }),
  pricingSourceType: varchar("pricing_source_type", { length: 50 }),
  appliedConditionId: integer("applied_condition_id"),
  conditionSnapshot: jsonb("condition_snapshot"),
  // ─── R37.C2B: Snapshot Comercial Promocional de Campanha ─────────────────
  appliedCampaignId: integer("applied_campaign_id"),
  appliedCampaignRedemptionId: integer("applied_campaign_redemption_id"),
  appliedCampaignRedemptionItemId: integer("applied_campaign_redemption_item_id"),
  campaignSnapshot: jsonb("campaign_snapshot"),
}, (table) => ({
  campaignRedemptionItemUniqueIdx: uniqueIndex("invoice_items_campaign_redemption_item_unique_idx")
    .on(table.appliedCampaignRedemptionItemId)
    .where(sql`${table.appliedCampaignRedemptionItemId} IS NOT NULL`),
}));

export const invoiceItemsRelations = relations(invoiceItemsTable, ({ one }) => ({
  invoice: one(invoicesTable, {
    fields: [invoiceItemsTable.invoiceId],
    references: [invoicesTable.id],
  }),
}));

// 6. Contas a Pagar (Despesas da Creche)
export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(), // Ex: 'aluguel', 'salário', 'limpeza'
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  isPaid: boolean("is_paid").default(false).notNull(),
  supplier: varchar("supplier", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const expensesRelations = relations(expensesTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [expensesTable.crecheId],
    references: [crechesTable.id],
  }),
}));

// 7. Fluxo de Caixa (Transações Consolidadas)
export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  invoiceId: integer("invoice_id"),
  expenseId: integer("expense_id"),
  type: transactionTypeEnum("type").notNull(), // 'income' ou 'expense'
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  transactionDate: date("transaction_date").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const transactionsRelations = relations(transactionsTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [transactionsTable.crecheId],
    references: [crechesTable.id],
  }),
  invoice: one(invoicesTable, {
    fields: [transactionsTable.invoiceId],
    references: [invoicesTable.id],
  }),
  expense: one(expensesTable, {
    fields: [transactionsTable.expenseId],
    references: [expensesTable.id],
  }),
}));

// 8. Registro de Auditoria Financeira
export const financialAuditLogsTable = pgTable("financial_audit_logs", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  userId: integer("user_id").notNull(), // Quem executou a ação
  action: auditActionEnum("action").notNull(),
  referenceId: integer("reference_id").notNull(), // ID do recurso alterado
  referenceType: varchar("reference_type", { length: 100 }).notNull(), // Ex: 'invoices', 'expenses', 'catalogue_items'
  details: text("details").notNull(), // Histórico textual
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const financialAuditLogsRelations = relations(financialAuditLogsTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [financialAuditLogsTable.crecheId],
    references: [crechesTable.id],
  }),
  user: one(usersTable, {
    fields: [financialAuditLogsTable.userId],
    references: [usersTable.id],
  }),
}));

// --- E-Commerce & Pet Shop (Logistics & Orders) ---

export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment", 
  "paid", 
  "preparing", 
  "ready_for_pickup", 
  "delivering", 
  "delivered", 
  "cancelled"
]);

export const deliveryMethodEnum = pgEnum("delivery_method", ["pickup", "delivery"]);

export const stockTransactionTypeEnum = pgEnum("stock_transaction_type", ["in", "out", "adjustment"]);

export const catalogueStockTransactionsTable = pgTable("catalogue_stock_transactions", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  crecheId: integer("creche_id").notNull(),
  type: stockTransactionTypeEnum("type").notNull(),
  quantity: integer("quantity").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  userId: integer("user_id"), // Admin/Staff who made the change
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  tutorId: integer("tutor_id").notNull(),
  invoiceId: integer("invoice_id"), // Link to financial invoice
  status: orderStatusEnum("status").default("pending_payment").notNull(),
  deliveryMethod: deliveryMethodEnum("delivery_method").notNull(),
  deliveryAddress: text("delivery_address"), // Full address string
  deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 }).default("0").notNull(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  catalogueItemId: integer("catalogue_item_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
});

export const ecomRelations = relations(ordersTable, ({ one, many }) => ({
  creche: one(crechesTable, { fields: [ordersTable.crecheId], references: [crechesTable.id] }),
  tutor: one(usersTable, { fields: [ordersTable.tutorId], references: [usersTable.id] }),
  invoice: one(invoicesTable, { fields: [ordersTable.invoiceId], references: [invoicesTable.id] }),
  items: many(orderItemsTable),
}));

export const orderItemsRelations = relations(orderItemsTable, ({ one }) => ({
  order: one(ordersTable, { fields: [orderItemsTable.orderId], references: [ordersTable.id] }),
  item: one(catalogueItemsTable, { fields: [orderItemsTable.catalogueItemId], references: [catalogueItemsTable.id] }),
}));

export const stockTransactionsRelations = relations(catalogueStockTransactionsTable, ({ one }) => ({
  item: one(catalogueItemsTable, { fields: [catalogueStockTransactionsTable.itemId], references: [catalogueItemsTable.id] }),
  creche: one(crechesTable, { fields: [catalogueStockTransactionsTable.crecheId], references: [crechesTable.id] }),
  user: one(usersTable, { fields: [catalogueStockTransactionsTable.userId], references: [usersTable.id] }),
}));

// ─── Financial Outbox (Phase 15B) ────────────────────────────────────────────
// Stores domain events for async consumers. Events are inserted inside the same
// transaction as the main DB write (atomicity guarantee). A background worker
// processes pending events and marks them processed/failed.

export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "processed", "failed"]);

export const financialOutboxTable = pgTable("financial_outbox", {
  id: serial("id").primaryKey(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  payload: jsonb("payload").notNull(),
  status: outboxStatusEnum("status").default("pending").notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── POS Sale Operations (Phase R20F) ─────────────────────────────────────────
// Stores idempotency metadata for POS counter sales. Guaranteed unique per tenant.
export const posSaleOperationsTable = pgTable("pos_sale_operations", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  operationId: varchar("operation_id", { length: 64 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  invoiceId: integer("invoice_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  crecheOpIdx: uniqueIndex("pos_sale_operations_creche_op_idx").on(table.crecheId, table.operationId),
}));

// ─── Store Order Operations (Phase R24F) ──────────────────────────────────────
// Stores idempotency metadata for Tutor Store checkout orders. Guaranteed unique per tenant.
export const storeOrderOperationsTable = pgTable("store_order_operations", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  operationId: varchar("operation_id", { length: 64 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  orderId: integer("order_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  crecheOpIdx: uniqueIndex("store_order_operations_creche_op_idx").on(table.crecheId, table.operationId),
}));

