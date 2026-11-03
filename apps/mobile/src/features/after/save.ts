import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Saves one Lore photo (F-AFT-04): the short-lived full-size link is downloaded to the app cache and the
 * system share sheet opens, where people choose "Save image" (or send it on). Nothing leaves the device
 * without their action.
 */
export async function savePhoto(url: string, itemId: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = await File.downloadFileAsync(url, new File(Paths.cache, `lore-${itemId}.webp`), {
    idempotent: true,
  });
  await Sharing.shareAsync(file.uri, { mimeType: 'image/webp' });
  return true;
}
