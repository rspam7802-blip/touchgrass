/**
 * Seed-only artwork (development and demo data, never production): cover art for plans and crews, matched
 * to their category, and abstract profile pictures for members. Drawn as SVG and rasterised with sharp, so
 * seeding works offline and every image is our own.
 */

/** Two-colour gradients per interest category, deep enough for white text over the card. */
const PALETTES: Record<string, [string, string][]> = {
  food: [
    ['#7A2E0E', '#E8833A'],
    ['#8C1D3B', '#F0A04B'],
    ['#5B3A1A', '#D9A35B'],
  ],
  active: [
    ['#0F4C3A', '#3FB984'],
    ['#123B5E', '#2FA7C9'],
    ['#24470F', '#8CC63F'],
  ],
  games: [
    ['#2D1B69', '#8B5CF6'],
    ['#3B0F4F', '#D946EF'],
  ],
  culture: [
    ['#14274E', '#4F7CAC'],
    ['#3A1C3E', '#B5627E'],
    ['#1E3A3A', '#5FA8A0'],
  ],
  creative: [
    ['#6B1E4F', '#F472B6'],
    ['#7C2D12', '#FB923C'],
  ],
  learning: [
    ['#1E1B4B', '#6366F1'],
    ['#0C4A6E', '#38BDF8'],
  ],
  community: [
    ['#7C2D12', '#F59E0B'],
    ['#14532D', '#4ADE80'],
  ],
};
const FALLBACK: [string, string] = ['#1F2A16', '#5E8C2A'];
const LIME = '#E5FB46';

