import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { Check } from './icons';
import { Icon, Text, TextField } from './ui';

export interface PickOption {
  id: string;
  label: string;
  /** Small text on the right (e.g. "Waitlist"). */
  detail?: string;
  /** Options with the same group sit under one heading, in the order groups first appear. */
  group?: string;
}

export interface PickListProps {
  label: string;
  options: PickOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  mode: 'single' | 'multi';
  max?: number;
  testIDPrefix?: string;
  searchLabel?: string;
  /** Shown when the search matches nothing. */
  emptyText?: string;
  /** Lists longer than this get a search box. */
  searchFrom?: number;
}

const fold = (s: string): string => s.toLocaleLowerCase().normalize('NFKD');

/**
 * One choice per row, with search for long lists (D-182): calmer than a wall of chips when there are
 * dozens of cities or interests. Single (radio) or multi (checkbox) selection with an optional maximum.
 */
export function PickList({
  label,
  options,
  selected,
  onChange,
  mode,
  max,
  testIDPrefix = 'pick',
  searchLabel,
  emptyText,
  searchFrom = 9,
}: PickListProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const atMax = max !== undefined && selected.length >= max;
  const searchable = options.length >= searchFrom;

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const shown = q ? options.filter((o) => fold(o.label).includes(q)) : options;
    const out: { name: string | null; items: PickOption[] }[] = [];
    for (const o of shown) {
      const name = o.group ?? null;
      const g = out.find((x) => x.name === name);
      if (g) g.items.push(o);
      else out.push({ name, items: [o] });
    }
    return out;
  }, [options, query]);

  return (
    <View style={styles.wrap}>
      {searchable ? (
        <TextField
          label={searchLabel ?? t('common.search')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          testID={`${testIDPrefix}-search`}
        />
      ) : null}
      <View
        accessibilityRole={mode === 'single' ? 'radiogroup' : 'list'}
        accessibilityLabel={label}
        style={[
          styles.list,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.md,
          },
        ]}
      >
        {groups.length === 0 ? (
          <Text tone="muted" style={styles.empty} testID={`${testIDPrefix}-empty`}>
            {emptyText ?? t('common.noMatches')}
          </Text>
        ) : null}
        {groups.map((g, gi) => (
          <View key={g.name ?? `group-${String(gi)}`}>
            {g.name ? (
              <Text
                variant="overline"
                tone="muted"
                accessibilityRole="header"
                style={[styles.heading, { backgroundColor: theme.colors.surfaceAlt }]}
              >
                {g.name}
              </Text>
            ) : null}
            {g.items.map((o, i) => {
              const isSelected = selected.includes(o.id);
              const disabled = !isSelected && mode === 'multi' && atMax;
              return (
                <Pressable
                  key={o.id}
                  testID={`${testIDPrefix}-${o.id}`}
                  accessibilityRole={mode === 'single' ? 'radio' : 'checkbox'}
                  accessibilityLabel={o.detail ? `${o.label}, ${o.detail}` : o.label}
                  accessibilityHint={t('a11y.toggleHint')}
                  accessibilityState={{ checked: isSelected, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    if (mode === 'single') onChange([o.id]);
                    else
                      onChange(
                        isSelected ? selected.filter((s) => s !== o.id) : [...selected, o.id],
                      );
                  }}
                  style={[
                    styles.row,
                    {
                      minHeight: theme.minTouchTarget + 4,
                      borderTopColor: theme.colors.border,
                      borderTopWidth: i === 0 && !g.name && gi === 0 ? 0 : StyleSheet.hairlineWidth,
                      opacity: disabled ? 0.45 : 1,
                    },
                  ]}
                >
                  <Text style={styles.grow} numberOfLines={2}>
                    {o.label}
                  </Text>
                  {o.detail ? (
                    <Text variant="caption" tone="muted">
                      {o.detail}
                    </Text>
                  ) : null}
                  <View
                    style={[
                      styles.mark,
                      {
                        borderRadius: mode === 'single' ? theme.radii.pill : 6,
                        borderColor: isSelected ? theme.colors.primary : theme.colors.inputBorder,
                        backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                      },
                    ]}
                  >
                    {isSelected ? (
                      <Icon icon={Check} size={14} color={theme.colors.onPrimary} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  list: { borderWidth: 1, overflow: 'hidden' },
  heading: { paddingHorizontal: 14, paddingVertical: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  grow: { flexGrow: 1, flexShrink: 1 },
  mark: { width: 22, height: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 14 },
});
