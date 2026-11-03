import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { flatten, useSquad } from '../../src/features/social/api';
import { Chip, Text } from '../ui';

/** Multi-select from your squad (crew invites, plan votes). */
export function SquadPicker({
  label,
  selected,
  onChange,
  exclude = [],
  max,
}: {
  label: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  max?: number;
}) {
  const { t } = useTranslation();
  const squad = useSquad();
  const people = flatten(squad.data).filter((p) => !exclude.includes(p.id));
  const full = max !== undefined && selected.length >= max;
  return (
    <View style={styles.wrap} accessibilityRole="list" accessibilityLabel={label}>
      <Text variant="label">{label}</Text>
      {people.length === 0 && !squad.isPending ? (
        <Text tone="muted">{t('squad.empty')}</Text>
      ) : null}
      <View style={styles.chips}>
        {people.map((p) => {
          const on = selected.includes(p.id);
          return (
            <Chip
              key={p.id}
              label={p.displayName}
              selected={on}
              disabled={!on && full}
              onToggle={() => {
                onChange(on ? selected.filter((x) => x !== p.id) : [...selected, p.id]);
              }}
              testID={`pick-${p.id}`}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
