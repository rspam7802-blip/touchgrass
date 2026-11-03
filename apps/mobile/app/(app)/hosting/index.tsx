import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ErrorState,
  ListRow,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { useHostAnalytics, useHostStatus } from '../../../src/features/payments/api';
import { money } from '../../../src/features/payments/format';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../src/lib/errors';
import { StatGrid } from '../../../components/hosting/StatGrid';

/** Hosting home: who may sell tickets (F-HST-01), payout setup (F-PAY-03) and insights (F-HST-02). */
export default function HostingScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const offline = useIsOffline();
  const status = useHostStatus();
  const analytics = useHostAnalytics();
  if (status.isPending) return <LoadingState />;
  if (status.isError)
    return offline ? (
      <OfflineState onRetry={() => void status.refetch()} />
    ) : (
      <ErrorState
        message={errorMessage(t, status.error) ?? undefined}
        onRetry={() => void status.refetch()}
      />
    );
  const s = status.data;
  const app = s.application;
  const account = s.account;
  return (
    <Screen testID="hosting-screen">
      <Text variant="title" accessibilityRole="header">
        {t('hosting.title')}
      </Text>
      {!s.canHostFree ? <Text tone="muted">{t('hosting.verifyFirst')}</Text> : null}
      <Text variant="heading" accessibilityRole="header">
        {t('hosting.applyTitle')}
      </Text>
      {app?.status === 'approved' ? (
        <Text tone="primary" testID="host-approved">
          {t('hosting.approved')}
        </Text>
      ) : app?.status === 'pending' ? (
        <Text testID="host-pending">{t('hosting.pending')}</Text>
      ) : (
        <>
          <Text tone="muted">
            {app?.status === 'rejected' ? t('hosting.rejected') : t('hosting.applyBody')}
          </Text>
          {s.canHostFree ? (
            <Button
              label={app?.status === 'rejected' ? t('hosting.applyAgain') : t('hosting.applyTitle')}
              onPress={() => {
                router.push('/hosting/apply');
              }}
              testID="host-apply"
            />
          ) : null}
        </>
      )}
      {s.canHostPaid ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('hosting.payoutSetup')}
          </Text>
          <Text tone={account?.status === 'activated' ? 'primary' : 'muted'} testID="kyc-status">
            {account === null
              ? t('hosting.payoutSetupBody')
              : account.status === 'activated'
                ? t('hosting.kycActive')
                : account.status === 'needs_clarification'
                  ? t('hosting.kycNeedsInfo')
                  : account.status === 'rejected'
                    ? t('hosting.kycRejected')
                    : t('hosting.kycPending')}
          </Text>
          {account === null ? (
            <Button
              label={t('hosting.startKyc')}
              variant="secondary"
              onPress={() => {
                router.push('/hosting/account');
              }}
              testID="start-kyc"
            />
          ) : null}
          <ListRow
            label={t('hosting.payouts')}
            onPress={() => {
              router.push('/hosting/payouts');
            }}
            testID="open-payouts"
          />
        </>
      ) : null}
      <Text variant="heading" accessibilityRole="header">
        {t('hosting.analytics')}
      </Text>
      {analytics.isPending ? (
        <LoadingState />
      ) : analytics.isError ? (
        <ErrorState
          message={errorMessage(t, analytics.error) ?? undefined}
          onRetry={() => void analytics.refetch()}
        />
      ) : analytics.data.events.length === 0 ? (
        <Text tone="muted">{t('hosting.noEvents')}</Text>
      ) : (
        <>
          <Text variant="label">{t('hosting.overall')}</Text>
          <StatGrid a={analytics.data.totals} language={i18n.language} />
          {analytics.data.events.map((e) => (
            <ListRow
              key={e.eventId}
              label={e.title}
              detail={`${t('hosting.views')} ${String(e.views)} · ${t('hosting.rsvps')} ${String(e.rsvps)} · ${money(e.revenuePaise, i18n.language)}`}
              onPress={() => {
                router.push({ pathname: '/hosting/event/[id]', params: { id: e.eventId } });
              }}
              testID={`analytics-${e.eventId}`}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
