import {
  CompareFacesCommand,
  DetectModerationLabelsCommand,
  type RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { describe, expect, it, vi } from 'vitest';
import { FakeModerationProvider, FLAGGED_FIXTURE } from './fake.moderation.js';
import { RekognitionModerationProvider } from './rekognition.js';

describe('FakeModerationProvider', () => {
  const m = new FakeModerationProvider();
  it('is safe by default and flags the fixture', async () => {
    expect(await m.moderateImage(Buffer.from('a cat'))).toEqual({ verdict: 'safe', labels: [] });
    expect((await m.moderateImage(FLAGGED_FIXTURE)).verdict).toBe('flagged');
  });
  it('compares faces deterministically', async () => {
    expect(await m.compareFaces(Buffer.from('a'), Buffer.from('a'))).toBe(95);
    expect(await m.compareFaces(Buffer.from('a'), Buffer.from('b'))).toBe(40);
    expect(await m.compareFaces(Buffer.alloc(0), Buffer.from('b'))).toBeNull();
  });
});

describe('RekognitionModerationProvider', () => {
  const client = (response: unknown) =>
    ({ send: vi.fn().mockResolvedValue(response) }) as unknown as RekognitionClient;
  it('flags labels in blocked categories above threshold', async () => {
    const c = client({
      ModerationLabels: [{ Name: 'Graphic Violence', ParentName: 'Violence', Confidence: 91 }],
    });
    const res = await new RekognitionModerationProvider('ap-south-1', c).moderateImage(
      Buffer.from('x'),
    );
    expect(res.verdict).toBe('flagged');
    expect(vi.mocked(c.send).mock.calls[0]?.[0]).toBeInstanceOf(DetectModerationLabelsCommand);
  });
  it('passes benign or low-confidence labels', async () => {
    expect(
      (
        await new RekognitionModerationProvider(
          'r',
          client({ ModerationLabels: [{ Name: 'Explicit', Confidence: 50 }] }),
        ).moderateImage(Buffer.from('x'))
      ).verdict,
    ).toBe('safe');
    expect(
      (await new RekognitionModerationProvider('r', client({})).moderateImage(Buffer.from('x')))
        .labels,
    ).toEqual([]);
    expect(
      (
        await new RekognitionModerationProvider(
          'r',
          client({ ModerationLabels: [{}] }),
        ).moderateImage(Buffer.from('x'))
      ).labels[0],
    ).toEqual({ name: 'unknown', confidence: 0 });
  });
  it('compares faces', async () => {
    const c = client({
      SourceImageFace: {},
      FaceMatches: [{ Similarity: 88 }, { Similarity: 97 }],
    });
    expect(
      await new RekognitionModerationProvider('r', c).compareFaces(
        Buffer.from('a'),
        Buffer.from('b'),
      ),
    ).toBe(97);
    expect(vi.mocked(c.send).mock.calls[0]?.[0]).toBeInstanceOf(CompareFacesCommand);
    expect(
      await new RekognitionModerationProvider('r', client({})).compareFaces(
        Buffer.from('a'),
        Buffer.from('b'),
      ),
    ).toBeNull();
    expect(
      await new RekognitionModerationProvider('r', client({ SourceImageFace: {} })).compareFaces(
        Buffer.from('a'),
        Buffer.from('b'),
      ),
    ).toBe(0);
  });
  it('constructs its own client when none is given', () => {
    expect(new RekognitionModerationProvider('ap-south-1')).toBeInstanceOf(
      RekognitionModerationProvider,
    );
  });
});
