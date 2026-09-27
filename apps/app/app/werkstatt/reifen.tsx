/** Werkstatt, Reifeneinlagerung [E]: Ergänzung, Details offen (O-7). */
import { SupplementView } from '../../src/screens/workshop/SupplementView';

export default function TireStorageScreen() {
  return (
    <SupplementView
      title="Reifeneinlagerung"
      icon="Tire"
      code="O-7"
      testID="werkstatt-reifen"
      question="Soll die Einlagerung von Reifen und Rädern in der Software geführt werden?"
      proposal="Nicht umgesetzt; das Datenmodell ist vorbereitet (tire_storage)."
      today={['Räderwechsel laufen als normale Aufträge mit Positionen, Fotos und Rechnung.']}
      open={['Lagerplätze, Einlagerungsschein, Profiltiefe je Rad, Saisonerinnerung und Abholung.', 'Gebühren und Verlängerung der Einlagerung.']}
    />
  );
}
