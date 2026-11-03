import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API, token } from './api-helpers';

async function authed(api: APIRequestContext, phone: string) {
  const headers = { authorization: `Bearer ${await token(api, phone)}` };
  return {
    get: async <T>(path: string): Promise<T> =>
      (await (await api.get(`${API}${path}`, { headers })).json()) as T,
  };
}

// Distinct seeded members per browser project, so parallel sign-ins never trip each other's OTP cooldown.
const PROFILE = { desktop: '+919000010013', mobile: '+919000010017' } as const;
const CREW_MEMBER = { desktop: '+919000010007', mobile: '+919000010011' } as const;
const pick = <T>(m: { desktop: T; mobile: T }, project: string): T =>
  project === 'mobile' ? m.mobile : m.desktop;

test('shared profile links show the name and open the app (F-GRW-02)', async ({
  page,
  request,
}, info) => {
  const me = await (
    await authed(request, pick(PROFILE, info.project.name))
  ).get<{ id: string; displayName: string }>('/v1/me');
  await page.goto(`/u/${me.id}`);
  await expect(page.getByTestId('profile-share-title')).toContainText(
    `${me.displayName} is on TouchGrass`,
  );
  await expect(page.getByRole('link', { name: 'Open in TouchGrass' })).toHaveAttribute(
    'href',
    `touchgrass://users/${me.id}`,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toBeTruthy();
  const image = await request.get(new URL(og ?? '').pathname, {
    failOnStatusCode: false,
  });
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toContain('image/png');
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('shared crew links show open crews only (F-GRW-02)', async ({ page, request }, info) => {
  const crews = await (
    await authed(request, pick(CREW_MEMBER, info.project.name))
  ).get<{
    items: { id: string; name: string; joinPolicy: string }[];
  }>('/v1/crews?scope=mine&limit=20');
  const open = crews.items.find((c) => c.joinPolicy === 'request');
  if (!open) throw new Error('seeded open crew missing');
  await page.goto(`/c/${open.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(open.name);
  await expect(page.getByTestId('crew-share-members')).toHaveText(/\d+ members/);
  await expect(page.getByRole('link', { name: 'Open in TouchGrass' })).toHaveAttribute(
    'href',
    `touchgrass://crews/${open.id}`,
  );
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  const missing = await page.goto('/c/01890a5d-ac96-774b-bcce-b302099a8057');
  expect(missing?.status()).toBe(404);
  const bad = await page.goto('/u/not-a-user');
  expect(bad?.status()).toBe(404);
});

test('plan previews get a generated card; app links cover profiles and crews', async ({
  request,
}) => {
  const card = await request.get('/e/seedev001/opengraph-image');
  expect(card.status()).toBe(200);
  expect(card.headers()['content-type']).toContain('image/png');
  const aasa = await request.get('/.well-known/apple-app-site-association');
  expect(aasa.status()).toBe(200);
});
