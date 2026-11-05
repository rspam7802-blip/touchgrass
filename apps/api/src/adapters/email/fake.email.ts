import { Logger } from '@nestjs/common';
import { type EmailMessage, EmailSender } from './email.port.js';

/**
 * Keeps emails instead of sending them (tests and test servers without a mail service). The log line shows
 * only the recipient's domain and the subject, never the body or the full address.
 */
export class FakeEmailSender extends EmailSender {
  private readonly logger = new Logger(FakeEmailSender.name);
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.sent.length > 200) this.sent.shift();
    const domain = message.to.split('@')[1] ?? 'unknown';
    this.logger.log(`Email kept, not sent: "${message.subject}" to someone at ${domain}`);
    return Promise.resolve();
  }
}
