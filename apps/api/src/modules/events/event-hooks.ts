import { Injectable } from '@nestjs/common';
import type { EventPerk, ViewerState } from '@touchgrass/shared';
import type { EventCore } from './event-store.service.js';
import type { EventViewerFacts } from './event-access.service.js';

export type ViewerPayment = NonNullable<ViewerState['payment']>;

/**
 * Extension points other modules plug into, so events never imports them (they import events):
 * hosting decides who may sell tickets (F-HST-01), payments shows the viewer's checkout (F-PAY-01), and
 * perks lists partner-venue perks on the plan (F-PAY-04). Unregistered hooks answer conservatively.
 */
export interface EventHookSet {
  canHostPaid?: (userId: string) => Promise<boolean>;
  /** Someone has paid or is paying: the price is locked. */
  hasPayments?: (eventId: string) => Promise<boolean>;
  viewerPayment?: (userId: string, eventId: string) => Promise<ViewerPayment | null>;
  perks?: (userId: string, core: EventCore, facts: EventViewerFacts) => Promise<EventPerk[]>;
  lore?: (
    userId: string,
    core: EventCore,
    facts: EventViewerFacts,
  ) => Promise<{ count: number; canAdd: boolean } | null>;
  /** The crew a crew session belongs to (F-ENG-02). */
  crew?: (eventId: string) => Promise<{ id: string; name: string } | null>;
}

@Injectable()
export class EventHooks {
  private readonly hooks: EventHookSet = {};

  register(hooks: EventHookSet): void {
    for (const key of Object.keys(hooks) as (keyof EventHookSet)[]) {
      if (this.hooks[key]) throw new Error(`Event hook ${key} is already registered`);
    }
    Object.assign(this.hooks, hooks);
  }

  /** Without the hosting module nobody sells tickets. */
  canHostPaid(userId: string): Promise<boolean> {
    return this.hooks.canHostPaid ? this.hooks.canHostPaid(userId) : Promise.resolve(false);
  }

  hasPayments(eventId: string): Promise<boolean> {
    return this.hooks.hasPayments ? this.hooks.hasPayments(eventId) : Promise.resolve(false);
  }

  viewerPayment(userId: string, eventId: string): Promise<ViewerPayment | null> {
    return this.hooks.viewerPayment
      ? this.hooks.viewerPayment(userId, eventId)
      : Promise.resolve(null);
  }

  perks(userId: string, core: EventCore, facts: EventViewerFacts): Promise<EventPerk[]> {
    return this.hooks.perks ? this.hooks.perks(userId, core, facts) : Promise.resolve([]);
  }

  lore(
    userId: string,
    core: EventCore,
    facts: EventViewerFacts,
  ): Promise<{ count: number; canAdd: boolean } | null> {
    return this.hooks.lore ? this.hooks.lore(userId, core, facts) : Promise.resolve(null);
  }

  crew(eventId: string): Promise<{ id: string; name: string } | null> {
    return this.hooks.crew ? this.hooks.crew(eventId) : Promise.resolve(null);
  }
}
