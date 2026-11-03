import { Injectable, Logger } from '@nestjs/common';
import type { NotificationCategory, SupportedLanguage } from '@touchgrass/shared';
import { type PushMessage, PushSender } from '../../adapters/push/push.port.js';
import { SettingsService } from '../account/settings.service.js';
import { UsersService } from '../users/users.service.js';

const BATCH = 100;

export interface PushContent {
  title: string;
  body: string;
  data?: Record<string, string>;
  collapseKey?: string;
}

/**
 * Sends push notifications to people in their own language, honouring per-category preferences and
 * switching off tokens Expo reports as gone. Inbox items, quiet hours and digests live in
 * `NotificationsService`, which sends through this.
 */
@Injectable()
export class PushDispatchService {
  private readonly logger = new Logger(PushDispatchService.name);

  constructor(
    private readonly push: PushSender,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
  ) {}

  async sendToUsers(
    userIds: string[],
    category: NotificationCategory,
    build: (language: SupportedLanguage, userId: string) => PushContent,
  ): Promise<number> {
    const unique = [...new Set(userIds)];
    const [targets, languages] = await Promise.all([
      this.settings.pushTargets(unique, category),
      this.users.languages(unique),
    ]);
    const messages: PushMessage[] = targets.map((t) => {
      const content = build(languages.get(t.userId) ?? 'en', t.userId);
      return {
        to: t.token,
        title: content.title,
        body: content.body,
        data: content.data,
        collapseKey: content.collapseKey,
        channelId: category,
      };
    });
    let sent = 0;
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      const tickets = await this.push.send(batch);
      const gone = tickets.flatMap((t, j) =>
        t.status === 'error' && t.error === 'DeviceNotRegistered' ? [batch[j]?.to ?? ''] : [],
      );
      await this.settings.disableTokens(gone.filter((x) => x.length > 0));
      sent += tickets.filter((t) => t.status === 'ok').length;
      for (const t of tickets)
        if (t.status === 'error' && t.error !== 'DeviceNotRegistered')
          this.logger.warn(`push failed: ${t.error} ${t.message}`);
    }
    return sent;
  }
}
