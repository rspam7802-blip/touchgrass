import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AttendeeList,
  CheckInResult,
  ClaimPlusOneResult,
  type CreateEventBody,
  EventDetail,
  EventList,
  InviteeList,
  InviteLink,
  InviteUsersResult,
  JoinRequestList,
  MyJoinRequest,
  RsvpResult,
  Ticket,
  type UpdateEventBody,
  Venue,
  VenueList,
  VenueSearchResponse,
  type GeoPoint,
  type HostRole,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';

const Empty = z.undefined();
export type MyEventsScope = 'upcoming' | 'hosting' | 'past';

export const EVENT_KEYS = {
  all: ['events'] as const,
  mine: (scope: MyEventsScope) => ['events', 'mine', scope] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  slug: (slug: string) => ['events', 'slug', slug] as const,
  attendees: (id: string) => ['events', 'attendees', id] as const,
  invitees: (id: string) => ['events', 'invitees', id] as const,
  joinRequests: (id: string) => ['events', 'join-requests', id] as const,
  ticket: (id: string) => ['events', 'ticket', id] as const,
  savedVenues: ['venues', 'saved'] as const,
};

const idem = (prefix: string): string => `${prefix}-${Crypto.randomUUID()}`;

export function useMyEvents(scope: MyEventsScope) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: EVENT_KEYS.mine(scope),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/events/mine?scope=${scope}&limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        EventList,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEvent(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: EVENT_KEYS.detail(id),
    queryFn: ({ signal }) => client.request(`/v1/events/${id}`, EventDetail, { signal }),
  });
}

/** Opening a share link; an `i` invite token records who invited you before visibility is checked. */
export function useEventBySlug(slug: string, inviteToken: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: EVENT_KEYS.slug(slug),
    queryFn: ({ signal }) =>
      client.request(
        `/v1/events/by-slug/${encodeURIComponent(slug)}${inviteToken ? `?i=${encodeURIComponent(inviteToken)}` : ''}`,
        EventDetail,
        { signal },
      ),
  });
}

export function useAttendees(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: EVENT_KEYS.attendees(id),
    queryFn: ({ signal }) => client.request(`/v1/events/${id}/attendees`, AttendeeList, { signal }),
  });
}

export function useInvitees(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: EVENT_KEYS.invitees(id),
    queryFn: ({ signal }) => client.request(`/v1/events/${id}/invitees`, InviteeList, { signal }),
  });
}

export function useTicket(id: string, enabled: boolean) {
  const { client } = useApi();
  return useQuery({
    queryKey: EVENT_KEYS.ticket(id),
    enabled,
    queryFn: ({ signal }) => client.request(`/v1/events/${id}/ticket`, Ticket, { signal }),
    staleTime: Infinity,
  });
}

/** Any event change can move counts, lists and the viewer state everywhere, so refresh all event queries. */
function useEventMutation<TInput, TOut>(fn: (input: TInput) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (out) => {
      const parsed = EventDetail.safeParse(out);
      if (parsed.success) qc.setQueryData(EVENT_KEYS.detail(parsed.data.id), parsed.data);
      const nested = z.object({ event: EventDetail }).safeParse(out);
      if (nested.success)
        qc.setQueryData(EVENT_KEYS.detail(nested.data.event.id), nested.data.event);
      await qc.invalidateQueries({ queryKey: EVENT_KEYS.all });
    },
  });
}

export type RsvpInput =
  | { status: 'going' | 'interested'; plusOne?: { userId: string } | { guest: true } | null }
  | { status: 'cancel' }
  | { status: 'claim' };

export function useRsvp(id: string) {
  const { client } = useApi();
  return useEventMutation(async (input: RsvpInput) => {
    if (input.status === 'cancel') {
      await client.request(`/v1/events/${id}/rsvp`, Empty, { method: 'DELETE' });
      return null;
    }
    if (input.status === 'claim')
      return client.request(`/v1/events/${id}/waitlist/claim`, RsvpResult, {
        method: 'POST',
        idempotencyKey: idem('claim'),
      });
    return client.request(`/v1/events/${id}/rsvp`, RsvpResult, {
      method: 'PUT',
      body: { status: input.status, plusOne: input.plusOne ?? null },
      idempotencyKey: idem('rsvp'),
    });
  });
}

/** Pass one key per form so a retried submit returns the same plan instead of creating a second one. */
export function useCreateEvent(idempotencyKey?: string) {
  const { client } = useApi();
  return useEventMutation((body: CreateEventBody) =>
    client.request('/v1/events', EventDetail, {
      method: 'POST',
      body,
      idempotencyKey: idempotencyKey ?? idem('plot'),
    }),
  );
}

