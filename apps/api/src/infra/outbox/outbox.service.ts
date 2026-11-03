import { Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '../database/database.module.js';
import { outboxEvents } from '../database/schema/index.js';

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: TPayload;
}

/**
 * Transactional outbox: domain events are written in the SAME transaction as the state change,
 * then relayed to BullMQ by OutboxRelay. A crash between commit and publish loses nothing.
 */
@Injectable()
export class OutboxService {
  async add(tx: Tx, event: DomainEvent): Promise<string> {
    const id = uuidv7();
    await tx.insert(outboxEvents).values({
      id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.type,
      payload: event.payload,
    });
    return id;
  }
}
