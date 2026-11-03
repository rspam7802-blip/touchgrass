import { test as setup } from '@playwright/test';
import { ADMIN_STATE } from '../playwright.config';
import { ADMIN_PHONE, expectDashboard, signInAs } from './admin-helpers';

setup('sign in as the seeded super admin', async ({ page }) => {
  await signInAs(page, ADMIN_PHONE);
  await expectDashboard(page);
  await page.context().storageState({ path: ADMIN_STATE });
});
