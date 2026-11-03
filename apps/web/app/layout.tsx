import { BRAND } from '@touchgrass/shared';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { THEME_CSS } from '../lib/theme';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${BRAND.name} · ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: `${BRAND.storeSubtitle}. Meet people in real life through events, plans, shared interests and mutual friends.`,
  applicationName: BRAND.name,
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: BRAND.name,
    description: BRAND.tagline,
    locale: 'en_IN',
  },
  twitter: { card: 'summary_large_image', title: BRAND.name, description: BRAND.tagline },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#146A25' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0F0C' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}
