import { Platform } from 'react-native';
import { CreateUploadResponse, LIMITS, MediaAsset, type MediaPurpose } from '@touchgrass/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import type { ApiClient } from '../../lib/api-client';

export interface LocalImage {
  uri: string;
  sizeBytes: number;
}

/**
 * Client-side compression (F-ACC-06): longest edge ≤ 2048 px, JPEG 80%. Also converts HEIC to JPEG,
 * which the server pipeline requires. Location EXIF is dropped by the re-encode and again on the server.
 */
export async function compressImage(uri: string): Promise<LocalImage> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 2048 }).renderAsync();
  const result = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  const blob = await (await fetch(result.uri)).blob();
  return { uri: result.uri, sizeBytes: blob.size };
}

/** Photo access was declined; the person has to allow it in the phone's settings. */
export class PhotoAccessDeniedError extends Error {
  constructor() {
    super('Photo access denied');
    this.name = 'PhotoAccessDeniedError';
  }
}

/**
 * Android opens the system photo picker, which needs no permission: the person picks, the app only gets what
 * they picked. The app removes the storage permissions on purpose (app.config.ts), so asking for library access
 * there always fails. iOS still asks for access to the library.
 */
async function ensureLibraryAccess(): Promise<void> {
  if (Platform.OS === 'android') return;
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PhotoAccessDeniedError();
}

/**
 * Opens the photo library. Returns null when the user cancels, and throws `PhotoAccessDeniedError` when
 * access is declined, so screens can explain it instead of silently doing nothing.
 */
export async function pickImage(): Promise<string | null> {
  await ensureLibraryAccess();
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    aspect: [4, 5],
    exif: false,
  });
  return res.canceled ? null : (res.assets[0]?.uri ?? null);
}

/** A storage upload the phone could not complete; `status` is 0 when storage was never reached. */
export class StorageUploadError extends Error {
  constructor(readonly status: number) {
    super(`Upload failed with ${String(status)}`);
    this.name = 'StorageUploadError';
  }
}

/**
 * Sends a local file straight to object storage with the presigned POST form. The native uploader reads the
 * file itself: React Native's `fetch` with a `{ uri }` FormData part never reached storage on Android release
 * builds, so uploads failed before any request was made.
 */
async function postToStorage(
  upload: { url: string; fields: Record<string, string> },
  fileUri: string,
  mimeType: string,
): Promise<void> {
  let status: number;
  try {
    ({ status } = await uploadAsync(upload.url, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType,
      parameters: upload.fields,
    }));
  } catch {
    throw new StorageUploadError(0);
  }
  if (status < 200 || status >= 300) throw new StorageUploadError(status);
}

/** Presigned POST straight to object storage, then tells the API the upload is complete. */
export async function uploadImage(
  client: ApiClient,
  purpose: MediaPurpose,
  image: LocalImage,
): Promise<MediaAsset> {
  if (image.sizeBytes > LIMITS.upload.maxImageBytes) throw new Error('Image too large');
  const created = await client.request('/v1/media/uploads', CreateUploadResponse, {
    method: 'POST',
    body: { purpose, contentType: 'image/jpeg', sizeBytes: image.sizeBytes },
  });
  await postToStorage(created.upload, image.uri, 'image/jpeg');
  return client.request(`/v1/media/${created.assetId}/complete`, MediaAsset, { method: 'POST' });
}

/**
 * Images are scanned and resized before anyone else sees them. Polls the asset until it is `ready`;
 * returns false when it is still processing after `polls` checks, or held/rejected by moderation.
 */
export async function waitUntilReady(
  client: ApiClient,
  asset: MediaAsset,
  polls: number,
  intervalMs = 800,
): Promise<boolean> {
  let status = asset.status;
  const busy = (s: MediaAsset['status']): boolean => s === 'pending_upload' || s === 'processing';
  for (let i = 0; i < polls && busy(status); i += 1) {
    await new Promise((r) => setTimeout(r, intervalMs));
    status = (await client.request(`/v1/media/${asset.id}`, MediaAsset)).status;
  }
  return status === 'ready';
}

/** A picked story: a photo (compressed like any other) or a video clip, sent as recorded (D-164). */
export type StoryMedia =
  | { kind: 'photo'; image: LocalImage }
  | { kind: 'video'; uri: string; sizeBytes: number; durationMs: number; contentType: string };

/** Video is longer than stories allow (15 s), or bigger than the upload limit. */
export class VideoTooLongError extends Error {
  constructor() {
    super('Video too long');
    this.name = 'VideoTooLongError';
  }
}
export class VideoTooLargeError extends Error {
  constructor() {
    super('Video too large');
    this.name = 'VideoTooLargeError';
  }
}

/**
 * Opens the library for a story: a photo, or a video up to 15 s (trimmed in the picker where the phone
 * offers it). Picking from the library needs no microphone access. The server re-encodes every video, which
 * removes its location and device details.
 */
export async function pickStoryMedia(): Promise<StoryMedia | null> {
  await ensureLibraryAccess();
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    quality: 1,
    videoMaxDuration: LIMITS.upload.maxVideoSeconds,
    allowsEditing: true,
    exif: false,
  });
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset) return null;
  if (asset.type !== 'video') return { kind: 'photo', image: await compressImage(asset.uri) };
  const durationMs = asset.duration ?? 0;
  if (durationMs > (LIMITS.upload.maxVideoSeconds + 0.5) * 1000) throw new VideoTooLongError();
  const sizeBytes = asset.fileSize ?? (await (await fetch(asset.uri)).blob()).size;
  if (sizeBytes > LIMITS.upload.maxVideoBytes) throw new VideoTooLargeError();
  const contentType = asset.mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  return { kind: 'video', uri: asset.uri, sizeBytes, durationMs, contentType };
}

/** Uploads a story video the same way as images: presigned POST, then `complete`. */
export async function uploadVideo(
  client: ApiClient,
  video: Extract<StoryMedia, { kind: 'video' }>,
): Promise<MediaAsset> {
  if (video.sizeBytes > LIMITS.upload.maxVideoBytes) throw new VideoTooLargeError();
  const created = await client.request('/v1/media/uploads', CreateUploadResponse, {
    method: 'POST',
    body: { purpose: 'story', contentType: video.contentType, sizeBytes: video.sizeBytes },
  });
  await postToStorage(created.upload, video.uri, video.contentType);
  return client.request(`/v1/media/${created.assetId}/complete`, MediaAsset, { method: 'POST' });
}
