import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ProfileCard } from '../../../components/ProfileCard';
import { StreakCard } from '../../../components/engagement/StreakCard';
import { Button, ErrorState, LoadingState, Screen } from '../../../components/ui';
import { useMe } from '../../../src/features/me/api';
import { errorMessage } from '../../../src/lib/errors';
import { shareLinks, shareText } from '../../../src/features/share/share';
import { useFlag } from '../../../src/features/app-config/use-flag';

export default function MyProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const flags = {
    challenges: useFlag('challenges'),
    recaps: useFlag('recaps'),
    referrals: useFlag('referrals'),
  };
  if (me.isPending) {
    return (
      <Screen testID="my-profile">
        <LoadingState />
      </Screen>
    );
  }
  if (me.isError) {
    return (
      <Screen testID="my-profile">
        <ErrorState
          message={errorMessage(t, me.error) ?? undefined}
          onRetry={() => void me.refetch()}
        />
      </Screen>
    );
  }
  const m = me.data;
  return (
    <Screen testID="my-profile">
      <ProfileCard
        displayName={m.displayName ?? ''}
        subtitle={m.pronouns}
        bio={m.bio}
        photos={m.photos.flatMap((p) => (p.urls ? [p.urls] : []))}
        interests={m.interests}
        vibeTags={m.vibeTags}
        stats={m.stats}
        verified={m.verified}
      />
      <StreakCard />
      <Button
        label={t('share.shareProfile')}
        variant="secondary"
        onPress={() => void shareText(t('share.profileMessage', { url: shareLinks.profile(m.id) }))}
        testID="share-my-profile"
      />
      <Button
        label={t('profile.edit')}
        onPress={() => {
          router.push('/profile-edit');
        }}
        testID="edit-profile"
      />
      <Button
        label={t('profile.invites')}
        variant="secondary"
        onPress={() => {
          router.push('/invites');
        }}
        testID="open-invites"
      />
      <Button
        label={t('hosting.title')}
        variant="secondary"
        onPress={() => {
          router.push('/hosting');
        }}
        testID="open-hosting"
      />
      {(
        [
          ['/badges', 'badges.title', 'open-badges', true],
          ['/challenges', 'challenges.title', 'open-challenges', flags.challenges],
          ['/recaps', 'recap.title', 'open-recaps', flags.recaps],
          ['/referrals', 'referrals.title', 'open-referrals', flags.referrals],
          ['/safety', 'safety.title', 'open-safety', true],
        ] as const
      )
        .filter(([, , , on]) => on)
        .map(([path, label, testID]) => (
          <Button
            key={path}
            label={t(label)}
            variant="secondary"
            onPress={() => {
              router.push(path);
            }}
            testID={testID}
          />
        ))}
    </Screen>
  );
}
