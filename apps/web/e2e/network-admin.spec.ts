import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { API, freshIp, token } from './api-helpers';

test('invite network: generations from our invitee onwards, a family view, the time slider and Customer 360 (D-193)', async ({
  page,
  request,
}) => {
  // A seeded member invites a brand-new person with their own code: generation 1 → generation 2.
  const host = await token(request, '+919000010003');
  const auth = { authorization: `Bearer ${host}` };
  const me = (await (await request.get(`${API}/v1/me`, { headers: auth })).json()) as {
    id: string;
    displayName: string;
  };
  const made = await request.post(`${API}/v1/me/invites`, {
    headers: { ...auth, 'idempotency-key': `e2e-net-${String(Date.now())}` },
  });
  expect(made.status(), await made.text()).toBe(201);
  const { code } = (await made.json()) as { code: string };
  const phone = `+9170${String(Date.now()).slice(-8)}`;
  const ip = freshIp();
  await request.post(`${API}/v1/auth/otp/request`, { data: { phone }, headers: ip });
  const joined = await request.post(`${API}/v1/auth/otp/verify`, {
    headers: ip,
    data: {
      phone,
      code: '000000',
      inviteCode: code,
      device: { deviceId: `e2e-${phone}`, platform: 'android' },
    },
  });
  expect(joined.status(), await joined.text()).toBe(200);

  await page.goto('/admin');
  await page.getByRole('link', { name: 'Invite network' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invite network');
  await expect(page.getByTestId('network-generations')).toContainText(
    'Generation 1 (our invitees)',
  );
  await expect(page.getByTestId('network-generations')).toContainText('Generation 2');
  await expect(page.getByTestId('network-graph')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // One family: the inviter and the person they brought in.
  await page.goto(`/admin/network?root=${me.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Family of');
  await expect(page.getByTestId('network-stats')).toContainText('Longest chain (generations)2');

  // The time slider: today shows everyone; a day before anyone joined shows nobody.
  await expect(page.getByTestId('network-until-label')).toHaveText('Today');
  await page.goto('/admin/network?until=2020-01-01');
  await expect(page.getByText('Nobody has joined yet.')).toBeVisible();

  // Every person opens their Customer 360.
  await page.goto(`/admin/network?root=${me.id}`);
  await page.getByTestId('network-graph').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/customers/${me.id}$`));
  await expect(page.getByTestId('customer-network')).toBeVisible();
});
