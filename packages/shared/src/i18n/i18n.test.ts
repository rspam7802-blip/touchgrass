import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../constants';
import { ErrorCode } from '../errors';
import { flattenKeys, interpolationVariables, resources } from './index';

const enKeys = flattenKeys(resources.en);

describe('i18n resources', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const flat = flattenKeys(resources[lang]);
    it(`${lang} has exactly the English key set`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(enKeys).sort());
    });
    it(`${lang} has no empty strings and matching interpolation variables`, () => {
      for (const [key, value] of Object.entries(flat)) {
        expect(value.trim(), key).not.toBe('');
        expect(interpolationVariables(value), key).toEqual(
          interpolationVariables(enKeys[key] ?? ''),
        );
      }
    });
  }
  it('has a translated message for every error code', () => {
    for (const code of ErrorCode.options) expect(enKeys[`errors.${code}`]).toBeTruthy();
  });
  it('telugu and hindi strings use their native scripts', () => {
    expect(flattenKeys(resources.te)['states.loading']).toMatch(/[ఀ-౿]/);
    expect(flattenKeys(resources.hi)['states.loading']).toMatch(/[ऀ-ॿ]/);
  });

  // Translation review (F-A11Y-03, Phase 12): every Telugu / Hindi string is actually translated, in the
  // right script. Only language-neutral strings may match English: the brand, each language's own name,
  // universal abbreviations, and strings made of placeholders and punctuation alone.
  const NEUTRAL = new Set([
    'brand.name',
    'settings.languageNames.en',
    'settings.languageNames.te',
    'settings.languageNames.hi',
    'admin.gst',
    'safety.sos',
  ]);
  const onlyPlaceholders = (v: string): boolean => !/\p{L}/u.test(v.replace(/\{\{[^}]*\}\}/g, ''));
  const SCRIPTS = { te: /[\u0C00-\u0C7F]/, hi: /[\u0900-\u097F]/ } as const;
  for (const lang of ['te', 'hi'] as const) {
    it(`${lang}: nothing left in English, nothing in the other Indian script`, () => {
      const other = lang === 'te' ? SCRIPTS.hi : SCRIPTS.te;
      for (const [key, value] of Object.entries(flattenKeys(resources[lang]))) {
        if (NEUTRAL.has(key) || onlyPlaceholders(value)) continue;
        expect([key, SCRIPTS[lang].test(value)]).toEqual([key, true]);
        if (!key.startsWith('settings.languageNames.'))
          expect([key, other.test(value)]).toEqual([key, false]);
      }
    });
  }
  it('extracts interpolation variables', () => {
    expect(interpolationVariables('{{count}} of your {{ who }}')).toEqual(['count', 'who']);
  });
});
