import {
  CompareFacesCommand,
  DetectModerationLabelsCommand,
  type RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { describe, expect, it, vi } from 'vitest';
import { fakeFetch } from '../../test-support/env.js';
import { GoogleVisionModerationProvider } from './google-vision.js';
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

describe('Google Cloud Vision SafeSearch (D-165)', () => {
  const annotate = (safeSearchAnnotation: Record<string, string>) => ({
    body: { responses: [{ safeSearchAnnotation }] },
  });
  it('holds likely nudity or violence, and only very likely racy photos', async () => {
    const f = fakeFetch([
      annotate({ adult: 'VERY_UNLIKELY', violence: 'UNLIKELY', racy: 'POSSIBLE' }),
      annotate({ adult: 'LIKELY', violence: 'VERY_UNLIKELY', racy: 'LIKELY' }),
      annotate({ adult: 'UNLIKELY', violence: 'VERY_LIKELY', racy: 'UNLIKELY' }),
      annotate({ adult: 'POSSIBLE', violence: 'UNLIKELY', racy: 'VERY_LIKELY' }),
    ]);
    const vision = new GoogleVisionModerationProvider('key-1', f.fetch);
    const img = Buffer.from('jpeg');
    expect(await vision.moderateImage(img)).toEqual({
      verdict: 'safe',
      labels: [{ name: 'racy', confidence: 50 }],
    });
    expect((await vision.moderateImage(img)).verdict).toBe('flagged');
    expect((await vision.moderateImage(img)).verdict).toBe('flagged');
    expect((await vision.moderateImage(img)).verdict).toBe('flagged');
    const call = f.calls[0];
    expect(new URL(call?.url ?? '').searchParams.get('key')).toBe('key-1');
    expect(JSON.parse(call?.init?.body as string)).toEqual({
      requests: [
        {
          image: { content: img.toString('base64') },
          features: [{ type: 'SAFE_SEARCH_DETECTION' }],
        },
      ],
    });
  });
  it('treats a per-image error as a failure (retried by the worker) and never compares faces', async () => {
    const f = fakeFetch([{ body: { responses: [{ error: { message: 'Bad image' } }] } }]);
    const vision = new GoogleVisionModerationProvider('k', f.fetch);
    await expect(vision.moderateImage(Buffer.from('x'))).rejects.toThrow('Bad image');
    expect(await vision.compareFaces(Buffer.from('a'), Buffer.from('b'))).toBeNull();
  });
});
