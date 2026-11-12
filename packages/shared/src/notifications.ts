import { LIMITS, LOCALE_DEFAULTS, type SupportedLanguage } from './constants';
import type { NotificationCategory } from './enums';
import { resources } from './i18n';
import { localeTag } from './money';
import { zonedParts } from './time';

/**
 * Every notification the app sends (F-NOT-01). Copy lives in the i18n resources (title/body keys), so an inbox
 * item renders in whatever language the reader uses today, and `link` is the in-app path it opens.
 * - `inbox: false`: push only (chat has its own inbox).
 * - `batch`: low priority; held briefly so several go out as one digest.
 * - `urgent`: time-sensitive; ignores quiet hours. Chat counts: holding a live conversation until morning
 *   breaks it, and the phone's own do-not-disturb still applies.
 */
export interface NotificationTemplate {
  category: NotificationCategory;
  title: string;
  body: string;
  link: string;
  inbox?: boolean;
  batch?: boolean;
  urgent?: boolean;
}

export const NOTIFICATION_TEMPLATES = {
  // ---------- chat (F-CHT) ----------
  chat_direct: {
    category: 'chat',
    title: 'notifications.kinds.chatDirect.title',
    body: 'notifications.kinds.chatDirect.body',
    link: 'chats/{{conversationId}}',
    inbox: false,
    urgent: true,
  },
  chat_group: {
    category: 'chat',
    title: 'notifications.kinds.chatGroup.title',
    body: 'chat.newMessagePush',
    link: 'chats/{{conversationId}}',
    inbox: false,
    urgent: true,
  },
  chat_request: {
    category: 'chat',
    title: 'chat.requestReceived',
    body: 'notifications.kinds.chatDirect.body',
    link: 'chats/{{conversationId}}',
    inbox: false,
    urgent: true,
  },
  // ---------- squad ----------
  friend_requested: {
    category: 'squad',
    title: 'notifications.kinds.friendRequested.title',
    body: 'notifications.kinds.friendRequested.body',
    link: 'squad',
    batch: true,
  },
  friend_accepted: {
    category: 'squad',
    title: 'notifications.kinds.friendAccepted.title',
    body: 'notifications.kinds.friendAccepted.body',
    link: 'users/{{userId}}',
    batch: true,
  },
  free_now: {
    category: 'free_now',
    title: 'free.pushTitle',
    body: 'free.pushBody',
    link: 'free',
    batch: true,
  },
  free_now_note: {
    category: 'free_now',
    title: 'free.pushTitle',
    body: 'notifications.kinds.freeNowNote.body',
    link: 'free',
    batch: true,
  },
  squad_pulling_up: {
    category: 'squad',
    title: 'notifications.kinds.squadPullingUp.title',
    body: 'notifications.kinds.squadPullingUp.body',
    link: 'events/{{eventId}}',
    batch: true,
  },
  squad_outside: {
    category: 'squad',
    title: 'notifications.kinds.squadOutside.title',
    body: 'notifications.kinds.squadOutside.body',
    link: 'discover',
    batch: true,
  },
  event_comment: {
    category: 'event_updates',
    title: 'notifications.kinds.eventComment.title',
    body: 'notifications.kinds.eventComment.body',
    link: 'events/{{eventId}}',
    batch: true,
  },
  free_now_ping: {
    category: 'free_now',
    title: 'notifications.kinds.freeNowPing.title',
    body: 'notifications.kinds.freeNowPing.body',
    link: 'users/{{userId}}',
    batch: false,
  },
  crew_requested: {
    category: 'squad',
    title: 'crews.requestPush',
    body: 'notifications.kinds.crew.body',
    link: 'crews/{{crewId}}',
    batch: true,
  },
  crew_invited: {
    category: 'squad',
    title: 'crews.invitePush',
    body: 'notifications.kinds.crew.body',
    link: 'crews/{{crewId}}',
  },
  crew_approved: {
    category: 'squad',
    title: 'crews.approvedPush',
    body: 'notifications.kinds.crew.body',
    link: 'crews/{{crewId}}',
  },
  referral_rewarded: {
    category: 'squad',
    title: 'referrals.rewardPush',
    body: 'referrals.balance',
    link: 'referrals',
  },
  // ---------- plans (F-EVT-16, F-NOT-02) ----------
  event_invited: {
    category: 'event_updates',
    title: 'notifications.kinds.eventInvited.title',
    body: 'notifications.kinds.eventInvited.body',
    link: 'events/{{eventId}}',
  },
  join_requested: {
    category: 'event_updates',
    title: 'notifications.kinds.joinRequested.title',
    body: 'notifications.kinds.joinRequested.body',
    link: 'events/{{eventId}}/requests',
  },
  join_approved: {
    category: 'event_updates',
    title: 'notifications.kinds.joinApproved.title',
    body: 'notifications.kinds.joinApproved.body',
    link: 'events/{{eventId}}',
  },
  event_updated: {
    category: 'event_updates',
    title: 'notifications.kinds.eventUpdated.title',
    body: 'notifications.kinds.eventUpdated.body',
    link: 'events/{{eventId}}',
  },
  event_cancelled: {
    category: 'event_updates',
    title: 'notifications.kinds.eventCancelled.title',
    body: 'notifications.kinds.eventCancelled.body',
    link: 'events/{{eventId}}',
    urgent: true,
  },
  event_host_added: {
    category: 'event_updates',
    title: 'notifications.kinds.eventHostAdded.title',
    body: 'notifications.kinds.eventHostAdded.body',
    link: 'events/{{eventId}}',
  },
  proposal_invited: {
    category: 'event_updates',
    title: 'proposals.invitePush',
    body: 'notifications.kinds.proposal.body',
    link: 'proposals/{{proposalId}}',
  },
  proposal_locked: {
    category: 'event_updates',
    title: 'proposals.lockedPush',
    body: 'notifications.kinds.proposal.body',
    link: 'events/{{eventId}}',
  },
  waitlist_offer: {
    category: 'waitlist',
    title: 'notifications.kinds.waitlistOffer.title',
    body: 'notifications.kinds.waitlistOffer.body',
    link: 'events/{{eventId}}',
    urgent: true,
  },
  reminder_day: {
    category: 'reminders',
    title: 'notifications.kinds.reminderDay.title',
    body: 'notifications.kinds.reminderDay.body',
    link: 'events/{{eventId}}',
  },
  reminder_soon: {
    category: 'reminders',
    title: 'notifications.kinds.reminderSoon.title',
    body: 'notifications.kinds.reminderSoon.body',
    link: 'events/{{eventId}}',
    urgent: true,
  },
  mystery_revealed: {
    category: 'reminders',
    title: 'notifications.kinds.mysteryRevealed.title',
    body: 'notifications.kinds.mysteryRevealed.body',
    link: 'events/{{eventId}}',
    urgent: true,
  },
  feedback_ask: {
    category: 'reminders',
    title: 'notifications.kinds.feedbackAsk.title',
    body: 'notifications.kinds.feedbackAsk.body',
    link: 'after/{{eventId}}',
  },
  // ---------- engagement ----------
  badge_earned: {
    category: 'badges',
    title: 'badges.newPush',
    body: 'badges.newPushBody',
    link: 'badges',
    batch: true,
  },
  challenge_completed: {
    category: 'badges',
    title: 'challenges.completedPush',
    body: 'notifications.kinds.challenge.body',
    link: 'challenges',
    batch: true,
  },
  streak_risk: {
    category: 'streaks',
    title: 'streak.reminderTitle',
    body: 'streak.reminderBody',
    link: 'discover',
  },
  recap_ready: {
    category: 'recaps',
    title: 'recap.readyPushTitle',
    body: 'recap.readyPushBody',
    link: 'recaps/{{recapId}}',
  },
  // ---------- safety ----------
  verification_approved: {
    category: 'safety',
    title: 'verification.approvedPush',
    body: 'verification.approvedPushBody',
    link: 'safety',
  },
  verification_rejected: {
    category: 'safety',
    title: 'verification.rejectedPush',
    body: 'verification.rejectedPushBody',
    link: 'verification',
  },
  live_share_ended: {
    category: 'safety',
    title: 'safety.shareEndedPush',
    body: 'safety.shareEndedPushBody',
    link: 'safety',
  },
  sanction_warn: {
    category: 'safety',
    title: 'moderation.warnPush',
    body: 'moderation.warnPushBody',
    link: 'safety',
    urgent: true,
  },
  sanction_mute: {
    category: 'safety',
    title: 'moderation.mutePush',
    body: 'moderation.mutePushBody',
    link: 'safety',
    urgent: true,
  },
  content_removed: {
    category: 'safety',
    title: 'moderation.removedPush',
    body: 'moderation.removedPushBody',
    link: 'safety',
  },
  // ---------- cities (F-GRW-03) ----------
  city_launched: {
    category: 'event_updates',
    title: 'cities.launchedPush',
    body: 'cities.launchedPushBody',
    link: 'city',
  },
} as const satisfies Record<string, NotificationTemplate>;

