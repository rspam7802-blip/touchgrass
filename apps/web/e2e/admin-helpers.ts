import { expect, type Page } from '@playwright/test';

/** Seeded dev super admin (apps/api/src/seed/seed.ts); OTP 000000 is accepted outside production. */
export const ADMIN_PHONE = '9000000001';
/** Seed persona #1: an ordinary member. */
export const MEMBER_PHONE = '9000010001';

export async function signInAs(page: Page, phone: string): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
}

export async function expectDashboard(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
}
