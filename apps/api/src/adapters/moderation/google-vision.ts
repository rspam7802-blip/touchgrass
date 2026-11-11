import { type FetchFn, requestJson } from '../http/http-client.js';
import { type ImageModerationResult, ModerationProvider } from './moderation.port.js';

type Likelihood = 'UNKNOWN' | 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';

interface AnnotateResponse {
  responses?: {
    safeSearchAnnotation?: Partial<
      Record<'adult' | 'violence' | 'racy' | 'medical' | 'spoof', Likelihood>
    >;
    error?: { message?: string };
  }[];
}

const SCORE: Record<Likelihood, number> = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 10,
  UNLIKELY: 30,
  POSSIBLE: 50,
  LIKELY: 75,
  VERY_LIKELY: 95,
};

/**
 * When a SafeSearch category holds a photo for review: nudity and violence once Google thinks it likely,
 * suggestive ("racy") only when very likely, so ordinary beach or gym photos pass.
 */
const HOLD_AT: Record<'adult' | 'violence' | 'racy', Likelihood> = {
  adult: 'LIKELY',
  violence: 'LIKELY',
  racy: 'VERY_LIKELY',
};

/**
 * Google Cloud Vision SafeSearch (D-165): image moderation from the same Google project as sign-in and
 * maps, instead of AWS. It has no face comparison, so verification selfies are matched by the reviewer's
 * eye alone (face matching only ever assisted them).
 */
export class GoogleVisionModerationProvider extends ModerationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
  }

  async moderateImage(image: Buffer): Promise<ImageModerationResult> {
    const res = await requestJson<AnnotateResponse>(
      this.fetchFn,
      'google-vision',
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        body: {
          requests: [
            {
              image: { content: image.toString('base64') },
              features: [{ type: 'SAFE_SEARCH_DETECTION' }],
            },
          ],
        },
      },
    );
    const first = res.responses?.[0];
    if (!first || first.error)
      throw new Error(first?.error?.message ?? 'Vision returned no result');
    const annotation = first.safeSearchAnnotation ?? {};
    const labels = (Object.keys(HOLD_AT) as (keyof typeof HOLD_AT)[])
      .map((category) => ({ category, likelihood: annotation[category] ?? 'UNKNOWN' }))
      .filter((l) => SCORE[l.likelihood] >= SCORE.POSSIBLE)
      .map((l) => ({ name: l.category, confidence: SCORE[l.likelihood] }));
    const flagged = (Object.keys(HOLD_AT) as (keyof typeof HOLD_AT)[]).some(
      (category) => SCORE[annotation[category] ?? 'UNKNOWN'] >= SCORE[HOLD_AT[category]],
    );
    return { verdict: flagged ? 'flagged' : 'safe', labels };
  }

  compareFaces(_source: Buffer, _target: Buffer): Promise<number | null> {
    return Promise.resolve(null);
  }
}
