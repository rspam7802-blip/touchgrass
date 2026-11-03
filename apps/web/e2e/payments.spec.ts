import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { API, token } from './api-helpers';

/** Seeded venue staff PIN for partner venues (apps/api/src/seed/payments.seed.ts). */
const STAFF_PIN = '2468';

/** Distinct seeded members per Playwright project so parallel projects never share an OTP window. */
function members(project: string): { host: string; guest: string; buyer: string } {
  const base = project === 'mobile' ? 170 : 160;
  return {
    // Seed persona n is verified when n % 3 === 0.
    host: `+919000010${String(project === 'mobile' ? 6 : 3).padStart(3, '0')}`,
    guest: `+9190000${String(10_000 + base)}`,
    buyer: `+9190000${String(10_000 + base + 1)}`,
  };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test('checkout page shows the order and (in test mode) plays the bank', async ({
  page,
  request,
}, info) => {
  const m = members(info.project.name);
  const buyer = await token(request, m.buyer);
  // The first upcoming seeded paid plan this member has not already bought (reruns buy the next one).
  let path = '';
  let title = '';
  for (let n = 0; n < 4 && !path; n += 1) {
    const plan = await request.get(`${API}/v1/events/by-slug/seedpd${String(n).padStart(3, '0')}`, {
      headers: auth(buyer),
    });
    expect(plan.status()).toBe(200);
    const e = (await plan.json()) as { id: string; title: string };
    const res = await request.post(`${API}/v1/events/${e.id}/checkout`, {
      headers: {
        ...auth(buyer),
        'Idempotency-Key': `e2e-${String(Date.now())}-${info.project.name}-${String(n)}`,
      },
      data: {},
    });
    if (res.status() !== 201) continue;
    const body = (await res.json()) as { kind: string; session?: { checkoutUrl: string } };
    if (body.kind !== 'checkout' || !body.session) continue;
    path = new URL(body.session.checkoutUrl).pathname;
    title = e.title;
  }
  expect(path).not.toBe('');

  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByTestId('checkout-amount')).toHaveText(/^₹\d/);
  await expect(page.getByText('Test mode: no real money moves.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to TouchGrass' })).toHaveAttribute(
    'href',
    /^touchgrass:\/\/payments\//,
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('button', { name: 'Test payment: succeed' }).click();
  await expect(page.getByTestId('checkout-paid')).toBeVisible();
});

test('unknown checkout and perk links are not found', async ({ page }) => {
  await page.goto(`/pay/${'x'.repeat(43)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("We couldn't find that.");
  await page.goto(`/r/${'y'.repeat(43)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("We couldn't find that.");
});

test('venue staff redeem a perk pass once with the venue PIN', async ({ page, request }, info) => {
  const m = members(info.project.name);
  const host = await token(request, m.host);
  const guest = await token(request, m.guest);
  // Partner venues with a small-group perk, found through the seeded paid plans held there.
  const venueIds = new Set<string>();
  for (let n = 0; n < 6; n += 1) {
    const res = await request.get(`${API}/v1/events/by-slug/seedpd${String(n).padStart(3, '0')}`, {
      headers: auth(guest),
    });
    if (!res.ok()) continue;
    const e = (await res.json()) as {
      perks: { perk: { venueId: string; minGroupSize: number } }[];
    };
    for (const p of e.perks) if (p.perk.minGroupSize <= 2) venueIds.add(p.perk.venueId);
  }
  // Each project uses its own venue so wrong-PIN counts (per venue) never add up across projects.
  const venueId = [...venueIds].sort()[info.project.name === 'mobile' ? 1 : 0];
  expect(venueId).toBeDefined();
  const interests = (await (await request.get(`${API}/v1/interests`)).json()) as {
    items: { id: string }[];
  };
  const start = Date.now() + 60 * 60_000;
  const plotted = await request.post(`${API}/v1/events`, {
    headers: { ...auth(host), 'Idempotency-Key': `e2e-plot-${String(start)}-${info.project.name}` },
    data: {
      title: 'Chai and chess',
      categoryInterestId: interests.items[0]?.id,
      where: { venueId },
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 2 * 3_600_000).toISOString(),
      capacity: 6,
    },
  });
  expect(plotted.status()).toBe(201);
  const plan = (await plotted.json()) as { id: string };
  const going = await request.put(`${API}/v1/events/${plan.id}/rsvp`, {
    headers: {
      ...auth(guest),
      'Idempotency-Key': `e2e-rsvp-${String(start)}-${info.project.name}`,
    },
    data: { status: 'going' },
  });
  expect(going.status()).toBe(200);
  const detail = (await (
    await request.get(`${API}/v1/events/${plan.id}`, { headers: auth(guest) })
  ).json()) as {
    perks: { perk: { id: string }; canRedeem: boolean }[];
  };
  const perk = detail.perks.find((p) => p.canRedeem);
  expect(perk).toBeDefined();
  const pass = (await (
    await request.post(`${API}/v1/events/${plan.id}/perks/${perk?.perk.id ?? ''}/pass`, {
      headers: auth(guest),
    })
  ).json()) as { qr: string };

  await page.goto(new URL(pass.qr).pathname);
  await expect(page.getByText('Redeem a TouchGrass perk')).toBeVisible();
  await expect(page.getByText(/Group of 2/)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByLabel('Venue staff PIN').fill('0000');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    "That PIN doesn't match this venue.",
  );
  await page.getByLabel('Venue staff PIN').fill(STAFF_PIN);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('perk-done')).toHaveText('Done! Perk used.');
  await page.reload();
  await expect(page.getByTestId('perk-already')).toBeVisible();
});
