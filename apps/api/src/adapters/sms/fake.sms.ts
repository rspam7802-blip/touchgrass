import { Logger } from '@nestjs/common';
import { SmsSender, type SmsTemplate } from './sms.port.js';

export interface SentSms {
  to: string;
  kind: 'otp' | SmsTemplate;
  body: string;
  at: Date;
}

/** Dev/test SMS: logs the OTP to the console and keeps a bounded in-memory outbox for assertions. */
export class FakeSmsSender extends SmsSender {
  private readonly logger = new Logger('FakeSMS');
  readonly sent: SentSms[] = [];

  sendOtp(phoneE164: string, code: string): Promise<void> {
    this.record({ to: phoneE164, kind: 'otp', body: code, at: new Date() });
    this.logger.log(`OTP for ${phoneE164}: ${code}`);
    return Promise.resolve();
  }

  sendTemplate(
    phoneE164: string,
    template: SmsTemplate,
    variables: Record<string, string>,
  ): Promise<void> {
    this.record({ to: phoneE164, kind: template, body: JSON.stringify(variables), at: new Date() });
    this.logger.log(`SMS ${template} to ${phoneE164}`);
    return Promise.resolve();
  }

  lastOtpFor(phoneE164: string): string | undefined {
    return [...this.sent].reverse().find((s) => s.to === phoneE164 && s.kind === 'otp')?.body;
  }

  private record(sms: SentSms): void {
    this.sent.push(sms);
    if (this.sent.length > 1000) this.sent.shift();
  }
}
