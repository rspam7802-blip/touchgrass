import { create } from 'qrcode';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** Renders a QR code as SVG (high error correction, quiet zone included) for ticket check-in. */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = create(value, { errorCorrectionLevel: 'H' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y += 1)
      for (let x = 0; x < n; x += 1)
        if (qr.modules.get(x, y)) d += `M${String(x + 4)} ${String(y + 4)}h1v1h-1z`;
    return { path: d, count: n + 8 };
  }, [value]);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(count)} ${String(count)}`}
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Rect width={count} height={count} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
