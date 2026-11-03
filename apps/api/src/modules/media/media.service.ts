import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateUploadBody,
  type CreateUploadResponse,
  LIMITS,
  type MediaAsset,
  type MediaVariants,
  type ModerationPreview,
} from '@touchgrass/shared';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ObjectStorage } from '../../adapters/storage/storage.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { mediaAssets, type VariantKeys } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';

export type MediaRow = typeof mediaAssets.$inferSelect;
const UPLOAD_TTL_SECONDS = 15 * 60;
const URL_TTL_SECONDS = 2 * 60 * 60;
const HOUR = 3_600_000;

export const MEDIA_UPLOADED_EVENT = 'media.uploaded';

/**
 * Direct-to-S3 uploads (F-ACC-06): presigned POST → client upload → `complete` → worker resizes to webp,
 * strips EXIF and moderates. Only the owner can see an asset before it is `ready`.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly outbox: OutboxService,
  ) {}

  async createUpload(ownerUserId: string, body: CreateUploadBody): Promise<CreateUploadResponse> {
    const id = uuidv7();
    const originalKey = `uploads/${body.purpose}/${id}/original`;
    const upload = await this.storage.createPresignedUpload(
      originalKey,
      body.contentType,
      LIMITS.upload.maxImageBytes,
      UPLOAD_TTL_SECONDS,
    );
    await this.db.insert(mediaAssets).values({
      id,
      ownerUserId,
      purpose: body.purpose,
      originalKey,
      contentType: body.contentType,
      declaredBytes: body.sizeBytes,
      status: 'pending_upload',
    });
    return {
      assetId: id,
      upload: { url: upload.url, fields: upload.fields, expiresAt: upload.expiresAt.toISOString() },
    };
  }

  /** Client signals the upload finished. Verifies the object really exists, then queues processing. */
  async complete(ownerUserId: string, assetId: string): Promise<MediaAsset> {
    const asset = await this.ownedOrThrow(ownerUserId, assetId);
    if (asset.status !== 'pending_upload') return this.toDto(asset, true);
    const head = await this.storage.head(asset.originalKey);
    if (!head) throw new AppError('CONFLICT', 'Upload not found in storage yet');
    if (head.size > LIMITS.upload.maxImageBytes)
      throw new AppError('PAYLOAD_TOO_LARGE', 'Upload exceeds the size limit');
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(mediaAssets)
        .set({ status: 'processing' })
        .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'pending_upload')))
        .returning();
      if (row)
        await this.outbox.add(tx, {
          aggregateType: 'media_asset',
          aggregateId: assetId,
          type: MEDIA_UPLOADED_EVENT,
          payload: { assetId },
        });
      return row;
    });
    return this.toDto(updated ?? (await this.ownedOrThrow(ownerUserId, assetId)), true);
  }

  async get(viewerUserId: string, assetId: string): Promise<MediaAsset> {
    const asset = await this.byId(assetId);
    if (!asset || asset.status === 'deleted') throw AppError.notFound('Media');
    const isOwner = asset.ownerUserId === viewerUserId;
    if (!isOwner && asset.status !== 'ready') throw AppError.notFound('Media');
    return this.toDto(asset, isOwner);
  }

  async byId(assetId: string, db: DbOrTx = this.db): Promise<MediaRow | null> {
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
    return row ?? null;
  }

  async byIds(ids: string[]): Promise<MediaRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(mediaAssets).where(inArray(mediaAssets.id, ids));
  }

  async ownedOrThrow(ownerUserId: string, assetId: string): Promise<MediaRow> {
    const asset = await this.byId(assetId);
    if (!asset || asset.ownerUserId !== ownerUserId || asset.status === 'deleted')
      throw AppError.notFound('Media');
    return asset;
  }

  /**
   * Signed URLs bucketed to the hour so the same asset yields a stable URL for an hour
   * (CDN/device caching) while still expiring.
   */
  async urlsFor(keys: VariantKeys | null, now: Date = new Date()): Promise<MediaVariants | null> {
    if (!keys) return null;
    const signingDate = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
    const [sm, md, lg] = await Promise.all(
      [keys.sm, keys.md, keys.lg].map((k) =>
        this.storage.signedDownloadUrl(k, URL_TTL_SECONDS, signingDate),
      ),
    );
    return { sm: sm ?? '', md: md ?? '', lg: lg ?? '' };
  }

  /** A full-size link that lives `ttlSeconds` (downloads, F-AFT-04). */
  async downloadUrl(keys: VariantKeys, ttlSeconds: number): Promise<string> {
    return this.storage.signedDownloadUrl(keys.lg, ttlSeconds);
  }

  /** Reads a stored variant (server-side image composition). */
  async readVariant(keys: VariantKeys, size: keyof VariantKeys): Promise<Buffer> {
    return this.storage.get(keys[size]);
  }

  async toDto(asset: MediaRow, isOwner: boolean): Promise<MediaAsset> {
    const visible = asset.status === 'ready' || (isOwner && asset.status === 'flagged');
    return {
      id: asset.id,
      purpose: asset.purpose,
      status: asset.status,
      width: asset.width,
      height: asset.height,
      urls: visible ? await this.urlsFor(asset.variantKeys) : null,
    };
  }

  /** Removes stored objects and marks the asset deleted (account deletion, photo removal). */
  async destroy(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;
    const rows = await this.byIds(assetIds);
    for (const row of rows) {
      const keys = [
        row.originalKey,
        ...(row.variantKeys ? [row.variantKeys.sm, row.variantKeys.md, row.variantKeys.lg] : []),
      ];
      await Promise.all(keys.map((k) => this.storage.delete(k)));
    }
    await this.db
      .update(mediaAssets)
      .set({ status: 'deleted', deletedAt: new Date(), variantKeys: null })
      .where(inArray(mediaAssets.id, assetIds));
  }

  // ---------- moderation (F-SAF-06) ----------

  async moderationPreview(assetId: string): Promise<ModerationPreview> {
    const asset = await this.byId(assetId);
    if (!asset || asset.status === 'deleted' || asset.status === 'rejected') return GONE;
    return {
      title: asset.purpose,
      text: null,
      image: await this.urlsFor(asset.variantKeys),
      owner: asset.ownerUserId ? { id: asset.ownerUserId, displayName: '' } : null,
      gone: false,
    };
  }

  /** A flagged image was fine after all: it shows wherever it was used. */
  async releaseFlagged(assetId: string, tx: Tx): Promise<AfterCommit> {
    await tx
      .update(mediaAssets)
      .set({ status: 'ready' })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'flagged')));
    return undefined;
  }

  /** Rejects the image everywhere it is used; the stored files go once the decision has committed. */
  async removeForModeration(assetId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(mediaAssets).set({ status: 'rejected' }).where(eq(mediaAssets.id, assetId));
    return () => this.destroy([assetId]);
  }

  async ownedAssetIds(ownerUserId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.ownerUserId, ownerUserId), isNull(mediaAssets.deletedAt)));
    return rows.map((r) => r.id);
  }

  /** Housekeeping: uploads never completed within a day are removed (worker, hourly). */
  async purgeStaleUploads(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.status, 'pending_upload'),
          lt(mediaAssets.createdAt, new Date(now.getTime() - 24 * HOUR)),
        ),
      );
    await this.destroy(rows.map((r) => r.id));
    return rows.length;
  }
}
