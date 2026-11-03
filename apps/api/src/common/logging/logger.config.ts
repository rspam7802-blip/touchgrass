import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.js';

/** Pino with request ids and redaction of credentials and personal data. */
export function loggerParams(env: Env, service: 'api' | 'realtime' | 'worker'): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service, version: env.APP_VERSION },
      genReqId: (req: IncomingMessage) => {
        const header = req.headers['x-request-id'];
        return typeof header === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(header)
          ? header
          : randomUUID();
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-razorpay-signature"]',
          'req.headers["idempotency-key"]',
          '*.phone',
          '*.phoneE164',
          '*.otp',
          '*.code',
          '*.refreshToken',
          '*.accessToken',
        ],
        censor: '[redacted]',
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
      autoLogging: { ignore: (req: IncomingMessage) => req.url?.startsWith('/v1/health') ?? false },
    },
  };
}
