/**
 * Unbekannte Pfade außerhalb der Bereiche: ehrlicher Hinweis und Weg zur eigenen Startseite.
 */
import { homeForRole } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useSession } from '../src/auth/session';
import { PublicPage } from '../src/screens/common';
import { Button, EmptyState } from '../src/ui';

export default function NotFoundScreen() {
  const { user } = useSession();
  const home = user ? homeForRole(user.role) : '/';
  return (
    <PublicPage testID="seite-nicht-gefunden">
      <EmptyState
        icon="Prohibit"
        title="Nicht verfügbar"
        message="Diese Seite gibt es nicht oder sie ist für Ihr Konto nicht freigegeben."
        action={<Button label="Zur Startseite" variant="primary" icon="House" onPress={() => router.replace(home as Href)} />}
      />
    </PublicPage>
  );
}
