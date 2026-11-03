import { z } from 'zod';
import { LIMITS } from '../constants';
import { MediaPurpose, MediaStatus } from '../enums';

export const ImageContentType = z.enum(LIMITS.upload.allowedImageTypes);

export const CreateUploadBody = z.object({
  purpose: MediaPurpose,
  contentType: ImageContentType,
  sizeBytes: z.number().int().min(1).max(LIMITS.upload.maxImageBytes),
});
export type CreateUploadBody = z.infer<typeof CreateUploadBody>;

export const CreateUploadResponse = z.object({
  assetId: z.uuid(),
  upload: z.object({
    url: z.url(),
    fields: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;

export const MediaVariants = z.object({ sm: z.url(), md: z.url(), lg: z.url() });
export type MediaVariants = z.infer<typeof MediaVariants>;

export const MediaAsset = z.object({
  id: z.uuid(),
  purpose: MediaPurpose,
  status: MediaStatus,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  urls: MediaVariants.nullable(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;
