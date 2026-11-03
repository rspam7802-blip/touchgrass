/**
 * Profanity / abuse screening for user text (F-SAF-06) in English, Hindi and Telugu, including the Latin-script
 * ("Hinglish", "Tenglish") spellings people actually type. Matching is per word after normalising case,
 * look-alike digits/symbols and stretched letters, so ordinary words that merely contain a bad one
 * ("Scunthorpe", "assessment") are not caught. Anything matched is held for human review, not silently
 * rewritten.
 */

export type TextSeverity = 'medium' | 'high';

export interface TextScreenResult {
  flagged: boolean;
  severity: TextSeverity | null;
  /** The normalised words or phrases that matched (for reviewers, never shown to other users). */
  matches: string[];
}

/** Slurs, sexual abuse and threats: reviewed first. */
const HIGH_WORDS = [
  // English
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'tranny',
  'rapist',
  'kys',
  // Hindi (Latin and Devanagari)
  'randi',
  'randwa',
  'hijda',
  'hijra',
  'chhakka',
  'chakka',
  'sulli',
  'रंडी',
  'हिजड़ा',
  'छक्का',
  // Telugu (Latin and Telugu script)
  'lanja',
  'lanjakoduku',
  'kojja',
  'lanjodaka',
  'లంజ',
  'లంజకొడుకు',
  'కొజ్జా',
];

/** Profanity and insults. */
const MEDIUM_WORDS = [
  // English
  'fuck',
  'fucker',
  'fucking',
  'motherfucker',
  'shit',
  'bullshit',
  'bitch',
  'bastard',
  'asshole',
  'dick',
  'dickhead',
  'cunt',
  'slut',
  'whore',
  'wanker',
  'prick',
  'twat',
  // Hindi
  'chutiya',
  'chutiye',
  'madarchod',
  'maderchod',
  'behenchod',
  'bhenchod',
  'bhosdike',
  'bhosdi',
  'gaandu',
  // Not "chod": "chod do" just means "leave it".
  'gandu',
  'harami',
  'haramkhor',
  'lund',
  'lauda',
  'loda',
  'chodu',
  'jhaatu',
  'kamina',
  'kamine',
  'चूतिया',
  'चुतिया',
  'मादरचोद',
  'बहनचोद',
  'भोसड़ीके',
  'गांडू',
  'हरामी',
  'लौड़ा',
  'कमीना',
  // Telugu
  // Not Latin "gudda": in Hindi it means a doll.
  'dengu',
  'dengey',
  'denga',
  'modda',
  'puku',
  'nakodaka',
  'erripuka',
  'దెంగు',
  'దెంగెయ్',
  'మొడ్డ',
  'పూకు',
  'గుద్ద',
  'ఎర్రిపూకు',
];

/** Threat phrases, matched on the normalised text as a whole. */
const HIGH_PHRASES = [
  'kill yourself',
  'i will kill you',
  'ill kill you',
  'gonna kill you',
  'i will rape',
  'rape you',
  'maar dunga',
  'maar dalunga',
  'jaan se maar',
  'मार दूंगा',
  'मार डालूंगा',
  'champestha',
  'champesta',
  'చంపేస్తా',
  'చంపేస్తాను',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Case-fold, unify look-alikes, drop zero-width/combining tricks in Latin, squash stretched letters. */
export function normaliseText(text: string): string {
  const folded = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
  let out = '';
  for (const ch of folded) out += LEET[ch] ?? ch;
  // Repeated Latin letters collapse to one ("fuuuck" → "fuck", "asshole" → "ashole"); the word lists go through
  // the same function, so both sides always agree. Indic vowel signs stay as typed.
  return out.replace(/([a-z])\1+/g, '$1');
}

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{M}]+/u).filter((w) => w.length > 0);
}

const HIGH = new Set(HIGH_WORDS.map(normaliseText));
const MEDIUM = new Set(MEDIUM_WORDS.map(normaliseText));
const PHRASES = HIGH_PHRASES.map(normaliseText);

/** The word itself plus its singular, so plurals ("haramis", "bitches") are caught too. */
function forms(token: string): string[] {
  if (!/^[a-z]+$/.test(token)) return [token];
  const out = [token];
  if (token.endsWith('es')) out.push(token.slice(0, -2));
  if (token.endsWith('s')) out.push(token.slice(0, -1));
  return out;
}

function lookup(token: string, set: Set<string>): string | null {
  return forms(token).find((f) => set.has(f)) ?? null;
}

/** Screens one piece of user text. Empty text is never flagged. */
export function screenText(text: string): TextScreenResult {
  const norm = normaliseText(text);
  const tokens = words(norm);
  const matches: string[] = [];
  let severity: TextSeverity | null = null;
  for (const t of tokens) {
    const high = lookup(t, HIGH);
    const medium = high ? null : lookup(t, MEDIUM);
    if (high) {
      matches.push(high);
      severity = 'high';
    } else if (medium) {
      matches.push(medium);
      severity ??= 'medium';
    }
  }
  const spaced = ` ${tokens.join(' ')} `;
  for (const p of PHRASES)
    if (spaced.includes(` ${p} `)) {
      matches.push(p);
      severity = 'high';
    }
  return { flagged: matches.length > 0, severity, matches: [...new Set(matches)] };
}

/** Screens several fields at once (e.g. a title and a description); the worst severity wins. */
export function screenTexts(...texts: (string | null | undefined)[]): TextScreenResult {
  const all = texts.map((t) => screenText(t ?? ''));
  const matches = [...new Set(all.flatMap((r) => r.matches))];
  const severity = all.some((r) => r.severity === 'high')
    ? 'high'
    : all.some((r) => r.severity === 'medium')
      ? 'medium'
      : null;
  return { flagged: matches.length > 0, severity, matches };
}
