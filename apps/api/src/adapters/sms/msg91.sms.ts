import { type FetchFn, requestJson } from '../http/http-client.js';
import { SmsSender, type SmsTemplate } from './sms.port.js';

export interface Msg91Config {
  authKey: string;
  otpTemplateId: string;
  /** Flow (template) ids per transactional template, registered on MSG91 + DLT. */
  flowIds: Partial<Record<SmsTemplate, string>>;
  baseUrl?: string;
}

interface Msg91Response {
  type?: string;
  message?: string;
}

/** MSG91 v5 APIs: /otp for OTP delivery and /flow for DLT-approved transactional templates. */
export class Msg91SmsSender extends SmsSender {
  private readonly baseUrl: string;

  constructor(
    private readonly config: Msg91Config,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
    this.baseUrl = config.baseUrl ?? 'https://control.msg91.com/api/v5';
  }

  private static mobile(phoneE164: string): string {
    return phoneE164.replace(/^\+/, '');
  }

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    const params = new URLSearchParams({
      template_id: this.config.otpTemplateId,
      mobile: Msg91SmsSender.mobile(phoneE164),
      otp: code,
      otp_length: String(code.length),
    });
    const res = await requestJson<Msg91Response>(
      this.fetchFn,
      'msg91',
      `${this.baseUrl}/otp?${params.toString()}`,
      {
        method: 'POST',
        headers: { authkey: this.config.authKey },
        body: {},
      },
    );
    this.assertSuccess(res);
  }

  async sendTemplate(
    phoneE164: string,
    template: SmsTemplate,
    variables: Record<string, string>,
  ): Promise<void> {
    const flowId = this.config.flowIds[template];
    if (!flowId) throw new Error(`No MSG91 flow configured for template "${template}"`);
    const res = await requestJson<Msg91Response>(this.fetchFn, 'msg91', `${this.baseUrl}/flow`, {
      method: 'POST',
      headers: { authkey: this.config.authKey },
      body: {
        template_id: flowId,
        short_url: '0',
        recipients: [{ mobiles: Msg91SmsSender.mobile(phoneE164), ...variables }],
      },
    });
    this.assertSuccess(res);
  }

  private assertSuccess(res: Msg91Response): void {
    if (res.type !== 'success')
      throw new Error(`MSG91 rejected the request: ${res.message ?? 'unknown error'}`);
  }
}
