import { CreateUploadResponse, LIMITS, MediaAsset, type MediaPurpose } from '@touchgrass/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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
 * Opens the photo library. Returns null when the user cancels, and throws `PhotoAccessDeniedError` when
 * access is declined, so screens can explain it instead of silently doing nothing.
 */
export async function pickImage(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PhotoAccessDeniedError();
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    aspect: [4, 5],
    exif: false,
  });
  return res.canceled ? null : (res.assets[0]?.uri ?? null);
}

/** Presigned POST straight to object storage, then tells the API the upload is complete. */
export async function uploadImage(
  client: ApiClient,
  purpose: MediaPurpose,
  image: LocalImage,
  fetchFn: typeof fetch = fetch,
): Promise<MediaAsset> {
  if (image.sizeBytes > LIMITS.upload.maxImageBytes) throw new Error('Image too large');
  const created = await client.request('/v1/media/uploads', CreateUploadResponse, {
    method: 'POST',
    body: { purpose, contentType: 'image/jpeg', sizeBytes: image.sizeBytes },
  });
  const form = new FormData();
  for (const [k, v] of Object.entries(created.upload.fields)) form.append(k, v);
  // React Native's FormData accepts { uri, name, type } file descriptors.
  form.append('file', { uri: image.uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  const res = await fetchFn(created.upload.url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed with ${res.status}`);
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
