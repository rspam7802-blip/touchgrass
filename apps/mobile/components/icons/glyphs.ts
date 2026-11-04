/**
 * The TouchGrass icon set (D-146): original line icons on a 24pt grid, 1.75pt round strokes, with a lime
 * "live dot" (ACCENT) on the icons people see most, taken from the logo. Each value is the inner SVG markup;
 * `CURRENT` is the icon colour and `ACCENT` the brand lime (or the icon colour on lime backgrounds).
 * The same strings render the app icons and the design preview, so they never drift apart.
 */
export const GLYPHS = {
  // Dock
  explore:
    '<circle cx="12" cy="12" r="8.75"/><path d="M16.6 7.4 13.7 13.7 7.4 16.6 10.3 10.3Z"/><circle cx="12" cy="12" r="1.6" fill="ACCENT" stroke="none"/>',
  plans:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="15.5" cy="15.25" r="1.75" fill="ACCENT" stroke="none"/>',
  chats:
    '<path d="M20.5 11.5c0 4.14-3.8 7.5-8.5 7.5-1.2 0-2.35-.22-3.39-.62L4 19.5l1.3-3.7C4.2 14.6 3.5 13.1 3.5 11.5 3.5 7.36 7.3 4 12 4s8.5 3.36 8.5 7.5Z"/><circle cx="8.5" cy="11.5" r="1.1" fill="CURRENT" stroke="none"/><circle cx="12" cy="11.5" r="1.3" fill="ACCENT" stroke="none"/><circle cx="15.5" cy="11.5" r="1.1" fill="CURRENT" stroke="none"/>',
  squad:
    '<circle cx="9" cy="8.5" r="3.25"/><path d="M3.25 19.5c0-3.18 2.57-5.75 5.75-5.75s5.75 2.57 5.75 5.75"/><path d="M14.8 5.6a2.75 2.75 0 1 1 1.9 4.9"/><path d="M16.75 13.9c2.4.3 4 2.4 4 5.1"/><circle cx="21" cy="3.6" r="1.5" fill="ACCENT" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',

  // Header and actions
  bell: '<path d="M6 16.5v-5.25a6 6 0 0 1 12 0v5.25l1.5 2h-15Z"/><path d="M10 21.25h4"/><circle cx="18" cy="5.5" r="2" fill="ACCENT" stroke="none"/>',
  bellOff:
    '<path d="M6 16.5v-5.25a6 6 0 0 1 9.4-4.94M18 11.25v5.25l1.5 2h-15"/><path d="M10 21.25h4M3.5 3.5l17 17"/>',
  search:
    '<circle cx="10.75" cy="10.75" r="6.75"/><path d="M15.75 15.75 20.5 20.5"/><circle cx="10.75" cy="10.75" r="1.4" fill="ACCENT" stroke="none"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrowRight: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>',

  // Plans
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.25" fill="ACCENT" stroke="none"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="15.5" cy="15.25" r="1.75" fill="ACCENT" stroke="none"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.6" fill="ACCENT" stroke="none"/>',
  people:
    '<circle cx="9" cy="8.5" r="3.25"/><path d="M3.25 19.5c0-3.18 2.57-5.75 5.75-5.75s5.75 2.57 5.75 5.75"/><path d="M14.8 5.6a2.75 2.75 0 1 1 1.9 4.9"/><path d="M16.75 13.9c2.4.3 4 2.4 4 5.1"/>',
  mystery:
    '<path d="M2.5 12s3.5-6.5 9.5-6.5c1.5 0 2.85.4 4.04 1.02M21.5 12s-3.5 6.5-9.5 6.5c-1.5 0-2.85-.4-4.04-1.02"/><path d="M9.6 14.4a3.4 3.4 0 0 1 4.8-4.8M4 20l16-16"/>',
  heart:
    '<path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.6 12 20 12 20Z"/>',
  ticket:
    '<path d="M4 6.5h16c.28 0 .5.22.5.5v3a2 2 0 0 0 0 4v3c0 .28-.22.5-.5.5H4a.5.5 0 0 1-.5-.5v-3a2 2 0 0 0 0-4V7c0-.28.22-.5.5-.5Z"/><path d="M14.5 8v1.5M14.5 11.25v1.5M14.5 14.5V16"/><circle cx="9" cy="12" r="1.6" fill="ACCENT" stroke="none"/>',
  map: '<path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2Z"/><path d="M9 4.5v13M15 6.5v13"/><circle cx="12" cy="11" r="1.5" fill="ACCENT" stroke="none"/>',

  // People and trust
  verified:
    '<path d="M12 2.75l2.2 1.6 2.7-.2.85 2.6 2.2 1.6-.85 2.6.85 2.6-2.2 1.6-.85 2.6-2.7-.2L12 21.25l-2.2-1.6-2.7.2-.85-2.6-2.2-1.6.85-2.6-.85-2.6 2.2-1.6.85-2.6 2.7.2Z"/><path d="M8.6 12.2l2.3 2.3 4.5-4.7"/>',
  shield:
    '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6Z"/><path d="M8.75 12.25l2.25 2.25 4.25-4.5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.9l-5.25 2.8 1-5.85L3.5 9.7l5.9-.9Z"/>',

  // Free now, streaks
  bolt: '<path d="M13 2.5 5 13.5h6l-.5 8 8.5-11h-6Z"/>',
  flame:
    '<path d="M12 21c3.6 0 6.5-2.7 6.5-6.3 0-3.4-2.3-5.3-3.6-7.7-.5 2-1.6 3.2-2.9 3.7C12.3 7.6 10.9 5 8.5 3.5c.3 3.4-3 5.9-3 10.7C5.5 18.1 8.4 21 12 21Z"/><circle cx="12" cy="16.5" r="1.6" fill="ACCENT" stroke="none"/>',
  snowflake:
    '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.75 4.5 12 6.5l2.25-2M9.75 19.5 12 17.5l2.25 2"/>',

  // Badges
  sprout:
    '<path d="M12 21v-7.5"/><path d="M12 13.5C12 9.6 9.1 7 5 7c0 3.9 2.9 6.5 7 6.5Z"/><path d="M12 11c0-3.3 2.4-5.5 6-5.5 0 3.3-2.4 5.5-6 5.5Z"/>',
  pine: '<path d="M12 3 6.5 10h3l-4 5.5h13l-4-5.5h3Z"/><path d="M12 15.5V21"/>',
  crown: '<path d="M4.25 17.25 3 7.5l5 4 4-6 4 6 5-4-1.25 9.75Z"/><path d="M4.75 20.5h14.5"/>',
  sunrise:
    '<path d="M3 17.5h18M6.5 17.5a5.5 5.5 0 0 1 11 0M12 4.5v3M5.3 9.3l2 2M18.7 9.3l-2 2M8.5 21h7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  repeat:
    '<path d="M17 3.5l3 3-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>',
  trophy:
    '<path d="M8 4.5h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.7 3.6M16 6.5h2.5a2.5 2.5 0 0 1-2.7 3.6M12 13.5v4M8.5 20.5h7M9.5 17.5h5"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4"/><path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0Z"/><path d="M12 16v4.5"/>',
  medal:
    '<circle cx="12" cy="9" r="5.5"/><path d="M8.6 13.4 7 21l5-2.5 5 2.5-1.6-7.6"/><circle cx="12" cy="9" r="1.6" fill="ACCENT" stroke="none"/>',

  // Find-your-group signal
  leaf: '<path d="M5 19C5 10 10.5 4.5 19.5 4.5c0 9-5.5 14.5-14.5 14.5Z"/><path d="M5 19l8-8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.25M12 19.25v2.25M2.5 12h2.25M19.25 12h2.25M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10Z"/>',
  flower:
    '<circle cx="12" cy="7" r="3.25"/><circle cx="17" cy="12" r="3.25"/><circle cx="12" cy="17" r="3.25"/><circle cx="7" cy="12" r="3.25"/><circle cx="12" cy="12" r="1.75" fill="CURRENT" stroke="none"/>',
  wave: '<path d="M3 9.5c2.25 0 2.25-2.5 4.5-2.5s2.25 2.5 4.5 2.5 2.25-2.5 4.5-2.5 2.25 2.5 4.5 2.5M3 16c2.25 0 2.25-2.5 4.5-2.5S9.75 16 12 16s2.25-2.5 4.5-2.5S18.75 16 21 16"/>',
  // Stories
  send: '<path d="M20.5 3.5 10.25 13.75"/><path d="M20.5 3.5 14 20.5l-3.75-6.75L3.5 10Z"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.75"/><circle cx="12" cy="12" r="1.1" fill="ACCENT" stroke="none"/>',
  trash:
    '<path d="M4.5 6.5h15M9.5 6.5V4.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V6.5"/><path d="M6.5 6.5l.85 12.1a2 2 0 0 0 2 1.9h5.3a2 2 0 0 0 2-1.9l.85-12.1M10 10.5v6M14 10.5v6"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2.25 4 2.25 4h-11"/>',
  pause:
    '<rect x="6.5" y="5" width="3.5" height="14" rx="1.25"/><rect x="14" y="5" width="3.5" height="14" rx="1.25"/>',
  play: '<path d="M7.5 4.75v14.5c0 .6.66.97 1.17.65l11.4-7.25a.77.77 0 0 0 0-1.3L8.67 4.1a.77.77 0 0 0-1.17.65Z"/>',
  // Categories
  bowl: '<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z"/><path d="M8 20.25h8M9 7.5c0-1.5 1.5-1.5 1.5-3M13.5 7.5c0-1.5 1.5-1.5 1.5-3"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" fill="CURRENT" stroke="none"/><circle cx="15" cy="15" r="1.2" fill="CURRENT" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="ACCENT" stroke="none"/>',
  book: '<path d="M12 6.5c-2-1.5-4.75-2-8-1.75v13.5c3.25-.25 6 .25 8 1.75 2-1.5 4.75-2 8-1.75V4.75c-3.25-.25-6 .25-8 1.75Z"/><path d="M12 6.5v13.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><circle cx="16.75" cy="16.75" r="3.25" fill="ACCENT" stroke="none"/>',
  // Profile
  share:
    '<path d="M12 15.5V3.5M7.5 8 12 3.5 16.5 8"/><path d="M7 11.5H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.75v2.5M12 18.75v2.5M2.75 12h2.5M18.75 12h2.5M5.46 5.46l1.77 1.77M16.77 16.77l1.77 1.77M5.46 18.54l1.77-1.77M16.77 7.23l1.77-1.77"/><circle cx="12" cy="12" r="1.1" fill="ACCENT" stroke="none"/>',
} as const;

export type GlyphName = keyof typeof GLYPHS;
