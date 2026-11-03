import { type FetchFn, requestJson } from '../http/http-client.js';
import { type PushMessage, PushSender, type PushTicket } from './push.port.js';

const CHUNK = 100;
const KNOWN_ERRORS = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'InvalidCredentials',
  'MessageRateExceeded',
]);

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Expo Push API (fans out to FCM/APNs). Sends in chunks of 100 as Expo requires. */
export class ExpoPushSender extends PushSender {
  constructor(
    private readonly accessToken: string | undefined,
    private readonly fetchFn: FetchFn = fetch,
    private readonly url = 'https://exp.host/--/api/v2/push/send',
  ) {
    super();
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      const res = await requestJson<{ data: ExpoTicket[] }>(this.fetchFn, 'expo-push', this.url, {
        method: 'POST',
        headers: this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {},
        body: chunk.map((m) => ({
          to: m.to,
          title: m.title,
          body: m.body,
          data: m.data,
          badge: m.badge,
          channelId: m.channelId,
          collapseId: m.collapseKey,
          sound: 'default',
        })),
      });
      for (const t of res.data) {
        if (t.status === 'ok' && t.id) tickets.push({ status: 'ok', id: t.id });
        else {
          const code = t.details?.error ?? 'Unknown';
          tickets.push({
            status: 'error',
            error: (KNOWN_ERRORS.has(code) ? code : 'Unknown') as Extract<
              PushTicket,
              { status: 'error' }
            >['error'],
            message: t.message ?? code,
          });
        }
      }
    }
    return tickets;
  }
}
