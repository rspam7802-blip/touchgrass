import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN_PHONE } from './admin-helpers';
import { API, freshIp } from './api-helpers';

// A session of its own: admin.spec's last test signs the shared admin session out while this file runs.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  const res = await page.request.post('/admin/api/otp', {
    headers: freshIp(),
    data: { step: 'proof', token: `fake-phone:+91${ADMIN_PHONE}:waitlist-${String(Date.now())}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
});

/** Launch waitlist in the admin console (D-169): list, invite with a code to copy, remove on request. */
test('invites a waitlisted person and removes another, both audited', async ({ page, request }) => {
  const run = `${String(Date.now())}${String(Math.random()).slice(2, 6)}`;
  const invitee = `Invitee ${run}`;
  const leaver = `Leaver ${run}`;
  const phone = `+9179${run.slice(-8)}`;
  for (const body of [
    { name: invitee, phone, note: 'Treks and quiz nights' },
    { name: leaver, email: `leaver-${run}@example.com` },
  ]) {
    const res = await request.post(`${API}/v1/public/waitlist`, {
      headers: freshIp(),
      data: { ...body, consent: true },
    });
    expect(res.status(), await res.text()).toBe(200);
  }

  await page.goto('/admin/waitlist');
  await expect(page.getByRole('heading', { level: 1, name: 'Waitlist' })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(invitee) });
  await expect(row).toContainText(phone);
  await expect(row).toContainText('Treks and quiz nights');
  await expect(row).toContainText('hyderabad');
  await row.getByRole('button', { name: `Invite ${invitee}` }).click();
  const issued = row.getByTestId('waitlist-new-code');
  await expect(issued.locator('output')).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  // No email on file: the admin sends it.
  await expect(issued).toContainText('Send it to them yourself.');
  const code = ((await issued.locator('output').textContent()) ?? '').trim();
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Invited people leave the default list and show their code under "Everyone".
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(invitee) })).toHaveCount(0);
  await page.getByLabel('Show').selectOption('all');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('row', { name: new RegExp(invitee) })).toContainText(code);

  const leaving = page.getByRole('row', { name: new RegExp(leaver) });
  await leaving.getByRole('button', { name: `Remove ${leaver}` }).click();
  await expect(leaving).toContainText(`Remove ${leaver} for good?`);
  await leaving.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByRole('row', { name: new RegExp(leaver) })).toHaveCount(0);

  await page.goto('/admin/audit-log');
  for (const action of ['waitlist.invite', 'waitlist.remove'])
    await expect(page.getByRole('cell', { name: action }).first()).toBeVisible();
});

test('insights: a sign-up from an Instagram link is counted, labelled and exported (D-191)', async ({
  page,
  browser,
}) => {
  const name = `Insta ${String(Date.now())}${String(Math.random()).slice(2, 6)}`;
  // A visitor arrives from the Instagram bio link and joins.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const site = await visitor.newPage();
  await site.goto('/?lang=en&utm_source=instagram');
  const form = site.locator('#waitlist');
  await form.getByLabel('Your name').fill(name);
  await form.getByLabel('Email').fill(`insta-${String(Date.now())}@example.com`);
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Join the waitlist' }).click();
  await expect(site.getByTestId('waitlist-done')).toBeVisible();
  await visitor.close();

  await page.goto('/admin/waitlist');
  await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  await expect(page.getByTestId('waitlist-totals')).toContainText('Today');
  await expect(page.getByTestId('waitlist-sources')).toContainText('Instagram');
  await expect(page.getByTestId('waitlist-funnel')).toContainText('Joined the app');
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('From instagram');
  await page.getByRole('link', { name: 'Last 90 days' }).click();
  await expect(page).toHaveURL(/days=90/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  const csv = await page.request.get('/admin/waitlist/export?status=all');
  expect(csv.headers()['content-type']).toContain('text/csv');
  const text = await csv.text();
  expect(text).toContain('"Source"');
  expect(text).toContain(name);
  expect(text).toContain('"instagram"');
});
