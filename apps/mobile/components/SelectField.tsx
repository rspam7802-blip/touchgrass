import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldShell, Sheet } from './DateTimeFields';
import { Grid } from './icons';
import { type PickOption, PickList } from './PickList';

export interface SelectFieldProps {
  label: string;
  /** Shown in the field before anything is chosen. */
  placeholder: string;
  options: PickOption[];
  value: string | null;
  onChange: (id: string) => void;
  searchLabel?: string;
  error?: string | null;
  testID?: string;
}

/**
 * One choice from a long list (D-189): a field that shows the choice, opening a sheet with a searchable,
 * grouped list. Tapping a row picks it and closes the sheet.
 */
export function SelectField({
  label,
  placeholder,
  options,
  value,
  onChange,
  searchLabel,
  error,
  testID,
}: SelectFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.id === value) ?? null;
  return (
    <>
      <FieldShell
        label={label}
        display={chosen?.label ?? placeholder}
        error={error}
        hint={t('common.choose')}
        icon={Grid}
        testID={testID}
        onOpen={() => {
          setOpen(true);
        }}
      />
      {open ? (
        <Sheet
          title={label}
          onClose={() => {
            setOpen(false);
          }}
          testID={testID ? `${testID}-sheet` : undefined}
        >
          <PickList
            label={label}
            searchLabel={searchLabel}
            mode="single"
            options={options}
            selected={value ? [value] : []}
            onChange={(ids) => {
              const [id] = ids;
              if (id) onChange(id);
              setOpen(false);
            }}
            testIDPrefix={testID ?? 'select'}
            searchFrom={0}
          />
        </Sheet>
      ) : null}
    </>
  );
}
