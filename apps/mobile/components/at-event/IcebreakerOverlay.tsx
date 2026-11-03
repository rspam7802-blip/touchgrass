import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { localized } from '../../src/features/catalog/api';
import { useRealtime } from '../../src/features/chat/realtime';
import { useTheme } from '../../src/theme/theme';
import { Button, Text } from '../ui';

/** A card a host pushed to everyone at the plan (F-ATE-01), shown over whatever screen is open. */
export function IcebreakerOverlay() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const shown = useRealtime((s) => s.icebreaker);
  const dismiss = useRealtime((s) => s.dismissIcebreaker);
  return (
    <Modal
      visible={shown !== null}
      transparent
      animationType={theme.reduceMotion ? 'none' : 'fade'}
      onRequestClose={dismiss}
      accessibilityViewIsModal
    >
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg },
          ]}
          testID="icebreaker-overlay"
        >
          <Text variant="label" tone="primary">
            {t('ate.fromHost')}
          </Text>
          <Text variant="title" accessibilityRole="header" style={styles.prompt}>
            {shown ? localized(shown.card.prompt, i18n.language) : ''}
          </Text>
          <Button label={t('common.done')} onPress={dismiss} testID="dismiss-icebreaker" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { padding: 24, gap: 16, alignItems: 'stretch' },
  prompt: { textAlign: 'center' },
});
