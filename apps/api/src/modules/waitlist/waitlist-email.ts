import { resources, type SupportedLanguage } from '@touchgrass/shared';
import type { EmailMessage } from '../../adapters/email/email.port.js';

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

/** The invite a waitlisted person gets by email (D-169), in the language they used on the website. */
export function waitlistInviteEmail(input: {
  to: string;
  name: string;
  code: string;
  validDays: number;
  siteUrl: string;
  language: SupportedLanguage;
}): EmailMessage {
  const t = resources[input.language].landing.inviteEmail;
  const lines = [
    fill(t.greeting, { name: input.name }),
    t.body,
    input.code,
    fill(t.steps, { days: String(input.validDays) }),
    fill(t.site, { url: input.siteUrl }),
    t.signoff,
    resources[input.language].brand.name,
  ];
  const [greeting, body, code, steps, site, signoff, brand] = lines.map(escapeHtml);
  const html = `<!doctype html><html lang="${input.language}"><body style="font-family:sans-serif;color:#111">
<p>${greeting ?? ''}</p>
<p>${body ?? ''}</p>
<p style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:2px">${code ?? ''}</p>
<p>${steps ?? ''}</p>
<p>${site ?? ''}</p>
<p>${signoff ?? ''}<br>${brand ?? ''}</p>
</body></html>`;
  return { to: input.to, subject: t.subject, text: lines.join('\n\n'), html };
}
