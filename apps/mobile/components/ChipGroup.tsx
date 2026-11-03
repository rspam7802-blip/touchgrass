import { StyleSheet, View } from 'react-native';
import { Chip } from './ui';

export interface ChipOption {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface ChipGroupProps {
  label: string;
  options: ChipOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  mode: 'single' | 'multi';
  max?: number;
  testIDPrefix?: string;
}

/** Accessible single (radio) or multi (checkbox) selection of chips with an optional maximum. */
export function ChipGroup({
  label,
  options,
  selected,
  onChange,
  mode,
  max,
  testIDPrefix = 'chip',
}: ChipGroupProps) {
  const atMax = max !== undefined && selected.length >= max;
  return (
    <View
      accessibilityRole={mode === 'single' ? 'radiogroup' : 'list'}
      accessibilityLabel={label}
      style={styles.wrap}
    >
      {options.map((o) => {
        const isSelected = selected.includes(o.id);
        return (
          <Chip
            key={o.id}
            label={o.label}
            kind={mode === 'single' ? 'radio' : 'checkbox'}
            selected={isSelected}
            disabled={o.disabled === true || (!isSelected && mode === 'multi' && atMax)}
            onToggle={() => {
              if (mode === 'single') onChange([o.id]);
              else onChange(isSelected ? selected.filter((s) => s !== o.id) : [...selected, o.id]);
            }}
            testID={`${testIDPrefix}-${o.id}`}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
