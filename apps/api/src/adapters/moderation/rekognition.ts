import {
  CompareFacesCommand,
  DetectModerationLabelsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  FLAG_CATEGORIES,
  FLAG_MIN_CONFIDENCE,
  type ImageModerationResult,
  ModerationProvider,
} from './moderation.port.js';

export class RekognitionModerationProvider extends ModerationProvider {
  private readonly client: RekognitionClient;

  constructor(region: string, client?: RekognitionClient) {
    super();
    this.client = client ?? new RekognitionClient({ region });
  }

  async moderateImage(image: Buffer): Promise<ImageModerationResult> {
    const res = await this.client.send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: image },
        MinConfidence: FLAG_MIN_CONFIDENCE,
      }),
    );
    const labels = (res.ModerationLabels ?? []).map((l) => ({
      name: l.Name ?? 'unknown',
      parent: l.ParentName ?? '',
      confidence: l.Confidence ?? 0,
    }));
    const flagged = labels.some(
      (l) =>
        l.confidence >= FLAG_MIN_CONFIDENCE &&
        (FLAG_CATEGORIES.includes(l.name) || FLAG_CATEGORIES.includes(l.parent)),
    );
    return {
      verdict: flagged ? 'flagged' : 'safe',
      labels: labels.map(({ name, confidence }) => ({ name, confidence })),
    };
  }

  async compareFaces(source: Buffer, target: Buffer): Promise<number | null> {
    const res = await this.client.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: source },
        TargetImage: { Bytes: target },
        SimilarityThreshold: 0,
      }),
    );
    if (!res.SourceImageFace) return null;
    const best = Math.max(0, ...(res.FaceMatches ?? []).map((m) => m.Similarity ?? 0));
    return best;
  }
}
