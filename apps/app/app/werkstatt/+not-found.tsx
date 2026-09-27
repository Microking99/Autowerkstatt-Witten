import { routes } from '@werkstatt/contracts';
import { AreaNotFound } from '../../src/screens/AreaNotFound';

/** Unbekannte Adresse im Werkstattbereich (Navigation bleibt sichtbar). */
export default function WorkshopNotFound() {
  return <AreaNotFound home={routes.workshop.home()} homeLabel="Zur Übersicht" />;
}
