import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { MEMBER_PHONE, signInAs } from './admin-helpers';
import { freshIp } from './api-helpers';

test.describe.configure({ mode: 'serial' });

test('dashboard shows roles and passes axe', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByText('Your roles: super_admin').first()).toBeVisible();
  // Metadata streams in after the body; audit the finished document.
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('generates and revokes invite codes (F-ACC-01)', async ({ page }) => {
  const label = `e2e-${Date.now()}`;
  await page.goto('/admin/invite-codes');
  await page.getByLabel('How many').fill('2');
  await page.getByLabel('Uses per code').fill('3');
  await page.getByLabel('Label').fill(label);
  await page.getByRole('button', { name: 'Generate' }).click();
  const output = page.locator('output');
  await expect(output).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}\s+[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const [code] = ((await output.textContent()) ?? '').trim().split(/\s+/);
  await page.reload();
  const row = page.getByTestId(`invite-row-${code ?? ''}`);
  await expect(row).toContainText('0/3');
  await expect(row).toContainText(label);
  await row.getByRole('button', { name: `Revoke ${code ?? ''}` }).click();
  await expect(row).toContainText('Revoked');
  // Metadata streams in after the body; audit the finished document.
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('toggles a feature flag (F-PLT-01)', async ({ page, request }) => {
  await page.goto('/admin/feature-flags');
  const row = page.getByTestId('flag-referrals');
  await expect(row).toContainText('On');
  await row.getByRole('button').click();
  await expect(row).toContainText('Off');
  const api = `http://localhost:${process.env.API_E2E_PORT ?? '4100'}`;
  expect(
    (
      (await (await request.get(`${api}/v1/app/config`)).json()) as {
        flags: Record<string, boolean>;
      }
    ).flags.referrals,
  ).toBe(false);
  await row.getByRole('button').click();
  await expect(row).toContainText('On');
});

test('changes the invite quota setting', async ({ page }) => {
  const save = async (value: string): Promise<void> => {
    await page.getByRole('spinbutton', { name: 'Invites per user' }).fill(value);
    // Wait for the server action round-trip before reloading, so the reload reads the saved value.
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/admin/settings'),
      ),
      page
        .getByRole('form', { name: 'Invites per user' })
        .getByRole('button', { name: 'Save' })
        .click(),
    ]);
    await page.reload();
    await expect(page.getByRole('spinbutton', { name: 'Invites per user' })).toHaveValue(value);
  };
  await page.goto('/admin/settings');
  await save('7');
  await save('5');
});

