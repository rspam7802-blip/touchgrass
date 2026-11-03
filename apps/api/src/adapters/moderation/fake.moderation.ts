import { createHash } from 'node:crypto';
import { type ImageModerationResult, ModerationProvider } from './moderation.port.js';

/** Bytes of the "flagged" fixture image. Any upload with these exact bytes is flagged by the fake. */
export const FLAGGED_FIXTURE = Buffer.from('touchgrass-flagged-fixture-image');
const FLAGGED_HASH = createHash('sha256').update(FLAGGED_FIXTURE).digest('hex');

/** Always-safe moderation, except the flagged fixture. Face comparison returns 95 for identical bytes, else 40. */
export class FakeModerationProvider extends ModerationProvider {
  moderateImage(image: Buffer): Promise<ImageModerationResult> {
    const hash = createHash('sha256').update(image).digest('hex');
    if (hash === FLAGGED_HASH) {
      return Promise.resolve({
        verdict: 'flagged',
        labels: [{ name: 'Explicit Nudity', confidence: 99 }],
      });
    }
    return Promise.resolve({ verdict: 'safe', labels: [] });
  }

  compareFaces(source: Buffer, target: Buffer): Promise<number | null> {
    if (source.length === 0 || target.length === 0) return Promise.resolve(null);
    return Promise.resolve(source.equals(target) ? 95 : 40);
  }
}
