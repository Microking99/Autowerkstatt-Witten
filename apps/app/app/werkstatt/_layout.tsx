import { AreaGuard } from '../../src/auth/guards';
import { WorkshopShell } from '../../src/navigation/shells';

/**
 * Werkstattbereich (Inhaber/Admin, Service): Seitenleiste ab 1024 px, sonst unten 5 Reiter.
 * Strg+K Schnellsuche, Alt+1 bis Alt+8 Hauptbereiche (siehe src/navigation/shells.tsx).
 */
export default function WorkshopLayout() {
  return (
    <AreaGuard area="workshop">
      <WorkshopShell />
    </AreaGuard>
  );
}
