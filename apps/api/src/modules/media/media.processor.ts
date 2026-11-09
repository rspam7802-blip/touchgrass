import { Inject, Injectable, Logger } from '@nestjs/common';
import { isVideoContentType, LIMITS } from '@touchgrass/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import { ModerationProvider } from '../../adapters/moderation/moderation.port.js';
import { ObjectStorage } from '../../adapters/storage/storage.port.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { mediaAssets, type VariantKeys } from '../../infra/database/schema/index.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { VideoRejected, VideoTranscoder } from './video.js';

/** Refuse decompression bombs: 40 megapixels is far above any phone camera output. */
const MAX_INPUT_PIXELS = 40_000_000;
const [SM, MD, LG] = LIMITS.imageSizes;

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Resize to webp in three sizes, auto-rotate using EXIF orientation, then drop ALL metadata
 * (sharp omits EXIF/GPS/ICC unless `withMetadata` is called).
 */
export async function renderVariant(input: Buffer, maxEdge: number): Promise<ProcessedImage> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

@Injectable()
export class MediaProcessor {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly moderationProvider: ModerationProvider,
    private readonly moderation: ModerationService,
    private readonly videos: VideoTranscoder,
  ) {}

  /**
   * Stores an image the server made itself (e.g. a Lore collage, F-AFT-04) as a ready asset with the usual
   * three webp variants. It is built only from already-moderated images, so it skips moderation.
   */
  async storeGenerated(
    purpose: 'lore',
    ownerUserId: string | null,
    image: Buffer,
  ): Promise<string> {
    const id = uuidv7();
    const [sm, md, lg] = await Promise.all([SM, MD, LG].map((size) => renderVariant(image, size)));
    if (!sm || !md || !lg) throw new Error('Variant rendering failed');
    const keys: VariantKeys = {
      sm: `media/${id}/sm.webp`,
      md: `media/${id}/md.webp`,
      lg: `media/${id}/lg.webp`,
    };
    await Promise.all([
      this.storage.put(keys.sm, sm.buffer, 'image/webp'),
      this.storage.put(keys.md, md.buffer, 'image/webp'),
      this.storage.put(keys.lg, lg.buffer, 'image/webp'),
    ]);
    await this.db.insert(mediaAssets).values({
      id,
      ownerUserId,
      purpose,
      // Never uploaded: the key only satisfies the unique column.
      originalKey: `generated/${id}`,
      contentType: 'image/webp',
      declaredBytes: lg.buffer.length,
      status: 'ready',
      width: lg.width,
      height: lg.height,
      variantKeys: keys,
      moderationLabels: [],
      processedAt: new Date(),
    });
    return id;
  }

  /** Idempotent: re-processing an asset that already left `processing` is a no-op. */
  async process(assetId: string): Promise<'ready' | 'flagged' | 'rejected' | 'skipped'> {
    const [asset] = await this.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    if (!asset || asset.status !== 'processing') return 'skipped';
    if (isVideoContentType(asset.contentType)) return this.processVideo(asset);

    let original: Buffer;
    try {
      original = await this.storage.get(asset.originalKey);
      await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch (err) {
      this.logger.warn(
        `Rejecting unreadable upload ${assetId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.db
        .update(mediaAssets)
        .set({ status: 'rejected', processedAt: new Date() })
        .where(eq(mediaAssets.id, assetId));
      await this.storage.delete(asset.originalKey);
      return 'rejected';
    }

    const [sm, md, lg] = await Promise.all(
      [SM, MD, LG].map((size) => renderVariant(original, size)),
    );
    if (!sm || !md || !lg) throw new Error('Variant rendering failed');
    const keys: VariantKeys = {
      sm: `media/${assetId}/sm.webp`,
      md: `media/${assetId}/md.webp`,
      lg: `media/${assetId}/lg.webp`,
    };
    await Promise.all([
      this.storage.put(keys.sm, sm.buffer, 'image/webp'),
      this.storage.put(keys.md, md.buffer, 'image/webp'),
      this.storage.put(keys.lg, lg.buffer, 'image/webp'),
    ]);

    // Rekognition accepts JPEG/PNG only, so moderate a metadata-free JPEG rendition.
    const forModeration = await sharp(md.buffer).jpeg({ quality: 85 }).toBuffer();
    const verdict = await this.moderationProvider.moderateImage(forModeration);
    const status = verdict.verdict === 'flagged' ? 'flagged' : 'ready';

    await this.db.transaction(async (tx) => {
      await tx
        .update(mediaAssets)
        .set({
          status,
          width: lg.width,
          height: lg.height,
          variantKeys: keys,
          moderationLabels: verdict.labels,
          processedAt: new Date(),
        })
        .where(eq(mediaAssets.id, assetId));
      if (status === 'flagged') {
        await this.moderation.flag(
          {
            targetType: 'media_asset',
            targetId: assetId,
            source: 'auto_image',
            severity: 'high',
            details: { purpose: asset.purpose, labels: verdict.labels },
          },
          tx,
        );
      }
    });
    // The original may carry EXIF GPS; it is never kept once variants exist.
    await this.storage.delete(asset.originalKey);
    return status;
  }

  /**
   * Video stories (D-164): re-encode (drops metadata, caps length and size), poster frame into the usual
   * image variants, and image moderation on three frames across the clip; any flagged frame holds the video.
   */
  private async processVideo(
    asset: typeof mediaAssets.$inferSelect,
  ): Promise<'ready' | 'flagged' | 'rejected'> {
    const reject = async (reason: string): Promise<'rejected'> => {
      this.logger.warn(`Rejecting video ${asset.id}: ${reason}`);
      await this.db
        .update(mediaAssets)
        .set({ status: 'rejected', processedAt: new Date() })
        .where(eq(mediaAssets.id, asset.id));
      await this.storage.delete(asset.originalKey);
      return 'rejected';
    };
    let done;
    try {
      done = await this.videos.transcode(await this.storage.get(asset.originalKey));
    } catch (err) {
      if (err instanceof VideoRejected) return reject(err.message);
      throw err;
    }
    const [sm, md, lg] = await Promise.all(
      [SM, MD, LG].map((size) => renderVariant(done.poster, size)),
    );
    if (!sm || !md || !lg) throw new Error('Poster rendering failed');
    const keys: VariantKeys = {
      sm: `media/${asset.id}/sm.webp`,
      md: `media/${asset.id}/md.webp`,
      lg: `media/${asset.id}/lg.webp`,
      video: `media/${asset.id}/video.mp4`,
    };
    await Promise.all([
      this.storage.put(keys.sm, sm.buffer, 'image/webp'),
      this.storage.put(keys.md, md.buffer, 'image/webp'),
      this.storage.put(keys.lg, lg.buffer, 'image/webp'),
      this.storage.put(keys.video ?? '', done.video, 'video/mp4'),
    ]);
    const verdicts = await Promise.all(
      done.samples.map((frame) => this.moderationProvider.moderateImage(frame)),
    );
    const labels = verdicts.flatMap((v) => v.labels);
    const status = verdicts.some((v) => v.verdict === 'flagged') ? 'flagged' : 'ready';
    await this.db.transaction(async (tx) => {
      await tx
        .update(mediaAssets)
        .set({
          status,
          width: done.width,
          height: done.height,
          durationMs: done.durationMs,
          variantKeys: keys,
          moderationLabels: labels,
          processedAt: new Date(),
        })
        .where(eq(mediaAssets.id, asset.id));
      if (status === 'flagged')
        await this.moderation.flag(
          {
            targetType: 'media_asset',
            targetId: asset.id,
            source: 'auto_image',
            severity: 'high',
            details: { purpose: asset.purpose, labels, video: true },
          },
          tx,
        );
    });
    // The original may carry GPS in its container metadata; it is never kept once the re-encode exists.
    await this.storage.delete(asset.originalKey);
    return status;
  }
}
