import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DeletionScheduledResponse,
  InterestList,
  InviteCode,
  MeResponse,
  MyInvites,
  NotificationPreferences,
  type NotificationPreference,
  PrivacySettings,
  type RecordConsentBody,
  type SupportedLanguage,
  SessionList,
  type UpdateProfileBody,
  VibeTagList,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';
import { useAuthStore } from '../../stores/auth-store';

const Empty = z.undefined();
export const ME_KEY = ['me'] as const;

export function useMe() {
  const { client } = useApi();
  return useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => client.request('/v1/me', MeResponse, { signal }),
  });
}

/** Mutations that return the full profile write it straight into the cache. */
function useMeMutation<TInput>(fn: (input: TInput) => Promise<MeResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me);
    },
  });
}

export function useUpdateProfile() {
  const { client } = useApi();
  return useMeMutation((body: UpdateProfileBody) =>
    client.request('/v1/me/profile', MeResponse, { method: 'PATCH', body }),
  );
}

export function useSetPhotos() {
  const { client } = useApi();
  return useMeMutation((mediaAssetIds: string[]) =>
    client.request('/v1/me/photos', MeResponse, { method: 'PUT', body: { mediaAssetIds } }),
  );
}

export function useSetInterests() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (interestIds: string[]) =>
      client.request('/v1/me/interests', InterestList, { method: 'PUT', body: { interestIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useSetVibeTags() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vibeTagIds: string[]) =>
      client.request('/v1/me/vibe-tags', VibeTagList, { method: 'PUT', body: { vibeTagIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useCompleteOnboarding() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request('/v1/me/onboarding/complete', MeResponse, { method: 'POST' }),
    onSuccess: async (me) => {
      qc.setQueryData(ME_KEY, me);
      await useAuthStore.getState().updateUser({
        onboardingComplete: true,
        status: me.status,
        tutorialComplete: me.tutorialComplete,
      });
    },
  });
}

export function useTutorial() {
  const { client } = useApi();
  return useMutation({
    mutationFn: async (complete: boolean) => {
      await client.request(complete ? '/v1/me/tutorial/complete' : '/v1/me/tutorial', Empty, {
        method: complete ? 'POST' : 'DELETE',
      });
      await useAuthStore.getState().updateUser({ tutorialComplete: complete });
    },
  });
}

export function useRecordConsent() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (body: RecordConsentBody) =>
      client.request('/v1/me/consents', Empty, { method: 'POST', body }),
  });
}

export function useRegisterDevice() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (body: { expoPushToken: string; platform: 'ios' | 'android' }) =>
      client.request('/v1/me/devices', Empty, { method: 'POST', body }),
  });
}

export function usePrivacy() {
  const { client } = useApi();
  return useQuery({
    queryKey: ['privacy'],
    queryFn: ({ signal }) => client.request('/v1/me/settings/privacy', PrivacySettings, { signal }),
  });
}

export function useUpdatePrivacy() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PrivacySettings>) =>
      client.request('/v1/me/settings/privacy', PrivacySettings, { method: 'PUT', body: patch }),
    onSuccess: (data) => {
      qc.setQueryData(['privacy'], data);
    },
  });
}

export function useNotificationPrefs() {
  const { client } = useApi();
  return useQuery({
    queryKey: ['notification-prefs'],
    queryFn: ({ signal }) =>
      client.request('/v1/me/settings/notifications', NotificationPreferences, { signal }),
  });
}

export function useUpdateNotificationPrefs() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: NotificationPreference[]) =>
      client.request('/v1/me/settings/notifications', NotificationPreferences, {
        method: 'PUT',
        body: { items },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['notification-prefs'], data);
    },
  });
}

export function useSaveLanguage() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (language: SupportedLanguage) =>
      client.request('/v1/me/settings/language', Empty, { method: 'PUT', body: { language } }),
  });
}

export function useSessions() {
  const { client } = useApi();
  return useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => client.request('/v1/me/sessions', SessionList, { signal }),
  });
}

export function useRevokeSession() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.request(`/v1/me/sessions/${id}`, Empty, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useExportData() {
  const { client } = useApi();
  return useMutation({
    mutationFn: () => client.request('/v1/me/export', z.record(z.string(), z.unknown())),
  });
}

export function useDeleteAccount() {
  const { client } = useApi();
  return useMutation({
    mutationFn: async () => {
      const res = await client.request('/v1/me/deletion', DeletionScheduledResponse, {
        method: 'POST',
        body: { confirm: 'DELETE' },
      });
      await useAuthStore.getState().signOut();
      return res;
    },
  });
}

export function useMyInvites() {
  const { client } = useApi();
  return useQuery({
    queryKey: ['my-invites'],
    queryFn: ({ signal }) => client.request('/v1/me/invites', MyInvites, { signal }),
  });
}

export function useCreateInvite() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request('/v1/me/invites', InviteCode, {
        method: 'POST',
        idempotencyKey: `invite-${Crypto.randomUUID()}`,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-invites'] }),
  });
}
