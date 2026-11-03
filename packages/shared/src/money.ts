import type { SupportedLanguage } from './constants';

/** All money is stored and transported as integer paise (1 INR = 100 paise). */
export type Paise = number;

const LOCALE_TAGS: Record<SupportedLanguage, string> = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };

export function assertPaise(value: number): Paise {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Invalid paise amount: ${value}`);
  }
  return value;
}

export function rupeesToPaise(rupees: number): Paise {
  return assertPaise(Math.round(rupees * 100));
}

export function paiseToRupees(paise: Paise): number {
  return assertPaise(paise) / 100;
}

/** Percentage of an amount expressed in basis points (1% = 100 bps), rounded half-up to whole paise. */
export function percentOfPaise(amount: Paise, basisPoints: number): Paise {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError(`Invalid basis points: ${basisPoints}`);
  }
  return Math.round((assertPaise(amount) * basisPoints) / 10_000);
}

export function formatPaise(paise: Paise, language: SupportedLanguage = 'en'): string {
  const rupees = paiseToRupees(paise);
  return new Intl.NumberFormat(LOCALE_TAGS[language], {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function localeTag(language: SupportedLanguage): string {
  return LOCALE_TAGS[language];
}
