import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarFeed, NotificationPage, QuietHours, UnreadCount } from '@touchgrass/shared';
import { useApi } from '../../providers/api-context';

export const NOTIFICATION_KEYS = {
  inbox: ['notifications', 'inbox'] as const,
  unread: ['notifications', 'unread'] as const,
  quiet: ['notifications', 'quiet'] as const,
  calendar: ['calendar', 'feed'] as const,
};

// ---------- inbox (F-NOT-01) ----------

export function useInbox() {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: NOTIFICATION_KEYS.inbox,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/notifications?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        NotificationPage,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useUnreadCount() {
  const { client } = useApi();
  return useQuery({
    queryKey: NOTIFICATION_KEYS.unread,
    queryFn: ({ signal }) => client.request('/v1/notifications/unread', UnreadCount, { signal }),
    refetchInterval: 60_000,
  });
}

export function useMarkRead() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: { ids: string[] } | { all: true }) =>
      client.request('/v1/notifications/read', UnreadCount, { method: 'POST', body: target }),
    onSuccess: async (data) => {
      qc.setQueryData(NOTIFICATION_KEYS.unread, data);
      await qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.inbox });
    },
  });
}

export function useQuietHours() {
  const { client } = useApi();
  return useQuery({
    queryKey: NOTIFICATION_KEYS.quiet,
    queryFn: ({ signal }) => client.request('/v1/me/settings/quiet-hours', QuietHours, { signal }),
  });
}

export function useSetQuietHours() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: QuietHours) =>
      client.request('/v1/me/settings/quiet-hours', QuietHours, { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(NOTIFICATION_KEYS.quiet, data),
  });
}

// ---------- calendar feed (F-CAL-01) ----------

export function useCalendarFeed() {
  const { client } = useApi();
  return useQuery({
    queryKey: NOTIFICATION_KEYS.calendar,
    queryFn: ({ signal }) => client.request('/v1/me/calendar', CalendarFeed, { signal }),
  });
}

export function useResetCalendarFeed() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request('/v1/me/calendar/reset', CalendarFeed, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(NOTIFICATION_KEYS.calendar, data),
  });
}
