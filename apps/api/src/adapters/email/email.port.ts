export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Transactional email (receipts F-PAY-05, admin notices). */
export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<void>;
}
