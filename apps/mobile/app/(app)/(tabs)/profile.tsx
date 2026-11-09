import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { BackButton } from '../../../components/BackButton';
import { ProfileCard } from '../../../components/ProfileCard';
import { StreakCard } from '../../../components/engagement/StreakCard';
import { PlanRail } from '../../../components/explore/PlanRail';
import {
  Award,
  Gear,
  type GlyphIcon,
  Link,
  Repeat,
  Send,
  Shield,
  Ticket,
  ShareIcon,
  Trophy,
} from '../../../components/icons';
import {
  AnimatedPressable,
  Button,
  ErrorState,
  FadeIn,
  Icon,
  IconButton,
  LoadingState,
  Screen,
  staggerDelay,
  Text,
  usePressScale,
} from '../../../components/ui';
import { useFlag } from '../../../src/features/app-config/use-flag';
import { useMyEvents } from '../../../src/features/events/api';
import { useMe } from '../../../src/features/me/api';
import { shareLinks, shareText } from '../../../src/features/share/share';
import { flatten } from '../../../src/features/social/api';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

/** Matches the Screen's side padding so rails run edge to edge. */
const GUTTER = 20;

type Shortcut = {
  path: '/invites' | '/hosting' | '/badges' | '/challenges' | '/recaps' | '/referrals' | '/safety';
  label: string;
  icon: GlyphIcon;
  testID: string;
  on: boolean;
};

/**
 * Your profile (F-ACC-05, D-159): who you are, one clear "Edit profile" with share and settings beside it,
 * your streak, your next plans as a sideways row, and everything else as a tidy grid of tiles instead of a
 * stack of buttons.
 */
export default function MyProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const upcoming = useMyEvents('upcoming');
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
  const plans = flatten(upcoming.data);
  const shortcuts: Shortcut[] = [
    { path: '/invites', label: t('profile.invites'), icon: Send, testID: 'open-invites', on: true },
    { path: '/hosting', label: t('hosting.title'), icon: Ticket, testID: 'open-hosting', on: true },
    { path: '/badges', label: t('badges.title'), icon: Award, testID: 'open-badges', on: true },
    {
      path: '/challenges',
      label: t('challenges.title'),
      icon: Trophy,
      testID: 'open-challenges',
      on: flags.challenges,
    },
    {
      path: '/recaps',
      label: t('recap.title'),
      icon: Repeat,
      testID: 'open-recaps',
      on: flags.recaps,
    },
    {
      path: '/referrals',
      label: t('referrals.title'),
      icon: Link,
      testID: 'open-referrals',
      on: flags.referrals,
    },
    { path: '/safety', label: t('safety.title'), icon: Shield, testID: 'open-safety', on: true },
  ];

  return (
    <Screen testID="my-profile">
      <FadeIn>
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
      </FadeIn>
      <View style={styles.actions}>
        <BackButton testID="profile-back" />
        <Button
          label={t('profile.edit')}
          onPress={() => {
            router.push('/profile-edit');
          }}
          style={styles.grow}
          testID="edit-profile"
        />
        <IconButton
          icon={<Icon icon={ShareIcon} size={18} />}
          label={t('share.shareProfile')}
          onPress={() =>
            void shareText(t('share.profileMessage', { url: shareLinks.profile(m.id) }))
          }
          testID="share-my-profile"
        />
        <IconButton
          icon={<Icon icon={Gear} size={18} />}
          label={t('nav.settings')}
          onPress={() => {
            router.push('/settings');
          }}
          testID="open-settings"
        />
      </View>
      <StreakCard />
      {plans.length > 0 ? (
        <PlanRail
          railKey="profile-upcoming"
          title={t('events.upcoming')}
          items={plans}
          gutter={GUTTER}
          onOpen={(e) => {
            router.push({ pathname: '/events/[id]', params: { id: e.id } });
          }}
        />
      ) : null}
      <View style={styles.grid}>
        {shortcuts
          .filter((s) => s.on)
          .map((s, i) => (
            <FadeIn key={s.path} delay={staggerDelay(i, 40, 8)} style={styles.cell}>
              <ShortcutTile
                label={s.label}
                icon={s.icon}
                testID={s.testID}
                onPress={() => {
                  router.push(s.path);
                }}
              />
            </FadeIn>
          ))}
      </View>
    </Screen>
  );
}

function ShortcutTile({
  label,
  icon,
  testID,
  onPress,
}: {
  label: string;
  icon: GlyphIcon;
  testID: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const press = usePressScale(0.96);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      testID={testID}
      style={[
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
        },
        press.scaleStyle,
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Icon icon={icon} size={18} color={theme.colors.primary} />
      </View>
      <Text variant="label" numberOfLines={2}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '47%', flexGrow: 1 },
  tile: {
    minHeight: 84,
    padding: 14,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
