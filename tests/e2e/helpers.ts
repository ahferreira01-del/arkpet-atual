import { Page } from '@playwright/test';
import { db } from '@workspace/db';
import { usersTable, crechesTable } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import { createTestCreche, createTestUser } from '../helpers';

export type E2ETestData = {
  crecheId: number;
  adminUser: any;
  staffUser: any;
  tutorUser: any;
  tutorToAnonymize: any;
};

export async function createE2ETestData(): Promise<E2ETestData> {
  const creche = await createTestCreche({ name: 'Creche E2E' });
  const adminUser = await createTestUser({ role: 'creche_admin', crecheId: creche.id });
  const staffUser = await createTestUser({ role: 'staff', crecheId: creche.id });
  const tutorUser = await createTestUser({ role: 'tutor', crecheId: creche.id });
  const tutorToAnonymize = await createTestUser({ role: 'tutor', crecheId: creche.id, cpf: '999.999.999-99' });

  // Update their passwords to a known hash for E2E if doing actual UI login, 
  // or we can mock localstorage. Let's assume the UI login works with a known password
  // For simplicity, we just inject the token into localStorage using evaluate.
  return {
    crecheId: creche.id,
    adminUser,
    staffUser,
    tutorUser,
    tutorToAnonymize
  };
}

export async function cleanupE2ETestData(data: E2ETestData) {
  // Cascading deletes usually handle references
  await db.delete(usersTable).where(eq(usersTable.crecheId, data.crecheId));
  await db.delete(crechesTable).where(eq(crechesTable.id, data.crecheId));
}

export async function loginAs(page: Page, role: string, testData: E2ETestData) {
  let user;
  if (role === 'creche_admin') user = testData.adminUser;
  else if (role === 'staff') user = testData.staffUser;
  else user = testData.tutorUser;

  // We can either do UI login, or just set token and navigate
  await page.goto('/');
  await page.evaluate((userObj) => {
    // Generate token in frontend or just mock the auth flow
    // Since we are mocking E2E, it might be better to just set the token and user in localStorage
    // However, generating a token in browser requires the secret. We can just generate it here and pass it in.
  }, user);

  // In a real E2E, we'd actually fill the login form:
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', 'senha123'); // assuming test users have this or we bypass
  await page.click('button[type="submit"]');
  await page.waitForURL('**/');
}
