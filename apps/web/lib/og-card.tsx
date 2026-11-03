import { BRAND, colors } from '@touchgrass/shared';
import { ImageResponse } from 'next/og';

/** Link previews (WhatsApp, Instagram DMs, iMessage) want 1200×630 with large, short text (F-GRW-02). */
export const OG_SIZE = { width: 1200, height: 630 };

export function ogCard(title: string, subtitle: string): ImageResponse {
  const fit = title.length > 40 ? 64 : 84;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: colors.light.primary,
        color: colors.light.onPrimary,
      }}
    >
      <div style={{ fontSize: 40, fontWeight: 800, opacity: 0.85 }}>{BRAND.name}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: fit, fontWeight: 800, lineHeight: 1.05 }}>{title.slice(0, 80)}</div>
        <div style={{ fontSize: 36, marginTop: 20, color: colors.light.accent }}>
          {subtitle.slice(0, 90)}
        </div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 700 }}>{BRAND.tagline}</div>
    </div>,
    OG_SIZE,
  );
}
