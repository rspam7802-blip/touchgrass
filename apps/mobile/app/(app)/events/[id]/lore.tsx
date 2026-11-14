import { LIMITS, type LoreItem, type LoreVisibility } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { ChipGroup } from '../../../../components/ChipGroup';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../../components/ui';
import {
  useAddLore,
  useLore,
  useLoreDownload,
  useLoreVisibility,
  useRemoveLore,
} from '../../../../src/features/after/api';
import { savePhoto } from '../../../../src/features/after/save';
import {
  compressImage,
  pickImage,
  uploadImage,
  waitUntilReady,
} from '../../../../src/features/media/upload';
import { errorMessage } from '../../../../src/lib/errors';
import { useApi } from '../../../../src/providers/api-context';
import { useTheme } from '../../../../src/theme/theme';

/** Moderation usually takes a few seconds; give it ~30 s before telling the person it is still being checked. */
const LORE_READY_POLLS = 36;

/**
 * Lore (F-AFT-04): the plan's shared album. People who checked in add photos; hosts choose whether their
 * squads can see it too. Photos open full size with save, report and remove.
 */
export default function LoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  // Three square tiles a row, sized from the grid's width (a % width with aspectRatio collapsed on Android).
  const [gridWidth, setGridWidth] = useState(0);
  const tile = gridWidth > 0 ? Math.floor((gridWidth - 6 * 2) / 3) : 104;
  const tileSize = { width: tile, height: tile };
  const { client } = useApi();
  const q = useLore(id);
  const add = useAddLore(id);
  const remove = useRemoveLore(id);
  const visibility = useLoreVisibility(id);
  const download = useLoreDownload(id);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<'uploading' | 'checking' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LoreItem | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const first = q.data.pages[0];
  if (!first) return <LoadingState />;
  const items = q.data.pages.flatMap((p) => p.items);

  const addPhoto = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const uri = await pickImage();
      if (!uri) return;
      setBusy('uploading');
      const asset = await uploadImage(client, 'lore', await compressImage(uri));
      setBusy('checking');
      if (!(await waitUntilReady(client, asset, LORE_READY_POLLS))) {
        setNotice(t('lore.pending'));
        return;
      }
      await add.mutateAsync({ mediaId: asset.id, caption: caption.trim() });
      setCaption('');
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  };

  const saveAll = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const links = await download.mutateAsync();
      let saved = 0;
      for (const item of links.items) if (await savePhoto(item.url, item.id)) saved += 1;
      setNotice(t('lore.downloaded', { count: saved }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const saveOne = async (item: LoreItem): Promise<void> => {
    setError(null);
    try {
      if (await savePhoto(item.image.lg, item.id)) setNotice(t('lore.downloaded', { count: 1 }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const removeOne = async (item: LoreItem): Promise<void> => {
    setOpen(null);
    setError(null);
    try {
      await remove.mutateAsync(item.id);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="lore-screen">
      <Text variant="title" accessibilityRole="header">
        {first.eventTitle}
      </Text>

      {first.canManage ? (
        <ChipGroup
          label={t('lore.visibility')}
          mode="single"
          options={[
            { id: 'attendees', label: t('lore.visibilityAttendees') },
            { id: 'friends_of_attendees', label: t('lore.visibilityFriends') },
          ]}
          selected={[first.visibility]}
          onChange={(next) => {
            const v = next[0] as LoreVisibility | undefined;
            if (!v || v === first.visibility) return;
            setError(null);
            visibility.mutateAsync(v).catch((err: unknown) => {
              setError(errorMessage(t, err));
            });
          }}
          testIDPrefix="lore-visibility"
        />
      ) : null}

      {first.canAdd ? (
        <View style={styles.section}>
          <TextField
            label={t('lore.caption')}
            value={caption}
            onChangeText={setCaption}
            maxLength={LIMITS.after.captionMaxLength}
            testID="lore-caption"
          />
          <Button
            label={busy ? t('lore.uploading') : t('lore.add')}
            loading={busy !== null}
            onPress={() => void addPhoto()}
            testID="lore-add"
          />
        </View>
      ) : null}

      {notice ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="lore-notice">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="lore-error">
          {error}
        </Text>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title={t('lore.empty')} />
      ) : (
        <>
          <View
            style={styles.grid}
            testID="lore-grid"
            onLayout={(e) => {
              setGridWidth(e.nativeEvent.layout.width);
            }}
          >
            {items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={[
                  item.caption || null,
                  t('lore.photoBy', { name: item.uploader.displayName }),
                ]
                  .filter(Boolean)
                  .join(', ')}
                onPress={() => {
                  setOpen(item);
                }}
                style={[styles.tile, tileSize, { borderRadius: theme.radii.md }]}
                testID={`lore-item-${item.id}`}
              >
                <Image
                  source={{ uri: item.image.sm }}
                  style={styles.fill}
                  contentFit="cover"
                  accessibilityIgnoresInvertColors
                  accessible={false}
                  importantForAccessibility="no"
                />
              </Pressable>
            ))}
          </View>
          {q.hasNextPage ? (
            <Button
              label={t('lore.more')}
              variant="ghost"
              loading={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
              testID="lore-more"
            />
          ) : null}
          <Button
            label={t('lore.download')}
            variant="secondary"
            loading={download.isPending}
            onPress={() => void saveAll()}
            testID="lore-download"
          />
        </>
      )}

      <Modal
        visible={open !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setOpen(null);
        }}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => {
            setOpen(null);
          }}
        >
          {open ? (
            <View
              style={[
                styles.sheet,
                { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg },
              ]}
              testID="lore-photo"
            >
              <Image
                source={{ uri: open.image.lg }}
                style={styles.photo}
                contentFit="contain"
                accessibilityIgnoresInvertColors
                accessibilityLabel={
                  open.caption || t('lore.photoBy', { name: open.uploader.displayName })
                }
              />
              {open.caption ? <Text>{open.caption}</Text> : null}
              {open.captionHeld ? (
                <Text variant="caption" tone="muted" testID="lore-caption-held">
                  {t('moderation.held')}
                </Text>
              ) : null}
              <Text variant="caption" tone="muted">
                {t('lore.photoBy', { name: open.uploader.displayName })}
              </Text>
              <Button
                label={t('lore.download')}
                variant="secondary"
                onPress={() => void saveOne(open)}
                testID="lore-save-one"
              />
              {open.mine || first.canManage ? (
                <Button
                  label={t('lore.remove')}
                  variant="danger"
                  loading={remove.isPending}
                  onPress={() => void removeOne(open)}
                  testID="lore-remove"
                />
              ) : null}
              {!open.mine ? (
                <Button
                  label={t('lore.report')}
                  variant="ghost"
                  onPress={() => {
                    const target = open;
                    setOpen(null);
                    router.push({
                      pathname: '/report',
                      params: {
                        targetType: 'lore_media',
                        targetId: target.id,
                        name: target.uploader.displayName,
                      },
                    });
                  }}
                  testID="lore-report"
                />
              ) : null}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  backdrop: { flex: 1, justifyContent: 'center', padding: 16 },
  sheet: { padding: 16, gap: 10 },
  photo: { width: '100%', aspectRatio: 0.8 },
});
