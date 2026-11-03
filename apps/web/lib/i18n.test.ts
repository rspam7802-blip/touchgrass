import { describe, expect, it } from 'vitest';
import { isSupportedLanguage, resolveLanguage, strings } from './i18n';

describe('web i18n', () => {
  it('prefers an explicit supported language', () => {
    expect(resolveLanguage('te', 'hi-IN,en;q=0.5')).toBe('te');
  });
  it('falls back to Accept-Language by quality, then English', () => {
    expect(resolveLanguage(undefined, 'fr-FR,hi-IN;q=0.8,en;q=0.5')).toBe('hi');
    expect(resolveLanguage('xx', 'fr-FR')).toBe('en');
    expect(resolveLanguage(null, null)).toBe('en');
  });
  it('exposes translations', () => {
    expect(strings('en').brand.tagline).toBe('Log off. Pull up.');
    expect(isSupportedLanguage('hi')).toBe(true);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });
});