test('reports land in the moderation queue, most severe first (F-SOC-05)', async ({
  page,
  request,
}) => {
  const api = `http://localhost:${process.env.API_E2E_PORT ?? '4100'}`;
  // Seed member #2 reports seed member #3 through the real API.
  const ip = freshIp();
  const otp = await request.post(`${api}/v1/auth/otp/request`, {
    data: { phone: '9000010002' },
    headers: ip,
  });
  expect(otp.status()).toBe(200);
  const auth = await request.post(`${api}/v1/auth/otp/verify`, {
    headers: ip,
    data: {
      phone: '9000010002',
      code: '000000',
      device: { deviceId: `e2e-${Date.now()}`, platform: 'web' },
    },
  });
  expect(auth.status()).toBe(200);
  const { accessToken } = (await auth.json()) as { accessToken: string };
  const target = '9000010003';
  const lookup = await request.post(`${api}/v1/social/contacts/match`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { hashes: [await sha256(`+91${target}`)] },
  });
  const { items } = (await lookup.json()) as { items: { person: { id: string } }[] };
  const targetId = items[0]?.person.id ?? '';
  const report = await request.post(`${api}/v1/reports`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'idempotency-key': `e2e-report-${Date.now()}`,
    },
    data: { targetType: 'user', targetId, category: 'violence' },
  });
  expect(report.status()).toBe(201);
  await page.goto('/admin/moderation');
  const row = page.getByTestId(`queue-${targetId}`);
  await expect(row).toContainText('critical');
  await expect(row).toContainText('violence');
  // Metadata streams in after the body; audit the finished document.
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('curates the icebreaker deck in three languages (F-ATE-01)', async ({ page }) => {
  const prompt = `E2E prompt ${String(Date.now())}`;
  await page.goto('/admin/icebreakers');
  await page.getByLabel('Prompt (English)').fill(prompt);
  await page.getByLabel('Prompt (Telugu)').fill('మీకు ఇష్టమైన చాయ్ స్పాట్?');
  await page.getByLabel('Prompt (Hindi)').fill('आपकी पसंदीदा चाय की जगह?');
  await page.getByLabel('Kind').selectOption('local');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('output')).toContainText(prompt);
  await page.reload();
  const row = page.locator('tr', { hasText: prompt });
  await expect(row).toContainText('Hyderabad');
  await expect(row).toContainText('On');
  await row.getByRole('button', { name: `Turn off: ${prompt}` }).click();
  await expect(row).toContainText('Off');
  await row.getByRole('button', { name: `Turn on: ${prompt}` }).click();
  await expect(row).toContainText('On');
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

/** Files a fresh application from a verified seed member who has none yet, so reruns always have one to review. */
async function fileApplication(request: APIRequestContext): Promise<void> {
  const api = `http://localhost:${process.env.API_E2E_PORT ?? '4100'}`;
  const tried: string[] = [];
  for (let n = 24; n <= 99; n += 3) {
    const phone = `+9190000${String(10_000 + n)}`;
    const ip = freshIp();
    await request.post(`${api}/v1/auth/otp/request`, { data: { phone }, headers: ip });
    const auth = await request.post(`${api}/v1/auth/otp/verify`, {
      headers: ip,
      data: {
        phone,
        code: '000000',
        device: { deviceId: `e2e-admin-${phone}`, platform: 'android' },
      },
    });
    if (!auth.ok()) {
      tried.push(`${String(n)}:verify ${String(auth.status())}`);
      continue;
    }
    const { accessToken } = (await auth.json()) as { accessToken: string };
    const res = await request.post(`${api}/v1/host/applications`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': `e2e-app-${String(n)}-${String(Date.now())}`,
      },
      data: {
        about: 'I host neighbourhood walks every weekend.',
        experience: 'Two years of weekly walks for ten to twenty people.',
        eventIdeas: 'Paid heritage walks with a local historian.',
      },
    });
    if (res.status() === 201) return;
    tried.push(`${String(n)}:apply ${String(res.status())}`);
  }
  throw new Error(`No seed member could apply (${tried.slice(0, 6).join(', ')})`);
}

