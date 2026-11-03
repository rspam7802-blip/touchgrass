export interface PushMessage {
  /** Expo push token, e.g. ExponentPushToken[xxxx]. */
  to: string;
  title: string;
  body: string;
  /** Deep link and routing data, e.g. { url: 'touchgrass://e/abc' }. */
  data?: Record<string, string>;
  badge?: number;
  channelId?: string;
  collapseKey?: string;
}

export type PushTicket =
  | { status: 'ok'; id: string }
  | {
      status: 'error';
      error:
        | 'DeviceNotRegistered'
        | 'MessageTooBig'
        | 'InvalidCredentials'
        | 'MessageRateExceeded'
        | 'Unknown';
      message: string;
    };

export abstract class PushSender {
  /** Returns one ticket per message, in order. Tokens with DeviceNotRegistered must be deactivated by the caller. */
  abstract send(messages: PushMessage[]): Promise<PushTicket[]>;
}

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token);
}
