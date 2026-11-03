import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { describe, expect, it, vi } from 'vitest';
import { SesEmailSender } from './ses.email.js';
import { SmtpEmailSender } from './smtp.email.js';

const message = {
  to: 'host@example.com',
  subject: 'Your receipt',
  html: '<p>₹499</p>',
  text: '₹499',
};

describe('email senders', () => {
  it('SES sends a UTF-8 simple message', async () => {
    const client = { send: vi.fn().mockResolvedValue({}) } as unknown as SESv2Client;
    await new SesEmailSender('ap-south-1', 'TouchGrass <hello@touchgrass.app>', client).send(
      message,
    );
    const cmd = vi.mocked(client.send).mock.calls[0]?.[0] as SendEmailCommand;
    expect(cmd).toBeInstanceOf(SendEmailCommand);
    expect(cmd.input.Destination?.ToAddresses).toEqual(['host@example.com']);
    expect(cmd.input.Content?.Simple?.Body?.Text?.Data).toBe('₹499');
    expect(new SesEmailSender('ap-south-1', 'x')).toBeInstanceOf(SesEmailSender);
  });
  it('SMTP sender constructs a transport (delivery is covered by the Mailpit integration test)', () => {
    expect(
      new SmtpEmailSender('smtp://localhost:1025', 'TouchGrass <hello@touchgrass.app>'),
    ).toBeInstanceOf(SmtpEmailSender);
  });
});
