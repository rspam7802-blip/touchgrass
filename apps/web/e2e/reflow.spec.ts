import { expect, test } from '@playwright/test';

/**
 * Reflow (WCAG 1.4.10) and text resize (1.4.4): public pages work at 320 CSS px wide, the equivalent of
 * 1280 px at 400% zoom, and with text at 200%, without sideways scrolling or clipped content.
 */
const PAGES = ['/', '/e/seedev001', '/e/seedev007', '/e/zzzzzzzz'];

test.use({ viewport: { width: 320, height: 640 } });

for (const path of PAGES) {
  test(`${path} reflows at 320px and with 200% text`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}
