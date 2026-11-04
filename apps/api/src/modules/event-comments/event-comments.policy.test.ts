import { describe, expect, it } from 'vitest';
import { canComment, canDeleteComment, commentVisibleTo } from './event-comments.policy.js';

describe('plan comments policy', () => {
  it('posting needs a visible, live plan', () => {
    expect(canComment({ status: 'published' }, true)).toBe(true);
    expect(canComment({ status: 'completed' }, true)).toBe(true);
    expect(canComment({ status: 'cancelled' }, true)).toBe(false);
    expect(canComment({ status: 'draft' }, true)).toBe(false);
    expect(canComment({ status: 'published' }, false)).toBe(false);
  });

  it('hides removed comments, blocked authors and other people’s held comments', () => {
    const none = new Set<string>();
    const base = { authorId: 'a', heldAt: null, status: 'visible' as const };
    expect(commentVisibleTo(base, 'v', none)).toBe(true);
    expect(commentVisibleTo({ ...base, status: 'removed' }, 'a', none)).toBe(false);
    expect(commentVisibleTo(base, 'v', new Set(['a']))).toBe(false);
    expect(commentVisibleTo({ ...base, heldAt: new Date() }, 'v', none)).toBe(false);
    expect(commentVisibleTo({ ...base, heldAt: new Date() }, 'a', none)).toBe(true);
  });

  it('authors and hosts delete; nobody else', () => {
    expect(canDeleteComment({ authorId: 'a' }, 'a', false)).toBe(true);
    expect(canDeleteComment({ authorId: 'a' }, 'h', true)).toBe(true);
    expect(canDeleteComment({ authorId: 'a' }, 'v', false)).toBe(false);
  });
});
