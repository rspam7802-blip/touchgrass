import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckoutResult,
  type CreateHostAccountBody,
  type CreateHostApplicationBody,
  EventAnalytics,
  HostAccount,
  HostAnalytics,
  HostApplication,
  HostStatus,
  PaymentList,
  PaymentView,
  PayoutLedger,
  PerkPass,
  Receipt,
  ReceiptEmailBody,
  RefundQuote,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';
import { EVENT_KEYS } from '../events/api';

const Empty = z.undefined();
const idem = (prefix: string): string => `${prefix}-${Crypto.randomUUID()}`;

export const PAY_KEYS = {
  all: ['payments'] as const,
  payment: (id: string) => ['payments', 'one', id] as const,
  list: ['payments', 'list'] as const,
  receipt: (id: string) => ['payments', 'receipt', id] as const,
  receiptEmail: ['payments', 'receipt-email'] as const,
  quote: (eventId: string) => ['payments', 'quote', eventId] as const,
  host: ['host'] as const,
  hostStatus: ['host', 'status'] as const,
  analytics: ['host', 'analytics'] as const,
  eventAnalytics: (id: string) => ['host', 'analytics', id] as const,
  payouts: ['host', 'payouts'] as const,
};

/** Polls while the bank has not answered yet (only verified webhooks change the status). */
const OPEN = new Set(['created', 'failed']);

// ---------- buying (F-PAY-01) ----------

export function useCheckout(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { receiptEmail: string | null; fromOffer: boolean; useCredit?: boolean }) =>
      client.request(`/v1/events/${eventId}/checkout`, CheckoutResult, {
        method: 'POST',
        body,
        idempotencyKey: idem('checkout'),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: EVENT_KEYS.all });
    },
  });
}

export function usePayment(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: PAY_KEYS.payment(id),
    queryFn: ({ signal }) => client.request(`/v1/payments/${id}`, PaymentView, { signal }),
    refetchInterval: (q) => (q.state.data && OPEN.has(q.state.data.status) ? 3000 : false),
  });
}

export function useCancelCheckout(id: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request(`/v1/payments/${id}/cancel`, Empty, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: PAY_KEYS.all }),
        qc.invalidateQueries({ queryKey: EVENT_KEYS.all }),
      ]);
    },
  });
}

export function usePayments() {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: PAY_KEYS.list,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/payments?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        PaymentList,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useReceipt(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: PAY_KEYS.receipt(id),
    queryFn: ({ signal }) => client.request(`/v1/payments/${id}/receipt`, Receipt, { signal }),
  });
}

export function useReceiptEmail() {
  const { client } = useApi();
  return useQuery({
    queryKey: PAY_KEYS.receiptEmail,
    queryFn: ({ signal }) =>
      client.request('/v1/payments/receipt-email', ReceiptEmailBody, { signal }),
  });
}

export function useSetReceiptEmail() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string | null) =>
      client.request('/v1/payments/receipt-email', ReceiptEmailBody, {
        method: 'PUT',
        body: { email },
      }),
    onSuccess: (data) => {
      qc.setQueryData(PAY_KEYS.receiptEmail, data);
    },
  });
}

export function useRefundQuote(eventId: string, enabled: boolean) {
  const { client } = useApi();
  return useQuery({
    queryKey: PAY_KEYS.quote(eventId),
    enabled,
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/refund-quote`, RefundQuote, { signal }),
  });
}

// ---------- perks (F-PAY-04) ----------

export function usePerkPass(eventId: string, perkId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: ['perks', eventId, perkId],
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/perks/${perkId}/pass`, PerkPass, {
        method: 'POST',
        signal,
      }),
    staleTime: Infinity,
  });
}

// ---------- hosting (F-HST-01/02, F-PAY-03) ----------

export function useHostStatus() {
  const { client } = useApi();
  return useQuery({
    queryKey: PAY_KEYS.hostStatus,
    queryFn: ({ signal }) => client.request('/v1/host/status', HostStatus, { signal }),
  });
}

export function useApplyToHost() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHostApplicationBody) =>
      client.request('/v1/host/applications', HostApplication, {
        method: 'POST',
        body,
        idempotencyKey: idem('host-app'),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PAY_KEYS.hostStatus });
    },
  });
}

export function useCreateHostAccount() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHostAccountBody) =>
      client.request('/v1/host/account', HostAccount, {
        method: 'POST',
        body,
        idempotencyKey: idem('host-account'),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PAY_KEYS.host });
    },
  });
}

export function useHostAnalytics() {
  const { client } = useApi();
  return useQuery({
    queryKey: PAY_KEYS.analytics,
    queryFn: ({ signal }) => client.request('/v1/host/analytics', HostAnalytics, { signal }),
  });
}

export function useEventAnalytics(eventId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: PAY_KEYS.eventAnalytics(eventId),
    queryFn: ({ signal }) =>
      client.request(`/v1/host/analytics/events/${eventId}`, EventAnalytics, { signal }),
  });
}

export function usePayouts() {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: PAY_KEYS.payouts,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/host/payouts?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        PayoutLedger,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
