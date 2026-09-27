import { routes } from '@werkstatt/contracts';
import { PlannedView } from '../../src/screens/PlannedView';

/** Noch nicht umgesetzte Mechanikeransichten (Paket APP-2), innerhalb der Navigation. */
export default function MechanicPlanned() {
  return <PlannedView home={routes.mechanic.home()} homeLabel="Zu Heute" />;
}
