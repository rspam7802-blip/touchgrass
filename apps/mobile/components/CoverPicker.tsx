import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import {
  compressImage,
  pickImage,
  uploadImage,
  waitUntilReady,
} from '../src/features/media/upload';
import { useApi } from '../src/providers/api-context';
import { useTheme } from '../src/theme/theme';
import { Button, Text } from './ui';

export interface CoverValue {
  /** Uploaded, ready cover to send as `coverMediaId`; null when there is none. */
  id: string | null;
  /** What to show: a local file just picked, or the plan's current cover. */
  uri: string | null;
}

/**
 * Optional cover photo for a plan (D-196). The picked image is compressed, uploaded as an `event_cover` and
 * awaited until the server has scanned and resized it (the plan can only use a ready cover).
 */
export function CoverPicker({
  value,
  onChange,
}: {
  value: CoverValue;
  onChange: (next: CoverValue) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { client } = useApi();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = async (): Promise<void> => {
    setFailed(false);
    const uri = await pickImage();
    if (!uri) return;
    setBusy(true);
    try {
      const image = await compressImage(uri);
      const asset = await uploadImage(client, 'event_cover', image);
      if (!(await waitUntilReady(client, asset, 40))) throw new Error('not ready');
      onChange({ id: asset.id, uri: image.uri });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="plot-cover">
      <Text variant="overline" tone="muted">
        {t('events.coverLabel')}
      </Text>
      {value.uri ? (
        <Image
          source={{ uri: value.uri }}
          style={[styles.preview, { borderRadius: theme.radii.md }]}
          contentFit="cover"
          accessible
          accessibilityLabel={t('events.coverLabel')}
          accessibilityIgnoresInvertColors
          testID="plot-cover-preview"
        />
      ) : (
        <Text tone="muted" variant="caption">
          {t('events.coverHint')}
        </Text>
      )}
      <View style={styles.row}>
        <Button
          label={
            busy
              ? t('events.coverUploading')
              : value.uri
                ? t('events.coverChange')
                : t('events.coverAdd')
          }
          variant="secondary"
          loading={busy}
          onPress={() => void choose()}
          testID="plot-cover-add"
        />
        {value.uri && !busy ? (
          <Button
            label={t('events.coverRemove')}
            variant="ghost"
            onPress={() => {
              onChange({ id: null, uri: null });
            }}
            testID="plot-cover-remove"
          />
        ) : null}
      </View>
      {failed ? (
        <Text tone="danger" variant="caption" accessibilityRole="alert">
          {t('events.coverFailed')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  preview: { width: '100%', height: 180 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
