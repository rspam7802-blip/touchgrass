import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Phase 12 accessibility pass (F-A11Y-01): every admin section, as the super admin, is axe-clean at WCAG
 * 2.1 AA. Mirrors the dashboard navigation (`lib/admin-nav.ts`).
 */
const SECTIONS = [
  '/admin',
  '/admin/analytics',
  '/admin/users',
  '/admin/verifications',
  '/admin/moderation',
  '/admin/events',
  '/admin/events/new',
  '/admin/cities',
  '/admin/venues',
  '/admin/host-applications',
  '/admin/icebreakers',
  '/admin/taxonomy',
  '/admin/badges',
  '/admin/challenges',
  '/admin/feedback',
  '/admin/payments',
  '/admin/invite-codes',
  '/admin/weights',
  '/admin/notification-templates',
  '/admin/feature-flags',
  '/admin/settings',
  '/admin/team',
  '/admin/audit-log',
];

for (const path of SECTIONS) {
  test(`${path} passes axe (WCAG 2.1 AA)`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page).toHaveTitle(/TouchGrass/);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
