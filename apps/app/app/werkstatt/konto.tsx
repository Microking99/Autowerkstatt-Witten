/** Werkstatt, eigenes Konto: Profil, Passwort, Abmelden. */
import { routes } from '@werkstatt/contracts';
import { StaffAccount } from '../../src/screens/StaffAccount';

export default function WorkshopAccount() {
  return <StaffAccount home={routes.workshop.home()} homeLabel="Übersicht" testID="werkstatt-konto" />;
}
