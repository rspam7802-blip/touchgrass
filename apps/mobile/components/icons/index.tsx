import type { ComponentType } from 'react';
import { SvgXml } from 'react-native-svg';
import { GLYPHS, type GlyphName } from './glyphs';

export interface GlyphProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fill colour for the shape itself (a selected star); `none` draws the outline only. */
  fill?: string;
  /** Colour of the lime signature dot; defaults to the brand lime. */
  accent?: string;
  accessible?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  accessibilityElementsHidden?: boolean;
}

export type GlyphIcon = ComponentType<GlyphProps>;

const LIME = '#E5FB46';

function glyph(name: GlyphName): GlyphIcon {
  function TouchGrassIcon({
    size = 24,
    color = '#F4F5F0',
    strokeWidth = 1.75,
    fill = 'none',
    accent = LIME,
    ...a11y
  }: GlyphProps) {
    const inner = GLYPHS[name].replaceAll('ACCENT', accent).replaceAll('CURRENT', color);
    const xml = `<svg viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${String(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    return <SvgXml xml={xml} width={size} height={size} {...a11y} />;
  }
  TouchGrassIcon.displayName = `Icon(${name})`;
  return TouchGrassIcon;
}

/*
 * The TouchGrass icon set (D-146). Exported under the names screens already use, so swapping a glyph is a
 * change in `glyphs.ts` only.
 */
export const Compass = glyph('explore');
export const CalendarDays = glyph('plans');
export const MessageCircle = glyph('chats');
export const Users = glyph('squad');
export const Plus = glyph('plus');
export const Bell = glyph('bell');
export const BellOff = glyph('bellOff');
export const Search = glyph('search');
export const X = glyph('close');
export const Check = glyph('check');
export const ArrowRight = glyph('arrowRight');
export const MapPin = glyph('pin');
export const Calendar = glyph('calendar');
export const Lock = glyph('lock');
export const People = glyph('people');
export const EyeOff = glyph('mystery');
export const Heart = glyph('heart');
export const Ticket = glyph('ticket');
export const MapFold = glyph('map');
export const BadgeCheck = glyph('verified');
export const Shield = glyph('shield');
export const Star = glyph('star');
export const Zap = glyph('bolt');
export const Flame = glyph('flame');
export const Snowflake = glyph('snowflake');
export const Sprout = glyph('sprout');
export const TreePine = glyph('pine');
export const Crown = glyph('crown');
export const Sunrise = glyph('sunrise');
export const Link = glyph('link');
export const Repeat = glyph('repeat');
export const Trophy = glyph('trophy');
export const Plug = glyph('plug');
export const Award = glyph('medal');
export const Leaf = glyph('leaf');
export const Sun = glyph('sun');
export const Moon = glyph('moon');
export const Flower2 = glyph('flower');
export const Waves = glyph('wave');
export const Send = glyph('send');
export const Eye = glyph('eye');
export const Trash = glyph('trash');
export const Flag = glyph('flag');
export const Pause = glyph('pause');
export const Play = glyph('play');
export const Bowl = glyph('bowl');
export const Dice = glyph('dice');
export const Book = glyph('book');
export const Grid = glyph('grid');
export const ShareIcon = glyph('share');
export const Gear = glyph('gear');
