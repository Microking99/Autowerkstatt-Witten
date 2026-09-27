/** Mechaniker, Konto: Profil, Passwort, Abmelden (mit Hinweis auf nicht übertragene Einträge). */
import { routes } from '@werkstatt/contracts';
import { useOfflineQueue } from '../../src/offline/OfflineQueueProvider';
import { StaffAccount } from '../../src/screens/StaffAccount';

export default function MechanicAccount() {
  const { summary } = useOfflineQueue();
  return <StaffAccount home={routes.mechanic.home()} homeLabel="Heute" unsynced={summary.total} testID="mechaniker-konto" />;
}
