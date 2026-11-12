import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { describe, expect, it, vi } from 'vitest';
import { BrevoEmailSender, parseSender } from './brevo.email.js';
import { FakeEmailSender } from './fake.email.js';
import { SesEmailSender } from './ses.email.js';
import { SmtpEmailSender } from './smtp.email.js';

const message = {
  to: 'host@example.com',
  subject: 'Your receipt',
  html: '<p>₹499</p>',
  text: '₹499',
};

describe('email senders', () => {
  it('the fake sender keeps emails without sending them', async () => {
    const fake = new FakeEmailSender();
    await fake.send(message);
    expect(fake.sent).toEqual([message]);
  });

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

  it('Brevo posts the message to its API with the key and the parsed sender', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"messageId":"m1"}', { status: 201 }));
    await new BrevoEmailSender('key-1', 'TouchGrass <hello@touchgrass.co.in>', fetchFn).send(
      message,
    );
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(new Headers(init.headers).get('api-key')).toBe('key-1');
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: 'TouchGrass', email: 'hello@touchgrass.co.in' },
      to: [{ email: 'host@example.com' }],
      subject: 'Your receipt',
      htmlContent: '<p>₹499</p>',
      textContent: '₹499',
    });
  });

  it('Brevo turns a rejected send into an error the caller can log', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('{"code":"unauthorized"}', { status: 401 }));
    await expect(
      new BrevoEmailSender('bad', 'hello@touchgrass.co.in', fetchFn).send(message),
    ).rejects.toThrow('brevo request failed with status 401');
  });

  it('reads EMAIL_FROM with or without a display name', () => {
    expect(parseSender('TouchGrass <hello@touchgrass.co.in>')).toEqual({
      name: 'TouchGrass',
      email: 'hello@touchgrass.co.in',
    });
    expect(parseSender('"Touch Grass" <a@b.in>')).toEqual({ name: 'Touch Grass', email: 'a@b.in' });
    expect(parseSender('a@b.in')).toEqual({ email: 'a@b.in' });
  });
});
