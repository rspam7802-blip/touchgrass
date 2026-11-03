import { createHash } from 'node:crypto';

/** Find-your-group palette (F-ATE-02): distinct hues that stay legible full-screen, with named icons. */
export const SIGNAL_COLORS = [
  { name: 'green', hex: '#1E8E3E' },
  { name: 'blue', hex: '#1A5FD0' },
  { name: 'orange', hex: '#E8710A' },
  { name: 'pink', hex: '#D01884' },
  { name: 'purple', hex: '#7B3FD1' },
  { name: 'yellow', hex: '#F2B705' },
  { name: 'teal', hex: '#00897B' },
  { name: 'red', hex: '#D93025' },
] as const;
export const SIGNAL_ICONS = [
  { name: 'leaf', glyph: '🍃' },
  { name: 'star', glyph: '⭐' },
  { name: 'sun', glyph: '☀️' },
  { name: 'moon', glyph: '🌙' },
  { name: 'bolt', glyph: '⚡' },
  { name: 'heart', glyph: '❤️' },
  { name: 'flower', glyph: '🌸' },
  { name: 'wave', glyph: '🌊' },
] as const;

export interface SignalChoice {
  color: string;
  icon: string;
}

/**
 * Picks a colour + icon not used by any overlapping plan nearby. Colours are spread first (most visible from
 * a distance), then icons. The starting point is derived from the event id so choices look random but are
 * stable. Returns null only if all 64 combinations are taken nearby.
 */
export function pickSignal(eventId: string, taken: SignalChoice[]): SignalChoice | null {
  const used = new Set(taken.map((t) => `${t.color}|${t.icon}`));
  const usedColors = new Set(taken.map((t) => t.color));
  const seed = createHash('sha256').update(eventId).digest().readUInt32BE(0);
  const combos: SignalChoice[] = [];
  for (let i = 0; i < SIGNAL_COLORS.length * SIGNAL_ICONS.length; i += 1) {
    const k = (seed + i) % (SIGNAL_COLORS.length * SIGNAL_ICONS.length);
    const color = SIGNAL_COLORS[k % SIGNAL_COLORS.length];
    const icon = SIGNAL_ICONS[Math.floor(k / SIGNAL_COLORS.length)];
    if (color && icon) combos.push({ color: color.hex, icon: icon.glyph });
  }
  return (
    combos.find((c) => !usedColors.has(c.color) && !used.has(`${c.color}|${c.icon}`)) ??
    combos.find((c) => !used.has(`${c.color}|${c.icon}`)) ??
    null
  );
}

export function iconName(glyph: string): string {
  return SIGNAL_ICONS.find((i) => i.glyph === glyph)?.name ?? 'star';
}
export function colorName(hex: string): string {
  return SIGNAL_COLORS.find((c) => c.hex === hex)?.name ?? 'green';
}

/** Deterministic per-event order of the deck so everyone at a plan sees the same sequence. */
export function deckOrder<T extends { id: string }>(eventId: string, cards: T[]): T[] {
  const key = (id: string): string => createHash('sha256').update(`${eventId}:${id}`).digest('hex');
  return [...cards].sort((a, b) => (key(a.id) < key(b.id) ? -1 : 1));
}
