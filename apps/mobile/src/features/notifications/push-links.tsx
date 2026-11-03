import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTrack } from '../analytics/analytics';
import { useMarkRead } from './api';

const SCHEME = 'touchgrass://';

/** Maps a push's `data.url` (our own scheme only) to an in-app path; anything else is ignored. */
export function pushPath(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('url' in data)) return null;
  const url = data.url;
  if (typeof url !== 'string' || !url.startsWith(SCHEME)) return null;
  const path = url.slice(SCHEME.length);
  return /^[A-Za-z0-9/_-]+$/.test(path) ? `/${path}` : null;
}

/** The inbox item a push belongs to, if it carries one. */
export function pushNotificationId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('notificationId' in data)) return null;
  const id = data.notificationId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

/** Opens the screen a tapped notification points at (e.g. a chat thread) and marks its inbox item read. */
export function PushLinkHandler() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  const read = useMarkRead();
  const track = useTrack();
  const { mutate } = read;
  useEffect(() => {
    if (!response) return;
    const data = response.notification.request.content.data;
    const path = pushPath(data);
    const id = pushNotificationId(data);
    if (id) mutate({ ids: [id] });
    track('notification_opened', { source: 'push' });
    if (path) router.push(path as Href);
  }, [response, router, mutate, track]);
  return null;
}
