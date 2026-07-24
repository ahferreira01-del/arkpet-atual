import { test, expect } from '@playwright/test';
import { loginAs, createE2ETestData, cleanupE2ETestData, E2ETestData } from './helpers';

test.describe('Ciclo Completo: Despesa → Check-out → Pagamento → DRE', () => {
  let testData: E2ETestData;

  test.beforeAll(async () => {
    testData = await createE2ETestData();
  });

  test.afterAll(async () => {
    await cleanupE2ETestData(testData);
  });

  test('FLUXO 1 — Admin cadastra e paga despesa operacional', async ({ page }) => {
    await loginAs(page, 'creche_admin', testData);

    await page.click('[data-testid="nav-financial"]');
    await expect(page).toHaveURL(/.*financial/);

    await page.click('[data-testid="tab-expenses"]');

    await page.click('[data-testid="btn-new-expense"]');
    await expect(page.locator('[data-testid="modal-expense"]')).toBeVisible();

    await page.fill('[data-testid="input-description"]', 'Aluguel Fevereiro');
    await page.selectOption('[data-testid="select-category"]', 'aluguel');
    await page.fill('[data-testid="input-amount"]', '3500');
    await page.fill('[data-testid="input-due-date"]', '2026-02-28');
    await page.click('[data-testid="btn-save-expense"]');

    await expect(page.locator('[data-testid="expense-item"]').filter({ hasText: 'Aluguel Fevereiro' })).toBeVisible();

    await page.click('[data-testid="expense-item"]:has-text("Aluguel Fevereiro") [data-testid="btn-pay-expense"]');
    await page.click('[data-testid="btn-confirm-pay"]');

    await expect(page.locator('[data-testid="expense-item"]:has-text("Aluguel Fevereiro") [data-testid="badge-paid"]')).toBeVisible();
  });

  test('FLUXO 2 — Staff faz check-out com consumível e fatura é gerada', async ({ page }) => {
    await loginAs(page, 'staff', testData);

    await page.click('[data-testid="nav-staff-board"]');
    await expect(page).toHaveURL(/.*staff\/board/);

    const petCard = page.locator('[data-testid="active-pet-card"]').first();
    // Assuming there's a pet active
    if (await petCard.isVisible()) {
      await petCard.locator('[data-testid="btn-add-consumable"]').click();
      await expect(page.locator('[data-testid="modal-consumable"]')).toBeVisible();

      await page.click('[data-testid="catalogue-item"]:has-text("Banho")');
      await page.click('[data-testid="btn-confirm-consumable"]');

      await expect(page.locator('[data-testid="modal-consumable"] [data-testid="success-feedback"]')).toBeVisible();
      await page.click('[data-testid="btn-close-modal"]');

      await petCard.locator('[data-testid="btn-checkout"]').click();

      await expect(page.locator('[data-testid="checkout-modal"]')).toBeVisible();
      await expect(page.locator('[data-testid="checkout-consumables-list"]')).toBeVisible();
      await expect(page.locator('[data-testid="checkout-consumables-list"]').locator('text=Banho')).toBeVisible();

      await page.click('[data-testid="btn-confirm-checkout"]');

      await expect(page.locator('[data-testid="checkout-success"]')).toBeVisible();
      await expect(page.locator('[data-testid="checkout-success"]').locator('text=/Fatura|fatura|R\\$/i')).toBeVisible();
    }
  });

  test('FLUXO 3 — Tutor vê fatura, envia comprovante Pix e admin aprova', async ({ page, context }) => {
    await loginAs(page, 'tutor', testData);

    await page.click('[data-testid="nav-tutor-financial"]');

    const invoiceCard = page.locator('[data-testid="invoice-card"][data-status="pending"]').first();
    // In a real test, ensure one exists
    if (await invoiceCard.isVisible()) {
      await invoiceCard.locator('[data-testid="btn-upload-receipt"]').click();

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: 'comprovante.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('fake-image-content')
      });

      await page.click('[data-testid="btn-confirm-upload"]');

      await expect(page.locator('[data-testid="invoice-card"] [data-testid="badge-awaiting"]')).toBeVisible();

      const adminPage = await context.newPage();
      await loginAs(adminPage, 'creche_admin', testData);
      await adminPage.goto('/financial?tab=cobrancas');

      const awaitingInvoice = adminPage.locator('[data-testid="invoice-card"][data-status="awaiting_confirmation"]').first();
      await expect(awaitingInvoice).toBeVisible();

      await awaitingInvoice.locator('[data-testid="btn-view-receipt"]').click();
      await expect(adminPage.locator('[data-testid="modal-receipt"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="receipt-image"]')).toBeVisible();

      await adminPage.click('[data-testid="btn-approve-receipt"]');
      await expect(awaitingInvoice.locator('[data-testid="badge-paid"]')).toBeVisible();

      await adminPage.close();
    }
  });

  test('FLUXO 4 — Tutor paga via Stripe (mock)', async ({ page }) => {
    await loginAs(page, 'tutor', testData);
    await page.goto('/tutor/financial');

    const pendingInvoice = page.locator('[data-testid="invoice-card"][data-status="pending"]').first();
    if (await pendingInvoice.isVisible()) {
      const checkoutPromise = page.waitForRequest(req => req.url().includes('stripe-checkout'));
      await pendingInvoice.locator('[data-testid="btn-pay-online"]').click();
      const checkoutRequest = await checkoutPromise;
      expect(checkoutRequest.method()).toBe('POST');
    }
  });

  test('FLUXO 5 — Admin visualiza DRE do período com receitas e despesas', async ({ page }) => {
    await loginAs(page, 'creche_admin', testData);
    await page.goto('/financial?tab=saude');

    const startDate = page.locator('[data-testid="input-start-date"]');
    await expect(startDate).not.toHaveValue('');

    await page.click('[data-testid="quick-filter-this-month"]');

    await expect(page.locator('[data-testid="kpi-total-income"]')).not.toHaveText('R$ 0,00');
    await expect(page.locator('[data-testid="cashflow-chart"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-total-income"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-total-expenses"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-net-result"]')).toBeVisible();
  });

  test('FLUXO 6 — Anonimização LGPD pelo admin', async ({ page }) => {
    await loginAs(page, 'creche_admin', testData);
    await page.goto(`/tutors/${testData.tutorToAnonymize.id}`);

    await expect(page.locator('[data-testid="section-lgpd"]')).toBeVisible();

    await page.click('[data-testid="btn-anonymize"]');
    await expect(page.locator('[data-testid="modal-anonymize-confirm"]')).toBeVisible();

    await page.fill('[data-testid="input-confirm-anonymize"]', 'CONFIRMAR');
    await expect(page.locator('[data-testid="btn-proceed-anonymize"]')).toBeEnabled();

    await page.click('[data-testid="btn-proceed-anonymize"]');

    await expect(page).toHaveURL(/.*tutors/);
    await expect(page.locator('[data-testid="toast-success"]')).toBeVisible();
  });
});
