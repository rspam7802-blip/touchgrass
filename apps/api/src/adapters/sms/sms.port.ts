/** Transactional SMS (F-ACC-02 OTP, F-SAF-04 live-location links). Templates must be DLT-registered in India. */
export type SmsTemplate = 'live_location_share' | 'sos_alert' | 'invite_link';

export abstract class SmsSender {
  abstract sendOtp(phoneE164: string, code: string): Promise<void>;
  abstract sendTemplate(
    phoneE164: string,
    template: SmsTemplate,
    variables: Record<string, string>,
  ): Promise<void>;
}
