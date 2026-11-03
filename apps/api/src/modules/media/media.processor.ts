import { Inject, Injectable, Logger } from '@nestjs/common';
import { LIMITS } from '@touchgrass/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import { ModerationProvider } from '../../adapters/moderation/moderation.port.js';
import { ObjectStorage } from '../../adapters/storage/storage.port.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { mediaAssets, type VariantKeys } from '../../infra/database/schema/index.js';
import { ModerationService } from '../moderation/moderation.service.js';

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
}
