import { BRAND, type SupportedLanguage } from '@touchgrass/shared';

/** Brand colours for email (the app's lime and forest, D-144). Inline styles only: mail apps drop <style>. */
const C = {
  lime: '#E5FB46',
  forest: '#0B130E',
  forestSoft: '#26382B',
  page: '#F4F5F0',
  card: '#FFFFFF',
  text: '#142017',
  muted: '#526055',
  border: '#D7DDD3',
};
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Telugu', 'Noto Sans Devanagari', Arial, sans-serif";

export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** One block of the email body. Text is escaped here; never pass HTML in. */
export type EmailBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; muted?: boolean }
  | { kind: 'code'; text: string; label?: string }
  | { kind: 'button'; text: string; href: string }
  | { kind: 'rows'; rows: [string, string][] };

function block(b: EmailBlock): string {
  switch (b.kind) {
    case 'heading':
      return `<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:800;color:${C.text}">${escapeHtml(b.text)}</h1>`;
    case 'text':
      return `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${b.muted ? C.muted : C.text}">${escapeHtml(b.text)}</p>`;
    case 'code':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td align="center" style="background:${C.forest};border-radius:16px;padding:20px 16px">${
        b.label
          ? `<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${C.lime};margin-bottom:8px">${escapeHtml(b.label)}</div>`
          : ''
      }<div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:30px;font-weight:800;letter-spacing:6px;color:${C.lime}">${escapeHtml(b.text)}</div></td></tr></table>`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="background:${C.lime};border-radius:999px"><a href="${escapeHtml(b.href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:800;color:${C.forest};text-decoration:none">${escapeHtml(b.text)}</a></td></tr></table>`;
    case 'rows':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-top:1px solid ${C.border}">${b.rows
        .map(
          ([a, v]) =>
            `<tr><th scope="row" align="left" style="padding:10px 12px 10px 0;border-bottom:1px solid ${C.border};font-size:14px;font-weight:600;color:${C.text}">${escapeHtml(a)}</th><td align="right" style="padding:10px 0;border-bottom:1px solid ${C.border};font-size:14px;color:${C.text}">${escapeHtml(v)}</td></tr>`,
        )
        .join('')}</table>`;
  }
}

/**
 * The TouchGrass email layout (D-187): forest header with the logo and tagline, a white card with the
 * content, and a footer with the website. Table-based with inline styles so Gmail, Outlook and phone mail
 * apps all show it the same; the plain-text part is sent alongside for clients that prefer it.
 */
export function brandedEmail(input: {
  language: SupportedLanguage;
  siteUrl: string;
  preheader: string;
  blocks: EmailBlock[];
  footer: string;
}): string {
  const site = input.siteUrl.replace(/\/$/, '');
  const host = site.replace(/^https?:\/\//, '');
  return `<!doctype html>
<html lang="${input.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(BRAND.name)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:${C.forest};border-radius:20px 20px 0 0;padding:24px 28px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px"><img src="${site}/email-logo.png" width="44" height="44" alt="" style="display:block;border-radius:10px"></td>
<td><div style="font-size:20px;font-weight:800;color:#FFFFFF">${escapeHtml(BRAND.name)}<span style="color:${C.lime}">.</span></div><div style="font-size:13px;color:${C.lime}">${escapeHtml(BRAND.tagline)}</div></td>
</tr></table></td></tr>
<tr><td style="background:${C.card};padding:32px 28px 16px;border-left:1px solid ${C.border};border-right:1px solid ${C.border}">
${input.blocks.map(block).join('\n')}
</td></tr>
<tr><td style="background:${C.forestSoft};border-radius:0 0 20px 20px;padding:18px 28px;font-size:13px;line-height:20px;color:#D7DDD3">
${escapeHtml(input.footer)}<br><a href="${site}" style="color:${C.lime};text-decoration:none;font-weight:700">${escapeHtml(host)}</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}
