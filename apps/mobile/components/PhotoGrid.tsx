import { X } from './icons';
import type { ProfilePhoto } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/theme/theme';
import { Icon, Text } from './ui';

export interface PhotoGridProps {
  photos: ProfilePhoto[];
  max: number;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
  onRemove: (mediaAssetId: string) => void;
}

/** 3-column grid of profile photo slots with processing/review states. */
export function PhotoGrid({ photos, max, canAdd, adding, onAdd, onRemove }: PhotoGridProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  // Tiles get an exact size from the grid's measured width. A percentage width with aspectRatio collapsed
  // to the border on Android (photos looked missing, so people uploaded them again).
  const [gridWidth, setGridWidth] = useState(0);
  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - GAP * (COLUMNS - 1)) / COLUMNS) : 0;
  const size = tileWidth > 0 ? { width: tileWidth, height: Math.round((tileWidth * 5) / 4) } : null;
  const slot = [
    styles.slot,
    size ?? styles.slotFallback,
    {
      borderRadius: theme.radii.md,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
    },
  ];
  return (
    <View
      style={styles.grid}
      onLayout={(e) => {
        setGridWidth(e.nativeEvent.layout.width);
      }}
    >
      {photos.map((p, i) => (
        <View key={p.mediaAssetId} style={slot}>
          {p.urls ? (
            <Image
              source={{ uri: p.urls.md }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              accessible
              accessibilityLabel={t('a11y.photoSlot', { number: i + 1, total: max })}
              accessibilityIgnoresInvertColors
            />
          ) : null}
          {p.status === 'processing' ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text variant="caption">{t('onboarding.photoProcessing')}</Text>
            </View>
          ) : null}
          {p.status === 'flagged' ? (
            <View style={styles.center}>
              <Text variant="caption" tone="danger">
                {t('onboarding.photoFlagged')}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.removePhoto', { number: i + 1 })}
            accessibilityHint={t('onboarding.removePhoto', { number: i + 1 })}
            onPress={() => {
              onRemove(p.mediaAssetId);
            }}
            hitSlop={8}
            style={[
              styles.remove,
              {
                backgroundColor: theme.colors.overlay,
                minWidth: theme.minTouchTarget,
                minHeight: theme.minTouchTarget,
              },
            ]}
            testID={`remove-photo-${i + 1}`}
          >
            <Icon icon={X} size={16} color={theme.colors.onPrimary} strokeWidth={2.6} />
          </Pressable>
        </View>
      ))}
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.addPhoto')}
          accessibilityHint={t('onboarding.photosBody')}
          accessibilityState={{ busy: adding, disabled: adding }}
          disabled={adding}
          onPress={onAdd}
          style={[slot, styles.addTile]}
          testID="add-photo"
        >
          {adding ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Text variant="title">＋</Text>
          )}
          <Text variant="caption">{t('onboarding.addPhoto')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const COLUMNS = 3;
const GAP = 8;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  slot: { borderWidth: 2, overflow: 'hidden' },
  /** Until the grid is measured (first frame, and tests): a fixed tile so nothing collapses. */
  slotFallback: { width: 104, height: 130 },
  addTile: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 12,
  },
});
