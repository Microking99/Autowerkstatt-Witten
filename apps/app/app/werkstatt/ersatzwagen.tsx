/** Werkstatt, Ersatzwagen [E]: Ergänzung, Details offen (O-8). */
import { SupplementView } from '../../src/screens/workshop/SupplementView';

export default function LoanCarScreen() {
  return (
    <SupplementView
      title="Ersatzwagen"
      icon="Car"
      code="O-8"
      testID="werkstatt-ersatzwagen"
      question="Sollen Ersatzwagen in der Software gebucht und übergeben werden?"
      proposal="Nicht umgesetzt; das Datenmodell ist vorbereitet."
      today={['Ein Ersatzwagen kann heute nur als interne Notiz am Termin oder Auftrag vermerkt werden.']}
      open={['Buchung mit Belegungskalender, Übergabe- und Rücknahmeprotokoll mit Fotos und km-Stand.', 'Kosten, Versicherungsfragen und Vertragsbedingungen (rechtliche Prüfung nötig).']}
    />
  );
}
