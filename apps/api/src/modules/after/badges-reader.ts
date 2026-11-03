import { Injectable } from '@nestjs/common';
import type { EarnedBadge } from '@touchgrass/shared';

export interface BadgeSource {
  earnedAt(userId: string, eventId: string): Promise<EarnedBadge[]>;
}

/**
 * Badges earned at a plan, for the post-event screen (F-AFT-01). The gamification module (F-GAM-01) evaluates
 * badges and registers itself here, so `after` never imports it; unregistered, the list is empty.
 */
@Injectable()
export class BadgesReader {
  private source: BadgeSource | null = null;

  register(source: BadgeSource): void {
    if (this.source) throw new Error('Badge source already registered');
    this.source = source;
  }

  earnedAt(userId: string, eventId: string): Promise<EarnedBadge[]> {
    return this.source ? this.source.earnedAt(userId, eventId) : Promise.resolve([]);
  }
}
