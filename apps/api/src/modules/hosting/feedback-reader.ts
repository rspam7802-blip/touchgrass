import { Injectable } from '@nestjs/common';

export interface EventFeedbackSummary {
  averageRating: number | null;
  ratingsCount: number;
  themes: { theme: string; count: number }[];
}

export interface FeedbackSource {
  summaries(eventIds: string[]): Promise<Map<string, EventFeedbackSummary>>;
}

/**
 * Ratings and feedback themes for host analytics (F-HST-02). Post-event feedback is collected by the
 * after-the-event module (Phase 7, F-AFT), which registers itself here; until then every plan reads as
 * "no ratings yet" rather than inventing numbers.
 */
@Injectable()
export class FeedbackReader {
  private source: FeedbackSource | null = null;

  register(source: FeedbackSource): void {
    if (this.source) throw new Error('Feedback source already registered');
    this.source = source;
  }

  async summaries(eventIds: string[]): Promise<Map<string, EventFeedbackSummary>> {
    if (this.source) return this.source.summaries(eventIds);
    return new Map(
      eventIds.map((id) => [id, { averageRating: null, ratingsCount: 0, themes: [] }]),
    );
  }
}
