import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { QrCode } from '../../../../components/QrCode';
import { ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { useEvent, useTicket } from '../../../../src/features/events/api';
import { formatTime } from '../../../../src/features/events/format';
import { errorMessage } from '../../../../src/lib/errors';

/** Your check-in code (F-EVT-14). Works offline once loaded: the code is signed, not looked up. */
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const event = useEvent(id);
  const ticket = useTicket(id, true);
  if (ticket.isPending) return <LoadingState />;
  if (ticket.isError)
    return (
      <ErrorState
        message={errorMessage(t, ticket.error) ?? undefined}
        onRetry={() => void ticket.refetch()}
      />
    );
  return (
    <Screen testID="ticket-screen">
      <Text variant="title" accessibilityRole="header">
        {event.data?.title ?? t('events.ticket')}
      </Text>
      <Text>{t('events.ticketBody')}</Text>
      <View style={styles.qr}>
        <QrCode value={ticket.data.qr} size={260} label={t('events.ticket')} />
      </View>
      <Text tone="muted">
        {t('events.ticketValid', {
          from: formatTime(ticket.data.validFrom, i18n.language),
          until: formatTime(ticket.data.validUntil, i18n.language),
        })}
      </Text>
      {event.data?.viewer.rsvp === 'checked_in' ? (
        <Text tone="primary" variant="heading">
          {t('events.checkedIn')}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  qr: { alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF' },
});
