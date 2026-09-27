import { routes } from '@werkstatt/contracts';
import { PlannedView } from '../../src/screens/PlannedView';

/** Noch nicht umgesetzte Werkstattansichten (Paket APP-2), innerhalb der Navigation. */
export default function WorkshopPlanned() {
  return <PlannedView home={routes.workshop.home()} homeLabel="Zur Übersicht" />;
}
