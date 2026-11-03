import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import { Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { StoryCardRef } from '../../../components/StoryCard';
import { readAppEnvironment } from '../../config';

/** Public web links for shareable things (F-GRW-02, F-PLT-03): they open the app when it's installed. */
export const shareLinks = {
  profile: (id: string) => `${readAppEnvironment().webUrl}/u/${id}`,
  crew: (id: string) => `${readAppEnvironment().webUrl}/c/${id}`,
};

/** Text + link share (WhatsApp and friends render the page's preview card). */
export async function shareText(message: string): Promise<void> {
  await Share.share({ message });
}

/** Captures a 9:16 card as a 1080×1920 PNG and opens the share sheet (Instagram Stories, WhatsApp status). */
export async function shareStory(card: RefObject<StoryCardRef | null>): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('no share sheet');
  const uri = await captureRef(card, { format: 'png', quality: 1, width: 1080, height: 1920 });
  await Sharing.shareAsync(uri, { mimeType: 'image/png' });
}
