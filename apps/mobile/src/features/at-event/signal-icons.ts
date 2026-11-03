import {
  Flower2,
  Heart,
  Leaf,
  type GlyphIcon,
  Moon,
  Star,
  Sun,
  Waves,
  Zap,
} from '../../../components/icons';

/** The find-your-group signal (F-ATE-02) is drawn from its icon name, never the server's emoji glyph. */
const SIGNAL_ICONS: Record<string, GlyphIcon> = {
  leaf: Leaf,
  star: Star,
  sun: Sun,
  moon: Moon,
  bolt: Zap,
  heart: Heart,
  flower: Flower2,
  wave: Waves,
};

export function signalIcon(name: string): GlyphIcon {
  return SIGNAL_ICONS[name] ?? Star;
}
