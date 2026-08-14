const fs = require('fs');
const file = 'artifacts/api-server/src/lib/scheduler.ts';
let content = fs.readFileSync(file, 'utf8');

const oldFuncStr = content.substring(content.indexOf('async function sendInvoiceReminders() {'), content.indexOf('async function applyScheduledPlanChanges() {'));

const newFuncStr = `async function sendInvoiceReminders() {
  try {
    const pendingInvoices = await db
      .select({
        invoiceId: invoicesTable.id,
        dueDate: invoicesTable.dueDate,
        amount: invoicesTable.amount,
        status: invoicesTable.status,
        tutorId: usersTable.id,
        tutorName: usersTable.name,
        crecheId: usersTable.crecheId,
      })
      .from(invoicesTable)
      .innerJoin(usersTable, eq(invoicesTable.tutorId, usersTable.id))
      .where(
        and(
          eq(usersTable.role, "tutor"),
          eq(usersTable.isActive, true),
          or(eq(invoicesTable.status, "pending"), eq(invoicesTable.status, "overdue"))
        )
      );

    if (!pendingInvoices.length) return;

    for (const invoice of pendingInvoices) {
      if (!invoice.dueDate || !invoice.crecheId) continue;

      const dueDateObj = new Date(\`\${invoice.dueDate}T00:00:00\`);
      const todayDateObj = new Date(\`\${getBrazilDateStr()}T00:00:00\`);
      const diffTime = dueDateObj.getTime() - todayDateObj.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      let notifyType: "5_days" | "3_days" | "today" | "overdue" | null = null;
      if (invoice.status === "pending") {
        if (diffDays <= 5 && diffDays > 3) notifyType = "5_days";
        else if (diffDays <= 3 && diffDays > 0) notifyType = "3_days";
        else if (diffDays === 0) notifyType = "today";
      } else if (invoice.status === "overdue") {
        if (diffDays < 0) notifyType = "overdue";
      }

      if (!notifyType) continue;

      // Idempotência
      const [alreadySent] = await db.select({ id: financialOutboxTable.id })
        .from(financialOutboxTable)
        .where(
          sql\`event_type = 'invoice_reminder' AND payload->>'invoiceId' = \${invoice.invoiceId.toString()} AND payload->>'type' = \${notifyType}\`
        );

      if (alreadySent) continue;

      const [y, m, d] = invoice.dueDate.split("-");
      const dueDateStr = \`\${d}/\${m}/\${y}\`;

      let tutorTitle = "💸 Lembrete de Fatura";
      let tutorBody = "";

      const fmtAmt = (Number(invoice.amount) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      if (notifyType === "5_days") {
        tutorBody = \`Sua fatura de \${fmtAmt} vence em breve (\${dueDateStr}).\`;
      } else if (notifyType === "3_days") {
        tutorBody = \`Sua fatura de \${fmtAmt} vence em \${diffDays} dias (\${dueDateStr}).\`;
      } else if (notifyType === "today") {
        tutorTitle = "⚠️ Sua fatura vence hoje";
        tutorBody = \`Sua fatura de \${fmtAmt} vence hoje (\${dueDateStr}).\`;
      } else if (notifyType === "overdue") {
        tutorTitle = "⚠️ Fatura atrasada";
        tutorBody = \`Sua fatura de \${fmtAmt} (\${dueDateStr}) está vencida. Verifique o financeiro.\`;
      }

      await sendPushToUser(invoice.tutorId, {
        title: tutorTitle,
        body: tutorBody,
        tag: \`invoice-remind-\${invoice.invoiceId}-\${notifyType}\`,
        data: { type: "invoice_reminder", invoiceId: invoice.invoiceId },
      });

      await db.insert(financialOutboxTable).values({
        eventType: 'invoice_reminder',
        payload: { invoiceId: invoice.invoiceId, type: notifyType },
        status: 'processed',
        processedAt: new Date()
      });
    }
  } catch (err) {
    console.error("[scheduler] erro ao processar lembretes de faturas:", err);
  }
}

  // ─── Scheduled plan changes `;

content = content.replace(oldFuncStr, newFuncStr);
fs.writeFileSync(file, content);
console.log('Fixed scheduler.ts');
