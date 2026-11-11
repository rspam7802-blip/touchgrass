import { firebaseWebConfig } from '../../../lib/firebase-web';
import { LoginForm } from './LoginForm';

/** Read per request: whether Firebase signs people in depends on the deployment's environment. */
export const dynamic = 'force-dynamic';

export default function AdminLogin() {
  return <LoginForm firebase={firebaseWebConfig()} />;
}
