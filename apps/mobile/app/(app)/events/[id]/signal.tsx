import { signalIcon } from '../../../../src/features/at-event/signal-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';
import { ErrorState, Icon, LoadingState, Screen, Text } from '../../../../components/ui';
import { useSignal } from '../../../../src/features/chat/api';
import { formatTime } from '../../../../src/features/events/format';
import { ApiError } from '../../../../src/lib/api-client';
import { errorMessage } from '../../../../src/lib/errors';
import { useTheme } from '../../../../src/theme/theme';

function availableFromOf(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const d = err.details;
  if (typeof d !== 'object' || d === null || !('reason' in d) || d.reason !== 'SIGNAL_NOT_YET')
    return null;
  return 'availableFrom' in d && typeof d.availableFrom === 'string' ? d.availableFrom : null;
}

/** Text colour with enough contrast on the signal colour (WCAG relative luminance). */
function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#111111' : '#FFFFFF';
}

/**
 * Find your group (F-ATE-02): a full-screen colour + icon to hold up at the spot. It gently pulses so it is easy
 * to spot from a distance, unless the person prefers reduced motion.
 */
export default function SignalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const q = useSignal(id, true);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (theme.reduceMotion || !q.data) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.75, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [theme.reduceMotion, q.data, pulse]);

  if (q.isPending) return <LoadingState />;
  if (q.isError) {
    const from = availableFromOf(q.error);
    if (from)
      return (
        <Screen testID="signal-screen">
          <Text variant="title" accessibilityRole="header">
            {t('ate.signalTitle')}
          </Text>
          <Text testID="signal-not-yet">
            {t('ate.signalAvailable', { time: formatTime(from, i18n.language) })}
          </Text>
        </Screen>
      );
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const s = q.data;
  const fg = onColor(s.color);
  const label = t('ate.signalLabel', {
    color: t(`ate.colors.${s.colorName}`),
    icon: t(`ate.icons.${s.iconName}`),
  });
  return (
    <View style={[styles.full, { backgroundColor: s.color }]} testID="signal-screen">
      <Animated.View style={[styles.center, { opacity: pulse }]}>
        <View accessible accessibilityLabel={label} accessibilityRole="image" testID="signal-icon">
          <Icon icon={signalIcon(s.iconName)} size={180} color={fg} strokeWidth={1.6} />
        </View>
      </Animated.View>
      <Text variant="title" style={{ color: fg, textAlign: 'center' }} accessibilityRole="header">
        {label}
      </Text>
      <Text style={{ color: fg, textAlign: 'center' }}>{t('ate.signalBody')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
