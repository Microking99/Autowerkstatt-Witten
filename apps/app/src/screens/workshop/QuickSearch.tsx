/**
 * Schnellsuche der Werkstatt (Strg+K): Kunde (Name, Telefon, E-Mail, Kennzeichen), Fahrzeug
 * (Kennzeichen, FIN) und Auftragsnummer. Enter öffnet den ersten Treffer, Esc schließt.
 */
import { routes, type CustomerSummary, type VehicleSummary, type WorkOrderSummary } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useApi } from '../../data/ApiProvider';
import { keepPlates } from '../../lib/format';
import { platformFont, useTheme } from '../../theme';
import { AppText, EmptyState, Icon, iconSize, ListGroup, ListRow, LoadingState, Sheet, StatusTriple } from '../../ui';

interface Results {
  customers: CustomerSummary[];
  vehicles: VehicleSummary[];
  orders: WorkOrderSummary[];
}

type Hit = { key: string; href: string };

export function QuickSearch({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const api = useApi();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<TextInput>(null);
  const request = useRef(0);

  useEffect(() => {
    if (!visible) {
      setQ('');
      setResults(null);
      return;
    }
    const timer = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.all([api.listCustomers({ q: term }), api.listVehicles({ q: term }), api.listWorkOrders({ q: term })])
        .then(([c, v, o]) => {
          if (id !== request.current) return;
          setResults({ customers: c.items.slice(0, 5), vehicles: v.items.slice(0, 5), orders: o.items.slice(0, 5) });
          setFailed(false);
        })
        .catch(() => id === request.current && setFailed(true))
        .finally(() => id === request.current && setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, api]);

  const hits: Hit[] = results
    ? [
        ...results.orders.map((o) => ({ key: `o-${o.id}`, href: routes.workshop.workOrder(o.id) })),
        ...results.customers.map((c) => ({ key: `c-${c.id}`, href: routes.workshop.customer(c.id) })),
        ...results.vehicles.map((v) => ({ key: `v-${v.id}`, href: routes.workshop.vehicle(v.id) })),
      ]
    : [];

  const open = (href: string) => {
    onClose();
    router.push(href as Href);
  };

  const total = hits.length;
  return (
    <Sheet visible={visible} onClose={onClose} title="Schnellsuche" width={680} testID="schnellsuche">
      <View style={[styles.field, { borderColor: t.colors.accent, borderRadius: t.radius.control, backgroundColor: t.colors.surface }]}>
        <Icon name="MagnifyingGlass" size={iconSize.md} color={t.colors.textSubtle} />
        <TextInput
          ref={input}
          value={q}
          onChangeText={setQ}
          accessibilityLabel="Suchbegriff: Kunde, Telefon, E-Mail, Kennzeichen, FIN oder Auftragsnummer"
          placeholder="Name, Telefon, Kennzeichen, FIN, Auftragsnummer"
          placeholderTextColor={t.colors.textSubtle}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          onSubmitEditing={() => hits[0] && open(hits[0].href)}
          testID="schnellsuche-eingabe"
          style={[styles.input, platformFont, t.typography.body, { color: t.colors.text }]}
        />
      </View>
      <AppText variant="small" tone="subtle" role="status" accessibilityLiveRegion="polite">
        {q.trim().length < 2 ? 'Mindestens zwei Zeichen eingeben. Enter öffnet den ersten Treffer, Esc schließt.' : loading ? 'Suche läuft' : failed ? 'Die Suche ist fehlgeschlagen. Bitte erneut versuchen.' : `${total} Treffer`}
      </AppText>
      {loading && !results ? <LoadingState rows={3} /> : null}
      {results && total === 0 && !loading ? <EmptyState icon="MagnifyingGlass" title="Nichts gefunden" message="Anderen Suchbegriff versuchen, zum Beispiel nur das Kennzeichen ohne Leerzeichen." /> : null}
      {results && results.orders.length > 0 ? (
        <Group title="Aufträge">
          {results.orders.map((o, i) => (
            <ListRow key={o.id} first={i === 0} icon="ClipboardText" title={`${o.orderNumber}: ${o.title}`} subtitle={`${o.customerDisplayName}, ${keepPlates(o.licensePlate)}`} onPress={() => open(routes.workshop.workOrder(o.id))} testID={`treffer-auftrag-${o.orderNumber}`}>
              <StatusTriple status={o.status} compact />
            </ListRow>
          ))}
        </Group>
      ) : null}
      {results && results.customers.length > 0 ? (
        <Group title="Kunden">
          {results.customers.map((c, i) => (
            <ListRow key={c.id} first={i === 0} icon="UserCircle" title={c.displayName} subtitle={[c.customerNumber, c.phone, c.email].filter(Boolean).join(', ')} onPress={() => open(routes.workshop.customer(c.id))} testID={`treffer-kunde-${c.customerNumber}`} />
          ))}
        </Group>
      ) : null}
      {results && results.vehicles.length > 0 ? (
        <Group title="Fahrzeuge">
          {results.vehicles.map((v, i) => (
            <ListRow key={v.id} first={i === 0} icon="Car" title={`${keepPlates(v.licensePlate)}, ${v.make} ${v.model}`} subtitle={[v.currentOwner?.displayName, v.vin ? `FIN ${v.vin}` : null].filter(Boolean).join(', ')} onPress={() => open(routes.workshop.vehicle(v.id))} testID={`treffer-fahrzeug-${v.id}`} />
          ))}
        </Group>
      ) : null}
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="caption" tone="muted" aria-level={2} accessibilityRole="header">
        {title}
      </AppText>
      <ListGroup>{children}</ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, paddingHorizontal: 12, minHeight: 52 },
  input: { flex: 1, minHeight: 48, minWidth: 0 },
  group: { gap: 8 },
});
