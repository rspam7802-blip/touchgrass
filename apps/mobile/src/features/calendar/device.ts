import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventDetail } from '@touchgrass/shared';
import * as Calendar from 'expo-calendar/legacy';
import type { TFunction } from 'i18next';

const KEY = (eventId: string) => `calendar:event:${eventId}`;

interface Stored {
  calendarEventId: string;
  signature: string;
}

export interface CalendarFields {
  title: string;
  startDate: Date;
  endDate: Date;
  location: string;
  notes: string;
  timeZone: string;
  /** Tentative for a "maybe", busy otherwise. */
  availability: Calendar.Availability;
}

/** A "maybe" goes in as tentative; plans you're going to or hosting block the time. */
export function isTentative(e: EventDetail): boolean {
  return e.viewer.rsvp === 'interested' && !e.viewer.isHost;
}

/** What goes in the device calendar: the spot only once it's revealed to this person (mystery-safe). */
export function calendarFields(e: EventDetail, t: TFunction, webUrl: string): CalendarFields {
  const loc = e.location;
  const location =
    loc.kind === 'exact'
      ? [loc.placeName, loc.address].filter(Boolean).join(', ')
      : t('calendar.mysteryLocation', { area: loc.neighbourhoodName ?? '' });
  return {
    title: e.title,
    startDate: new Date(e.startsAt),
    endDate: new Date(e.endsAt),
    location,
    notes: [e.description, t('calendar.openInApp', { url: `${webUrl}/e/${e.slug}` })]
      .filter((x) => x.length > 0)
      .join('\n\n'),
    timeZone: 'Asia/Kolkata',
    availability: isTentative(e) ? Calendar.Availability.TENTATIVE : Calendar.Availability.BUSY,
  };
}

const signatureOf = (f: CalendarFields): string =>
  JSON.stringify([
    f.title,
    f.startDate.toISOString(),
    f.endDate.toISOString(),
    f.location,
    f.availability,
  ]);

async function stored(eventId: string): Promise<Stored | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY(eventId));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

async function writableCalendarId(): Promise<string | null> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const pick =
    calendars.find((c) => c.allowsModifications && c.isPrimary === true) ??
    calendars.find((c) => c.allowsModifications);
  return pick?.id ?? null;
}

export type CalendarResult = 'added' | 'updated' | 'denied' | 'unavailable';

/** Adds the plan to the phone's calendar, or refreshes the copy added earlier (F-CAL-01). */
export async function saveToCalendar(
  e: EventDetail,
  fields: CalendarFields,
): Promise<CalendarResult> {
  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (!permission.granted) return 'denied';
  const signature = signatureOf(fields);
  const previous = await stored(e.id);
  if (previous) {
    try {
      await Calendar.updateEventAsync(previous.calendarEventId, fields);
      await AsyncStorage.setItem(KEY(e.id), JSON.stringify({ ...previous, signature }));
      return 'updated';
    } catch {
      // Deleted on the phone: add it again below.
    }
  }
  const calendarId = await writableCalendarId();
  if (!calendarId) return 'unavailable';
  const calendarEventId = await Calendar.createEventAsync(calendarId, fields);
  await AsyncStorage.setItem(KEY(e.id), JSON.stringify({ calendarEventId, signature }));
  return 'added';
}

/**
 * Keeps an added plan current: called whenever the plan is opened. Changes are written quietly (no prompt
 * unless access was already granted); a cancelled plan is removed from the calendar.
 */
export async function syncCalendarCopy(e: EventDetail, fields: CalendarFields): Promise<boolean> {
  const previous = await stored(e.id);
  if (!previous) return false;
  const permission = await Calendar.getCalendarPermissionsAsync();
  if (!permission.granted) return false;
  try {
    if (e.status === 'cancelled') {
      await Calendar.deleteEventAsync(previous.calendarEventId);
      await AsyncStorage.removeItem(KEY(e.id));
      return true;
    }
    const signature = signatureOf(fields);
    if (signature === previous.signature) return false;
    await Calendar.updateEventAsync(previous.calendarEventId, fields);
    await AsyncStorage.setItem(KEY(e.id), JSON.stringify({ ...previous, signature }));
    return true;
  } catch {
    await AsyncStorage.removeItem(KEY(e.id));
    return false;
  }
}

export async function isInCalendar(eventId: string): Promise<boolean> {
  return (await stored(eventId)) !== null;
}
