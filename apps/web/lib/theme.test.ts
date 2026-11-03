import { colors } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import { cssVariables, THEME_CSS } from './theme';

describe('theme css', () => {
  it('maps tokens to kebab-case custom properties for light and dark', () => {
    expect(cssVariables(colors.light)).toContain(`--tg-on-primary: ${colors.light.onPrimary};`);
    expect(THEME_CSS).toContain('prefers-color-scheme: dark');
    expect(THEME_CSS).toContain(colors.dark.background);
  });
});
