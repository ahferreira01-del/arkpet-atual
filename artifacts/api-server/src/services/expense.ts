/**
 * ExpenseService (Fase 15A) — lógica de baixa de despesas.
 */

import { db } from "@workspace/db";
import { ExpenseRepository } from "../repositories/expense.repository.js";
import { TransactionRepository } from "../repositories/transaction.repository.js";
import { logFinancialAudit } from "./audit.js";

export class ExpenseService {
  /**
   * Marks an expense as paid, creates the corresponding transaction,
   * and writes an audit log — all inside a single DB transaction.
   */
  static async pay(
    id: number,
    crecheId: number,
    userId: number,
    paymentMethod: string = "cash"
  ) {
    return db.transaction(async (tx) => {
      const expense = await ExpenseRepository.markPaid(id, crecheId, tx);
      if (!expense) return null; // already paid or not found — idempotent

      const transaction = await TransactionRepository.create(
        {
          crecheId,
          type: "expense",
          amount: expense.amount,
          description: `Pagamento Despesa: ${expense.description}`,
          expenseId: expense.id,
          paymentMethod: paymentMethod as any,
          transactionDate: new Date().toISOString().split("T")[0],
        },
        tx
      );

      await logFinancialAudit(
        {
          crecheId,
          userId,
          action: "manual_payment_register",
          referenceId: expense.id,
          referenceType: "expenses",
          details: `Baixa de despesa via transação #${transaction.id}`,
        },
        tx
      );

      return expense;
    });
  }
}
