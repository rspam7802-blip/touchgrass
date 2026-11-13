import { expect, type Page, test } from '@playwright/test';

/**
 * Live smoke tests (D-190): read-only checks against the real site, run on a schedule and on demand. They
 * never sign up, sign in, invite or change anything.
 */
const API = process.env.LIVE_API_URL ?? 'https://api.touchgrass.co.in';
const MEDIA = process.env.LIVE_MEDIA_URL ?? 'https://media.touchgrass.co.in';

/** Loads a page and fails on a server error or a script error in the browser. */
async function open(page: Page, path: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBeLessThan(400);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  expect(errors, `${path} script errors`).toEqual([]);
}

test('home page, in all three languages', async ({ page }) => {
  await open(page, '/');
  await expect(page.getByRole('link', { name: 'Join the waitlist' }).first()).toBeVisible();
  await open(page, '/?lang=te');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ఀ-౿]/);
  await open(page, '/?lang=hi');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ऀ-ॿ]/);
});

test('about us lists both founders', async ({ page }) => {
  await open(page, '/about');
  await expect(page.getByTestId('founders')).toContainText('Raghuram Srivatsa');
  await expect(page.getByTestId('founders')).toContainText('Narain Malladi');
});

for (const path of ['/privacy', '/terms', '/refunds', '/contact', '/delete-account']) {
  test(`${path} loads`, async ({ page }) => {
    await open(page, path);
  });
}

test('admin sign-in page loads (signed out)', async ({ page }) => {
  await open(page, '/admin/login');
});

test('an unknown share link is a clean 404, not a server error', async ({ page }) => {
  const res = await page.goto('/e/zzzzzzzz');
  expect(res?.status()).toBe(404);
});

test('the app links work: Android and iOS association files', async ({ request }) => {
  for (const path of ['/.well-known/assetlinks.json', '/.well-known/apple-app-site-association']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
});

test('the email logo is served', async ({ request }) => {
  const res = await request.get('/email-logo.png');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
});

test('the API is up and its database and Redis answer', async ({ request }) => {
  const live = await request.get(`${API}/v1/health/live`);
  expect(live.status()).toBe(200);
  const ready = await request.get(`${API}/v1/health`);
  expect(ready.status(), await ready.text()).toBe(200);
});

test('photo storage answers (refusing an unsigned upload)', async ({ request }) => {
  const res = await request.post(`${MEDIA}/touchgrass-media`, { multipart: { key: 'probe' } });
  // RustFS refuses an upload without a signed policy: that it answers at all is the check.
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});
