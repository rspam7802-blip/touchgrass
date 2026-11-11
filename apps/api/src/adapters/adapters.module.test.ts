import { describe, expect, it } from 'vitest';
import { testEnv } from '../test-support/env.js';
import { buildAdapters, AdaptersModule } from './adapters.module.js';
import { NoopAnalyticsSink } from './analytics/analytics.port.js';
import { PostHogAnalyticsSink } from './analytics/posthog.js';
import { SesEmailSender } from './email/ses.email.js';
import { SmtpEmailSender } from './email/smtp.email.js';
import { FakeMapsProvider } from './maps/fake.maps.js';
import { GoogleMapsProvider } from './maps/google.maps.js';
import { FakeModerationProvider } from './moderation/fake.moderation.js';
import { RekognitionModerationProvider } from './moderation/rekognition.js';
import { FakePaymentsGateway } from './payments/fake.payments.js';
import { RazorpayPaymentsGateway } from './payments/razorpay.payments.js';
import { ExpoPushSender } from './push/expo.push.js';
import { FakePushSender } from './push/fake.push.js';
import { FakeSmsSender } from './sms/fake.sms.js';
import { Msg91SmsSender } from './sms/msg91.sms.js';
import { MemoryObjectStorage } from './storage/memory.storage.js';
import { S3ObjectStorage } from './storage/s3.storage.js';
import { FakeWeatherProvider } from './weather/fake.weather.js';
import { OpenWeatherProvider } from './weather/openweather.js';
import { GoogleVisionModerationProvider } from './moderation/google-vision.js';
import { DisabledPaymentsGateway } from './payments/disabled.payments.js';
import { FakePhoneVerifier } from './phone-auth/fake.phone-auth.js';
import { FirebasePhoneVerifier } from './phone-auth/firebase.phone-auth.js';
import { NoPhoneIdentityVerifier } from './phone-auth/phone-auth.port.js';
import { NoSmsSender } from './sms/none.sms.js';
import { NoWeatherProvider, OpenMeteoProvider } from './weather/open-meteo.js';

describe('buildAdapters', () => {
  it('uses fakes by default', () => {
    const a = buildAdapters(testEnv());
    expect(a.sms).toBeInstanceOf(FakeSmsSender);
    expect(a.payments).toBeInstanceOf(FakePaymentsGateway);
    expect(a.push).toBeInstanceOf(FakePushSender);
    expect(a.storage).toBeInstanceOf(MemoryObjectStorage);
    expect(a.maps).toBeInstanceOf(FakeMapsProvider);
    expect(a.weather).toBeInstanceOf(FakeWeatherProvider);
    expect(a.moderation).toBeInstanceOf(FakeModerationProvider);
    expect(a.analytics).toBeInstanceOf(NoopAnalyticsSink);
    expect(a.email).toBeInstanceOf(SmtpEmailSender);
    expect(a.phoneAuth).toBeInstanceOf(NoPhoneIdentityVerifier);
  });
  it('uses the lean-launch choices (D-165, D-166)', () => {
    const lean = buildAdapters(
      testEnv({
        SMS_PROVIDER: 'none',
        PHONE_AUTH_PROVIDER: 'firebase',
        FIREBASE_PROJECT_ID: 'touchgrass',
        PAYMENTS_PROVIDER: 'disabled',
        WEATHER_PROVIDER: 'open-meteo',
        MODERATION_PROVIDER: 'google-vision',
        GOOGLE_VISION_API_KEY: 'v',
      }),
    );
    expect(lean.sms).toBeInstanceOf(NoSmsSender);
    expect(lean.phoneAuth).toBeInstanceOf(FirebasePhoneVerifier);
    expect(lean.payments).toBeInstanceOf(DisabledPaymentsGateway);
    expect(lean.weather).toBeInstanceOf(OpenMeteoProvider);
    expect(lean.moderation).toBeInstanceOf(GoogleVisionModerationProvider);
    const off = buildAdapters(testEnv({ WEATHER_PROVIDER: 'none', PHONE_AUTH_PROVIDER: 'fake' }));
    expect(off.weather).toBeInstanceOf(NoWeatherProvider);
    expect(off.phoneAuth).toBeInstanceOf(FakePhoneVerifier);
  });
  it('uses real providers when configured', () => {
    const a = buildAdapters(
      testEnv({
        SMS_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: 'k',
        MSG91_OTP_TEMPLATE_ID: 't',
        MSG91_SMS_FLOW_ID: 'f',
        PAYMENTS_PROVIDER: 'razorpay',
        RAZORPAY_KEY_ID: 'k',
        RAZORPAY_KEY_SECRET: 's',
        RAZORPAY_WEBHOOK_SECRET: 'w',
        PUSH_PROVIDER: 'expo',
        STORAGE_PROVIDER: 's3',
        MAPS_PROVIDER: 'google',
        GOOGLE_MAPS_API_KEY: 'g',
        WEATHER_PROVIDER: 'openweather',
        OPENWEATHER_API_KEY: 'o',
        MODERATION_PROVIDER: 'rekognition',
        ANALYTICS_PROVIDER: 'posthog',
        POSTHOG_API_KEY: 'p',
        EMAIL_PROVIDER: 'ses',
      }),
    );
    expect(a.sms).toBeInstanceOf(Msg91SmsSender);
    expect(a.payments).toBeInstanceOf(RazorpayPaymentsGateway);
    expect(a.push).toBeInstanceOf(ExpoPushSender);
    expect(a.storage).toBeInstanceOf(S3ObjectStorage);
    expect(a.maps).toBeInstanceOf(GoogleMapsProvider);
    expect(a.weather).toBeInstanceOf(OpenWeatherProvider);
    expect(a.moderation).toBeInstanceOf(RekognitionModerationProvider);
    expect(a.analytics).toBeInstanceOf(PostHogAnalyticsSink);
    expect(a.email).toBeInstanceOf(SesEmailSender);
  });
  it('builds a global module honouring overrides', () => {
    const sms = new FakeSmsSender();
    const mod = AdaptersModule.forRoot(testEnv(), { sms });
    expect(mod.providers).toHaveLength(10);
    expect(mod.providers?.[0]).toMatchObject({ useValue: sms });
  });
});
