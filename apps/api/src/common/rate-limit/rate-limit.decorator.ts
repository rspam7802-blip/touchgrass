import { SetMetadata } from '@nestjs/common';

export interface RateLimitRule {
  /** Logical bucket name, e.g. "otp-send". */
  name: string;
  limit: number;
  windowSeconds: number;
  /**
   * What to key the bucket on. "user" falls back to IP for unauthenticated requests; "anon-ip" applies only to
   * unauthenticated requests (signed-in traffic is limited per user, see DEFAULT_RULES).
   */
  by: 'ip' | 'anon-ip' | 'user' | 'body';
  /** For by="body": the request body field to key on (e.g. the phone number for OTP). */
  bodyField?: string;
  /** For by="body": canonical form of the value, so re-formatting it (spaces, dashes) can't open a new bucket. */
  normalize?: (value: string) => string | null;
}

export const RATE_LIMIT_RULES = 'tg:rate-limit-rules';

/** Apply one or more rate limit rules to a route. All rules must pass. */
export const RateLimit = (...rules: RateLimitRule[]): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_RULES, rules);

/** Default limits applied globally to every route unless overridden. */
export const DEFAULT_RULES: RateLimitRule[] = [
  // Per-IP only for anonymous traffic: Indian mobile carriers put many users behind one CGNAT address.
  { name: 'global-ip', limit: 600, windowSeconds: 60, by: 'anon-ip' },
  { name: 'global-user', limit: 300, windowSeconds: 60, by: 'user' },
];
