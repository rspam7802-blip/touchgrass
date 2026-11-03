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
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https:${mediaOrigin() ? ` ${mediaOrigin() ?? ''}` : ''}`,
  "font-src 'self' data:",
  `connect-src 'self'${dev ? ' ws:' : ''}`,
  'frame-src https://www.openstreetmap.org',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
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
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default config;
