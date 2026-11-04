import type { FreeNowItem } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStartDirect } from '../../src/features/chat/api';
import { usePing } from '../../src/features/engagement/api';
import { formatTime } from '../../src/features/events/format';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/theme';
import { Avatar } from '../Avatar';
import { Button, FadeIn, Text } from '../ui';

/**
 * What you can do with a squad member who is free now (the mock's ping card): ping them, message them, or start
 * a plan with them invited.
 */
export function FreeNowSheet({ item, onClose }: { item: FreeNowItem | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const ping = usePing();
  const startDirect = useStartDirect();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = (): void => {
    setNotice(null);
    setError(null);
    ping.reset();
    onClose();
  };
  if (!item) return null;
  const { person } = item;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        testID="free-sheet-backdrop"
      />
      <SafeAreaView
        edges={['bottom']}
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderTopLeftRadius: theme.radii.lg,
            borderTopRightRadius: theme.radii.lg,
          },
        ]}
        testID="free-sheet"
      >
        <View style={styles.head}>
          <Avatar
            photo={person.photo}
            name={person.displayName}
            size={56}
            ring={theme.colors.primary}
          />
          <View style={styles.grow}>
            <Text variant="heading" accessibilityRole="header">
              {person.displayName}
            </Text>
            <Text tone="muted">
              {t('free.until', { time: formatTime(item.until, i18n.language) })}
            </Text>
          </View>
        </View>
        {item.note ? <Text testID="free-sheet-note">{item.note}</Text> : null}
        {notice ? (
          <FadeIn distance={6}>
            <Text tone="primary" accessibilityLiveRegion="polite" testID="free-sheet-notice">
              {notice}
            </Text>
          </FadeIn>
        ) : null}
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="assertive" testID="free-sheet-error">
            {error}
          </Text>
        ) : null}
        <Button
          label={t('free.ping')}
          accessibilityHint={t('free.pingHint', { name: person.displayName })}
          loading={ping.isPending}
          disabled={ping.isSuccess}
          onPress={() => {
            setError(null);
            ping.mutateAsync(person.id).then(
              () => {
                setNotice(t('free.pingSent', { name: person.displayName }));
              },
              (err: unknown) => {
                setError(errorMessage(t, err));
              },
            );
          }}
          testID="free-sheet-ping"
        />
        <View style={styles.row}>
          <Button
            label={t('free.message')}
            variant="secondary"
            loading={startDirect.isPending}
            style={styles.grow}
            onPress={() => {
              startDirect.mutateAsync(person.id).then(
                (conversation) => {
                  close();
                  router.push({ pathname: '/chats/[id]', params: { id: conversation.id } });
                },
                (err: unknown) => {
                  setError(errorMessage(t, err));
                },
              );
            }}
            testID="free-sheet-message"
          />
          <Button
            label={t('free.planTogether')}
            variant="secondary"
            style={styles.grow}
            onPress={() => {
              close();
              router.push({ pathname: '/plot', params: { inviteUserId: person.id } });
            }}
            testID={`plan-with-${person.id}`}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { borderWidth: 1, padding: 20, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  row: { flexDirection: 'row', gap: 10 },
  grow: { flexGrow: 1, flexShrink: 1 },
});
