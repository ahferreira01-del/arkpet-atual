/**
 * Exceções financeiras tipadas (Fase 15A).
 * Todas as operações do domínio financeiro lançam estas exceções
 * em vez de `new Error()` genérico.
 */

export class InvoiceNotFound extends Error {
  readonly status = 404;
  constructor(id?: number) {
    super(id ? `Fatura #${id} não encontrada` : "Fatura não encontrada");
    this.name = "InvoiceNotFound";
  }
}

export class InvalidInvoiceState extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidInvoiceState";
  }
}

export class CreditUnavailable extends Error {
  readonly status = 422;
  constructor(message = "Créditos insuficientes") {
    super(message);
    this.name = "CreditUnavailable";
  }
}

export class DuplicatePayment extends Error {
  readonly status = 409;
  constructor(invoiceId?: number) {
    super(
      invoiceId
        ? `Pagamento duplicado: fatura #${invoiceId} já está paga`
        : "Pagamento duplicado"
    );
    this.name = "DuplicatePayment";
  }
}

export class PaymentAlreadyProcessed extends Error {
  readonly status = 409;
  constructor(invoiceId?: number) {
    super(
      invoiceId
        ? `Fatura #${invoiceId} já foi processada`
        : "Pagamento já processado"
    );
    this.name = "PaymentAlreadyProcessed";
  }
}

export class InvalidTransition extends Error {
  readonly status = 400;
  constructor(from: string, to: string) {
    super(`Transição de status inválida: "${from}" → "${to}"`);
    this.name = "InvalidTransition";
  }
}

export class CatalogueItemUnavailable extends Error {
  readonly status = 422;
  constructor(name?: string) {
    super(
      name
        ? `Item de catálogo "${name}" indisponível ou inativo`
        : "Item de catálogo indisponível"
    );
    this.name = "CatalogueItemUnavailable";
  }
}

export class WalletUnavailable extends Error {
  readonly status = 422;
  constructor(message = "Carteira de créditos indisponível") {
    super(message);
    this.name = "WalletUnavailable";
  }
}

export class ItemNotFound extends Error {
  readonly status = 404;
  constructor(entity = "Item") {
    super(`${entity} não encontrado`);
    this.name = "ItemNotFound";
  }
}

/**
 * Extrai o status HTTP de qualquer erro lançado no domínio financeiro.
 * Rotas usam isto para responder com o código correto.
 */
export function getErrorStatus(err: unknown): number {
  if (err && typeof err === "object" && "status" in err) {
    const s = Number((err as any).status);
    if (s >= 400 && s < 600) return s;
  }
  return 500;
}
