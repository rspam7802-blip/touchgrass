import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signInAs } from './admin-helpers';

/**
 * Seed member #31 curates Bengaluru (apps/api/src/seed/admin-console.seed.ts). Not #30: admin.spec's
 * host-application helper signs in members #24, #27, #30… in parallel (one OTP cooldown per phone).
 */
const CURATOR_PHONE = '9000010031';
const unique = () => Math.random().toString(36).slice(2, 7);

async function axeClean(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** `datetime-local` value, IST, n days from now at 18:00. */
function istLocal(daysAhead: number, hour: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000 + 330 * 60_000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
}

test.describe.configure({ mode: 'serial' });

test('cities: seeded cities, the waitlist and asked-for places (F-GRW-03)', async ({ page }) => {
  await page.goto('/admin/cities');
  await expect(page.getByRole('heading', { name: 'Cities', level: 1 })).toBeVisible();
  await expect(page.getByTestId('city-hyderabad')).toContainText('Gachibowli');
  await expect(page.getByTestId('city-bengaluru')).toContainText('Indiranagar');
  await expect(page.getByTestId('city-visakhapatnam')).toContainText('Waitlist');
  await expect(page.getByTestId('city-visakhapatnam')).toContainText(/\d+ waiting/);
  await expect(page.getByRole('heading', { name: 'Asked for, not a city yet' })).toBeVisible();
  await expect(page.getByText(/^Warangal/)).toBeVisible();
  await axeClean(page);
});

test('events: create a curated plan, feature, edit and cancel it (F-WEB-03)', async ({ page }) => {
  const title = `Heritage walk ${unique()}`;
  await page.goto('/admin/events/new');
  await page.getByLabel('Plan', { exact: true }).fill(title);
  await page.getByLabel('Place name').fill('Charminar');
  await page.getByLabel('Address').fill('Charminar Road, Old City');
  await page.getByLabel('Centre latitude').fill('17.3616');
  await page.getByLabel('Centre longitude').fill('78.4747');
  await page.getByLabel('Starts').fill(istLocal(3, 7));
  await page.getByLabel('Ends').fill(istLocal(3, 9));
  await page.getByLabel('Capacity').fill('20');
  await axeClean(page);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(page.getByTestId('event-summary')).toContainText('Curated');

  await page.getByRole('button', { name: 'Feature in the feed' }).click();
  await expect(page.getByTestId('featured-status')).toContainText('#1');
  await axeClean(page);

  await page.getByLabel('Plan', { exact: true }).fill(`${title} at dawn`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: `${title} at dawn`, level: 1 })).toBeVisible();

  await page.goto('/admin/events?featured=true');
  await expect(page.getByRole('link', { name: `${title} at dawn` })).toBeVisible();
  await page.getByRole('link', { name: `${title} at dawn` }).click();
  await page.getByLabel('Reason (attendees see it)').fill('Rain all morning');
  await page.getByRole('button', { name: 'Cancel plan' }).click();
  await expect(page.getByTestId('event-summary')).toContainText('Cancelled');
  await expect(page.getByText('Rain all morning')).toBeVisible();
});

test('taxonomy: add a vibe tag in three languages (F-EVT-11)', async ({ page }) => {
  const slug = `cosy-${unique()}`;
  await page.goto('/admin/taxonomy');
  const form = page.getByRole('form', { name: 'Add: Vibe tags' });
  await form.getByLabel('Name (English)').fill(`Cosy ${slug}`);
  await form.getByLabel('Name (Telugu)').fill('హాయిగా');
  await form.getByLabel('Name (Hindi)').fill('आरामदायक');
  await form.getByLabel('Slug').fill(slug);
  await form.getByLabel('Emoji').fill('🛋️');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId(`taxonomy-${slug}`)).toContainText(`Cosy ${slug}`);
  await axeClean(page);
});

test('weights: tune and reset recommendation weights', async ({ page }) => {
  await page.goto('/admin/weights');
  await page.getByLabel('Squad going').fill('5.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Squad going')).toHaveValue('5.5');
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.getByLabel('Squad going')).toHaveValue('4');
  await axeClean(page);
});

test('templates, analytics and team pages show their data and pass axe', async ({ page }) => {
  await page.goto('/admin/notification-templates');
  await expect(page.getByTestId('template-city_launched')).toBeVisible();
  await axeClean(page);
  await page.goto('/admin/analytics?days=30');
  await expect(page.getByTestId('analytics-totals')).toContainText('Pull-ups');
  await expect(page.getByRole('row')).toHaveCount(31);
  await axeClean(page);
  await page.goto('/admin/team');
  await expect(page.getByRole('cell', { name: 'City curator' }).first()).toBeVisible();
  await axeClean(page);
});

test('a city curator only sees their sections and their city', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signInAs(page, CURATOR_PHONE);
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Payments' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Team & roles' })).toHaveCount(0);
  await page.goto('/admin/cities');
  await expect(page.getByTestId('city-bengaluru')).toBeVisible();
  await expect(page.getByTestId('city-hyderabad')).toHaveCount(0);
  await page.goto('/admin/payments');
  await expect(
    page.getByRole('alert').filter({ hasText: "Your roles don't include this section." }),
  ).toBeVisible();
  await context.close();
});
