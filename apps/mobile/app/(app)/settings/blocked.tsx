import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import { useBlocked, useSquadAction } from '../../../src/features/social/api';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

export default function BlockedPeopleScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const blocked = useBlocked();
  const action = useSquadAction();
  if (blocked.isPending) {
    return (
      <Screen testID="blocked-screen">
        <LoadingState />
      </Screen>
    );
  }
  if (blocked.isError) {
    return (
      <Screen testID="blocked-screen">
        <ErrorState
          message={errorMessage(t, blocked.error) ?? undefined}
          onRetry={() => void blocked.refetch()}
        />
      </Screen>
    );
  }
  return (
    <Screen testID="blocked-screen">
      {blocked.data.items.length === 0 ? (
        <EmptyState body={t('settings.blockedEmpty')} />
      ) : (
        blocked.data.items.map((b) => (
          <View key={b.id} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
            <Text style={styles.grow}>{b.displayName}</Text>
            <Button
              label={t('report.unblock')}
              variant="ghost"
              onPress={() => {
                action.mutate({ action: 'unblock', userId: b.id });
              }}
              testID={`unblock-${b.id}`}
            />
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 120 },
});
