import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components/ui';
import { useReferrals } from '../../src/features/engagement/api';
import { formatWhen } from '../../src/features/events/format';
import { money } from '../../src/features/payments/format';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/theme';

/** Invite friends (F-GRW-01): your code and link, what a friend's first check-in earns, and your rewards. */
export default function ReferralsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const q = useReferrals();
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const r = q.data;
  return (
    <Screen testID="referrals-screen">
      <Text variant="label">{t('referrals.code')}</Text>
      <Text
        variant="title"
        testID="referral-code"
        accessibilityLabel={`${t('referrals.code')}: ${r.code.split('').join(' ')}`}
        style={styles.code}
      >
        {r.code}
      </Text>
      <Button
        label={t('referrals.share')}
        onPress={() =>
          void Share.share({ message: t('referrals.shareMessage', { link: r.link, code: r.code }) })
        }
        testID="referral-share"
      />
      <View
        style={[
          styles.box,
          { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
        ]}
      >
        <Text>{t('referrals.how')}</Text>
        {r.perReferral.priorityPasses > 0 ? (
          <Text>• {t('referrals.perPasses', { count: r.perReferral.priorityPasses })}</Text>
        ) : null}
        {r.perReferral.credits > 0 ? (
          <Text>• {t('referrals.perCredits', { count: r.perReferral.credits })}</Text>
        ) : null}
        <Text>• {t('referrals.badge')}</Text>
        <Text tone="muted">{t('referrals.friendGets')}</Text>
      </View>
      <Text variant="heading" accessibilityRole="header">
        {t('referrals.balance')}
      </Text>
      <Text testID="referral-passes">
        {t('referrals.passes', { count: r.balance.priorityPasses })}
      </Text>
      <Text testID="referral-credits">{t('referrals.credits', { count: r.balance.credits })}</Text>
      {r.balance.credits > 0 ? (
        <Text variant="caption" tone="muted">
          {t('referrals.creditMax', { amount: money(r.balance.creditMaxPaise, i18n.language) })}
        </Text>
      ) : null}
      <Text variant="heading" accessibilityRole="header">
        {t('referrals.friends')}
      </Text>
      {r.items.length === 0 ? <EmptyState title={t('referrals.empty')} /> : null}
      {r.items.map((i, idx) => (
        <View key={`${i.createdAt}-${String(idx)}`} accessible style={styles.item}>
          <Text variant="label">{i.person?.displayName ?? t('referrals.leftApp')}</Text>
          <Text variant="caption" tone={i.status === 'rewarded' ? 'primary' : 'muted'}>
            {[
              t(`referrals.status.${i.status}`),
              i.reason ? t(`referrals.reasons.${i.reason}`) : null,
              formatWhen(i.createdAt, i18n.language),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { letterSpacing: 4 },
  box: { padding: 16, gap: 6 },
  item: { gap: 2, paddingVertical: 6 },
});
