import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { API, token } from './api-helpers';

test('customer 360: one person’s plans, squad, money, safety and timeline, and it is audited (D-192)', async ({
  page,
  request,
}) => {
  // Seeded member #2 is in two crews and has a rewarded referral.
  const auth = await token(request, '+919000010002');
  const me = await request.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${auth}` } });
  const { id } = (await me.json()) as { id: string };

  await page.goto(`/admin/users/${id}`);
  await page.getByTestId('open-customer-360').click();
  await expect(page).toHaveURL(new RegExp(`/admin/customers/${id}$`));
  await expect(page.getByTestId('customer-header')).toContainText('Customer 360');
  await expect(page.getByTestId('customer-access')).toContainText('Full view');
  for (const name of ['Overview', 'Plans', 'Spending', 'Squad and invites', 'Safety', 'Timeline'])
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.getByTestId('customer-stats')).toContainText('Pulled up');
  await expect(page.getByTestId('customer-spend')).toContainText('Paid in total');
  await expect(page.getByTestId('customer-safety')).toContainText('SOS alerts');
  await expect(page.getByTestId('customer-timeline')).toContainText('Joined TouchGrass');
  await page.getByRole('link', { name: 'Timeline' }).click();
  await expect(page).toHaveURL(/#timeline$/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.goto('/admin/audit-log');
  await expect(page.getByText('users.view_360').first()).toBeVisible();
});