export type NotificationKind = keyof typeof NOTIFICATION_TEMPLATES;
export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_TEMPLATES) as NotificationKind[];

export function notificationTemplate(kind: NotificationKind): NotificationTemplate {
  return NOTIFICATION_TEMPLATES[kind];
}

export function isNotificationKind(value: string): value is NotificationKind {
  return value in NOTIFICATION_TEMPLATES;
}

/**
 * A template value: plain text or a number, a moment shown in the reader's language (`{ at }`), another
 * translated string (`{ t: 'path.to.key' }`), or text the author gave in each language.
 */
export type NotificationParam =
  | string
  | number
  /** An instant, shown in `tz` (the plan's city zone) or IST. */
  | { at: string; tz?: string }
  | { t: string }
  | Record<SupportedLanguage, string>;
export type NotificationParams = Record<string, NotificationParam>;

/** Looks up a dotted i18n path; unknown paths fall back to English, then to the path itself. */
export function translate(path: string, language: SupportedLanguage): string {
  const find = (lang: SupportedLanguage): string | null => {
    let node: unknown = resources[lang];
    for (const part of path.split('.')) {
      if (typeof node !== 'object' || node === null || !(part in node)) return null;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : null;
  };
  return find(language) ?? find('en') ?? path;
}

export function formatMoment(
  iso: string,
  language: SupportedLanguage,
  timeZone: string = LOCALE_DEFAULTS.timezone,
): string {
  return new Intl.DateTimeFormat(localeTag(language), {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function paramText(value: NotificationParam, language: SupportedLanguage): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if ('at' in value) return formatMoment(value.at, language, value.tz);
  if ('t' in value) return translate(value.t, language);
  return value[language];
}

export function fillParams(
  template: string,
  params: NotificationParams,
  language: SupportedLanguage,
): string {
  return template.replace(/\{\{\s*(\w+)(?:\s*,\s*\w+)?\s*\}\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? '' : paramText(value, language);
  });
}

export interface RenderedNotification {
  title: string;
  body: string;
  /** In-app path, without the scheme (e.g. `events/<id>`). */
  path: string;
}

/** Admin-edited wording for one kind in one language (F-WEB-03); same placeholders as the default. */
export interface NotificationCopy {
  title: string;
  body: string;
}

export function renderNotification(
  kind: NotificationKind,
  params: NotificationParams,
  language: SupportedLanguage,
  override?: NotificationCopy | null,
): RenderedNotification {
  const t = NOTIFICATION_TEMPLATES[kind];
  return {
    title: fillParams(override?.title ?? translate(t.title, language), params, language).trim(),
    body: fillParams(override?.body ?? translate(t.body, language), params, language).trim(),
    path: fillParams(t.link, params, language),
  };
}

// ---------- quiet hours ----------

/** `HH:MM` on a 24-hour clock. */
export function parseClock(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface QuietWindow {
  enabled: boolean;
  /** Minutes after local midnight. */
  start: number;
  end: number;
}

export const DEFAULT_QUIET_WINDOW: QuietWindow = {
  enabled: true,
  start: LIMITS.notifications.quietHoursStart * 60,
  end: LIMITS.notifications.quietHoursEnd * 60,
};

function minuteOfDay(date: Date): number {
  const p = zonedParts(date);
  return p.hour * 60 + p.minute;
}

/** Whether `date` falls in the window (which may wrap past midnight), in IST. */
export function inQuietWindow(date: Date, w: QuietWindow): boolean {
  if (!w.enabled || w.start === w.end) return false;
  const now = minuteOfDay(date);
  return w.start < w.end ? now >= w.start && now < w.end : now >= w.start || now < w.end;
}

/** When the window that contains `date` ends (or `date` itself when outside it). */
export function quietWindowEnd(date: Date, w: QuietWindow): Date {
  if (!inQuietWindow(date, w)) return date;
  const now = minuteOfDay(date);
  const ahead = (w.end - now + 24 * 60) % (24 * 60) || 24 * 60;
  const end = new Date(date.getTime() + ahead * 60_000);
  end.setUTCSeconds(0, 0);
  return end;
}
