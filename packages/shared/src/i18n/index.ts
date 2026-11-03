import type { SupportedLanguage } from '../constants';
import { en, type Translation } from './en';
import { hi } from './hi';
import { te } from './te';

export type { Translation };
export const resources: Record<SupportedLanguage, Translation> = { en, te, hi };
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/** Flatten nested keys to dotted paths, e.g. "states.loading". */
export function flattenKeys(obj: object, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value !== null && typeof value === 'object')
      Object.assign(out, flattenKeys(value as object, path));
  }
  return out;
}

export function interpolationVariables(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] ?? '').sort();
}
