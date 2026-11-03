import type { InviteCode } from '@touchgrass/shared';
import { Share, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components/ui';
import { useCreateInvite, useMyInvites } from '../../src/features/me/api';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/theme';

function inviteStatus(
  t: (k: string, o?: Record<string, unknown>) => string,
  i: InviteCode,
): string {
  if (i.expiresAt && new Date(i.expiresAt).getTime() < Date.now())
    return t('profile.inviteExpired');
  return t('profile.inviteUses', { uses: i.uses, max: i.maxUses });
}

/** Your invite codes (F-ACC-01): create up to your quota and share via WhatsApp/SMS. */
export default function InvitesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const invites = useMyInvites();
  const create = useCreateInvite();

  if (invites.isPending) {
    return (
      <Screen testID="invites-screen">
        <LoadingState />
      </Screen>
    );
  }
  if (invites.isError) {
    return (
      <Screen testID="invites-screen">
        <ErrorState
          message={errorMessage(t, invites.error) ?? undefined}
          onRetry={() => void invites.refetch()}
        />
      </Screen>
    );
  }
  const data = invites.data;
  const share = (code: string): void => {
    void Share.share({
      message: t('profile.inviteShareMessage', { code, url: `${data.shareUrlBase}/${code}` }),
    });
  };

  return (
    <Screen testID="invites-screen">
      <Text variant="heading" accessibilityLiveRegion="polite">
        {t('profile.invitesRemaining', { count: data.remaining })}
      </Text>
      <Button
        label={t('profile.createInvite')}
        onPress={() =>
          void create.mutateAsync().then(
            (i) => {
              share(i.code);
            },
            () => undefined,
          )
        }
        disabled={data.remaining === 0}
        loading={create.isPending}
        testID="create-invite"
      />
      {create.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, create.error)}
        </Text>
      ) : null}
      {data.items.length === 0 ? (
        <EmptyState body={t('profile.invitesEmpty')} />
      ) : (
        data.items.map((i) => (
          <View
            key={i.id}
            style={[styles.row, { borderColor: theme.colors.border, borderRadius: theme.radii.md }]}
            testID={`invite-${i.code}`}
          >
            <View style={styles.grow}>
              <Text variant="heading" selectable>
                {i.code}
              </Text>
              <Text variant="caption" tone="muted">
                {inviteStatus(t, i)}
              </Text>
            </View>
            <Button
              label={t('profile.shareInvite')}
              variant="ghost"
              onPress={() => {
                share(i.code);
              }}
              disabled={i.uses >= i.maxUses || i.revoked}
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
    gap: 12,
    padding: 12,
    borderWidth: 1,
  },
  grow: { flex: 1, minWidth: 120 },
});
