import type { Suggestion } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { Avatar } from './Avatar';
import { SquadActions } from './SquadActions';
import { AnimatedPressable, FadeIn, staggerDelay, Text, usePressScale } from './ui';

/** "People you might know" as sideways cards (D-158), on the Squad tab above the lists. */
export function SuggestionStrip({
  items,
  gutter,
  onOpen,
}: {
  items: Suggestion[];
  gutter: number;
  onOpen: (userId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap} testID="suggestion-strip">
      <Text variant="heading" accessibilityRole="header">
        {t('squad.tabSuggestions')}
      </Text>
      <FlatList
        data={items}
        horizontal
        keyExtractor={(s) => s.person.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD + 12}
        decelerationRate="fast"
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}
        renderItem={({ item, index }) => (
          <FadeIn delay={staggerDelay(index, 50, 4)} distance={8}>
            <SuggestionCard
              suggestion={item}
              onOpen={() => {
                onOpen(item.person.id);
              }}
            />
          </FadeIn>
        )}
      />
    </View>
  );
}

const CARD = 148;

function SuggestionCard({ suggestion, onOpen }: { suggestion: Suggestion; onOpen: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const press = usePressScale(0.97);
  const why = suggestion.reasons.map((r) => t(`squad.reasons.${r}`)).join(' · ');
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
        },
      ]}
      testID={`suggestion-card-${suggestion.person.id}`}
    >
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={[suggestion.person.displayName, why].filter(Boolean).join(', ')}
        accessibilityHint={t('a11y.opensScreen', { screen: suggestion.person.displayName })}
        onPress={onOpen}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.top, press.scaleStyle]}
      >
        <Avatar photo={suggestion.person.photo} name={suggestion.person.displayName} size={64} />
        <Text variant="label" numberOfLines={1}>
          {suggestion.person.displayName}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2} style={styles.center}>
          {why}
        </Text>
      </AnimatedPressable>
      <SquadActions userId={suggestion.person.id} relationship="none" compact />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  card: {
    width: CARD,
    padding: 12,
    gap: 10,
    alignItems: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
  },
  top: { alignItems: 'center', gap: 4, minHeight: 44 },
  center: { textAlign: 'center' },
});
