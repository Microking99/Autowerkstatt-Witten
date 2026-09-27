import { routes } from '@werkstatt/contracts';
import { AreaNotFound } from '../../src/screens/AreaNotFound';

/** Unbekannte Adresse im Mechanikerbereich (Navigation bleibt sichtbar). */
export default function MechanicNotFound() {
  return <AreaNotFound home={routes.mechanic.home()} homeLabel="Zu Heute" />;
}
