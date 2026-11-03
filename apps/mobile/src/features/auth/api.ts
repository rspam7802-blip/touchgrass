import { useMutation } from '@tanstack/react-query';
import { AuthResponse, InviteCheckResponse, OtpRequestResponse } from '@touchgrass/shared';
import { z } from 'zod';
import { deviceInfo } from '../../lib/device';
import { useApi } from '../../providers/api-context';
import { useAuthStore } from '../../stores/auth-store';

export const TERMS_VERSION = '2026-10';
const Empty = z.undefined();

export function useRequestOtp() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (phone: string) =>
      client.request('/v1/auth/otp/request', OtpRequestResponse, {
        method: 'POST',
        body: { phone },
      }),
  });
}

export function useCheckInvite() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (code: string) =>
      client.request('/v1/auth/invites/check', InviteCheckResponse, {
        method: 'POST',
        body: { code },
      }),
  });
}

/** Verifies the OTP, stores the session, and records Terms/Privacy/18+ consent for brand-new accounts. */
export function useVerifyOtp() {
  const { client, appVersion } = useApi();
  return useMutation({
    mutationFn: async (input: {
      phone: string;
      code: string;
      inviteCode: string | null;
      claimToken?: string | null;
    }) => {
      const res = await client.request('/v1/auth/otp/verify', AuthResponse, {
        method: 'POST',
        body: {
          phone: input.phone,
          code: input.code,
          inviteCode: input.inviteCode ?? undefined,
          claimToken: input.claimToken ?? undefined,
          device: await deviceInfo(appVersion),
        },
      });
      await useAuthStore.getState().signIn(res);
      if (res.isNewUser) {
        for (const kind of ['terms', 'privacy', 'age_confirmation'] as const) {
          await client.request('/v1/me/consents', Empty, {
            method: 'POST',
            body: { kind, granted: true, version: TERMS_VERSION },
          });
        }
      }
      return res;
    },
  });
}

export function useLogout() {
  const { client } = useApi();
  return useMutation({
    mutationFn: async () => {
      await client.request('/v1/auth/logout', Empty, { method: 'POST' }).catch(() => undefined);
      await useAuthStore.getState().signOut();
    },
  });
}
