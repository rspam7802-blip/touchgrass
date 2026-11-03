import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import { useRevokeSession, useSessions } from '../../../src/features/me/api';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

/** Logged-in devices with per-device logout (F-ACC-02). */
export default function SessionsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  if (sessions.isPending) {
    return (
      <Screen testID="sessions-screen">
        <LoadingState />
      </Screen>
    );
  }
  if (sessions.isError) {
    return (
      <Screen testID="sessions-screen">
        <ErrorState
          message={errorMessage(t, sessions.error) ?? undefined}
          onRetry={() => void sessions.refetch()}
        />
      </Screen>
    );
  }
  const fmt = new Intl.DateTimeFormat(`${i18n.language}-IN`, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
  return (
    <Screen testID="sessions-screen">
      {sessions.data.items.map((s) => (
        <View
          key={s.id}
          style={[styles.row, { borderColor: theme.colors.border, borderRadius: theme.radii.md }]}
          testID={`session-${s.id}`}
        >
          <View style={styles.grow}>
            <Text variant="heading">
              {s.current ? `${s.deviceName} · ${t('settings.thisDevice')}` : s.deviceName}
            </Text>
            <Text variant="caption" tone="muted">
              {t('settings.lastActive', { when: fmt.format(new Date(s.lastUsedAt)) })}
            </Text>
          </View>
          {!s.current ? (
            <Button
              label={t('settings.revoke')}
              variant="ghost"
              onPress={() => {
                revoke.mutate(s.id);
              }}
              testID={`revoke-${s.id}`}
            />
          ) : null}
        </View>
      ))}
      {revoke.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, revoke.error)}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
  },
  grow: { flex: 1, minWidth: 140 },
});
