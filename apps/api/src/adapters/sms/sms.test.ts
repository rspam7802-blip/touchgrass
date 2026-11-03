import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonBody } from '../../test-support/env.js';
import { UpstreamError } from '../http/http-client.js';
import { FakeSmsSender } from './fake.sms.js';
import { Msg91SmsSender } from './msg91.sms.js';

describe('Msg91SmsSender', () => {
  const config = {
    authKey: 'key',
    otpTemplateId: 'tpl',
    flowIds: { live_location_share: 'flow1' },
  };
  it('sends OTP via /otp without the + prefix', async () => {
    const f = fakeFetch([{ body: { type: 'success' } }]);
    await new Msg91SmsSender(config, f.fetch).sendOtp('+919848022338', '123456');
    const url = new URL(f.calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/v5/otp');
    expect(url.searchParams.get('mobile')).toBe('919848022338');
    expect(url.searchParams.get('otp')).toBe('123456');
    expect((f.calls[0]?.init?.headers as Record<string, string>).authkey).toBe('key');
  });
  it('sends flow templates with variables', async () => {
    const f = fakeFetch([{ body: { type: 'success' } }]);
    await new Msg91SmsSender(config, f.fetch).sendTemplate('+919848022338', 'live_location_share', {
      link: 'https://x',
    });
    expect(jsonBody(f.calls[0]?.init)).toEqual({
      template_id: 'flow1',
      short_url: '0',
      recipients: [{ mobiles: '919848022338', link: 'https://x' }],
    });
  });
  it('fails on provider errors and unknown templates', async () => {
    await expect(
      new Msg91SmsSender(
        config,
        fakeFetch([{ body: { type: 'error', message: 'bad' } }]).fetch,
      ).sendOtp('+919848022338', '1'),
    ).rejects.toThrow(/bad/);
    await expect(
      new Msg91SmsSender(config, fakeFetch([{ status: 500, body: 'x' }]).fetch).sendOtp(
        '+919848022338',
        '1',
      ),
    ).rejects.toBeInstanceOf(UpstreamError);
    await expect(
      new Msg91SmsSender(config, fakeFetch([]).fetch).sendTemplate(
        '+919848022338',
        'sos_alert',
        {},
      ),
    ).rejects.toThrow(/No MSG91 flow/);
  });
  it('wraps network failures', async () => {
    const failing = (() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    await expect(
      new Msg91SmsSender(config, failing).sendOtp('+919848022338', '1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', upstreamStatus: 0 });
  });
});

describe('FakeSmsSender', () => {
  it('records OTPs and templates', async () => {
    const sms = new FakeSmsSender();
    await sms.sendOtp('+919848022338', '111111');
    await sms.sendOtp('+919848022338', '222222');
    await sms.sendTemplate('+919848022338', 'sos_alert', { name: 'A' });
    expect(sms.lastOtpFor('+919848022338')).toBe('222222');
    expect(sms.lastOtpFor('+910000000000')).toBeUndefined();
    expect(sms.sent).toHaveLength(3);
  });
  it('keeps a bounded outbox', async () => {
    const sms = new FakeSmsSender();
    for (let i = 0; i < 1005; i += 1) await sms.sendOtp('+919848022338', String(i));
    expect(sms.sent).toHaveLength(1000);
  });
});
