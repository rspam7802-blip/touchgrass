import { AppError } from '../../common/errors/app-error.js';
import { SmsSender, type SmsTemplate } from './sms.port.js';

/**
 * `SMS_PROVIDER=none` (D-166): the server sends no texts. Sign-in codes come from the phone identity
 * provider (Firebase), and the app texts trusted contacts from the person's own phone when an SOS or
 * live-location share could not be sent for them.
 */
export class NoSmsSender extends SmsSender {
  sendOtp(_phoneE164: string, _code: string): Promise<void> {
    return Promise.reject(
      new AppError('FEATURE_DISABLED', 'Sign in with the app’s phone verification', {
        reason: 'SMS_OFF',
      }),
    );
  }
  sendTemplate(
    _phoneE164: string,
    template: SmsTemplate,
    _variables: Record<string, string>,
  ): Promise<void> {
    return Promise.reject(new Error(`SMS is off; ${template} not sent`));
  }
}
