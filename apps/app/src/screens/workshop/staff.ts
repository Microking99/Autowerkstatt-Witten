/**
 * Mitarbeiter für Zuweisungen. Die Liste aller Mitarbeiter (GET /users) verlangt
 * `users.manage`; ohne dieses Recht (Service) werden die bekannten Mitarbeiter aus den
 * Aufträgen abgeleitet. Vertragslücke: Ein schlanker Endpunkt "zuweisbare Mitarbeiter" für
 * den Service fehlt in der API (siehe Übergabe APP-2, offene Punkte).
 */
import type { Role } from '@werkstatt/contracts';
import { useApiQuery } from '../../data/hooks';

export interface StaffOption {
  id: string;
  displayName: string;
  role: Role | null;
}

export function useStaffDirectory(enabled = true): { staff: StaffOption[]; complete: boolean } {
  const query = useApiQuery(enabled ? 'werkstatt:mitarbeiter' : null, async (api) => {
    try {
      const users = await api.listUsers();
      return { complete: true, staff: users.filter((u) => u.status === 'active').map((u) => ({ id: u.id, displayName: u.displayName, role: u.role })) };
    } catch {
      const orders = await api.listWorkOrders({});
      const map = new Map<string, StaffOption>();
      for (const o of orders.items) for (const a of o.assignees) map.set(a.userId, { id: a.userId, displayName: a.displayName, role: null });
      return { complete: false, staff: [...map.values()] };
    }
  });
  const staff = [...(query.data?.staff ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
  return { staff, complete: query.data?.complete ?? false };
}
