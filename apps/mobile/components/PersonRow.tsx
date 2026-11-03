import type { PersonCard } from '@touchgrass/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/theme/theme';
import { Avatar } from './Avatar';
import { Text } from './ui';

export interface PersonRowProps {
  person: PersonCard;
  detail?: string | null;
  onOpen: () => void;
  actions?: ReactNode;
}

/** Person in a list: tap the name area to open the profile; action buttons sit beside it. */
export function PersonRow({ person, detail, onOpen, actions }: PersonRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const subtitle =
    detail ??
    (person.mutualFriendCount > 0 ? t('squad.mutuals', { count: person.mutualFriendCount }) : null);
  return (
    <View
      style={[styles.row, { borderBottomColor: theme.colors.border }]}
      testID={`person-${person.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          person.displayName,
          person.verified ? t('profile.verified') : null,
          subtitle,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={t('a11y.opensScreen', { screen: t('profile.title') })}
        onPress={onOpen}
        style={[styles.main, { minHeight: theme.minTouchTarget }]}
      >
        <Avatar photo={person.photo} name={person.displayName} />
        <View style={styles.text}>
          <Text variant="heading">
            {person.displayName}
            {person.verified ? ' ✓' : ''}
          </Text>
          {subtitle ? (
            <Text variant="caption" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 180,
  },
  text: { flexShrink: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
