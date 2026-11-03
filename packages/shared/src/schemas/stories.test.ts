import { describe, expect, it } from 'vitest';
import { LIMITS } from '../constants';
import { PostStoryBody, StoryAudience } from './stories';

const mediaId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('stories schemas', () => {
  it('trims and bounds captions, and requires an audience', () => {
    expect(PostStoryBody.parse({ mediaId, audience: 'squad', caption: '  hi  ' }).caption).toBe(
      'hi',
    );
    expect(PostStoryBody.parse({ mediaId, audience: 'squad_fof' }).caption).toBe('');
    expect(
      PostStoryBody.safeParse({
        mediaId,
        audience: 'squad',
        caption: 'x'.repeat(LIMITS.stories.captionMaxLength + 1),
      }).success,
    ).toBe(false);
    expect(PostStoryBody.safeParse({ mediaId }).success).toBe(false);
  });

  it('offers exactly the two audiences', () => {
    expect(StoryAudience.options).toEqual(['squad', 'squad_fof']);
  });
});
