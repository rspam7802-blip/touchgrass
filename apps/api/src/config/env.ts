import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

/**
 * Every environment variable the backend reads. `.env.example` documents where each secret comes from.
 * Fake adapters are rejected in production by the refinement at the bottom.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_VERSION: z.string().default('0.1.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_PORT: z.coerce.number().int().default(4000),
    /** API processes per container (node:cluster, sharing the port); 1 = no cluster. Stateless, so any count works. */
    API_WORKERS: z.coerce.number().int().min(1).max(64).default(1),
    REALTIME_PORT: z.coerce.number().int().default(4001),
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    WEB_PUBLIC_URL: z.url().default('http://localhost:3000'),
    CORS_ORIGINS: csv.default(['http://localhost:3000', 'http://localhost:8081']),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

    DATABASE_URL: z.string().min(1),
    DATABASE_REPLICA_URL: z.string().min(1).optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(20),
    /**
     * PEM certificate of the database's certificate authority, for hosted Postgres whose certificates are
     * signed by a private CA (Supabase). Connections then require TLS and verify the server against it.
     * Escaped newlines (\\n) are accepted so it fits in one environment variable.
     */
    DATABASE_CA_CERT: z
      .string()
      .refine((v) => v.includes('BEGIN CERTIFICATE'), 'must be a PEM certificate')
      .optional(),
    REDIS_URL: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(32),
    TOKEN_HASH_PEPPER: z.string().min(32),
    SIGNED_URL_SECRET: z.string().min(32),

    MIN_SUPPORTED_APP_VERSION: z.string().default('0.1.0'),
    LATEST_APP_VERSION: z.string().default('0.1.0'),

    SMS_PROVIDER: z.enum(['fake', 'msg91']).default('fake'),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
    MSG91_SMS_FLOW_ID: z.string().optional(),

    /**
     * App Store / Play review sign-in: this one number gets this fixed code instead of an SMS (reviewers
     * can't receive texts). Attempt caps and rate limits still apply. Set both or neither.
     */
    STORE_REVIEW_PHONE: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 phone number')
      .optional(),
    STORE_REVIEW_OTP: z
      .string()
      .regex(/^\d{6}$/, 'must be 6 digits')
      .refine((v) => v !== '000000', 'must not be the development code')
      .optional(),
    /**
     * Outside production, OTP 000000 signs in any number (local development). Turn it off on any server
     * other people can reach (staging), or anyone could sign in as anyone.
     */
    OTP_DEV_BYPASS: bool.default(true),
    /**
     * Test servers without SMS: give each tester their own number and secret code,
     * "+919876543210:482913,+919812345678:730164". Codes replace the SMS for those numbers only, so testers
     * can't sign in as each other. Not allowed in production.
     */
    TEST_LOGINS: z
      .string()
      .regex(
        /^\+[1-9]\d{7,14}:\d{6}(,\+[1-9]\d{7,14}:\d{6})*$/,
        'must be "+<E.164 number>:<6 digits>" pairs separated by commas',
      )
      .refine((v) => !v.split(',').some((p) => p.endsWith(':000000')), 'must not use 000000')
      .optional(),

    // `disabled`: free plans only (D-165), allowed in production; no tickets can be sold.
    PAYMENTS_PROVIDER: z.enum(['fake', 'razorpay', 'disabled']).default('fake'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    /** Fake gateway only: settle refunds, transfers and KYC by itself a moment later (local development). */
    PAYMENTS_FAKE_AUTO_SETTLE: bool.default(true),
    /** Shown on receipts (F-PAY-05). */
    SELLER_LEGAL_NAME: z.string().default('TouchGrass'),
    SELLER_GSTIN: z.string().optional(),

    PUSH_PROVIDER: z.enum(['fake', 'expo']).default('fake'),
    EXPO_ACCESS_TOKEN: z.string().optional(),

    STORAGE_PROVIDER: z.enum(['memory', 's3']).default('s3'),
    S3_ENDPOINT: z.url().optional(),
    /** Local development on a phone: the laptop's Wi-Fi address for the store (signed links use it). */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_BUCKET_MEDIA: z.string().default('touchgrass-media'),
    MEDIA_PUBLIC_BASE_URL: z.url().default('http://localhost:9000/touchgrass-media'),

    MAPS_PROVIDER: z.enum(['fake', 'google']).default('fake'),
    GOOGLE_MAPS_API_KEY: z.string().optional(),

    // `open-meteo` needs no key (free tier is non-commercial; OPEN_METEO_API_KEY for their paid API), `none` hides weather.
    WEATHER_PROVIDER: z.enum(['fake', 'openweather', 'open-meteo', 'none']).default('fake'),
    OPEN_METEO_API_KEY: z.string().optional(),
    OPENWEATHER_API_KEY: z.string().optional(),

    MODERATION_PROVIDER: z.enum(['fake', 'rekognition', 'google-vision']).default('fake'),
    /** Google Cloud Vision API key (restrict it to the Vision API) for MODERATION_PROVIDER=google-vision. */
    GOOGLE_VISION_API_KEY: z.string().optional(),
    AWS_REGION: z.string().default('ap-south-1'),

    ANALYTICS_PROVIDER: z.enum(['noop', 'posthog']).default('noop'),
    POSTHOG_API_KEY: z.string().optional(),
    POSTHOG_HOST: z.url().default('https://eu.i.posthog.com'),

    EMAIL_PROVIDER: z.enum(['smtp', 'ses', 'fake']).default('smtp'),
    SMTP_URL: z.string().default('smtp://localhost:1025'),
    EMAIL_FROM: z.string().default('TouchGrass <hello@touchgrass.app>'),

    /** Video stories are re-encoded by the worker (D-164); the image ships these binaries. */
    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFPROBE_PATH: z.string().default('ffprobe'),

    SENTRY_DSN: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    const requireKeys = (when: boolean, keys: (keyof typeof env)[], reason: string): void => {
      if (!when) return;
      for (const key of keys) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when ${reason}`,
          });
      }
    };
    requireKeys(
      env.SMS_PROVIDER === 'msg91',
      ['MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID', 'MSG91_SMS_FLOW_ID'],
      'SMS_PROVIDER=msg91',
    );
    requireKeys(Boolean(env.STORE_REVIEW_PHONE), ['STORE_REVIEW_OTP'], 'STORE_REVIEW_PHONE is set');
    requireKeys(Boolean(env.STORE_REVIEW_OTP), ['STORE_REVIEW_PHONE'], 'STORE_REVIEW_OTP is set');
    requireKeys(
      env.PAYMENTS_PROVIDER === 'razorpay',
      ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
      'PAYMENTS_PROVIDER=razorpay',
    );
    requireKeys(env.MAPS_PROVIDER === 'google', ['GOOGLE_MAPS_API_KEY'], 'MAPS_PROVIDER=google');
    requireKeys(
      env.MODERATION_PROVIDER === 'google-vision',
      ['GOOGLE_VISION_API_KEY'],
      'MODERATION_PROVIDER=google-vision',
    );
    requireKeys(
      env.WEATHER_PROVIDER === 'openweather',
      ['OPENWEATHER_API_KEY'],
      'WEATHER_PROVIDER=openweather',
    );
    requireKeys(
      env.ANALYTICS_PROVIDER === 'posthog',
      ['POSTHOG_API_KEY'],
      'ANALYTICS_PROVIDER=posthog',
    );

    if (env.NODE_ENV === 'production' && env.TEST_LOGINS)
      ctx.addIssue({
        code: 'custom',
        path: ['TEST_LOGINS'],
        message: 'TEST_LOGINS is not allowed in production',
      });
    if (env.NODE_ENV === 'production') {
      const fakes: [keyof typeof env, string][] = [
        ['SMS_PROVIDER', 'fake'],
        ['PAYMENTS_PROVIDER', 'fake'],
        ['PUSH_PROVIDER', 'fake'],
        ['STORAGE_PROVIDER', 'memory'],
        ['MAPS_PROVIDER', 'fake'],
        ['WEATHER_PROVIDER', 'fake'],
        ['MODERATION_PROVIDER', 'fake'],
        ['EMAIL_PROVIDER', 'fake'],
      ];
      if (env.EMAIL_PROVIDER === 'smtp' && /localhost|127\.0\.0\.1/.test(env.SMTP_URL))
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_URL'],
          message: 'SMTP_URL must point at a real mail server in production',
        });
      for (const [key, fake] of fakes) {
        if (env[key] === fake)
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key}=${fake} is not allowed in production`,
          });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // An empty value means "not set" (`KEY=` in a .env file, or a blank key in the deployed secret).
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(present);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  return result.data;
}
