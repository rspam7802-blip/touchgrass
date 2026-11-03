import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AddProposalOptionBody,
  BadgeList,
  ChallengeList,
  ConversationSummary,
  type CreateCrewBody,
  type CreateProposalBody,
  CrewDetail,
  CrewHistory,
  CrewList,
  type CrewListQuery,
  type CrewMemberActionBody,
  type CrewMembershipBody,
  type CrewRecurrenceBody,
  FreeNowList,
  type LockProposalBody,
  MyAvailability,
  MyReferrals,
  PriorityPassResult,
  ProposalDetail,
  ProposalList,
  Recap,
  RecapList,
  type SetAvailabilityBody,
  StreakView,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';
import { EVENT_KEYS } from '../events/api';

const Empty = z.undefined();
const idem = (prefix: string): string => `${prefix}-${Crypto.randomUUID()}`;

export const ENGAGEMENT_KEYS = {
  free: ['free'] as const,
  crews: (scope: CrewListQuery['scope']) => ['crews', scope] as const,
  crew: (id: string) => ['crews', 'detail', id] as const,
  crewHistory: (id: string) => ['crews', 'history', id] as const,
  proposals: ['proposals'] as const,
  proposal: (id: string) => ['proposals', id] as const,
  badges: ['badges'] as const,
  streak: ['streak'] as const,
  challenges: ['challenges'] as const,
  recaps: ['recaps'] as const,
  recap: (id: string) => ['recaps', id] as const,
  referrals: ['referrals'] as const,
};

// ---------- free now (F-ENG-01) ----------

export function useFreeNow() {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.free,
    queryFn: ({ signal }) => client.request('/v1/me/availability', FreeNowList, { signal }),
  });
}

export function useSetFree() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetAvailabilityBody | null) =>
      body
        ? client.request('/v1/me/availability', MyAvailability, { method: 'PUT', body })
        : client.request('/v1/me/availability', Empty, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ENGAGEMENT_KEYS.free });
    },
  });
}

/** Ping a squad member who is free now (Phase 13). One per pair per 30 minutes; the API says when to retry. */
export function usePing() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (userId: string) =>
      client.request(`/v1/availability/${userId}/ping`, Empty, { method: 'POST' }),
  });
}

// ---------- crews (F-ENG-02) ----------

export function useCrews(scope: CrewListQuery['scope']) {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.crews(scope),
    queryFn: ({ signal }) =>
      client.request(`/v1/crews?scope=${scope}&limit=50`, CrewList, { signal }),
  });
}

export function useCrew(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.crew(id),
    queryFn: ({ signal }) => client.request(`/v1/crews/${id}`, CrewDetail, { signal }),
  });
}

export function useCrewHistory(id: string, enabled: boolean) {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.crewHistory(id),
    enabled,
    queryFn: ({ signal }) =>
      client.request(`/v1/crews/${id}/history?limit=20`, CrewHistory, { signal }),
  });
}

function useCrewMutation<T, R>(_id: string, fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['crews'] }),
        qc.invalidateQueries({ queryKey: EVENT_KEYS.all }),
      ]);
    },
  });
}

export function useCreateCrew() {
  const { client } = useApi();
  return useCrewMutation('new', (body: CreateCrewBody) =>
    client.request('/v1/crews', CrewDetail, { method: 'POST', body, idempotencyKey: idem('crew') }),
  );
}

export function useCrewMembership(id: string) {
  const { client } = useApi();
  return useCrewMutation(id, (body: CrewMembershipBody) =>
    client.request(`/v1/crews/${id}/membership`, CrewDetail.nullable(), { method: 'POST', body }),
  );
}

export function useCrewMemberAction(id: string) {
  const { client } = useApi();
  return useCrewMutation(id, (input: { userId: string; action: CrewMemberActionBody['action'] }) =>
    client.request(`/v1/crews/${id}/members/${input.userId}`, CrewDetail, {
      method: 'POST',
      body: { action: input.action },
    }),
  );
}

export function useCrewInvite(id: string) {
  const { client } = useApi();
  return useCrewMutation(id, (userIds: string[]) =>
    client.request(`/v1/crews/${id}/invites`, z.object({ invited: z.number().int() }), {
      method: 'POST',
      body: { userIds },
    }),
  );
}