/** Line icons on a 24-unit grid (round 1.5 strokes), one per interest. */
const ICONS: Record<string, string> = {
  chai: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8.5 6.5c0-1.2 1.2-1.2 1.2-2.5M12 6.5c0-1.2 1.2-1.2 1.2-2.5"/><path d="M4 21h13"/>',
  biryani:
    '<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z"/><path d="M6.5 11.5c1-2.5 3.5-4 5.5-4s4.5 1.5 5.5 4"/><path d="M8 20.25h8"/>',
  cafes:
    '<path d="M5 8h11v6.5a5.5 5.5 0 0 1-5.5 5.5A5.5 5.5 0 0 1 5 14.5Z"/><path d="M16 9.5h1.25a2.75 2.75 0 0 1 0 5.5H16"/><path d="M8 3.5c0 1 1 1 1 2M11.5 3.5c0 1 1 1 1 2"/>',
  'street-food':
    '<path d="M4 12h16l-2 8H6Z"/><path d="M7 12c0-3 2.2-5.5 5-5.5S17 9 17 12"/><path d="M12 6.5V3.5"/>',
  cooking: '<circle cx="10" cy="13" r="6"/><path d="M16 13h5.5"/><path d="M8 13c0-1.2.9-2 2-2"/>',
  running:
    '<circle cx="15" cy="4.5" r="1.75"/><path d="M8 21l3-5.5 3 2.5V22"/><path d="M6 11.5l3.5-3.5h4l2 3.5 3 1"/><path d="M11 8l-1.5 5.5L13 15"/>',
  cycling:
    '<circle cx="6" cy="16" r="3.75"/><circle cx="18" cy="16" r="3.75"/><path d="M6 16l4-7h5.5L18 16"/><path d="M10 9l2.5 7H6"/><path d="M14 5.5h2.5l-1 3.5"/>',
  trekking:
    '<path d="M2.5 20l7-12 4 6.5 2.5-3.5 5.5 9Z"/><path d="M9.5 8l1.75 3"/><circle cx="18" cy="5" r="1.75"/>',
  badminton:
    '<path d="M12 21l-2.5-7h5Z"/><path d="M9.5 14L7 4.5M14.5 14L17 4.5M12 14V3.5"/><path d="M7.5 7.5h9"/>',
  cricket:
    '<path d="M15 3.5l3 3-9.5 9.5-3-3Z"/><path d="M5.5 13l-2 2 3 3 2-2"/><circle cx="17.5" cy="17.5" r="2.25"/>',
  football:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5l3.5 2.5-1.3 4h-4.4l-1.3-4Z"/><path d="M12 7.5V3.5M15.5 10l4-1.5M14.2 14l2.3 3.5M9.8 14l-2.3 3.5M8.5 10l-4-1.5"/>',
  yoga: '<circle cx="12" cy="4.75" r="1.75"/><path d="M12 7.5v6"/><path d="M6 10.5l6 1.5 6-1.5"/><path d="M4.5 20c2-3 4.5-4.5 7.5-4.5s5.5 1.5 7.5 4.5Z"/>',
  climbing: '<path d="M3 21l6-15 4 7 2-3 6 11Z"/><path d="M9 6V2.5h4.5L12 4l1.5 1.5H9"/>',
  'board-games':
    '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>',
  quiz: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17h0.5A2.5 2.5 0 0 1 4 14.5Z"/><path d="M10 8.5a2 2 0 1 1 2.75 1.85c-.5.2-.75.65-.75 1.15v.5"/><circle cx="12" cy="14.25" r=".6"/>',
  gaming:
    '<path d="M7 7.5h10a4.5 4.5 0 0 1 4.4 5.45l-.9 4.05a2.5 2.5 0 0 1-4.3 1.1L14 15.5h-4l-2.2 2.6a2.5 2.5 0 0 1-4.3-1.1l-.9-4.05A4.5 4.5 0 0 1 7 7.5Z"/><path d="M7.5 10.5v3M6 12h3"/><circle cx="15.5" cy="11" r=".75"/><circle cx="17" cy="13" r=".75"/>',
  'live-music':
    '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/><path d="M9 9.5l11-2"/>',
  standup:
    '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21.5M8.5 21.5h7"/>',
  movies:
    '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M3.5 7l3-3.5h3L6.5 7M9.5 7l3-3.5h3L12.5 7M15.5 7l3-3.5h2"/><path d="M10 11v6l5-3Z"/>',
  books:
    '<path d="M12 6.5c-2-1.5-4.75-2-8-1.75v13.5c3.25-.25 6 .25 8 1.75 2-1.5 4.75-2 8-1.75V4.75c-3.25-.25-6 .25-8 1.75Z"/><path d="M12 6.5v13.5"/>',
  theatre:
    '<path d="M4 4h9v6a4.5 4.5 0 0 1-9 0Z"/><path d="M11 9h9v6a4.5 4.5 0 0 1-9 0Z"/><path d="M6.5 7h.01M10.5 7h.01M13.5 12h.01M17.5 12h.01"/><path d="M14 16.5c.75.75 2.25.75 3 0"/>',
  'heritage-walks':
    '<path d="M3 21h18"/><path d="M5 21V9l2-3 2 3v12M15 21V9l2-3 2 3v12"/><path d="M9 21v-6a3 3 0 0 1 6 0v6"/><path d="M9 11h6"/><path d="M12 11V6.5l1.5-1.5L12 3.5 10.5 5 12 6.5"/>',
  photography:
    '<path d="M4 8.5h3.5l1.5-2.5h6l1.5 2.5H20v10.5H4Z"/><circle cx="12" cy="13.25" r="3.5"/><circle cx="17.5" cy="10.5" r=".6"/>',
  art: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.25 0 1.75-.75 1.75-1.5 0-1.25-1-1.25-1-2.5 0-1 .75-1.75 1.75-1.75h2.25A3.75 3.75 0 0 0 20.5 11 8 8 0 0 0 12 3.5Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  pottery:
    '<path d="M9 3.5h6"/><path d="M9.5 3.5v3c-3 1.5-4.5 4-4.5 7a7 7 0 0 0 14 0c0-3-1.5-5.5-4.5-7v-3"/><path d="M6 13h12"/>',
  dance:
    '<circle cx="13" cy="4.5" r="1.75"/><path d="M13 7l-1.5 6 3.5 3 1 5"/><path d="M11.5 13L8 21"/><path d="M8 9.5l4.5-2.5 4 3 3-1"/>',
  'music-jams':
    '<path d="M14.5 3.5l3 3"/><path d="M16 5l-6.5 6.5"/><path d="M9.5 11.5a4 4 0 1 0 3 3l-3-3Z"/><path d="M5 19l2.5-2.5"/>',
  tech: '<path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14"/>',
  startups:
    '<path d="M12 3c3 2 5 5.5 5 9.5l-2.5 3h-5L7 12.5C7 8.5 9 5 12 3Z"/><circle cx="12" cy="10" r="1.75"/><path d="M9.5 15.5 7 19l3-1M14.5 15.5 17 19l-3-1M12 17.5V21"/>',
  languages:
    '<path d="M3.5 5.5h10v7h-5L5 15v-2.5H3.5Z"/><path d="M13.5 9.5h7v7H19V19l-3-2.5h-2.5"/><path d="M6.5 8.5h4M8.5 7.5v1"/>',
  volunteering:
    '<path d="M12 20s-7.5-4.5-7.5-10A4.25 4.25 0 0 1 12 7.5 4.25 4.25 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10Z"/><path d="M9.5 12h5M12 9.5v5"/>',
  pets: '<circle cx="7" cy="9" r="1.75"/><circle cx="11" cy="5.75" r="1.75"/><circle cx="15.5" cy="6.25" r="1.75"/><circle cx="18.5" cy="10.5" r="1.75"/><path d="M8 17.5c0-3 2-6 4.5-6s4.5 3 4.5 6c0 2-1.5 2.5-2.25 2.5S13 19.25 12.5 19.25s-1.5.75-2.25.75S8 19.5 8 17.5Z"/>',
  plants:
    '<path d="M12 21v-8"/><path d="M12 13c-4.5 0-7-2.5-7-7 4.5 0 7 2.5 7 7Z"/><path d="M12 15c0-4 2.25-6.5 6.5-6.5 0 4-2.25 6.5-6.5 6.5Z"/><path d="M8 21h8"/>',
};
const DEFAULT_ICON =
  '<circle cx="12" cy="12" r="8.75"/><path d="M16.6 7.4 13.7 13.7 7.4 16.6 10.3 10.3Z"/>';

