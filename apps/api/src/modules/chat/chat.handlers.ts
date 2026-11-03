import { Injectable } from '@nestjs/common';
import { type NotificationParam, resources, SUPPORTED_LANGUAGES } from '@touchgrass/shared';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { EVENT_HOST_ADDED_EVENT } from '../events/events.service.js';
import { RSVP_GOING_EVENT } from '../events/plus-one/plus-one-claim.service.js';
import { RSVP_CANCELLED_EVENT } from '../events/rsvp.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ChatPresence } from './chat-presence.js';
import {
  CHAT_MESSAGE_CREATED_EVENT,
  CHAT_REQUEST_CREATED_EVENT,
  ChatService,
} from './chat.service.js';
import { excerpt } from './chat.policy.js';

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

/** Worker side of chat: pushes for new messages and requests, and event-chat membership following seats. */
@Injectable()
export class ChatHandlers {
  constructor(
    private readonly chat: ChatService,
    private readonly presence: ChatPresence,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(CHAT_MESSAGE_CREATED_EVENT, 'chat.push', async (e) => {
      await this.pushFor(
        String(e.payload.conversationId),
        String(e.payload.messageId),
        String(e.payload.senderId),
        false,
      );
    });
    bus.subscribe(CHAT_REQUEST_CREATED_EVENT, 'chat.push-request', async (e) => {
      await this.pushFor(
        String(e.payload.conversationId),
        String(e.payload.messageId),
        String(e.payload.senderId),
        true,
      );
    });
    bus.subscribe(RSVP_GOING_EVENT, 'chat.join-event', async (e) => {
      await this.chat.syncEventMember(e.aggregateId, String(e.payload.userId), true);
    });
    bus.subscribe(EVENT_HOST_ADDED_EVENT, 'chat.join-event-host', async (e) => {
      await this.chat.syncEventMember(e.aggregateId, String(e.payload.userId), true);
    });
    bus.subscribe(RSVP_CANCELLED_EVENT, 'chat.leave-event', async (e) => {
      if (e.payload.hadSeat === true)
        await this.chat.syncEventMember(e.aggregateId, String(e.payload.userId), false);
    });
  }

  private async pushFor(
    conversationId: string,
    messageId: string,
    senderId: string,
    request: boolean,
  ): Promise<void> {
    const target = await this.chat.pushRecipients(conversationId, senderId, (id) =>
      this.presence.isPresent(conversationId, id),
    );
    const msg = await this.chat.rawMessage(messageId);
    if (!target || !msg || msg.deletedAt || target.userIds.length === 0) return;
    const name = (await this.profiles.displayNames([senderId])).get(senderId) ?? '';
    const title = (await this.chat.conversationTitle(target.conv)) ?? name;
    // Text depends on the reader's language only for photos and polls; build all three once.
    const text = Object.fromEntries(
      SUPPORTED_LANGUAGES.map((lang) => {
        const t = resources[lang].chat;
        return [
          lang,
          msg.kind === 'image'
            ? t.photo
            : msg.kind === 'poll'
              ? fill(t.pollLabel, { q: msg.body ?? '' })
              : (excerpt(msg.body, 120) ?? ''),
        ];
      }),
    ) as Extract<NotificationParam, { en: string }>;
    await this.notifications.notify(
      target.userIds,
      request ? 'chat_request' : target.conv.kind === 'direct' ? 'chat_direct' : 'chat_group',
      { name, title, text, conversationId },
      { collapseKey: conversationId },
    );
  }
}
