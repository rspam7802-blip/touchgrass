import {
  Award,
  Crown,
  Link,
  type LucideIcon,
  Map,
  Plug,
  Repeat,
  Sprout,
  Sunrise,
  TreePine,
  Trophy,
} from 'lucide-react-native';

/** Line icon per badge (D-145); badges added later in the admin console fall back to a medal. */
const BADGE_ICONS: Record<string, LucideIcon> = {
  grass_toucher: Sprout,
  certified_outside: TreePine,
  main_character: Crown,
  early_bird: Sunrise,
  connector: Link,
  crew_regular: Repeat,
  explorer: Map,
  challenge_champ: Trophy,
  plug: Plug,
};

export function badgeIcon(key: string): LucideIcon {
  return BADGE_ICONS[key] ?? Award;
}
