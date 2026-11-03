import type { EventDetail } from '@touchgrass/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readAppEnvironment } from '../src/config';
import { useTrack } from '../src/features/analytics/analytics';
import {
  calendarFields,
  type CalendarResult,
  saveToCalendar,
  syncCalendarCopy,
} from '../src/features/calendar/device';
import { Button, Text } from './ui';

/**
 * "Add to calendar" for plans you're going to or hosting (F-CAL-01). Once added, opening the plan keeps the
 * phone's copy current (time, place once revealed, cancellation).
 */
export function CalendarButton({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const track = useTrack();
  const fields = useMemo(() => calendarFields(event, t, readAppEnvironment().webUrl), [event, t]);
  const [result, setResult] = useState<CalendarResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void syncCalendarCopy(event, fields);
  }, [event, fields]);

  const add = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await saveToCalendar(event, fields);
      setResult(r);
      if (r === 'added' || r === 'updated') track('calendar_added', { target: 'device' });
    } catch {
      setResult('unavailable');
    } finally {
      setBusy(false);
    }
  };

  if (event.status === 'cancelled') return null;
  return (
    <>
      <Button
        label={t('calendar.add')}
        variant="secondary"
        loading={busy}
        onPress={() => void add()}
        testID="add-to-calendar"
      />
      {result ? (
        <Text
          tone={result === 'added' || result === 'updated' ? 'primary' : 'danger'}
          accessibilityLiveRegion="polite"
          testID="calendar-result"
        >
          {result === 'added'
            ? t('calendar.added')
            : result === 'updated'
              ? t('calendar.updated')
              : result === 'denied'
                ? t('calendar.permissionDenied')
                : t('errors.FEATURE_DISABLED')}
        </Text>
      ) : null}
    </>
  );
}
