import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { freshIp } from './api-helpers';

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
  expect(csp).not.toContain('https://www.google.com');
});

test('only the admin sign-in page allows Firebase sign-in scripts', async ({ request }) => {
  const res = await request.get('/admin/login');
  const csp = res.headers()['content-security-policy'] ?? '';
  // D-167: reCAPTCHA and Google's identity endpoints, still no framing of our pages and no plugins.
  expect(csp).toContain('https://www.google.com');
  expect(csp).toContain('https://identitytoolkit.googleapis.com');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  for (const path of ['/privacy', '/delete-account']) {
    const other = (await request.get(path)).headers()['content-security-policy'] ?? '';
    expect(other).not.toContain('https://www.google.com');
  }
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

test.describe('landing page sections and forms (D-169)', () => {
  // A visitor address of its own, so per-address limits never couple runs or projects.
  test.use({ extraHTTPHeaders: freshIp() });

  test('explains the app in ordered sections and passes axe', async ({ page }) => {
    await page.goto('/?lang=en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log off. Pull up.');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'How it works',
      'What you can do',
      'Safety comes first',
      'Invite-only, on purpose',
      'Got an invite code?',
      'No invite yet?',
      'Questions',
    ]);
    await expect(page.getByRole('heading', { level: 3, name: 'Pull up' })).toBeVisible();
    await expect(page.getByText('SOS and live location sharing')).toBeVisible();
    await page.getByText('Does it cost anything?').click();
    await expect(page.getByText('plans are free at launch')).toBeVisible();
    await page.getByRole('link', { name: 'Join the waitlist' }).click();
    await expect(page).toHaveURL(/#waitlist$/);
    await expect(page).toHaveTitle(/TouchGrass/);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('checks invite codes: the seeded code works, a made-up one does not', async ({ page }) => {
    await page.goto('/?lang=en');
    const result = page.getByTestId('invite-result');
    await page.getByRole('textbox', { name: 'Invite code' }).fill('grass-2026');
    await page.getByRole('button', { name: 'Check code' }).click();
    await expect(result).toContainText('This code works.');
    await expect(result).toContainText('Enter GRASS-2026 when the app asks for an invite code.');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole('textbox', { name: 'Invite code' }).fill('NOPE-0000');
    await page.getByRole('button', { name: 'Check code' }).click();
    await expect(result).toContainText("This code doesn't work.");
    await expect(result).not.toContainText('This code works.');
  });

  test('joins the waitlist after fixing a missing contact', async ({ page }) => {
    await page.goto('/?lang=en');
    const form = page.locator('#waitlist');
    await form.getByLabel('Your name').fill('E2E Waitlister');
    await form.getByLabel('What would you like to do?').fill('Board games on weekends');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(form.getByRole('alert')).toHaveText('Add a mobile number or an email.');
    // What was typed survives the failed attempt.
    await expect(form.getByLabel('Your name')).toHaveValue('E2E Waitlister');
    await expect(form.getByRole('checkbox')).toBeChecked();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);

    await form
      .getByLabel('Email')
      .fill(`e2e-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`);
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(page.getByTestId('waitlist-done')).toHaveText(
      "You're on the list. We'll be in touch when there's a spot for you.",
    );
  });

  test('the whole page is translated', async ({ page }) => {
    await page.goto('/?lang=te');
    for (const heading of await page.getByRole('heading', { level: 2 }).allTextContents())
      expect(heading).toMatch(/[ఀ-౿]/);
    await page.goto('/?lang=hi');
    await expect(page.getByRole('button', { name: 'वेटलिस्ट में जुड़ो' })).toBeVisible();
  });
});
