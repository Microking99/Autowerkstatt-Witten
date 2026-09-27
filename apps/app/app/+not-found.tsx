/**
 * Unbekannte Pfade. Werkstatt- und Mechanikeransichten außer den Startseiten entstehen in
 * Paket APP-2; bis dahin sagt diese Seite das ehrlich, statt eine leere Ansicht zu zeigen.
 */
import { homeForRole } from '@werkstatt/contracts';
import { router, usePathname, type Href } from 'expo-router';
import { useSession } from '../src/auth/session';
import { PublicPage } from '../src/screens/common';
import { Button, EmptyState } from '../src/ui';

export default function NotFoundScreen() {
  const path = usePathname();
  const { user } = useSession();
  const home = user ? homeForRole(user.role) : '/';
  const planned = path.startsWith('/werkstatt') || path.startsWith('/mechaniker');
  return (
    <PublicPage testID="seite-nicht-gefunden">
      <EmptyState
        icon={planned ? 'Wrench' : 'Prohibit'}
        title={planned ? 'Diese Ansicht ist noch in Arbeit' : 'Nicht verfügbar'}
        message={
          planned
            ? 'Im Entwurf sind für Werkstatt und Mechaniker bisher nur die Startseiten umgesetzt. Die weiteren Ansichten folgen mit dem nächsten Arbeitspaket.'
            : 'Diese Seite gibt es nicht oder sie ist für Ihr Konto nicht freigegeben.'
        }
        action={<Button label="Zur Startseite" variant="primary" icon="House" onPress={() => router.replace(home as Href)} />}
      />
    </PublicPage>
  );
}
