import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('account deletion page explains the in-app steps and passes axe', async ({ page }) => {
  await page.goto('/delete-account');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Delete your TouchGrass account',
  );
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByText(/within 14 days/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'support@touchgrass.test' })).toHaveAttribute(
    'href',
    'mailto:support@touchgrass.test',
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('account deletion page is translated', async ({ page }) => {
  await page.goto('/delete-account?lang=te');
  await expect(page.locator('main')).toHaveAttribute('lang', 'te');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ఀ-౿]/);
  await page.goto('/delete-account?lang=hi');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ऀ-ॿ]/);
});
