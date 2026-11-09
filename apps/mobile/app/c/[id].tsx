import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useAuthFlowStore } from '../../src/stores/auth-flow-store';
import { appArea, useAuthStore } from '../../src/stores/auth-store';

/** Universal link for a shared crew (F-PLT-03): straight to the crew once signed in. */
export default function CrewLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.session?.user);
  const signedIn = appArea(status, user) === 'app';
  // Signed out: remember the crew so it opens after sign-in instead of being lost.
  useEffect(() => {
    if (!signedIn && status !== 'loading')
      useAuthFlowStore.getState().setPendingLink(`/crews/${id}`);
  }, [signedIn, status, id]);
  if (status === 'loading') return null;
  if (!signedIn) return <Redirect href="/" />;
  return <Redirect href={`/crews/${id}`} />;
}
