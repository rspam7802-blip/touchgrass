import { describe, expect, it } from 'vitest';
import {
  colorName,
  deckOrder,
  iconName,
  pickSignal,
  SIGNAL_COLORS,
  SIGNAL_ICONS,
} from '../at-event/signal.js';
import {
  canDeleteForEveryone,
  directKey,
  dmPermission,
  eventChatState,
  excerpt,
  MUTED_FOREVER,
  muteUntil,
  uuidV7At,
  uuidV7Time,
} from './chat.policy.js';
import { voteProblem } from './polls.service.js';

const H = 3_600_000;
const NOW = new Date('2026-11-04T10:00:00.000Z');

describe('event chat window (F-CHT-02)', () => {
  const plan = (startsInH: number, hours = 2, status = 'published') => ({
    startsAt: new Date(NOW.getTime() + startsInH * H),
    endsAt: new Date(NOW.getTime() + (startsInH + hours) * H),
    status,
  });
  it('opens 24 h before, stays writable until 48 h after the end, then read-only', () => {
    expect(eventChatState(plan(25), NOW)).toBe('not_open');
    expect(eventChatState(plan(24), NOW)).toBe('open');
    expect(eventChatState(plan(-49, 1), NOW)).toBe('open');
    expect(eventChatState(plan(-51, 2), NOW)).toBe('read_only');
  });
  it('cancelled plans are read-only, drafts never open', () => {
    expect(eventChatState(plan(2, 2, 'cancelled'), NOW)).toBe('read_only');
    expect(eventChatState(plan(2, 2, 'draft'), NOW)).toBe('not_open');
  });
});

describe('direct messages (F-CHT-01)', () => {
  it('squad or a shared plan chat directly; others send a request; blocks are unreachable', () => {
    expect(dmPermission({ blocked: false, squad: true, sharedRecentPlan: false })).toBe('direct');
    expect(dmPermission({ blocked: false, squad: false, sharedRecentPlan: true })).toBe('direct');
    expect(dmPermission({ blocked: false, squad: false, sharedRecentPlan: false })).toBe('request');
    expect(dmPermission({ blocked: true, squad: true, sharedRecentPlan: true })).toBe('forbidden');
  });
  it('one key per pair, whichever side starts', () => {
    expect(directKey('b', 'a')).toBe(directKey('a', 'b'));
    expect(directKey('a', 'b')).toBe('a:b');
  });
});

describe('message features (F-CHT-04)', () => {
  it('delete for everyone within an hour', () => {
    expect(canDeleteForEveryone(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe(true);
    expect(canDeleteForEveryone(new Date(NOW.getTime() - 61 * 60_000), NOW)).toBe(false);
  });
  it('mute durations', () => {
    expect(muteUntil('off', NOW)).toBeNull();
    expect(muteUntil('hour', NOW)?.getTime()).toBe(NOW.getTime() + H);
    expect(muteUntil('day', NOW)?.getTime()).toBe(NOW.getTime() + 24 * H);
    expect(muteUntil('week', NOW)?.getTime()).toBe(NOW.getTime() + 7 * 24 * H);
    expect(muteUntil('forever', NOW)).toBe(MUTED_FOREVER);
  });
  it('UUID v7 ids carry their own timestamp (partition key)', () => {
    const at = new Date('2026-10-01T08:15:30.123Z');
    const id = uuidV7At(at, () => 0.5);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV7Time(id)).toEqual(at);
  });
  it('excerpts flatten whitespace and truncate', () => {
    expect(excerpt('  hi\n\nthere  ')).toBe('hi there');
    expect(excerpt('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(excerpt(null)).toBeNull();
  });
});

describe('polls (F-CHT-05)', () => {
  const open = { multi: false, closedAt: null, closesAt: new Date(NOW.getTime() + H) };
  const valid = new Set(['a', 'b', 'c']);
  it('validates closing, options and single choice', () => {
    expect(voteProblem(open, ['a'], valid, NOW)).toBeNull();
    expect(voteProblem(open, [], valid, NOW)).toBeNull();
    expect(voteProblem(open, ['a', 'b'], valid, NOW)).toBe('SINGLE_CHOICE');
    expect(voteProblem({ ...open, multi: true }, ['a', 'b'], valid, NOW)).toBeNull();
    expect(voteProblem(open, ['z'], valid, NOW)).toBe('INVALID_OPTION');
    expect(voteProblem({ ...open, closedAt: NOW }, ['a'], valid, NOW)).toBe('POLL_CLOSED');
    expect(voteProblem({ ...open, closesAt: NOW }, ['a'], valid, NOW)).toBe('POLL_CLOSED');
  });
});

describe('find-your-group signal (F-ATE-02)', () => {
  it('is stable per event and avoids colours used nearby first', () => {
    const a = pickSignal('event-a', []);
    expect(pickSignal('event-a', [])).toEqual(a);
    const taken = SIGNAL_COLORS.slice(0, 7).map((c) => ({ color: c.hex, icon: '⭐' }));
    expect(pickSignal('event-b', taken)?.color).toBe(SIGNAL_COLORS[7].hex);
  });
  it('reuses a colour with a new icon once all colours are taken, and gives up only when all 64 are', () => {
    const allColours = SIGNAL_COLORS.map((c) => ({
      color: c.hex,
      icon: SIGNAL_ICONS[0].glyph,
    }));
    const pick = pickSignal('event-c', allColours);
    expect(pick).not.toBeNull();
    expect(allColours.some((t) => t.color === pick?.color && t.icon === pick.icon)).toBe(false);
    const everything = SIGNAL_COLORS.flatMap((c) =>
      SIGNAL_ICONS.map((i) => ({ color: c.hex, icon: i.glyph })),
    );
    expect(pickSignal('event-d', everything)).toBeNull();
  });
  it('names icons and colours for screen readers; deck order is per event', () => {
    expect(iconName('🌊')).toBe('wave');
    expect(colorName('#1A5FD0')).toBe('blue');
    const cards = ['1', '2', '3', '4'].map((id) => ({ id }));
    expect(deckOrder('e1', cards)).toEqual(deckOrder('e1', [...cards].reverse()));
    expect(
      deckOrder('e1', cards)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['1', '2', '3', '4']);
  });
});
