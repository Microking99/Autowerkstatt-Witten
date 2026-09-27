/**
 * Mechaniker, Abschlusscheckliste [E]: einfache Liste zum Abhaken, ohne Pflichtpunkte (O-10).
 * Ergänzung: Die Liste wird nur auf diesem Gerät gespeichert; die API hat dafür (noch) keinen
 * Endpunkt, sie blockiert keinen Abschluss und gilt nicht als Nachweis.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSession } from '../../../../src/auth/session';
import { newClientId } from '../../../../src/lib/pickImage';
import { Banner, Button, Checkbox, Page, PageHeader, Row, Section, StatusChip, TextField } from '../../../../src/ui';

interface Point {
  id: string;
  label: string;
  done: boolean;
}

const DEFAULTS = [
  'Radschrauben mit Drehmoment angezogen',
  'Füllstände geprüft (Öl, Kühlmittel, Bremsflüssigkeit)',
  'Kein Werkzeug und keine Lappen im Motorraum',
  'Keine Warnleuchten im Kombiinstrument',
  'Schutzabdeckungen entfernt, Fahrzeug sauber',
  'Probefahrt gemacht (wenn nötig)',
];

export default function ChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id);
  const { user } = useSession();
  const key = `werkstatt.checkliste.v1:${user?.id ?? 'unbekannt'}:${orderId}`;
  const [points, setPoints] = useState<Point[] | null>(null);
  const [extra, setExtra] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(key)
      .then((raw) => setPoints(raw ? (JSON.parse(raw) as Point[]) : DEFAULTS.map((label) => ({ id: newClientId(), label, done: false }))))
      .catch(() => setPoints(DEFAULTS.map((label) => ({ id: newClientId(), label, done: false }))));
  }, [key]);
  useEffect(() => {
    if (points) void AsyncStorage.setItem(key, JSON.stringify(points)).catch(() => undefined);
  }, [points, key]);

  const done = points?.filter((p) => p.done).length ?? 0;
  return (
    <Page maxWidth={760} testID="mechaniker-checkliste">
      <PageHeader
        title="Abschlusscheckliste"
        subtitle={points ? `${done} von ${points.length} erledigt` : undefined}
        backHref={routes.mechanic.workOrder(orderId) as Href}
        backLabel="Auftrag"
        meta={<StatusChip status={{ label: 'Ergänzung, nur auf diesem Gerät', tone: 'warning', icon: 'HourglassMedium' }} />}
      />
      <Banner tone="info" message="Die Checkliste hilft beim Abschluss, hat keine Pflichtpunkte und wird nicht übertragen (offene Entscheidung O-10). Den Abschluss der Positionen erfassen Sie wie gewohnt." />
      <Section title="Punkte">
        {(points ?? []).map((p) => (
          <Checkbox key={p.id} label={p.label} checked={p.done} onChange={(v) => setPoints((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, done: v } : x)))} testID={`punkt-${p.id}`} />
        ))}
      </Section>
      <Row wrap gap={12} style={{ alignItems: 'flex-end' }}>
        <TextField label="Eigener Punkt" value={extra} onChangeText={setExtra} />
        <Button
          label="Hinzufügen"
          icon="Plus"
          disabled={!extra.trim()}
          onPress={() => {
            setPoints((l) => [...(l ?? []), { id: newClientId(), label: extra.trim(), done: false }]);
            setExtra('');
          }}
        />
      </Row>
      <Row wrap>
        <Button label="Alle zurücksetzen" onPress={() => setPoints((l) => (l ?? []).map((x) => ({ ...x, done: false })))} />
        <Button label="Zum Auftrag" variant="primary" size="lg" onPress={() => router.replace(routes.mechanic.workOrder(orderId) as Href)} />
      </Row>
    </Page>
  );
}
