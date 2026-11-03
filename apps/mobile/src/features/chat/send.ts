import { useQueryClient } from '@tanstack/react-query';
import { Message } from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { useCallback } from 'react';
import { ApiError } from '../../lib/api-client';
import { useApi } from '../../providers/api-context';
import { CHAT_KEYS, upsertMessage } from './api';
import { newClientId, type PendingMessage, useOutbox } from './outbox';

/**
 * Sending goes through the outbox: the message shows immediately as "sending", is posted with its clientId,
 * and on a network failure stays as "failed" to be retried (same clientId, so never duplicated).
 */
export function useChatSender() {
  const { client } = useApi();
  const qc = useQueryClient();

  const deliver = useCallback(
    async (m: PendingMessage): Promise<void> => {
      useOutbox.getState().setStatus(m.clientId, 'sending');
      try {
        const sent = await client.request(`/v1/chats/${m.conversationId}/messages`, Message, {
          method: 'POST',
          body: {
            clientId: m.clientId,
            kind: m.kind,
            body: m.body,
            mediaId: m.mediaId,
            replyToId: m.replyToId,
          },
        });
        useOutbox.getState().remove(m.clientId);
        qc.setQueryData(
          CHAT_KEYS.messages(m.conversationId),
          (data: Parameters<typeof upsertMessage>[0]) => upsertMessage(data, sent),
        );
        await qc.invalidateQueries({ queryKey: ['chat', 'inbox'] });
      } catch (err) {
        // Rejections from the API (closed chat, pending request) will not succeed on retry: drop them.
        if (err instanceof ApiError && err.code !== 'NETWORK' && !err.retryable) {
          useOutbox.getState().remove(m.clientId);
          throw err;
        }
        useOutbox.getState().setStatus(m.clientId, 'failed');
      }
    },
    [client, qc],
  );

  const send = useCallback(
    (input: Omit<PendingMessage, 'status' | 'createdAt' | 'clientId'>): Promise<void> =>
      deliver(
        useOutbox
          .getState()
          .enqueue({ ...input, clientId: newClientId(() => Crypto.randomUUID()) }),
      ),
    [deliver],
  );

  /** Resends every failed message (on reconnect, or when the thread opens). */
  const flush = useCallback(
    async (conversationId?: string): Promise<void> => {
      const failed = useOutbox
        .getState()
        .items.filter(
          (m) => m.status === 'failed' && (!conversationId || m.conversationId === conversationId),
        );
      for (const m of failed) await deliver(m).catch(() => undefined);
    },
    [deliver],
  );

  return { send, retry: deliver, flush };
}
