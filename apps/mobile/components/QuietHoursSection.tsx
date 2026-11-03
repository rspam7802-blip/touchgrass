import { parseClock } from '@touchgrass/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuietHours, useSetQuietHours } from '../src/features/notifications/api';
import { errorMessage } from '../src/lib/errors';
import { Button, SwitchRow, Text, TextField } from './ui';

/** Quiet hours (F-NOT-01): non-urgent notifications wait until they end and then arrive together. */
export function QuietHoursSection() {
  const { t } = useTranslation();
  const q = useQuietHours();
  const save = useSetQuietHours();
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('08:00');
  useEffect(() => {
    if (q.data) {
      setStart(q.data.start);
      setEnd(q.data.end);
    }
  }, [q.data]);
  if (!q.data) return null;
  const enabled = q.data.enabled;
  const valid = parseClock(start) !== null && parseClock(end) !== null;
  return (
    <View style={styles.group} testID="quiet-hours">
      <Text variant="heading" accessibilityRole="header">
        {t('notifications.quietHours')}
      </Text>
      <Text tone="muted">{t('notifications.quietHoursBody')}</Text>
      <SwitchRow
        label={t('notifications.quietEnabled')}
        value={enabled}
        onChange={(on) => {
          save.mutate({ enabled: on, start: q.data.start, end: q.data.end });
        }}
        testID="quiet-enabled"
      />
      {enabled ? (
        <>
          <TextField
            label={t('notifications.quietFrom')}
            value={start}
            onChangeText={setStart}
            maxLength={5}
            keyboardType="numbers-and-punctuation"
            error={parseClock(start) === null ? t('errors.VALIDATION_FAILED') : null}
            testID="quiet-start"
          />
          <TextField
            label={t('notifications.quietTo')}
            value={end}
            onChangeText={setEnd}
            maxLength={5}
            keyboardType="numbers-and-punctuation"
            error={parseClock(end) === null ? t('errors.VALIDATION_FAILED') : null}
            testID="quiet-end"
          />
          <Button
            label={t('common.save')}
            disabled={!valid}
            loading={save.isPending}
            onPress={() => {
              save.mutate({ enabled: true, start, end });
            }}
            testID="quiet-save"
          />
        </>
      ) : null}
      {save.isSuccess ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="quiet-saved">
          {t('notifications.saved')}
        </Text>
      ) : null}
      {save.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, save.error)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: 8 } });
