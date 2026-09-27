/** Werkstatt, Lager [E]: Ergänzung, Details offen (O-6). */
import { SupplementView } from '../../src/screens/workshop/SupplementView';

export default function StockScreen() {
  return (
    <SupplementView
      title="Lager und Teile"
      icon="Warehouse"
      code="O-6"
      testID="werkstatt-lager"
      question="Soll die Software eine Lagerführung für Teile bekommen?"
      proposal="Keine Lagerführung, nur der Teilebedarf je Auftrag mit Status (benötigt, bestellt, eingetroffen, verbaut)."
      today={[
        'Der Kalender warnt, wenn für einen Termin bestellte Teile voraussichtlich noch fehlen.',
        'Mechaniker erfassen verbaute Teile an der Position (Teilenummer, Bezeichnung, Menge; ohne Preise).',
      ]}
      open={[
        'Eigene Ansicht für den Teilebedarf aller Aufträge (die Schnittstelle liefert ihn noch nicht als Liste).',
        'Bestände, Mindestmengen, Inventur und Lieferantenanbindung (nur bei Entscheidung für eine Lagerführung).',
      ]}
    />
  );
}
