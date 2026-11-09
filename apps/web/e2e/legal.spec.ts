import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = [
  { path: '/privacy', title: 'Privacy policy' },
  { path: '/terms', title: 'Terms of use' },
  { path: '/refunds', title: 'Refund and cancellation policy' },
  { path: '/contact', title: 'Contact and grievances' },
];

for (const p of pages) {
  test(`${p.path} is published, linked from the footer and passes axe`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.title);
    const nav = page.getByRole('navigation', { name: 'Legal' });
    await expect(nav.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test('contact page names the grievance contact', async ({ page }) => {
  await page.goto('/contact');
  await expect(page.getByTestId('grievance-email')).toHaveText('support@touchgrass.test');
});

test('landing page links to the legal pages', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Legal' })
    .getByRole('link', { name: 'Terms' })
    .click();
  await expect(page).toHaveURL(/\/terms$/);
});