/** Small deterministic generator, so re-seeding draws the same art for the same input. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A 5:4 cover (drawn on a 1500 × 1200 canvas, rendered at 1080 px, the largest size served) for a plan or crew: the category's gradient, soft light, scattered rings and the
 * activity's line icon in the middle (so any crop keeps it), with the brand lime as an accent.
 */
export function coverSvg(category: string | null, slug: string | null, seed: number): Buffer {
  const rnd = random(seed);
  const palettes = PALETTES[category ?? ''] ?? [FALLBACK];
  const [from, to] = palettes[seed % palettes.length] ?? FALLBACK;
  const icon = ICONS[slug ?? ''] ?? DEFAULT_ICON;
  const angle = Math.round(rnd() * 360);
  const shapes: string[] = [];
  for (let i = 0; i < 9; i += 1) {
    const x = Math.round(rnd() * 1500);
    const y = Math.round(rnd() * 1200);
    const r = Math.round(60 + rnd() * 260);
    const filled = rnd() > 0.55;
    shapes.push(
      filled
        ? `<circle cx="${String(x)}" cy="${String(y)}" r="${String(r)}" fill="#ffffff" fill-opacity="${(0.04 + rnd() * 0.06).toFixed(3)}"/>`
        : `<circle cx="${String(x)}" cy="${String(y)}" r="${String(r)}" fill="none" stroke="#ffffff" stroke-opacity="${(0.08 + rnd() * 0.1).toFixed(3)}" stroke-width="${String(Math.round(3 + rnd() * 6))}"/>`,
    );
  }
  const dotX = Math.round(250 + rnd() * 1000);
  const dotY = Math.round(150 + rnd() * 200);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="864" viewBox="0 0 1500 1200">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${String(angle)} 0.5 0.5)">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.22" r="0.75">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shade" cx="0.5" cy="1.1" r="0.9">
      <stop offset="0" stop-color="#000000" stop-opacity="0.35"/><stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1500" height="1200" fill="url(#bg)"/>
  <rect width="1500" height="1200" fill="url(#glow)"/>
  ${shapes.join('\n  ')}
  <circle cx="750" cy="600" r="330" fill="#ffffff" fill-opacity="0.10"/>
  <circle cx="750" cy="600" r="330" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="4"/>
  <g transform="translate(750 600) scale(17) translate(-12 -12)" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${icon}</g>
  <circle cx="${String(dotX)}" cy="${String(dotY)}" r="22" fill="${LIME}"/>
  <rect width="1500" height="1200" fill="url(#shade)"/>
</svg>`,
  );
}

const AVATAR_PALETTES: [string, string, string][] = [
  ['#0F4C3A', '#3FB984', '#E5FB46'],
  ['#2D1B69', '#8B5CF6', '#F472B6'],
  ['#7A2E0E', '#E8833A', '#FDE68A'],
  ['#123B5E', '#2FA7C9', '#A7F3D0'],
  ['#6B1E4F', '#F472B6', '#FBCFE8'],
  ['#14274E', '#4F7CAC', '#E5FB46'],
  ['#3A1C3E', '#B5627E', '#FDBA74'],
  ['#24470F', '#8CC63F', '#FEF08A'],
];

/** A square abstract profile picture: soft overlapping colour fields (radial gradients), different per person. */
export function avatarSvg(seed: number): Buffer {
  const rnd = random(seed);
  const [a, b, c] = AVATAR_PALETTES[seed % AVATAR_PALETTES.length] ?? [
    '#0F4C3A',
    '#3FB984',
    '#E5FB46',
  ];
  const fields = [b, c, b].map((colour, i) => {
    const id = `f${String(i)}`;
    return {
      def: `<radialGradient id="${id}"><stop offset="0" stop-color="${colour}" stop-opacity="0.95"/><stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`,
      shape: `<circle cx="${String(Math.round(120 + rnd() * 560))}" cy="${String(Math.round(120 + rnd() * 560))}" r="${String(Math.round(300 + rnd() * 220))}" fill="url(#${id})"/>`,
    };
  });
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540" viewBox="0 0 800 800">
  <defs>${fields.map((f) => f.def).join('')}</defs>
  <rect width="800" height="800" fill="${a}"/>
  ${fields.map((f) => f.shape).join('')}
</svg>`,
  );
}
