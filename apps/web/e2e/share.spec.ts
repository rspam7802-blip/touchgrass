import { resources } from '@touchgrass/shared';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Seeded plans (apps/api/src/seed/events.seed.ts): fixed slugs with known shapes.
const PUBLIC = 'seedev001';
const CANCELLED = 'seedev002';
const INVITE_ONLY = 'seedev007';
const MYSTERY = 'seedev009';

test('public plan share page shows basics, OG tags and passes axe', async ({ page }) => {
  await page.goto(`/e/${PUBLIC}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/going$/)).toBeVisible();
  await expect(page.getByText(/^Hosted by /)).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Main Road');
  const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
  expect(ogTitle).toBe(await page.getByRole('heading', { level: 1 }).textContent());
  await expect(page.getByRole('link', { name: 'Open in TouchGrass' })).toHaveAttribute(
    'href',
    `touchgrass://e/${PUBLIC}`,
  );
  // Metadata streams in after the body; audit the finished document.
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('public plan pages carry structured data without an address, and link every language', async ({
  page,
}) => {
  await page.goto(`/e/${PUBLIC}`);
  const ld = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
  ) as { '@type': string; name: string; location: { address: { addressLocality: string } } };
  expect(ld['@type']).toBe('Event');
  expect(ld.name).toBe(await page.getByRole('heading', { level: 1 }).textContent());
  expect(ld.location.address.addressLocality).toBe('Hyderabad');
  expect(JSON.stringify(ld)).not.toContain('Main Road');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/e\/seedev001$/);
  await expect(page.locator('link[rel="alternate"][hreflang="te"]')).toHaveCount(1);
  // Private plans give search engines nothing.
  await page.goto(`/e/${INVITE_ONLY}`);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
});

test('invite links carry the token into the app link', async ({ page }) => {
  await page.goto(`/e/${PUBLIC}?i=abcdefghijklmnopqrstu`);
  await expect(page.getByRole('link', { name: 'Open in TouchGrass' })).toHaveAttribute(
    'href',
    `touchgrass://e/${PUBLIC}?i=abcdefghijklmnopqrstu`,
  );
});

test('invite-only plans show a teaser without the title', async ({ page }) => {
  await page.goto(`/e/${INVITE_ONLY}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/ has a plan$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('main')).not.toContainText('Main Road');
});

test('mystery plans show only the area, never the spot', async ({ page }) => {
  await page.goto(`/e/${MYSTERY}`);
  await expect(page.getByText(/^Mystery spot near /)).toBeVisible();
  await expect(page.getByText('The exact spot is revealed to people pulling up.')).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain('Main Road');
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description).toMatch(/Mystery spot near/);
});

test('cancelled plans say so; unknown plans 404', async ({ page }) => {
  await page.goto(`/e/${CANCELLED}`);
  await expect(page.getByRole('status')).toHaveText('This plan was cancelled.');
  const res = await page.goto('/e/zzzzzzzz');
  expect(res?.status()).toBe(404);
});

test('plays well in Telugu', async ({ page }) => {
  await page.goto(`/e/${PUBLIC}?lang=te`);
  await expect(page.locator('main')).toHaveAttribute('lang', 'te');
  await expect(page.getByRole('link', { name: resources.te.share.openInApp })).toBeVisible();
});

test('unknown +1 claim links explain they are used up', async ({ page }) => {
  await page.goto('/claim/abcdefghijklmnopqrstuvwxyz');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'This +1 link was already used or has expired.',
  );
});

test('serves app association files', async ({ request }) => {
  const aasa = await request.get('/.well-known/apple-app-site-association');
  expect(aasa.status()).toBe(200);
  expect(await aasa.json()).toHaveProperty('applinks.details');
  const assetlinks = await request.get('/.well-known/assetlinks.json');
  expect(assetlinks.status()).toBe(200);
  expect(Array.isArray(await assetlinks.json())).toBe(true);
});
