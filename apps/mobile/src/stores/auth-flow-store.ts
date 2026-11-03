import { create } from 'zustand';

/** Ephemeral sign-in flow state (never persisted): the number being verified and an accepted invite code. */
interface AuthFlowState {
  phone: string | null;
  inviteCode: string | null;
  inviterName: string | null;
  /** A friend's guest +1 link opened before signing up; it stands in for an invite code (F-EVT-07). */
  claimToken: string | null;
  setPhone: (phone: string) => void;
  setInvite: (code: string, inviterName: string | null) => void;
  setClaimToken: (token: string | null) => void;
  reset: () => void;
}

export const useAuthFlowStore = create<AuthFlowState>((set) => ({
  phone: null,
  inviteCode: null,
  inviterName: null,
  claimToken: null,
  setPhone: (phone) => {
    set({ phone });
  },
  setInvite: (inviteCode, inviterName) => {
    set({ inviteCode, inviterName });
  },
  setClaimToken: (claimToken) => {
    set({ claimToken });
  },
  reset: () => {
    set({ phone: null, inviteCode: null, inviterName: null, claimToken: null });
  },
}));
