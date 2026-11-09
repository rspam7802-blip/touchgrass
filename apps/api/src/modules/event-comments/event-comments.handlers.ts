import { Injectable } from '@nestjs/common';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import {
  COMMENT_NOTIFICATION,
  EVENT_COMMENTED_EVENT,
  EventCommentsService,
} from './event-comments.service.js';

/** Worker: hosts hear about new comments on their plans (category "event_updates"). */
@Injectable()
export class EventCommentsHandlers {
  constructor(
    private readonly comments: EventCommentsService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(EVENT_COMMENTED_EVENT, 'comments.notify-hosts', async (e) => {
      await this.notifyHosts(String(e.payload.eventId), String(e.payload.commentId));
    });
  }

  async notifyHosts(eventId: string, commentId: string): Promise<number> {
    const audience = await this.comments.hostAudience(eventId, commentId);
    if (!audience || audience.userIds.length === 0) return 0;
    const name =
      (await this.profiles.displayNames([audience.authorId])).get(audience.authorId) ?? '';
    const sent = await this.notifications.notify(
      audience.userIds,
      COMMENT_NOTIFICATION,
      { name, title: audience.title, excerpt: audience.excerpt, eventId, commentId },
      { collapseKey: `comments-${eventId}` },
    );
    return sent.pushed + sent.deferred;
  }
}
