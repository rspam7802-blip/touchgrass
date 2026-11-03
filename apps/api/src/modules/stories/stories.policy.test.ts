import { describe, expect, it } from 'vitest';
import {
  canLikeStory,
  canSeeStoryStats,
  canViewStory,
  type StoryFacts,
  type StoryViewerFacts,
  trayOrder,
} from './stories.policy.js';

const now = new Date('2026-11-03T12:00:00Z');
const H = 3_600_000;

const story = (over: Partial<StoryFacts> = {}): StoryFacts => ({
  authorId: 'author',
  audience: 'squad',
  status: 'live',
  heldAt: null,
  expiresAt: new Date(now.getTime() + 2 * H),
  ...over,
});
const viewer = (over: Partial<StoryViewerFacts> = {}): StoryViewerFacts => ({
  viewerId: 'viewer',
  blocked: false,
  inSquad: false,
  friendOfFriend: false,
  authorActive: true,
  ...over,
});

describe('canViewStory', () => {
  it('lets squad members see squad stories', () => {
    expect(canViewStory(story(), viewer({ inSquad: true }), now)).toBe(true);
  });

  it('keeps squad stories from friends of friends and strangers', () => {
    expect(canViewStory(story(), viewer({ friendOfFriend: true }), now)).toBe(false);
    expect(canViewStory(story(), viewer(), now)).toBe(false);
  });

  it('shows squad + friends-of-friends stories to both, never to strangers', () => {
    const s = story({ audience: 'squad_fof' });
    expect(canViewStory(s, viewer({ inSquad: true }), now)).toBe(true);
    expect(canViewStory(s, viewer({ friendOfFriend: true }), now)).toBe(true);
    expect(canViewStory(s, viewer(), now)).toBe(false);
  });

  it('hides everything when either side blocked the other', () => {
    expect(
      canViewStory(story({ audience: 'squad_fof' }), viewer({ inSquad: true, blocked: true }), now),
    ).toBe(false);
  });

  it('hides stories of suspended, banned or deleting authors', () => {
    expect(canViewStory(story(), viewer({ inSquad: true, authorActive: false }), now)).toBe(false);
  });

  it('hides held stories from everyone but the author', () => {
    const held = story({ heldAt: now });
    expect(canViewStory(held, viewer({ inSquad: true }), now)).toBe(false);
    expect(canViewStory(held, viewer({ viewerId: 'author' }), now)).toBe(true);
  });

  it('hides expired stories from everyone, the author included', () => {
    const expired = story({ expiresAt: now });
    expect(canViewStory(expired, viewer({ inSquad: true }), now)).toBe(false);
    expect(canViewStory(expired, viewer({ viewerId: 'author' }), now)).toBe(false);
  });

  it('hides removed stories from everyone, the author included', () => {
    const removed = story({ status: 'removed' });
    expect(canViewStory(removed, viewer({ inSquad: true }), now)).toBe(false);
    expect(canViewStory(removed, viewer({ viewerId: 'author' }), now)).toBe(false);
  });
});

describe('stats and likes', () => {
  it('only the author sees viewers and likes', () => {
    expect(canSeeStoryStats(story(), 'author')).toBe(true);
    expect(canSeeStoryStats(story(), 'viewer')).toBe(false);
  });

  it('people who can see a story can like it; authors cannot like their own', () => {
    expect(canLikeStory(story(), viewer({ inSquad: true }), now)).toBe(true);
    expect(canLikeStory(story(), viewer(), now)).toBe(false);
    expect(canLikeStory(story(), viewer({ viewerId: 'author' }), now)).toBe(false);
  });
});

describe('trayOrder', () => {
  it('puts your own first, then unseen, then seen, newest first', () => {
    const at = (h: number) => new Date(now.getTime() - h * H);
    const order = trayOrder([
      { authorId: 'seen-new', mine: false, unseen: false, latestAt: at(1) },
      { authorId: 'unseen-old', mine: false, unseen: true, latestAt: at(5) },
      { authorId: 'me', mine: true, unseen: false, latestAt: at(9) },
      { authorId: 'unseen-new', mine: false, unseen: true, latestAt: at(2) },
      { authorId: 'seen-old', mine: false, unseen: false, latestAt: at(8) },
    ]).map((e) => e.authorId);
    expect(order).toEqual(['me', 'unseen-new', 'unseen-old', 'seen-new', 'seen-old']);
  });
});
