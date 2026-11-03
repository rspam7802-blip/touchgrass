import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes the data export to a cache file and opens the share sheet (DPDP data portability). */
export async function shareExport(
  data: Record<string, unknown>,
  now: Date = new Date(),
): Promise<string> {
  const file = new File(Paths.cache, `touchgrass-export-${now.toISOString().slice(0, 10)}.json`);
  await file.write(JSON.stringify(data, null, 2));
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'TouchGrass' });
  return file.uri;
}
