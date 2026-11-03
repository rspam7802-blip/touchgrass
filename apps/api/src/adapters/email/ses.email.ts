import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { type EmailMessage, EmailSender } from './email.port.js';

export class SesEmailSender extends EmailSender {
  private readonly client: SESv2Client;

  constructor(
    region: string,
    private readonly from: string,
    client?: SESv2Client,
  ) {
    super();
    this.client = client ?? new SESv2Client({ region });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
  }
}
