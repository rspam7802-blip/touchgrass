import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API, token } from './api-helpers';

test.describe.configure({ mode: 'serial' });

async function userId(api: APIRequestContext, phone: string): Promise<string> {
  const auth = await token(api, phone);
  const me = await api.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${auth}` } });
  return ((await me.json()) as { id: string }).id;
}

async function axe(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test('verification queue: compare and reject with a reason (F-SAF-01)', async ({
  page,
  request,
}) => {
  // Seed member #5 has a selfie waiting (the seed refills it while they stay unverified).
  const id = await userId(request, '+919000010005');
  await page.goto('/admin/verifications');
  const card = page.getByTestId(`verification-${id}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('face-match')).toHaveText(/Face match|No automatic face match/);
  await expect(card.getByRole('img').first()).toBeVisible();
  await axe(page);
  await card.getByLabel('Reason').selectOption('UNCLEAR');
  await card.getByRole('button', { name: /^Reject: / }).click();
  await expect(page.getByRole('status')).toHaveText('Reviewed');
  await expect(page.getByTestId(`verification-${id}`)).toHaveCount(0);
});

test('moderation: review held text and release it (F-SAF-06)', async ({ page, request }) => {
  // Seed member #8's bio is held by the text filter.
  const id = await userId(request, '+919000010008');
  await page.goto('/admin/moderation');
  await page
    .getByRole('link', { name: `Review: user ${id}` })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Review item', level: 1 })).toBeVisible();
  await expect(page.getByTestId('item-preview')).toContainText('Zero patience for haramis');
  await expect(page.getByTestId('item-preview')).toContainText('Matched words: harami');
  await axe(page);
  await page.getByLabel('Nothing wrong (release it)').check();
  await page.getByLabel('Note').fill('Reads as a joke about flaky people');
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByTestId('item-status')).toHaveText('Dismissed');
  const audit = await page.goto('/admin/audit-log');
  expect(audit?.ok()).toBe(true);
  await expect(page.getByText('moderation.dismiss').first()).toBeVisible();
});

test('users: find someone, see their history, warn them (F-SAF-05)', async ({ page, request }) => {
  // Seed member #10 has a warning on record already.
  const id = await userId(request, '+919000010010');
  await page.goto(`/admin/users?q=${id}`);
  await page.getByTestId(`user-${id}`).getByRole('link').click();
  await expect(page.getByTestId('user-status')).toHaveText('Active');
  const before = await page.getByTestId('sanction-warn').count();
  expect(before).toBeGreaterThanOrEqual(1);
  await axe(page);
  await page.getByLabel('Action').selectOption('warn');
  await page.getByLabel('Reason').fill('Rude replies in a plan chat');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('sanction-warn')).toHaveCount(before + 1);
  await expect(page.getByText('Rude replies in a plan chat').first()).toBeVisible();
});