test('reviews host applications (F-HST-01)', async ({ page, request }) => {
  await fileApplication(request);
  await page.goto('/admin/host-applications');
  await expect(page.getByRole('heading', { name: 'Host applications', level: 1 })).toBeVisible();
  const first = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Approve:/ }) })
    .first();
  const name =
    ((await first.getByRole('heading', { level: 2 }).textContent()) ?? '').split(' · ')[0] ?? '';
  await first.getByLabel('Note').fill('Welcome aboard');
  await first.getByRole('button', { name: `Approve: ${name}` }).click();
  await expect(page.getByRole('button', { name: `Approve: ${name}` })).toHaveCount(0);
  await page.goto('/admin/host-applications?status=approved');
  await expect(page.getByText('Welcome aboard').first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('manages partner venues and perks (F-PAY-04)', async ({ page }) => {
  await page.goto('/admin/venues?partner=partners');
  const venue = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Add perk:/ }) })
    .first();
  await expect(venue).toContainText('PIN set');
  const title = `E2E perk ${String(Date.now())}`;
  await venue.getByLabel('Perk', { exact: true }).fill(title);
  await venue.getByLabel('Minimum group').fill('3');
  await venue.getByRole('button', { name: /^Add perk:/ }).click();
  await expect(page.getByText(title)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('shows payments, refunds and payouts (F-PAY-03)', async ({ page }) => {
  await page.goto('/admin/payments');
  await expect(page.getByTestId('payment-totals')).toContainText('Captured');
  await expect(page.getByRole('heading', { name: 'Recent payments' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Paid' }).first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('lists plan feedback, newest or lowest rated first (F-AFT-02)', async ({ page }) => {
  await page.goto('/admin/feedback');
  const table = page.getByTestId('feedback-table');
  await expect(table.getByRole('columnheader', { name: 'Needs work' })).toBeVisible();
  // Seeded finished plans have feedback with averages (comments never appear here).
  await expect(table.getByRole('cell', { name: /★$/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Most recent' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('link', { name: 'Lowest rated' }).click();
  await expect(page).toHaveURL(/sort=lowest/);
  await expect(page.getByRole('link', { name: 'Lowest rated' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const ratings = await table
    .locator('tbody tr td:nth-child(4)')
    .evaluateAll((cells) => cells.map((c) => Number.parseFloat(c.textContent)));
  const rated = ratings.filter((r) => !Number.isNaN(r));
  expect(rated.length).toBeGreaterThan(0);
  expect(rated).toEqual([...rated].sort((x, y) => x - y));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('adds a rule badge and a challenge; turns them off (F-GAM-01, F-GAM-03)', async ({ page }) => {
  const key = `e2e_${Date.now() % 1_000_000}`;
  await page.goto('/admin/badges');
  await expect(page.getByTestId('badge-grass_toucher')).toContainText('Grass Toucher');
  const form = page.getByRole('form', { name: 'New badge' });
  await form.getByLabel('Key').fill(key);
  await form.getByLabel('Emoji').fill('🧪');
  for (const [field, value] of [
    ['Name (English)', 'Tester'],
    ['Name (Telugu)', 'టెస్టర్'],
    ['Name (Hindi)', 'टेस्टर'],
    ['Description (English)', 'Checked in at 3 venues'],
    ['Description (Telugu)', '3 వెన్యూల్లో చెక్-ఇన్'],
    ['Description (Hindi)', '3 वेन्यू पर चेक-इन'],
  ] as const)
    await form.getByLabel(field).fill(value);
  await form.getByLabel('Rule').selectOption('distinct');
  await form.getByLabel('Different', { exact: true }).selectOption('venueId');
  await form.getByLabel('Threshold').fill('3');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText(`Saved: Tester`)).toBeVisible();
  const row = page.getByTestId(`badge-${key}`);
  await expect(row).toContainText('How many different: Check-ins · Venues ≥ 3');
  await row.getByRole('button', { name: 'Turn off Tester' }).click();
  await expect(row).toContainText('Off');

  await page.goto('/admin/challenges');
  // A run-unique title: the e2e database persists between local runs.
  const title = `E2E café crawl ${String(Date.now() % 100_000)}`;
  const ch = page.getByRole('form', { name: 'New challenge' });
  await ch.getByLabel('Emoji').fill('☕');
  for (const [field, value] of [
    ['Title (English)', title],
    ['Title (Telugu)', 'కేఫ్ క్రాల్'],
    ['Title (Hindi)', 'कैफ़े क्रॉल'],
    ['Description (English)', 'Three new cafés'],
    ['Description (Telugu)', 'మూడు కొత్త కేఫ్‌లు'],
    ['Description (Hindi)', 'तीन नए कैफ़े'],
  ] as const)
    await ch.getByLabel(field).fill(value);
  await ch.getByLabel('Starts (IST)').fill('2026-11-01T09:00');
  await ch.getByLabel('Ends (IST)').fill('2026-11-30T21:00');
  await ch.getByLabel('Count different').selectOption('venueId');
  await ch.getByLabel('Reward badge').selectOption({ label: '🌱 Grass Toucher' });
  await ch.getByLabel('New places only').check();
  await ch.getByRole('button', { name: 'Save' }).click();
  await expect(ch.getByText(`Saved: ${title}`)).toBeVisible();
  const table = page.getByTestId('challenges-table');
  const challengeRow = table.getByRole('row', { name: new RegExp(title) });
  await expect(challengeRow).toContainText('On');
  await table.getByRole('button', { name: `Turn off ${title}` }).click();
  await expect(challengeRow).toContainText('Off');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('every admin action is in the audit log', async ({ page }) => {
  await page.goto('/admin/audit-log');
  for (const action of [
    'invite_codes.bulk_create',
    'invite_codes.revoke',
    'feature_flags.set',
    'settings.set',
    'icebreaker.create',
    'icebreaker.update',
    'host_application.approve',
    'perk.create',
    'badge.create',
    'challenge.create',
  ]) {
    await expect(page.getByRole('cell', { name: action }).first()).toBeVisible();
  }
});

test.describe('access control', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous visitors are sent to sign in', async ({ page }) => {
    await page.goto('/admin/invite-codes');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('members without an admin role are refused', async ({ page }) => {
    await signInAs(page, MEMBER_PHONE);
    await expect(
      page.getByRole('alert').filter({ hasText: 'This account has no admin access.' }),
    ).toBeVisible();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

// Last: signing out revokes the shared admin session used by the tests above.
test('sign out ends the session', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto('/admin/invite-codes');
  await expect(page).toHaveURL(/\/admin\/login$/);
});
