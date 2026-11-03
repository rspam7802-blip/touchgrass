import { Injectable } from '@nestjs/common';
import type { ModerationPreview } from '@touchgrass/shared';
import type { Tx } from '../../infra/database/database.module.js';

/** Things the moderation queue can point at (`moderation_items.target_type`). */
export type ModerationTargetType =
  'media_asset' | 'user' | 'event' | 'message' | 'lore_media' | 'crew' | 'proposal' | 'story';

/** Work to run once the resolving transaction has committed (cache invalidation, realtime fan-out). */
export type AfterCommit = (() => Promise<void>) | undefined;

export interface ModerationTargetHandler {
  type: ModerationTargetType;
  /** What reviewers see; `gone` when the thing no longer exists. */
  preview(targetId: string): Promise<ModerationPreview>;
  /** Nothing wrong: make held content visible again. A no-op for content that was never held. */
  release(targetId: string, tx: Tx): Promise<AfterCommit>;
  /** Take the content down. */
  remove(targetId: string, tx: Tx): Promise<AfterCommit>;
}

export const GONE: ModerationPreview = {
  title: '',
  text: null,
  image: null,
  owner: null,
  gone: true,
};

/**
 * Each content module registers how to preview, release and take down its own content, so moderation tooling
 * never reaches into other modules' tables (F-SAF-05, F-SAF-06).
 */
@Injectable()
export class ModerationTargetRegistry {
  private readonly handlers = new Map<ModerationTargetType, ModerationTargetHandler>();

  register(handler: ModerationTargetHandler): void {
    if (this.handlers.has(handler.type))
      throw new Error(`Duplicate moderation target ${handler.type}`);
    this.handlers.set(handler.type, handler);
  }

  get(type: string): ModerationTargetHandler | undefined {
    return this.handlers.get(type as ModerationTargetType);
  }
}
