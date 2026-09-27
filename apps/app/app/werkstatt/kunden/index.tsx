/**
 * Werkstatt, Kundenliste: Suche (Name, Telefon, E-Mail, Kennzeichen), Filter App-Zugang und
 * offene Posten (in der URL). Neu; Zeile → Kundenakte. Kundendatensatz ist nicht gleich
 * Kundenkonto: Viele Kunden haben keinen App-Zugang.
 */
import { routes, type CustomerAccessStatus } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApiQuery } from '../../../src/data/hooks';
import { QueryView } from '../../../src/screens/common';
import { customerAccessLabels } from '../../../src/screens/workshop/shared';
import { AppText, Button, DataTable, EmptyState, FilterChips, Page, PageHeader, Row, SearchField, StatusChip } from '../../../src/ui';

const ACCESS = ['alle', 'none', 'invited', 'active', 'disabled'] as const;

export default function CustomerList() {
  const params = useLocalSearchParams<{ suche?: string; zugang?: string; offen?: string }>();
  const [search, setSearch] = useState(params.suche ?? '');
  const [q, setQ] = useState(params.suche ?? '');
  const zugang = (ACCESS as readonly string[]).includes(params.zugang ?? '') ? (params.zugang as (typeof ACCESS)[number]) : 'alle';
  const offen = params.offen === 'ja';

  // Suche kurz verzögert an die API geben und in der URL halten
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      router.setParams({ suche: search.trim() || undefined });
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = { q: q || undefined, access: zugang === 'alle' ? undefined : (zugang as CustomerAccessStatus), openItems: offen || undefined };
  const list = useApiQuery(`werkstatt:kunden:${JSON.stringify(query)}`, (api) => api.listCustomers(query));

  return (
    <Page maxWidth={1200} testID="werkstatt-kunden">
      <PageHeader
        title="Kunden"
        subtitle={list.data ? `${list.data.items.length} Kunden` : undefined}
        crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Kunden' }]}
        actions={<Button label="Kunde anlegen" variant="primary" icon="UserPlus" onPress={() => router.push(routes.workshop.newCustomer() as Href)} testID="kunde-anlegen" />}
      />
      <View style={styles.filters}>
        <View style={styles.search}>
          <SearchField value={search} onChangeText={setSearch} label="Kunden suchen" placeholder="Name, Telefon, E-Mail oder Kennzeichen" />
        </View>
        <FilterChips
          label="App-Zugang"
          value={zugang}
          onChange={(v) => router.setParams({ zugang: v === 'alle' ? undefined : v })}
          options={[
            { value: 'alle', label: 'Alle' },
            { value: 'none', label: 'Ohne App-Zugang' },
            { value: 'invited', label: 'Eingeladen' },
            { value: 'active', label: 'App aktiv' },
            { value: 'disabled', label: 'Gesperrt' },
          ]}
        />
        <FilterChips
          label="Offene Posten"
          value={offen ? 'ja' : 'alle'}
          onChange={(v) => router.setParams({ offen: v === 'ja' ? 'ja' : undefined })}
          options={[
            { value: 'alle', label: 'Alle' },
            { value: 'ja', label: 'Mit offenen Rechnungen' },
          ]}
        />
      </View>
      <QueryView query={list}>
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState icon="Users" title="Keine Kunden gefunden" message="Suchbegriff oder Filter ändern, oder den Kunden neu anlegen." action={<Button label="Kunde anlegen" icon="UserPlus" onPress={() => router.push(routes.workshop.newCustomer() as Href)} />} />
          ) : (
            <DataTable
              label="Kunden"
              keyboardNav
              rows={page.items}
              rowKey={(c) => c.id}
              rowTestID={(c) => `kunde-${c.customerNumber}`}
              onRowPress={(c) => router.push(routes.workshop.customer(c.id) as Href)}
              mobileTitle={(c) => c.displayName}
              mobileSubtitle={(c) => [c.phone, c.email].filter(Boolean).join(', ') || 'keine Kontaktdaten'}
              mobileMeta={(c) => `${c.customerNumber}, ${c.vehicleCount} ${c.vehicleCount === 1 ? 'Fahrzeug' : 'Fahrzeuge'}${c.openInvoiceCount ? `, ${c.openInvoiceCount} offen` : ''}`}
              mobileRight={(c) => <StatusChip status={customerAccessLabels[c.accessStatus]} />}
              columns={[
                { key: 'nr', header: 'Kundennr.', render: (c) => <AppText numeric numberOfLines={1}>{c.customerNumber}</AppText>, sortValue: (c) => c.customerNumber, width: 110 },
                {
                  key: 'name',
                  header: 'Name',
                  render: (c) => (
                    <View>
                      <AppText variant="bodyStrong">{c.displayName}</AppText>
                      {c.isTestData ? <AppText variant="small" tone="subtle">Beispieldaten</AppText> : null}
                    </View>
                  ),
                  sortValue: (c) => c.displayName,
                  flex: 1.6,
                },
                { key: 'kontakt', header: 'Kontakt', render: (c) => <View><AppText variant="small">{c.phone ?? 'kein Telefon'}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{c.email ?? 'keine E-Mail'}</AppText></View>, flex: 1.8 },
                { key: 'fz', header: 'Fahrzeuge', render: (c) => <AppText numeric>{c.vehicleCount}</AppText>, sortValue: (c) => c.vehicleCount, flex: 0.7 },
                { key: 'offen', header: 'Offene Rechnungen', render: (c) => <AppText numeric tone={c.openInvoiceCount ? 'warning' : 'muted'}>{c.openInvoiceCount ?? 0}</AppText>, sortValue: (c) => c.openInvoiceCount ?? 0, flex: 0.9 },
                { key: 'zugang', header: 'App-Zugang', render: (c) => <StatusChip status={customerAccessLabels[c.accessStatus]} />, sortValue: (c) => c.accessStatus, flex: 1.3 },
              ]}
            />
          )
        }
      </QueryView>
      <Row>
        <AppText variant="small" tone="subtle">Tasten J und K wählen einen Kunden, Enter öffnet die Akte.</AppText>
      </Row>
    </Page>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 12 },
  search: { maxWidth: 560 },
});
