import { Redirect, useLocalSearchParams } from 'expo-router';
import { appArea, useAuthStore } from '../../src/stores/auth-store';

/** Universal link for a shared crew (F-PLT-03): straight to the crew once signed in. */
export default function CrewLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.session?.user);
  if (appArea(status, user) !== 'app') return <Redirect href="/" />;
  return <Redirect href={`/crews/${id}`} />;
}
