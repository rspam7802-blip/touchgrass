import { expect, type Page, test } from '@playwright/test';
import { API, token } from './api-helpers';

/**
 * Admin buttons not covered elsewhere (D-186, D-190): each one answers with "Saved", or with the server's
 * reason when it refuses, instead of an error page.
 */
const saved = (page: Page) => expect(page.getByTestId('admin-saved')).toBeVisible();

test('cities: add a neighbourhood, and a duplicate is refused with a reason', async ({ page }) => {
  await page.goto('/admin/cities');
  const city = page.getByTestId('city-visakhapatnam');
  const slug = `e2e-${String(Date.now() % 1_000_000)}`;
  const add = async (): Promise<void> => {
    await city.getByText('Add a neighbourhood').click();
    const form = page.getByRole('form', { name: 'Add a neighbourhood: Visakhapatnam' });
    await form.getByLabel('Name', { exact: true }).fill(`E2E Beach ${slug}`);
    await form.getByLabel('Slug').fill(slug);
    await form.getByLabel(/latitude/i).fill('17.71');
    await form.getByLabel(/longitude/i).fill('83.32');
    await form.getByLabel(/radius/i).fill('1');
    await form.getByRole('button', { name: 'Add' }).click();
  };
  await add();
  await saved(page);
  await expect(page.getByTestId('city-visakhapatnam')).toContainText(`E2E Beach ${slug}`);
  await add();
  await expect(page.getByTestId('admin-failed')).toBeVisible();
});

test('notification templates: custom wording saves, then goes back to the default', async ({
  page,
}) => {
  await page.goto('/admin/notification-templates');
  const tpl = page.getByTestId('template-city_launched');
  await tpl.locator('summary').first().click();
  const form = page.getByRole('form', { name: 'Custom wording: city_launched English' });
  await form.getByLabel('Title').fill('E2E: your city is open');
  await form.getByLabel('Body').fill('Come and pull up.');
  await form.getByRole('button', { name: 'Save' }).click();
  await saved(page);
  await page.getByTestId('template-city_launched').locator('summary').first().click();
  await page
    .getByTestId('template-city_launched')
    .getByRole('button', { name: 'Use the default' })
    .first()
    .click();
  await saved(page);
});

test('users: mark someone verified, then remove it', async ({ page, request }) => {
  const auth = await token(request, '+919000010014');
  const me = await request.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${auth}` } });
  const id = ((await me.json()) as { id: string }).id;
  await page.goto(`/admin/users?q=${id}`);
  await page.getByTestId(`user-${id}`).getByRole('link').click();
  const before = (await page.getByTestId('user-verified').textContent()) ?? '';
  const [first, second] =
    before === '✓'
      ? ['Remove verification', 'Mark verified']
      : ['Mark verified', 'Remove verification'];
  await page.getByRole('button', { name: first }).click();
  await saved(page);
  await page.getByRole('button', { name: second }).click();
  await saved(page);
  await expect(page.getByTestId('user-verified')).toHaveText(before);
});

test('venues: saving a partner venue answers Saved', async ({ page }) => {
  await page.goto('/admin/venues?partner=partners');
  const venue = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Save: / }) })
    .first();
  await venue.getByRole('button', { name: /^Save: / }).click();
  await saved(page);
});

test('the notice can be dismissed', async ({ page }) => {
  await page.goto('/admin/weights?saved=1');
  await expect(page.getByTestId('admin-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('admin-saved')).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/weights$/);
});
