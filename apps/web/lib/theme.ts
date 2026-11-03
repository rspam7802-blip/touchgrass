import { colors, type ColorScheme } from '@touchgrass/shared';

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Design tokens → CSS custom properties, so Tailwind utilities and the mobile app share one palette. */
export function cssVariables(scheme: ColorScheme): string {
  return Object.entries(scheme)
    .map(([k, v]) => `--tg-${kebab(k)}: ${v};`)
    .join(' ');
}

export const THEME_CSS = `:root { ${cssVariables(colors.light)} color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { ${cssVariables(colors.dark)} } }`;
