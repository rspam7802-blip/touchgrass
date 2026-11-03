import { useQuery } from '@tanstack/react-query';
import { PublicProfile } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ProfileCard } from '../../../components/ProfileCard';
import { SquadActions } from '../../../components/SquadActions';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { useStartDirect } from '../../../src/features/chat/api';
import { useSquadAction } from '../../../src/features/social/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { ApiError } from '../../../src/lib/api-client';
import { errorMessage } from '../../../src/lib/errors';
import { useApi } from '../../../src/providers/api-context';
import { shareLinks, shareText } from '../../../src/features/share/share';

/** Another person's profile, already filtered server-side by blocks and visibility. */
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { client } = useApi();
  const offline = useIsOffline();
  const router = useRouter();
  const block = useSquadAction();
  const startDirect = useStartDirect();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ['profile', id],
    queryFn: ({ signal }) => client.request(`/v1/users/${id}/profile`, PublicProfile, { signal }),
  });

  if (profile.isPending) {
    return (
      <Screen testID="user-profile">
        <LoadingState />
      </Screen>
    );
  }
  if (profile.isError) {
    const err = profile.error;
    return (
      <Screen testID="user-profile">
        {err instanceof ApiError && err.code === 'NOT_FOUND' ? (
          <EmptyState title={t('errors.NOT_FOUND')} body="" />
        ) : offline ? (
          <OfflineState onRetry={() => void profile.refetch()} />
        ) : (
          <ErrorState
            message={errorMessage(t, err) ?? undefined}
            onRetry={() => void profile.refetch()}
          />
        )}
      </Screen>
    );
  }
  const p = profile.data;
  const meta = [
    p.age !== null ? t('profile.age', { age: p.age }) : null,
    p.pronouns,
    p.neighbourhoodName,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Screen testID="user-profile">
      <ProfileCard
        displayName={p.displayName}
        subtitle={meta || null}
        bio={p.bio}
        photos={p.photos}
        interests={p.interests}
        vibeTags={p.vibeTags}
        stats={p.stats}
        verified={p.verified}
        highlightInterestIds={p.sharedInterestIds}
        hostRating={p.hostRating}
      />
      {p.sharedInterestIds.length > 0 ? (
        <Text tone="primary">
          {t('profile.sharedInterests', { count: p.sharedInterestIds.length })}
        </Text>
      ) : null}
      {p.mutualFriends.count > 0 ? (
        <Text tone="muted">{t('profile.mutualFriends', { count: p.mutualFriends.count })}</Text>
      ) : null}
      {p.limited ? <Text tone="muted">{t('profile.limited')}</Text> : null}
      <View style={styles.actions}>
        <SquadActions userId={p.id} relationship={p.relationship} />
        {p.relationship !== 'self' ? (
          <Button
            label={t('chat.message')}
            variant="secondary"
            loading={startDirect.isPending}
            onPress={() => {
              setMessageError(null);
              startDirect.mutateAsync(p.id).then(
                (conversation) => {
                  router.push({ pathname: '/chats/[id]', params: { id: conversation.id } });
                },
                (err: unknown) => {
                  setMessageError(errorMessage(t, err));
                },
              );
            }}
            testID="message-user"
          />
        ) : null}
      </View>
      {messageError ? (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {messageError}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={t('share.shareProfile')}
          variant="secondary"
          onPress={() =>
            void shareText(t('share.profileMessage', { url: shareLinks.profile(p.id) }))
          }
          testID="share-profile"
        />
        <Button
          label={t('report.reportUser')}
          variant="ghost"
          onPress={() => {
            router.push({
              pathname: '/report',
              params: { targetType: 'user', targetId: p.id, name: p.displayName },
            });
          }}
          testID="report-user"
        />
        <Button
          label={t('report.block')}
          variant="ghost"
          onPress={() => {
            setConfirmBlock(true);
          }}
          testID="block-user"
        />
      </View>
      {confirmBlock ? (
        <View accessibilityRole="alert" style={styles.confirm}>
          <Text>{t('report.blockConfirm', { name: p.displayName })}</Text>
          <View style={styles.actions}>
            <Button
              label={t('report.block')}
              variant="danger"
              loading={block.isPending}
              onPress={() => {
                block.mutate(
                  { action: 'block', userId: p.id },
                  {
                    onSuccess: () => {
                      router.back();
                    },
                  },
                );
              }}
              testID="confirm-block"
            />
            <Button
              label={t('common.cancel')}
              variant="ghost"
              onPress={() => {
                setConfirmBlock(false);
              }}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirm: { gap: 8 },
});
