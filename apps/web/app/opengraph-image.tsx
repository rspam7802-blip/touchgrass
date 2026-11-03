import { BRAND, colors } from '@touchgrass/shared';
import { ImageResponse } from 'next/og';

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 80,
        background: colors.light.primary,
        color: colors.light.onPrimary,
      }}
    >
      <div style={{ fontSize: 48, fontWeight: 800, opacity: 0.85 }}>{BRAND.name}</div>
      <div style={{ fontSize: 110, fontWeight: 800, lineHeight: 1.05 }}>{BRAND.tagline}</div>
      <div style={{ fontSize: 40, marginTop: 24, color: colors.light.accent }}>
        {BRAND.storeSubtitle}
      </div>
    </div>,
    size,
  );
}
