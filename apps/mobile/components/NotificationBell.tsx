import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useUnreadCount } from '../src/features/notifications/api';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { IconButton, Text } from './ui';

/** Opens the inbox; the label reads the unread count so screen readers hear it too (F-NOT-01). */
export function NotificationBell() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const unread = useUnreadCount().data?.unread ?? 0;
  return (
    <View>
      <IconButton
        icon="🔔"
        label={t('notifications.open', { count: unread })}
        onPress={() => {
          router.push('/notifications');
        }}
        testID="open-notifications"
      />
      {unread > 0 ? (
        // Visual badge only: the button's label already says how many are unread.
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          pointerEvents="none"
          style={[styles.badge, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={[styles.count, { color: theme.colors.onPrimary }]}>{String(unread)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  count: { fontSize: 10, lineHeight: 12, fontWeight: '800' },
});
