import {
  Award,
  Crown,
  Link,
  type GlyphIcon,
  MapFold,
  Plug,
  Repeat,
  Sprout,
  Sunrise,
  TreePine,
  Trophy,
} from '../../../components/icons';

/** Line icon per badge (D-145); badges added later in the admin console fall back to a medal. */
const BADGE_ICONS: Record<string, GlyphIcon> = {
  grass_toucher: Sprout,
  certified_outside: TreePine,
  main_character: Crown,
  early_bird: Sunrise,
  connector: Link,
  crew_regular: Repeat,
  explorer: MapFold,
  challenge_champ: Trophy,
  plug: Plug,
};

export function badgeIcon(key: string): GlyphIcon {
  return BADGE_ICONS[key] ?? Award;
}
