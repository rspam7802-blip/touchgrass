import { resources, type SupportedLanguage } from '@touchgrass/shared';
import type { EmailMessage } from '../../adapters/email/email.port.js';
import { brandedEmail } from '../../common/email/branded.js';

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
  const brand = resources[input.language].brand.name;
  const greeting = fill(t.greeting, { name: input.name });
  const steps = fill(t.steps, { days: String(input.validDays) });
  const site = fill(t.site, { url: input.siteUrl });
  const html = brandedEmail({
    language: input.language,
    siteUrl: input.siteUrl,
    preheader: `${t.body} ${input.code}`,
    blocks: [
      { kind: 'heading', text: greeting },
      { kind: 'text', text: t.body },
      { kind: 'code', text: input.code, label: t.codeLabel },
      { kind: 'text', text: steps },
      { kind: 'button', text: t.cta, href: input.siteUrl },
      { kind: 'text', text: `${t.signoff} ${brand}`, muted: true },
    ],
    footer: t.footer,
  });
  const text = [greeting, t.body, input.code, steps, site, t.signoff, brand].join('\n\n');
  return { to: input.to, subject: t.subject, text, html };
}
