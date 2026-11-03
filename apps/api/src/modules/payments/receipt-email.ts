import { formatPaise, type Receipt, resources, type SupportedLanguage } from '@touchgrass/shared';
import type { EmailMessage } from '../../adapters/email/email.port.js';

const LOCALE: Record<SupportedLanguage, string> = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

/** Receipt email (F-PAY-05) in the buyer's language: plain text plus a minimal, accessible HTML table. */
export function receiptEmail(to: string, r: Receipt, language: SupportedLanguage): EmailMessage {
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
  const html = `<!doctype html><html lang="${language}"><body style="font-family:sans-serif;color:#111">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
<p>${escapeHtml(when.format(new Date(r.issuedAt)))}</p>
<table role="presentation" style="border-collapse:collapse">${rows
    .map(
      ([a, b]) =>
        `<tr><th scope="row" style="text-align:left;padding:4px 12px 4px 0;font-weight:600">${escapeHtml(a)}</th><td style="padding:4px 0">${escapeHtml(b)}</td></tr>`,
    )
    .join('')}</table>
</body></html>`;
  return { to, subject: `TouchGrass · ${title}`, text, html };
}
