import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { AnalyticsSink, NoopAnalyticsSink } from './analytics/analytics.port.js';
import { PostHogAnalyticsSink } from './analytics/posthog.js';
import { EmailSender } from './email/email.port.js';
import { SesEmailSender } from './email/ses.email.js';
import { SmtpEmailSender } from './email/smtp.email.js';
import { FakeMapsProvider } from './maps/fake.maps.js';
import { GoogleMapsProvider } from './maps/google.maps.js';
import { MapsProvider } from './maps/maps.port.js';
import { FakeModerationProvider } from './moderation/fake.moderation.js';
import { ModerationProvider } from './moderation/moderation.port.js';
import { RekognitionModerationProvider } from './moderation/rekognition.js';
import { FakePaymentsGateway } from './payments/fake.payments.js';
import { PaymentsGateway } from './payments/payments.port.js';
import { RazorpayPaymentsGateway } from './payments/razorpay.payments.js';
import { ExpoPushSender } from './push/expo.push.js';
import { FakePushSender } from './push/fake.push.js';
import { PushSender } from './push/push.port.js';
import { FakeSmsSender } from './sms/fake.sms.js';
import { Msg91SmsSender } from './sms/msg91.sms.js';
import { SmsSender } from './sms/sms.port.js';
import { MemoryObjectStorage } from './storage/memory.storage.js';
import { S3ObjectStorage } from './storage/s3.storage.js';
import { ObjectStorage } from './storage/storage.port.js';
import { FakeWeatherProvider } from './weather/fake.weather.js';
import { OpenWeatherProvider } from './weather/openweather.js';
import { WeatherProvider } from './weather/weather.port.js';

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export interface AdapterInstances {
  sms: SmsSender;
  payments: PaymentsGateway;
  push: PushSender;
  storage: ObjectStorage;
  maps: MapsProvider;
  weather: WeatherProvider;
  moderation: ModerationProvider;
  analytics: AnalyticsSink;
  email: EmailSender;
}

/** Chooses real or fake implementations from env. Env validation already guarantees required keys. */
export function buildAdapters(env: Env): AdapterInstances {
  return {
    sms:
      env.SMS_PROVIDER === 'msg91'
        ? new Msg91SmsSender({
            authKey: required(env.MSG91_AUTH_KEY, 'MSG91_AUTH_KEY'),
            otpTemplateId: required(env.MSG91_OTP_TEMPLATE_ID, 'MSG91_OTP_TEMPLATE_ID'),
            flowIds: env.MSG91_SMS_FLOW_ID
              ? {
                  live_location_share: env.MSG91_SMS_FLOW_ID,
                  sos_alert: env.MSG91_SMS_FLOW_ID,
                  invite_link: env.MSG91_SMS_FLOW_ID,
                }
              : {},
          })
        : new FakeSmsSender(),
    payments:
      env.PAYMENTS_PROVIDER === 'razorpay'
        ? new RazorpayPaymentsGateway({
            keyId: required(env.RAZORPAY_KEY_ID, 'RAZORPAY_KEY_ID'),
            keySecret: required(env.RAZORPAY_KEY_SECRET, 'RAZORPAY_KEY_SECRET'),
            webhookSecret: required(env.RAZORPAY_WEBHOOK_SECRET, 'RAZORPAY_WEBHOOK_SECRET'),
          })
        : new FakePaymentsGateway(),
    push:
      env.PUSH_PROVIDER === 'expo'
        ? new ExpoPushSender(env.EXPO_ACCESS_TOKEN)
        : new FakePushSender(),
    storage:
      env.STORAGE_PROVIDER === 's3'
        ? new S3ObjectStorage({
            bucket: env.S3_BUCKET_MEDIA,
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
            publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
          })
        : new MemoryObjectStorage(env.MEDIA_PUBLIC_BASE_URL),
    maps:
      env.MAPS_PROVIDER === 'google'
        ? new GoogleMapsProvider(required(env.GOOGLE_MAPS_API_KEY, 'GOOGLE_MAPS_API_KEY'))
        : new FakeMapsProvider(),
    weather:
      env.WEATHER_PROVIDER === 'openweather'
        ? new OpenWeatherProvider(required(env.OPENWEATHER_API_KEY, 'OPENWEATHER_API_KEY'))
        : new FakeWeatherProvider(),
    moderation:
      env.MODERATION_PROVIDER === 'rekognition'
        ? new RekognitionModerationProvider(env.AWS_REGION)
        : new FakeModerationProvider(),
    analytics:
      env.ANALYTICS_PROVIDER === 'posthog'
        ? new PostHogAnalyticsSink(
            required(env.POSTHOG_API_KEY, 'POSTHOG_API_KEY'),
            env.POSTHOG_HOST,
          )
        : new NoopAnalyticsSink(),
    email:
      env.EMAIL_PROVIDER === 'ses'
        ? new SesEmailSender(env.AWS_REGION, env.EMAIL_FROM)
        : new SmtpEmailSender(env.SMTP_URL, env.EMAIL_FROM),
  };
}

@Global()
@Module({})
export class AdaptersModule {
  /** `overrides` lets tests inject specific fakes (e.g. a FakeSmsSender they hold a reference to). */
  static forRoot(env: Env, overrides: Partial<AdapterInstances> = {}): DynamicModule {
    const a = { ...buildAdapters(env), ...overrides };
    const providers: Provider[] = [
      { provide: SmsSender, useValue: a.sms },
      { provide: PaymentsGateway, useValue: a.payments },
      { provide: PushSender, useValue: a.push },
      { provide: ObjectStorage, useValue: a.storage },
      { provide: MapsProvider, useValue: a.maps },
      { provide: WeatherProvider, useValue: a.weather },
      { provide: ModerationProvider, useValue: a.moderation },
      { provide: AnalyticsSink, useValue: a.analytics },
      { provide: EmailSender, useValue: a.email },
    ];
    return { module: AdaptersModule, providers, exports: providers };
  }
}
