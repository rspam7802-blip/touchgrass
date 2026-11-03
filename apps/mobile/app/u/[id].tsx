import { Redirect, useLocalSearchParams } from 'expo-router';
import { appArea, useAuthStore } from '../../src/stores/auth-store';

/** Universal link for a shared profile (F-PLT-03): straight to the profile once signed in. */
export default function ProfileLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.session?.user);
  if (appArea(status, user) !== 'app') return <Redirect href="/" />;
  return <Redirect href={`/users/${id}`} />;
}
