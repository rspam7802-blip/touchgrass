import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing page shows the brand and passes axe (WCAG 2.1 AA)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log off. Pull up.');
  // Metadata streams in after the body; audit the finished document.
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('switches language to Telugu and Hindi with native scripts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'తెలుగు' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ఀ-౿]/);
  await expect(page.locator('main')).toHaveAttribute('lang', 'te');
  await page.goto('/?lang=hi');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ऀ-ॿ]/);
});

test('honours Accept-Language', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'hi-IN' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('lang', 'hi');
  await context.close();
});

test('serves Open Graph tags and image for WhatsApp previews', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'TouchGrass');
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toBeTruthy();
  const res = await request.get(new URL(image ?? '').pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
});

test('sends security headers', async ({ request }) => {
  const res = await request.get('/');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(res.headers()['x-powered-by']).toBeUndefined();
  // Phase 12 security review: a CSP that forbids framing, plugins and foreign scripts.
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/script-src 'self'/);
  expect(csp).not.toContain('unsafe-eval');
});

test('dark mode uses dark tokens', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--tg-background').trim(),
  );
  expect(bg).toBe('#0B130E');
  await context.close();
});

test('unknown routes render the branded 404', async ({ page }) => {
  const res = await page.goto('/definitely-not-here');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("We couldn't find that.");
});

test('a referral link shows the friend’s code, kept across language switches; junk codes are ignored', async ({
  page,
}) => {
  await page.goto('/?ref=tg7k2p9q');
  await expect(page.getByTestId('referral-code')).toContainText('TG7K2P9Q');
  await page.getByRole('link', { name: 'हिन्दी' }).click();
  await expect(page.getByTestId('referral-code')).toContainText('TG7K2P9Q');
  await page.goto('/?ref=<script>');
  await expect(page.getByTestId('referral-code')).toHaveCount(0);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
