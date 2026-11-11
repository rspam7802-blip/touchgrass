import type { NextConfig } from 'next';

/** Origin media is served from (CloudFront in production, local object storage in development). */
function mediaOrigin(): string | null {
  const base = process.env.MEDIA_PUBLIC_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

const dev = process.env.NODE_ENV !== 'production';
/**
 * Content-Security-Policy (Phase 12 security review): same-origin scripts, styles and requests; images from
 * HTTPS and the media origin; the live-location viewer's OpenStreetMap frame is the only frame allowed, and
 * nothing may frame these pages. Next.js's inline bootstrap scripts need 'unsafe-inline'; dev needs eval.
 */
function cspFor(extra: { script?: string[]; connect?: string[]; frame?: string[] } = {}): string {
  const more = (list: string[] | undefined) => (list?.length ? ` ${list.join(' ')}` : '');
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}${more(extra.script)}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${mediaOrigin() ? ` ${mediaOrigin() ?? ''}` : ''}`,
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws:' : ''}${more(extra.connect)}`,
    `frame-src https://www.openstreetmap.org${more(extra.frame)}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * The admin sign-in page alone also allows Firebase phone sign-in (D-167): its invisible reCAPTCHA and
 * Google's identity endpoints. Every other page keeps the strict policy.
 */
const adminLoginCsp = cspFor({
  script: ['https://www.google.com', 'https://www.gstatic.com', 'https://apis.google.com'],
  connect: [
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://www.google.com',
    'https://recaptchaenterprise.googleapis.com',
  ],
  frame: ['https://www.google.com', 'https://recaptcha.google.com', 'https://*.firebaseapp.com'],
});

const securityHeaders = [
  { key: 'Content-Security-Policy', value: cspFor() },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@touchgrass/shared'],
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      // Later entries win for the same header.
      {
        source: '/admin/login',
        headers: [{ key: 'Content-Security-Policy', value: adminLoginCsp }],
      },
    ]);
  },
};

export default config;
