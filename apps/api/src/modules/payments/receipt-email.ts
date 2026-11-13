import { formatPaise, type Receipt, resources, type SupportedLanguage } from '@touchgrass/shared';
import type { EmailMessage } from '../../adapters/email/email.port.js';
import { brandedEmail } from '../../common/email/branded.js';

const LOCALE: Record<SupportedLanguage, string> = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

/** Receipt email (F-PAY-05) in the buyer's language: plain text plus the branded HTML layout (D-187). */
export function receiptEmail(
  to: string,
  r: Receipt,
  language: SupportedLanguage,
  siteUrl: string,
): EmailMessage {
  const t = resources[language].payments;
  const money = (p: number): string => formatPaise(p, language);
  const when = new Intl.DateTimeFormat(LOCALE[language], {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
  const refunded = r.amountPaise - r.netPaidPaise;
  const rows: [string, string][] = [
    [r.event.title, when.format(new Date(r.event.startsAt))],
    [fill(t.hostedBy, { name: r.hostName }), ''],
    [t.amountPaid, money(r.amountPaise)],
    [t.platformFee, money(r.platformFeePaise)],
    [t.gst, money(r.gstPaise)],
    ...(refunded > 0 ? ([[t.refunded, `− ${money(refunded)}`]] as [string, string][]) : []),
    [t.netPaid, money(r.netPaidPaise)],
    ...(r.method ? ([[t.method, r.method.toUpperCase()]] as [string, string][]) : []),
    [t.seller, r.sellerGstin ? `${r.sellerName} (GSTIN ${r.sellerGstin})` : r.sellerName],
  ];
  const title = fill(t.receiptNumber, { number: r.number });
  const text = [
    title,
    when.format(new Date(r.issuedAt)),
    '',
    ...rows.map(([a, b]) => (b ? `${a}: ${b}` : a)),
  ].join('\n');
  const html = brandedEmail({
    language,
    siteUrl,
    preheader: title,
    blocks: [
      { kind: 'heading', text: title },
      { kind: 'text', text: when.format(new Date(r.issuedAt)), muted: true },
      { kind: 'rows', rows },
    ],
    footer: resources[language].landing.inviteEmail.footer,
  });
  return { to, subject: `TouchGrass · ${title}`, text, html };
}
