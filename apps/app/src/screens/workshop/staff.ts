/**
 * Mitarbeiter für Zuweisungen (Aufträge, Positionen, Termine) aus `GET /staff/assignable`:
 * aktive und eingeladene Werkstattmitarbeiter, sortiert nach Namen, ohne E-Mail und Rechte.
 * Recht: workOrders.write oder appointments.write (prüft die API).
 */
import type { Role } from '@werkstatt/contracts';
import { useApiQuery } from '../../data/hooks';

export interface StaffOption {
  id: string;
  displayName: string;
  role: Role | null;
}

/**
 * `complete`: Liste vollständig geladen. Schlägt das Laden fehl (keine Verbindung, fehlendes
 * Recht), ist die Liste leer und `complete` false; bereits zugewiesene Mitarbeiter ergänzen die
 * Ansichten aus dem Auftrag bzw. Termin.
 */
export function useStaffDirectory(enabled = true): { staff: StaffOption[]; complete: boolean; status: 'loading' | 'error' | 'success' } {
  const query = useApiQuery(enabled ? 'werkstatt:mitarbeiter' : null, async (api) => {
    const list = await api.listAssignableStaff();
    return list.map((s): StaffOption => ({ id: s.userId, displayName: s.displayName, role: s.role }));
  });
  return { staff: query.data ?? [], complete: query.status === 'success', status: query.status };
}
