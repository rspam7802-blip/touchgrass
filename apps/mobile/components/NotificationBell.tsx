import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useUnreadCount } from '../src/features/notifications/api';
import { Button } from './ui';

/** Opens the inbox; the label reads the unread count so screen readers hear it too (F-NOT-01). */
export function NotificationBell() {
  const { t } = useTranslation();
  const router = useRouter();
  const unread = useUnreadCount().data?.unread ?? 0;
  return (
    <Button
      label={unread > 0 ? `🔔 ${String(unread)}` : '🔔'}
      accessibilityLabel={t('notifications.open', { count: unread })}
      variant="ghost"
      onPress={() => {
        router.push('/notifications');
      }}
      testID="open-notifications"
    />
  );
}
