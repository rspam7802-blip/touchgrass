import nodemailer, { type Transporter } from 'nodemailer';
import { type EmailMessage, EmailSender } from './email.port.js';

/** SMTP sender; in development this points at Mailpit (http://localhost:8025). */
export class SmtpEmailSender extends EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
