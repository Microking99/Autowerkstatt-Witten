import { AreaGuard } from '../../src/auth/guards';
import { WorkshopShell } from '../../src/navigation/shells';

/**
 * Werkstattbereich (Inhaber/Admin, Service): Seitenleiste ab 1024 px, sonst unten 5 Reiter.
 * Die Ansichten außer der Übersicht folgen mit Paket APP-2.
 */
export default function WorkshopLayout() {
  return (
    <AreaGuard area="workshop">
      <WorkshopShell />
    </AreaGuard>
  );
}
