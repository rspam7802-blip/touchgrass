import { describe, expect, it } from 'vitest';
import { colors, contrastRatio, relativeLuminance } from './tokens';

describe('design tokens', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => relativeLuminance('green')).toThrow(RangeError);
  });
  for (const scheme of ['light', 'dark'] as const) {
    const c = colors[scheme];
    const pairs: [string, string, string][] = [
      ['text/background', c.text, c.background],
      ['text/surface', c.text, c.surface],
      ['textMuted/surface', c.textMuted, c.surface],
      ['textMuted/background', c.textMuted, c.background],
      ['onPrimary/primary', c.onPrimary, c.primary],
      ['onAccent/accent', c.onAccent, c.accent],
      ['onDanger/danger', c.onDanger, c.danger],
      ['text/surfaceAlt', c.text, c.surfaceAlt],
      // tone="primary" / tone="danger" text (links, statuses, errors) on every surface (Phase 12 audit).
      ['primary/surface', c.primary, c.surface],
      ['primary/background', c.primary, c.background],
      ['danger/surface', c.danger, c.surface],
      ['danger/background', c.danger, c.background],
      ['textMuted/surfaceAlt', c.textMuted, c.surfaceAlt],
    ];
    // Non-text contrast (WCAG 1.4.11): focus rings and the borders that outline inputs.
    for (const [name, fg, bg] of [
      ['focus/background', c.focus, c.background],
      ['focus/surface', c.focus, c.surface],
      ['inputBorder/surface', c.inputBorder, c.surface],
      ['inputBorder/background', c.inputBorder, c.background],
    ] as const) {
      it(`${scheme}: ${name} meets 3:1 for UI components`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
      });
    }
    for (const [name, fg, bg] of pairs) {
      it(`${scheme}: ${name} meets WCAG AA (4.5:1)`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
