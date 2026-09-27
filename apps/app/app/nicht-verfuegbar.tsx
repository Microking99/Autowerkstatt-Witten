import { NotAvailableView, PublicPage } from '../src/screens/common';

/** Kein Zugriff oder nicht vorhanden; verrät keine fremden Daten. */
export default function NotAvailableScreen() {
  return (
    <PublicPage>
      <NotAvailableView />
    </PublicPage>
  );
}
