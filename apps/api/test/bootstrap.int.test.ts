import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/infra/database/schema/index.js';
import { grantSuperAdmin, seedReference } from '../src/seed/reference.js';
import { createHarness, freshPhone, type Harness, setInviteGate, signIn } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await setInviteGate(h, true);
});
afterAll(async () => {
  await h.close();
});

describe('production bootstrap', () => {
  it('loads reference data idempotently and lets the first admin in past the invite gate', async () => {
    const db = drizzle(h.pool, { schema });
    const first = await db.transaction((tx) => seedReference(tx));
    const second = await db.transaction((tx) => seedReference(tx));
    expect(second).toEqual(first);
    expect(first.hoodIds.length).toBeGreaterThanOrEqual(5);
    expect(first.interestIds.length).toBeGreaterThan(10);
    const { rows: deck } = await h.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM icebreaker_cards`,
    );
    expect(deck[0]?.n).toBeGreaterThan(0);

    const phone = freshPhone();
    const granted = await db.transaction((tx) => grantSuperAdmin(tx, phone));
    expect(granted.created).toBe(true);
    const again = await db.transaction((tx) => grantSuperAdmin(tx, phone));
    expect(again).toEqual({ userId: granted.userId, created: false });
    const { rows: roles } = await h.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1 AND role = 'super_admin'`,
      [granted.userId],
    );
    expect(roles[0]?.n).toBe(1);

    // No invite code: the account already exists, so the gate doesn't apply, and the token carries the role.
    const auth = await signIn(h, phone, { inviteCode: null });
    expect(auth.isNewUser).toBe(false);
    expect(auth.user).toMatchObject({ id: granted.userId, status: 'onboarding' });
    expect(auth.user.roles).toContain('super_admin');
  });

  it('refuses to promote a suspended or deleted account', async () => {
    const db = drizzle(h.pool, { schema });
    const { user, phone } = await signIn(h);
    await h.pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [user.id]);
    await expect(db.transaction((tx) => grantSuperAdmin(tx, phone))).rejects.toThrow(/suspended/);
  });
});
