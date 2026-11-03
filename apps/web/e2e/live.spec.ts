import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API, token } from './api-helpers';

// Each browser project shares as a different seeded member so parallel runs never collide.
const SHARER = { desktop: '+919000010014', mobile: '+919000010015' } as const;

async function startShare(
  api: APIRequestContext,
  phone: string,
): Promise<{ link: string; auth: string }> {
  const auth = await token(api, phone);
  const headers = { authorization: `Bearer ${auth}` };
  await api.post(`${API}/v1/safety/contacts`, {
    headers: {
      ...headers,
      'idempotency-key': `e2e-contact-${phone.slice(1)}-${String(Date.now())}`,
    },
    data: { name: 'E2E contact', phone: '+919876509999' },
  });
  await api.post(`${API}/v1/safety/live/stop`, { headers });
  const res = await api.post(`${API}/v1/safety/live`, {
    headers: { ...headers, 'idempotency-key': `e2e-live-${phone.slice(1)}-${String(Date.now())}` },
    data: { minutes: 30, eventId: null },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { share: { link: string } };
  return { link: body.share.link, auth };
}

test('trusted contacts follow a live share without logging in, until it stops (F-WEB-02)', async ({
  page,
  request,
}, info) => {
  const phone = info.project.name === 'mobile' ? SHARER.mobile : SHARER.desktop;
  const { link, auth } = await startShare(request, phone);
  const path = new URL(link).pathname;
  expect(path).toMatch(/^\/l\/[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);

  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /is sharing their location with you$/,
  );
  await expect(page.getByTestId('live-waiting')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const headers = { authorization: `Bearer ${auth}` };
  await request.post(`${API}/v1/safety/live/points`, {
    headers,
    data: { lat: 17.4239, lng: 78.4738, accuracy: 20 },
  });
  await page.reload();
  await expect(page.getByTestId('live-last-seen')).toContainText('Accurate to about 20 m');
  await expect(page.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute(
    'href',
    /query=17\.423900,78\.473800$/,
  );
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    // The map is a third-party frame; the page around it is what we own.
    .exclude('iframe')
    .analyze();
  expect(results.violations).toEqual([]);

  // The polling endpoint answers with the same data, uncached.
  const data = await request.get(`${path}/data`);
  expect(data.headers()['cache-control']).toBe('no-store');

  await request.post(`${API}/v1/safety/live/stop`, { headers });
  await page.reload();
  await expect(page.getByTestId('live-ended')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('17.42');
});

test('forged and malformed links show nothing', async ({ page }) => {
  await page.goto(`/l/01890a5d-ac96-774b-bcce-b302099a8057.1893456000.${'A'.repeat(43)}`);
  await expect(page.getByTestId('live-not-found')).toBeVisible();
  await page.goto('/l/not-a-token');
  await expect(page.getByTestId('live-not-found')).toBeVisible();
});
