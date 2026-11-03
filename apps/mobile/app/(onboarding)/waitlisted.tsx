import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../components/ui';
import { useCityWaitlist, useLeaveCityWaitlist } from '../../src/features/catalog/api';
import { errorMessage } from '../../src/lib/errors';

/** Waiting for your city to open (F-GRW-03): your place in line, and a way out. */
export default function WaitlistedScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const status = useCityWaitlist();
  const leave = useLeaveCityWaitlist();

  if (status.isPending)
    return (
      <Screen testID="waitlisted-screen">
        <LoadingState />
      </Screen>
    );
  if (status.isError)
    return (
      <Screen testID="waitlisted-screen">
        <ErrorState
          message={errorMessage(t, status.error) ?? undefined}
          onRetry={() => void status.refetch()}
        />
      </Screen>
    );
  const s = status.data;
  const city = s.cityName ?? '';
  return (
    <Screen testID="waitlisted-screen">
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">
          {t('cities.waitlistTitle', { city })}
        </Text>
        <Text testID="waitlist-position">
          {t('cities.waitlistBody', { city, position: s.position ?? 1 })}
        </Text>
        {leave.error ? (
          <Text tone="danger" accessibilityRole="alert">
            {errorMessage(t, leave.error)}
          </Text>
        ) : null}
        <Button
          label={t('cities.pickAnother')}
          onPress={() => {
            router.replace({ pathname: '/city', params: { change: '1' } });
          }}
          testID="waitlist-pick-another"
        />
        <Button
          label={t('cities.leave')}
          variant="secondary"
          loading={leave.isPending}
          onPress={() => {
            void leave.mutateAsync().then(
              () => {
                router.replace({ pathname: '/city', params: { change: '1' } });
              },
              () => undefined,
            );
          }}
          testID="waitlist-leave"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { gap: 16 } });