export function useUpdateEvent(id: string) {
  const { client } = useApi();
  return useEventMutation((body: UpdateEventBody) =>
    client.request(`/v1/events/${id}`, EventDetail, { method: 'PATCH', body }),
  );
}

export function useCancelEvent(id: string) {
  const { client } = useApi();
  return useEventMutation((reason: string) =>
    client.request(`/v1/events/${id}/cancel`, EventDetail, {
      method: 'POST',
      body: { reason },
      idempotencyKey: idem('cancel'),
    }),
  );
}

export function useInvite(id: string) {
  const { client } = useApi();
  return useEventMutation((userIds: string[]) =>
    client.request(`/v1/events/${id}/invites`, InviteUsersResult, {
      method: 'POST',
      body: { userIds },
    }),
  );
}

/** Private plans (D-179): ask the host to join, or take the request back before they answer. */
export function useJoinRequest(id: string) {
  const { client } = useApi();
  return useEventMutation(async (action: 'ask' | 'withdraw') => {
    if (action === 'withdraw') {
      await client.request(`/v1/events/${id}/join-request`, Empty, { method: 'DELETE' });
      return null;
    }
    return client.request(`/v1/events/${id}/join-request`, MyJoinRequest, { method: 'POST' });
  });
}

/** Hosts: people waiting for an answer, oldest first. */
export function useJoinRequests(id: string) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: EVENT_KEYS.joinRequests(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/events/${id}/join-requests${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        JoinRequestList,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Hosts: let someone in, or not. */
export function useDecideJoinRequest(id: string) {
  const { client } = useApi();
  return useEventMutation(async (input: { userId: string; approve: boolean }) => {
    await client.request(
      `/v1/events/${id}/join-requests/${input.userId}/${input.approve ? 'approve' : 'decline'}`,
      Empty,
      { method: 'POST' },
    );
    return null;
  });
}

export function useInviteLink(id: string) {
  const { client } = useApi();
  return useMutation({
    mutationFn: () =>
      client.request(`/v1/events/${id}/invite-links`, InviteLink, { method: 'POST' }),
  });
}

export function useHosts(id: string) {
  const { client } = useApi();
  return useEventMutation(
    async (
      input:
        | { action: 'add'; userId: string; role: Exclude<HostRole, 'host'> }
        | { action: 'remove'; userId: string },
    ) => {
      if (input.action === 'add')
        return client.request(`/v1/events/${id}/hosts`, EventDetail, {
          method: 'POST',
          body: { userId: input.userId, role: input.role },
        });
      await client.request(`/v1/events/${id}/hosts/${input.userId}`, Empty, { method: 'DELETE' });
      return null;
    },
  );
}

export function useCheckIn(id: string) {
  const { client } = useApi();
  return useEventMutation((body: { qr: string } | { point: GeoPoint }) =>
    client.request(`/v1/events/${id}/check-in`, CheckInResult, { method: 'POST', body }),
  );
}

export function useClaimPlusOne() {
  const { client } = useApi();
  return useEventMutation((token: string) =>
    client.request('/v1/plus-ones/claim', ClaimPlusOneResult, {
      method: 'POST',
      body: { token },
      idempotencyKey: idem('plus-one'),
    }),
  );
}

// ---------- venues (F-EVT-02) ----------

export function useVenueSearch(query: string, near: GeoPoint, sessionToken: string) {
  const { client } = useApi();
  const q = query.trim();
  return useQuery({
    queryKey: ['venues', 'search', q, near.lat, near.lng],
    enabled: q.length >= 2,
    queryFn: ({ signal }) =>
      client.request(
        `/v1/venues/search?q=${encodeURIComponent(q)}&lat=${near.lat}&lng=${near.lng}&session=${encodeURIComponent(sessionToken)}`,
        VenueSearchResponse,
        { signal },
      ),
    staleTime: 60_000,
  });
}

export function useVenueFromPlace() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (input: { placeId: string; sessionToken: string }) =>
      client.request('/v1/venues/from-place', Venue, { method: 'POST', body: input }),
  });
}

export function useSavedVenues() {
  const { client } = useApi();
  return useQuery({
    queryKey: EVENT_KEYS.savedVenues,
    queryFn: ({ signal }) => client.request('/v1/venues/saved', VenueList, { signal }),
  });
}

export function useSaveVenue() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { venueId: string; saved: boolean }) =>
      client.request(`/v1/venues/saved/${input.venueId}`, Empty, {
        method: input.saved ? 'PUT' : 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: EVENT_KEYS.savedVenues }),
  });
}
