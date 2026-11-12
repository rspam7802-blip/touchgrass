import { type FetchFn, requestJson } from '../http/http-client.js';
import { type EmailMessage, EmailSender } from './email.port.js';

/** `Name <address>` or a bare address, as in EMAIL_FROM. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(from);
  if (!match?.[2]) return { email: from.trim() };
  const name = match[1]?.replace(/^"|"$/g, '').trim();
  return name ? { name, email: match[2] } : { email: match[2] };
}

/**
 * Brevo's transactional email API over HTTPS. Hosts that block outbound SMTP (Railway below the Pro plan)
 * can still send this way. The sender address must be verified in Brevo.
 */
export class BrevoEmailSender extends EmailSender {
  private readonly sender: { name?: string; email: string };

  constructor(
    private readonly apiKey: string,
    from: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly url = 'https://api.brevo.com/v3/smtp/email',
  ) {
    super();
    this.sender = parseSender(from);
  }

  async send(message: EmailMessage): Promise<void> {
    await requestJson(this.fetchFn, 'brevo', this.url, {
      method: 'POST',
      headers: { 'api-key': this.apiKey },
      body: {
        sender: this.sender,
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      },
      timeoutMs: 10_000,
    });
  }
}
