import { LIMITS, type StoryAudience } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { ChipGroup } from '../../../components/ChipGroup';
import { Button, Screen, Text, TextField } from '../../../components/ui';
import { StoryVideo } from '../../../components/stories/StoryVideo';
import {
  pickStoryMedia,
  type StoryMedia,
  uploadImage,
  uploadVideo,
  waitUntilReady,
} from '../../../src/features/media/upload';
import { usePostStory } from '../../../src/features/stories/api';
import { errorMessage } from '../../../src/lib/errors';
import { useApi } from '../../../src/providers/api-context';
import { useTheme } from '../../../src/theme/theme';

/** Moderation usually takes a few seconds; give it ~30 s before telling the person it is still being checked. */
const STORY_READY_POLLS = 36;
/** A video is re-encoded first, so it gets about a minute. */
const VIDEO_READY_POLLS = 75;

/**
 * New story (Phase 13, D-164): one photo or a video of up to 15 s from the library, an optional caption and
 * who can see it. Photos are re-encoded on the phone and again on the server; videos are re-encoded on the
 * server. Either way location data is removed and the server checks it before anyone else can see it.
 */
export default function NewStoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { client } = useApi();
  const post = usePostStory();
  const [media, setMedia] = useState<StoryMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<StoryAudience>('squad');
  const [busy, setBusy] = useState<'uploading' | 'checking' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (): Promise<void> => {
    setError(null);
    try {
      const picked = await pickStoryMedia();
      if (picked) setMedia(picked);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const share = async (): Promise<void> => {
    if (!media) return;
    setError(null);
    setNotice(null);
    setBusy('uploading');
    try {
      const asset =
        media.kind === 'video'
          ? await uploadVideo(client, media)
          : await uploadImage(client, 'story', media.image);
      setBusy('checking');
      const polls = media.kind === 'video' ? VIDEO_READY_POLLS : STORY_READY_POLLS;
      if (!(await waitUntilReady(client, asset, polls))) {
        setNotice(t('stories.pending'));
        return;
      }
      await post.mutateAsync({ mediaId: asset.id, caption: caption.trim(), audience });
      router.back();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen testID="story-composer">
      <Text variant="title" accessibilityRole="header">
        {t('stories.composerTitle')}
      </Text>
      {media?.kind === 'photo' ? (
        <Image
          source={{ uri: media.image.uri }}
          style={[styles.preview, { borderRadius: theme.radii.lg }]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
          accessible={false}
          importantForAccessibility="no"
          testID="story-preview"
        />
      ) : null}
      {media?.kind === 'video' ? (
        <StoryVideo
          uri={media.uri}
          playing={busy === null}
          loop
          muted
          label={t('stories.videoPreview', { seconds: Math.round(media.durationMs / 1000) })}
          style={[styles.preview, { borderRadius: theme.radii.lg, overflow: 'hidden' }]}
          testID="story-video-preview"
        />
      ) : null}
      <Button
        label={media ? t('stories.changeMedia') : t('stories.pickMedia')}
        variant={media ? 'ghost' : 'primary'}
        disabled={busy !== null}
        onPress={() => void choose()}
        testID="story-pick"
      />
      <TextField
        label={t('stories.caption')}
        value={caption}
        onChangeText={setCaption}
        maxLength={LIMITS.stories.captionMaxLength}
        testID="story-caption"
      />
      <Text variant="heading">{t('stories.audience')}</Text>
      <ChipGroup
        label={t('stories.audience')}
        mode="single"
        options={[
          { id: 'squad', label: t('stories.audienceSquad') },
          { id: 'squad_fof', label: t('stories.audienceSquadFof') },
        ]}
        selected={[audience]}
        onChange={(next) => {
          const value = next[0];
          if (value === 'squad' || value === 'squad_fof') setAudience(value);
        }}
        testIDPrefix="story-audience"
      />
      {notice ? (
        <Text tone="muted" accessibilityRole="alert" testID="story-notice">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="story-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={
          busy === 'uploading'
            ? t('stories.uploading')
            : busy === 'checking'
              ? t('stories.checking')
              : t('stories.share')
        }
        disabled={!media}
        loading={busy !== null}
        onPress={() => void share()}
        testID="story-share"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', aspectRatio: 4 / 5 },
});
