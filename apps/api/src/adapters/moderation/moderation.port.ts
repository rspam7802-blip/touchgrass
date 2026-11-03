export interface ModerationLabel {
  name: string;
  confidence: number;
}

export interface ImageModerationResult {
  verdict: 'safe' | 'flagged';
  labels: ModerationLabel[];
}

/** Image moderation (F-SAF-06) and optional selfie-vs-profile face comparison (F-SAF-01). */
export abstract class ModerationProvider {
  abstract moderateImage(image: Buffer): Promise<ImageModerationResult>;
  /** Similarity 0–100 of the largest face in `source` vs faces in `target`; null if no face found. */
  abstract compareFaces(source: Buffer, target: Buffer): Promise<number | null>;
}

/** Label families that hold content for human review. */
export const FLAG_CATEGORIES = [
  'Explicit',
  'Explicit Nudity',
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Violence',
  'Visually Disturbing',
  'Hate Symbols',
  'Drugs & Tobacco',
  'Weapons',
];
export const FLAG_MIN_CONFIDENCE = 70;
