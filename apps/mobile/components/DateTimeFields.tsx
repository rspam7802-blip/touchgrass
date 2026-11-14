import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/theme';
import { ArrowLeft, ArrowRight, Calendar } from './icons';
import { Button, Chip, type GlyphIcon, Icon, Text } from './ui';

/** IST has no daylight saving: a fixed +05:30 offset. */
const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number): string => String(n).padStart(2, '0');

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** "DD/MM/YYYY" → parts, or null when it isn't a real date. */
export function parseDmy(value: string): Ymd | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return { y, m, d };
}

const toDmy = (p: Ymd): string => `${pad(p.d)}/${pad(p.m)}/${String(p.y)}`;
const toKey = (p: Ymd): string => `${String(p.y)}-${pad(p.m)}-${pad(p.d)}`;

/** Today's date in IST. */
export function todayIst(now: Date = new Date()): Ymd {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, d: ist.getUTCDate() };
}

/** The weeks of a month, Monday first; null for the blanks before the 1st and after the last day. */
export function monthGrid(y: number, m: number): (number | null)[][] {
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from<null>({ length: lead }).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function useFormatters(language: string) {
  return useMemo(() => {
    const locale = `${language}-IN`;
    const make = (o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o });
    return {
      field: make({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      month: make({ month: 'long', year: 'numeric' }),
      weekday: make({ weekday: 'narrow' }),
      full: make({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      time: make({ hour: 'numeric', minute: '2-digit', hour12: true }),
    };
  }, [language]);
}

export interface FieldShellProps {
  label: string;
  display: string;
  error?: string | null;
  onOpen: () => void;
  testID?: string;
  hint: string;
  /** Defaults to the calendar. */
  icon?: GlyphIcon;
}

/** Looks like a text field, opens a picker: nothing to type and nothing to get wrong. */
export function FieldShell({
  label,
  display,
  error,
  onOpen,
  testID,
  hint,
  icon = Calendar,
}: FieldShellProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="overline" tone="muted" style={styles.upper}>
        {label}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${display}`}
        accessibilityHint={hint}
        onPress={() => {
          // A field typed in just before would keep the keyboard over the sheet's choices.
          Keyboard.dismiss();
          onOpen();
        }}
        style={[
          styles.field,
          {
            minHeight: 46,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: error ? theme.colors.danger : theme.colors.inputBorder,
            borderRadius: theme.radii.md,
          },
        ]}
      >
        <Text style={styles.grow} numberOfLines={1}>
          {display}
        </Text>
        <Icon icon={icon} size={18} color={theme.colors.textMuted} />
      </Pressable>
      {error ? (
        <Text
          variant="caption"
          tone="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  testID,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Searching inside the sheet opens the keyboard: lift the sheet so the choices stay visible. */}
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <SafeAreaView
          edges={['bottom']}
          testID={testID}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
            },
          ]}
        >
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          {/* Long lists scroll inside the sheet; the sheet never grows past most of the screen. */}
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MonthButton({
  direction,
  label,
  disabled = false,
  onPress,
  testID,
}: {
  direction: 'prev' | 'next';
  label: string;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.monthButton,
        {
          minHeight: theme.minTouchTarget,
          minWidth: theme.minTouchTarget,
          opacity: disabled ? 0.35 : 1,
        },
      ]}
    >
      <Icon
        icon={direction === 'prev' ? ArrowLeft : ArrowRight}
        size={20}
        color={theme.colors.text}
      />
    </Pressable>
  );
}

export interface DateFieldProps {
  label: string;
  /** "DD/MM/YYYY" in IST, as the plan form keeps it. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  testID?: string;
  now?: Date;
}

/** A date chosen from a month calendar. Days before today (IST) can't be picked. */
export function DateField({ label, value, onChange, error, testID, now }: DateFieldProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const fmt = useFormatters(i18n.language);
  const today = todayIst(now);
  const picked = parseDmy(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: today.y, m: today.m });
  const utc = (p: Ymd): Date => new Date(Date.UTC(p.y, p.m - 1, p.d));
  const todayKey = toKey(today);
  const atFirstMonth = view.y === today.y && view.m === today.m;
  const move = (by: number): void => {
    const next = new Date(Date.UTC(view.y, view.m - 1 + by, 1));
    setView({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1 });
  };
  // A Monday-first week, named in the viewer's language (5 Jan 2026 is a Monday).
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    fmt.weekday.format(new Date(Date.UTC(2026, 0, 5 + i))),
  );

  return (
    <>
      <FieldShell
        label={label}
        display={picked ? fmt.field.format(utc(picked)) : t('events.pickDate')}
        error={error}
        hint={t('events.pickDate')}
        testID={testID}
        onOpen={() => {
          const start = picked && toKey(picked) >= todayKey ? picked : today;
          setView({ y: start.y, m: start.m });
          setOpen(true);
        }}
      />
      {open ? (
        <Sheet
          title={t('events.pickDate')}
          onClose={() => {
            setOpen(false);
          }}
          testID={testID ? `${testID}-sheet` : undefined}
        >
          <View style={styles.monthRow}>
            <MonthButton
              direction="prev"
              label={t('events.prevMonth')}
              disabled={atFirstMonth}
              onPress={() => {
                move(-1);
              }}
              testID={testID ? `${testID}-prev` : undefined}
            />
            <Text variant="label" accessibilityLiveRegion="polite" style={styles.monthName}>
              {fmt.month.format(new Date(Date.UTC(view.y, view.m - 1, 1)))}
            </Text>
            <MonthButton
              direction="next"
              label={t('events.nextMonth')}
              onPress={() => {
                move(1);
              }}
              testID={testID ? `${testID}-next` : undefined}
            />
          </View>
          <View style={styles.week}>
            {weekdays.map((w, i) => (
              <Text
                key={`${w}-${String(i)}`}
                variant="caption"
                tone="muted"
                style={styles.cell}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {w}
              </Text>
            ))}
          </View>
          {monthGrid(view.y, view.m).map((week, wi) => (
            <View key={`w-${String(wi)}`} style={styles.week}>
              {week.map((d, di) => {
                if (d === null) return <View key={`b-${String(di)}`} style={styles.cell} />;
                const day = { y: view.y, m: view.m, d };
                const key = toKey(day);
                const past = key < todayKey;
                const selected = picked !== null && toKey(picked) === key;
                return (
                  <Pressable
                    key={key}
                    testID={testID ? `${testID}-day-${key}` : undefined}
                    accessibilityRole="button"
                    accessibilityLabel={fmt.full.format(utc(day))}
                    accessibilityState={{ selected, disabled: past }}
                    disabled={past}
                    onPress={() => {
                      onChange(toDmy(day));
                      setOpen(false);
                    }}
                    style={[
                      styles.cell,
                      styles.day,
                      {
                        minHeight: theme.minTouchTarget,
                        borderRadius: theme.radii.pill,
                        backgroundColor: selected ? theme.colors.primary : 'transparent',
                        borderColor:
                          key === todayKey && !selected ? theme.colors.inputBorder : 'transparent',
                        opacity: past ? 0.35 : 1,
                      },
                    ]}
                  >
                    <Text
                      variant="label"
                      style={{ color: selected ? theme.colors.onPrimary : theme.colors.text }}
                    >
                      {String(d)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Sheet>
      ) : null}
    </>
  );
}

const MINUTES = [0, 15, 30, 45];

export interface TimeFieldProps {
  label: string;
  /** "HH:MM" (24 hour) in IST, as the plan form keeps it. */
  value: string;
  onChange: (value: string) => void;
  testID?: string;
}

/** A time chosen by tapping: hour, minutes and am/pm. */
export function TimeField({ label, value, onChange, testID }: TimeFieldProps) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatters(i18n.language);
  const [open, setOpen] = useState(false);
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hh = match ? Math.min(Number(match[1]), 23) : 18;
  const mm = match ? Math.min(Number(match[2]), 59) : 0;
  const pm = hh >= 12;
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  const set = (h12: number, minute: number, isPm: boolean): void => {
    onChange(`${pad((h12 % 12) + (isPm ? 12 : 0))}:${pad(minute)}`);
  };
  const display = match
    ? fmt.time.format(new Date(Date.UTC(2026, 0, 5, hh, mm)))
    : t('events.pickTime');
  const minutes = MINUTES.includes(mm) ? MINUTES : [...MINUTES, mm].sort((a, b) => a - b);

  return (
    <>
      <FieldShell
        label={label}
        display={display}
        hint={t('events.pickTime')}
        testID={testID}
        onOpen={() => {
          setOpen(true);
        }}
      />
      {open ? (
        <Sheet
          title={t('events.pickTime')}
          onClose={() => {
            setOpen(false);
          }}
          testID={testID ? `${testID}-sheet` : undefined}
        >
          <Text variant="overline" tone="muted" style={styles.upper}>
            {t('events.hour')}
          </Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <Chip
                key={h}
                kind="radio"
                label={String(h)}
                selected={h === hour12}
                onToggle={() => {
                  set(h, mm, pm);
                }}
                testID={testID ? `${testID}-hour-${String(h)}` : undefined}
              />
            ))}
          </View>
          <Text variant="overline" tone="muted" style={styles.upper}>
            {t('events.minute')}
          </Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            {minutes.map((m) => (
              <Chip
                key={m}
                kind="radio"
                label={pad(m)}
                selected={m === mm}
                onToggle={() => {
                  set(hour12, m, pm);
                }}
                testID={testID ? `${testID}-minute-${pad(m)}` : undefined}
              />
            ))}
          </View>
          <View style={styles.options} accessibilityRole="radiogroup">
            {(['am', 'pm'] as const).map((half) => (
              <Chip
                key={half}
                kind="radio"
                label={t(`events.${half}`)}
                selected={(half === 'pm') === pm}
                onToggle={() => {
                  set(hour12, mm, half === 'pm');
                }}
                testID={testID ? `${testID}-${half}` : undefined}
              />
            ))}
          </View>
          <Button
            label={t('common.done')}
            onPress={() => {
              setOpen(false);
            }}
            testID={testID ? `${testID}-done` : undefined}
          />
        </Sheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  upper: { textTransform: 'uppercase' },
  field: {
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: { flexGrow: 1, flexShrink: 1 },
  backdrop: { flex: 1 },
  sheet: { borderWidth: 1, padding: 20, gap: 12, maxHeight: '88%' },
  sheetBody: { flexGrow: 0 },
  sheetContent: { gap: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthName: { textAlign: 'center', flexGrow: 1 },
  monthButton: { alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, textAlign: 'center', alignItems: 'center', justifyContent: 'center' },
  day: { borderWidth: 1.5, margin: 1 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
