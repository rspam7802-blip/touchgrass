import { Injectable } from '@nestjs/common';
import type { MediaVariants } from '@touchgrass/shared';
import { EventAccessService } from '../events/event-access.service.js';
import { canViewEvent, holdsSeat } from '../events/event.policy.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { MediaService } from '../media/media.service.js';
import { eventChatClosesAt, eventChatOpensAt, eventChatState } from './chat.policy.js';

export type GateReason = 'NOT_OPEN' | 'CHAT_CLOSED' | 'NOT_MEMBER';

export interface GateAccess {
  read: boolean;
  write: boolean;
  reason: GateReason | null;
  /** Runs the group (hosts / crew admins). */
  host: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
}

/**
 * Who may use a group conversation, decided by the module that owns its subject. Event chats ask the events
 * module (people holding a seat, plus hosts); crew chats register a gate when crews arrive (Phase 8). A
 * conversation kind without a gate is unavailable.
 */
export interface ConversationGate {
  access(userId: string, refId: string, now: Date): Promise<GateAccess>;
  /** Everyone who should receive messages right now. */
  members(refId: string): Promise<string[]>;
  info(refIds: string[]): Promise<Map<string, { title: string; avatar: MediaVariants | null }>>;
}

@Injectable()
export class ConversationGates {
  private readonly gates = new Map<'event' | 'crew', ConversationGate>();

  register(kind: 'event' | 'crew', gate: ConversationGate): void {
    if (this.gates.has(kind)) throw new Error(`Duplicate conversation gate ${kind}`);
    this.gates.set(kind, gate);
  }

  get(kind: 'event' | 'crew'): ConversationGate | undefined {
    return this.gates.get(kind);
  }
}

const NO_ACCESS: GateAccess = {
  read: false,
  write: false,
  reason: 'NOT_MEMBER',
  host: false,
  opensAt: null,
  closesAt: null,
};

/** Event chats (F-CHT-02): seat holders and hosts; open 24 h before, writable until 48 h after the end. */
@Injectable()
export class EventChatGate implements ConversationGate {
  constructor(
    private readonly store: EventStore,
    private readonly access_: EventAccessService,
    private readonly search: EventSearchService,
    private readonly media: MediaService,
  ) {}

  async access(userId: string, eventId: string, now: Date): Promise<GateAccess> {
    const core = await this.store.core(eventId);
    if (!core) return NO_ACCESS;
    const ctx = await this.access_.context(userId);
    const facts = await this.access_.facts(ctx, eventId);
    const member = facts.hostRole !== null || holdsSeat(facts.rsvp);
    // The host switched the group chat off for this plan (D-156): nobody can read or post.
    if (!core.chatEnabled || !member || !canViewEvent(facts, core)) return NO_ACCESS;
    const state = eventChatState(core, now);
    return {
      read: true,
      write: state === 'open',
      reason: state === 'open' ? null : state === 'not_open' ? 'NOT_OPEN' : 'CHAT_CLOSED',
      host: facts.hostRole !== null,
      opensAt: eventChatOpensAt(core),
      closesAt: core.status === 'cancelled' ? now : eventChatClosesAt(core),
    };
  }

  async members(eventId: string): Promise<string[]> {
    const [holders, hosts] = await Promise.all([
      this.search.seatHoldersMany([eventId]),
      this.store.hosts(eventId),
    ]);
    return [...new Set([...(holders.get(eventId) ?? []), ...hosts.map((h) => h.userId)])];
  }

  async info(
    eventIds: string[],
  ): Promise<Map<string, { title: string; avatar: MediaVariants | null }>> {
    const cores = await this.store.coresByIds(eventIds);
    const covers = (
      await this.media.byIds(cores.flatMap((c) => (c.coverMediaId ? [c.coverMediaId] : [])))
    ).filter((m) => m.status === 'ready');
    const urls = new Map<string, MediaVariants | null>();
    for (const m of covers) urls.set(m.id, await this.media.urlsFor(m.variantKeys));
    return new Map(
      cores.map((c) => [
        c.id,
        { title: c.title, avatar: c.coverMediaId ? (urls.get(c.coverMediaId) ?? null) : null },
      ]),
    );
  }
}