export function useCrewSchedule(id: string) {
  const { client } = useApi();
  return useCrewMutation(id, (body: CrewRecurrenceBody) =>
    client.request(`/v1/crews/${id}/schedule`, CrewDetail, { method: 'PUT', body }),
  );
}

export function useCrewChat(id: string) {
  const { client } = useApi();
  return useMutation({
    mutationFn: () => client.request(`/v1/crews/${id}/chat`, ConversationSummary),
  });
}

// ---------- collaborative plans (F-ENG-03) ----------

export function useProposals() {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.proposals,
    queryFn: ({ signal }) => client.request('/v1/proposals', ProposalList, { signal }),
  });
}

export function useProposal(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.proposal(id),
    queryFn: ({ signal }) => client.request(`/v1/proposals/${id}`, ProposalDetail, { signal }),
  });
}

function useProposalMutation<T>(fn: (input: T) => Promise<ProposalDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (p) => {
      qc.setQueryData(ENGAGEMENT_KEYS.proposal(p.id), p);
      await qc.invalidateQueries({ queryKey: ENGAGEMENT_KEYS.proposals });
      if (p.eventId) await qc.invalidateQueries({ queryKey: EVENT_KEYS.all });
    },
  });
}

export function useCreateProposal() {
  const { client } = useApi();
  return useProposalMutation((body: CreateProposalBody) =>
    client.request('/v1/proposals', ProposalDetail, {
      method: 'POST',
      body,
      idempotencyKey: idem('proposal'),
    }),
  );
}

export function useAddOption(id: string) {
  const { client } = useApi();
  return useProposalMutation((body: AddProposalOptionBody) =>
    client.request(`/v1/proposals/${id}/options`, ProposalDetail, { method: 'POST', body }),
  );
}

export function useVote(id: string) {
  const { client } = useApi();
  return useProposalMutation((body: { optionId: string; vote: boolean }) =>
    client.request(`/v1/proposals/${id}/votes`, ProposalDetail, { method: 'POST', body }),
  );
}

export function useLockProposal(id: string) {
  const { client } = useApi();
  return useProposalMutation((body: LockProposalBody) =>
    client.request(`/v1/proposals/${id}/lock`, ProposalDetail, {
      method: 'POST',
      body,
      idempotencyKey: idem('lock'),
    }),
  );
}

export function useCancelProposal(id: string) {
  const { client } = useApi();
  return useProposalMutation(() =>
    client.request(`/v1/proposals/${id}/cancel`, ProposalDetail, { method: 'POST' }),
  );
}

// ---------- gamification (F-GAM-01..04) ----------

export function useBadges() {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.badges,
    queryFn: ({ signal }) => client.request('/v1/me/badges', BadgeList, { signal }),
  });
}

export function useStreak() {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.streak,
    queryFn: ({ signal }) => client.request('/v1/me/streak', StreakView, { signal }),
  });
}

export function useChallenges() {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.challenges,
    queryFn: ({ signal }) => client.request('/v1/challenges', ChallengeList, { signal }),
  });
}

export function useJoinChallenge() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; crewId: string | null }) =>
      client.request(`/v1/challenges/${input.id}/join`, ChallengeList, {
        method: 'POST',
        body: { crewId: input.crewId },
      }),
    onSuccess: (list) => {
      qc.setQueryData(ENGAGEMENT_KEYS.challenges, list);
    },
  });
}

export function useRecaps() {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.recaps,
    queryFn: ({ signal }) => client.request('/v1/me/recaps', RecapList, { signal }),
  });
}

export function useRecap(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.recap(id),
    queryFn: ({ signal }) => client.request(`/v1/me/recaps/${id}`, Recap, { signal }),
  });
}

// ---------- referrals (F-GRW-01) ----------

export function useReferrals(enabled = true) {
  const { client } = useApi();
  return useQuery({
    queryKey: ENGAGEMENT_KEYS.referrals,
    enabled,
    queryFn: ({ signal }) => client.request('/v1/me/referrals', MyReferrals, { signal }),
  });
}

export function usePriorityPass(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request(`/v1/events/${eventId}/priority-pass`, PriorityPassResult, {
        method: 'POST',
        idempotencyKey: idem('pass'),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: EVENT_KEYS.detail(eventId) }),
        qc.invalidateQueries({ queryKey: ENGAGEMENT_KEYS.referrals }),
      ]);
    },
  });
}
