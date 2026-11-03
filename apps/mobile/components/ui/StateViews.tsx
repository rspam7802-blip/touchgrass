import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/theme/theme';
import { Button } from './Button';
import { Text } from './Text';

/** The four states every screen must handle (loading, empty, error, offline). */
export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.center} accessible accessibilityRole="progressbar" testID="state-loading">
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text tone="muted">{label ?? t('states.loading')}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.center} testID="state-empty">
      <Text variant="heading">{title ?? t('states.emptyTitle')}</Text>
      <Text tone="muted" style={styles.centerText}>
        {body ?? t('states.emptyBody')}
      </Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center} testID="state-error" accessibilityRole="alert">
      <Text variant="heading">{t('states.errorTitle')}</Text>
      <Text tone="muted" style={styles.centerText}>
        {message ?? t('states.errorBody')}
      </Text>
      {onRetry ? (
        <Button
          label={t('common.retry')}
          accessibilityHint={t('a11y.retryHint')}
          variant="ghost"
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center} testID="state-offline">
      <Text variant="heading">{t('states.offlineTitle')}</Text>
      <Text tone="muted" style={styles.centerText}>
        {t('states.offlineBody')}
      </Text>
      {onRetry ? <Button label={t('common.retry')} variant="ghost" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  centerText: { textAlign: 'center' },
});
