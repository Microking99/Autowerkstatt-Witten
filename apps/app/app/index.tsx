import { homeForRole, routes } from '@werkstatt/contracts';
import { Redirect } from 'expo-router';
import { FullPageLoading } from '../src/auth/guards';
import { useSession } from '../src/auth/session';

/** Weiche: angemeldet → Startseite der Rolle, sonst Anmeldung. */
export default function Index() {
  const { status, user } = useSession();
  if (status === 'loading') return <FullPageLoading />;
  if (status === 'signedIn' && user) return <Redirect href={homeForRole(user.role)} />;
  return <Redirect href={routes.login()} />;
}
