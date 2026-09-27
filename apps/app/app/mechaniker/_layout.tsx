import { AreaGuard } from '../../src/auth/guards';
import { MechanicShell } from '../../src/navigation/shells';

/**
 * Mechanikerbereich (Mechaniker; Admin/Service mit workItems.execute): 3 Reiter.
 * Offline-Warteschlange für Feststellungen, Fotos, Zeiten und Notizen (src/offline).
 */
export default function MechanicLayout() {
  return (
    <AreaGuard area="mechanic">
      <MechanicShell />
    </AreaGuard>
  );
}
