import { AreaGuard } from '../../src/auth/guards';
import { MechanicShell } from '../../src/navigation/shells';

/**
 * Mechanikerbereich (Mechaniker; Admin/Service mit workItems.execute): 3 Reiter.
 * Die Ansichten außer "Heute" folgen mit Paket APP-2.
 */
export default function MechanicLayout() {
  return (
    <AreaGuard area="mechanic">
      <MechanicShell />
    </AreaGuard>
  );
}
