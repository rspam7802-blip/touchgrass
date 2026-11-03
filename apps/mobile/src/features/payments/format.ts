import { formatPaise, type RefundPolicy, type SupportedLanguage } from '@touchgrass/shared';

type T = (key: string, opts?: Record<string, unknown>) => string;

export function money(paise: number, language: string): string {
  const lang: SupportedLanguage = language === 'te' || language === 'hi' ? language : 'en';
  return formatPaise(paise, lang);
}

/** "Full refund if you cancel at least 24 h before." (+ host-cancel note). */
export function refundPolicyText(t: T, policy: RefundPolicy): string {
  const main =
    policy.kind === 'none'
      ? t('payments.refundNone')
      : policy.kind === 'partial'
        ? t('payments.refundPartial', { pct: policy.partialPct ?? 0, hours: policy.cutoffHours })
        : t('payments.refundFull', { hours: policy.cutoffHours });
  return `${main} ${t('payments.refundHostCancel')}`;
}
