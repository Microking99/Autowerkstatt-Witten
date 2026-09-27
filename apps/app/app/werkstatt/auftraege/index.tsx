/**
 * Werkstatt, Auftragsliste: Filter Arbeits-, Freigabe-, Zahlungsstatus, Mechaniker,
 * abholbereit und Zeitraum; alle Filter stehen in der URL (Kacheln der Übersicht verlinken
 * direkt, z. B. ?freigabe=pending). Am PC Tabelle mit Sortierung und J/K/Enter.
 */
import {
  approvalOverviewLabels,
  paymentStatusLabels,
  routes,
  workOrderStatusLabels,
  type ApprovalOverviewStatus,
  type PaymentStatus,
  type WorkOrderStatus,
} from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ListWorkOrdersQuery } from '../../../src/data/api';
import { useApiQuery } from '../../../src/data/hooks';
import { formatDate, formatDateTime, keepPlates } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { useBreakpoint } from '../../../src/theme';
import { AppText, Button, DataTable, EmptyState, FilterChips, Page, PageHeader, Row, SearchField, Select, StatusTriple } from '../../../src/ui';

const WORK: Record<string, WorkOrderStatus | 'active' | undefined> = {
  offen: 'active',
  entwurf: 'draft',
  neu: 'open',
  in_arbeit: 'in_progress',
  erledigt: 'work_completed',
  abgeschlossen: 'completed',
  abgeholt: 'picked_up',
  storniert: 'cancelled',
  alle: undefined,
};

const PAYMENT_ALIAS: Record<string, PaymentStatus> = { offen: 'open', teilweise: 'partially_paid', bezahlt: 'paid' };

type Period = 'alle' | 'heute' | 'woche';

export default function WorkOrderList() {
  const params = useLocalSearchParams<{ arbeit?: string; freigabe?: string; zahlung?: string; mechaniker?: string; abholbereit?: string; suche?: string; zeitraum?: string }>();
  const { device } = useBreakpoint();
  const [search, setSearch] = useState(params.suche ?? '');
  const arbeit = params.arbeit && params.arbeit in WORK ? params.arbeit : 'offen';
  const freigabe = (['pending', 'decided', 'none'] as const).includes(params.freigabe as ApprovalOverviewStatus) ? (params.freigabe as ApprovalOverviewStatus) : undefined;
  const zahlung = params.zahlung ? (PAYMENT_ALIAS[params.zahlung] ?? (params.zahlung in paymentStatusLabels ? (params.zahlung as PaymentStatus) : undefined)) : undefined;
  const period: Period = params.zeitraum === 'heute' || params.zeitraum === 'woche' ? params.zeitraum : 'alle';
  const query: ListWorkOrdersQuery = {
    work: WORK[arbeit],
    approval: freigabe,
    payment: zahlung,
    assigneeId: params.mechaniker || undefined,
    readyForPickup: params.abholbereit === 'ja' ? true : undefined,
    q: params.suche || undefined,
  };
  const key = `werkstatt:auftraege:${JSON.stringify(query)}`;
  const list = useApiQuery(key, (api) => api.listWorkOrders(query));
  const all = useApiQuery('werkstatt:auftraege:mitarbeiter', (api) => api.listWorkOrders({ work: 'active' }));
  const mechanics = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of [...(all.data?.items ?? []), ...(list.data?.items ?? [])]) for (const a of o.assignees) map.set(a.userId, a.displayName);
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all.data, list.data]);

  const set = (patch: Record<string, string | undefined>) => router.setParams(patch);
  const now = Date.now();
  const rows = (list.data?.items ?? []).filter((o) => {
    if (period === 'alle') return true;
    const ref = Date.parse(o.plannedStart ?? o.updatedAt);
    const days = period === 'heute' ? 1 : 7;
    return Math.abs(ref - now) <= days * 86_400_000;
  });
  const activeFilters = [freigabe, zahlung, params.mechaniker, params.abholbereit, params.suche, period !== 'alle' ? period : undefined].filter(Boolean).length + (arbeit !== 'offen' ? 1 : 0);

  return (
    <Page maxWidth={1280} testID="werkstatt-auftraege">
      <PageHeader
        title="Aufträge"
        subtitle={list.data ? `${rows.length} ${rows.length === 1 ? 'Auftrag' : 'Aufträge'}` : undefined}
        crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Aufträge' }]}
        actions={<Button label="Auftrag anlegen" icon="Plus" variant="primary" onPress={() => router.push(routes.workshop.newWorkOrder() as Href)} testID="auftrag-anlegen" />}
      />
      <View style={styles.filters}>
        <View style={styles.search}>
          <SearchField
            value={search}
            onChangeText={(v) => {
              setSearch(v);
              set({ suche: v.trim() || undefined });
            }}
            label="Aufträge durchsuchen"
            placeholder="Auftragsnummer oder Arbeit"
          />
        </View>
        <FilterChips
          label="Arbeitsstatus"
          value={arbeit}
          onChange={(v) => set({ arbeit: v })}
          options={[
            { value: 'offen', label: 'Laufend' },
            { value: 'entwurf', label: workOrderStatusLabels.draft.label },
            { value: 'erledigt', label: workOrderStatusLabels.work_completed.label },
            { value: 'abgeschlossen', label: workOrderStatusLabels.completed.label },
            { value: 'abgeholt', label: workOrderStatusLabels.picked_up.label },
            { value: 'storniert', label: workOrderStatusLabels.cancelled.label },
            { value: 'alle', label: 'Alle' },
          ]}
        />
        <Row wrap gap={12}>
          <View style={styles.select}>
            <Select
              label="Freigabe"
              value={freigabe ?? 'alle'}
              onChange={(v) => set({ freigabe: v === 'alle' ? undefined : v })}
              options={[{ value: 'alle', label: 'Alle' }, ...(['pending', 'decided', 'none'] as const).map((s) => ({ value: s, label: approvalOverviewLabels[s].label }))]}
              testID="filter-freigabe"
            />
          </View>
          <View style={styles.select}>
            <Select
              label="Zahlung"
              value={zahlung ?? 'alle'}
              onChange={(v) => set({ zahlung: v === 'alle' ? undefined : v })}
              options={[{ value: 'alle', label: 'Alle' }, ...(Object.keys(paymentStatusLabels) as PaymentStatus[]).map((s) => ({ value: s, label: paymentStatusLabels[s].label }))]}
              testID="filter-zahlung"
            />
          </View>
          <View style={styles.select}>
            <Select
              label="Mechaniker"
              value={params.mechaniker ?? 'alle'}
              onChange={(v) => set({ mechaniker: v === 'alle' ? undefined : v })}
              options={[{ value: 'alle', label: 'Alle' }, ...mechanics]}
              testID="filter-mechaniker"
            />
          </View>
          <View style={styles.select}>
            <Select
              label="Zeitraum (geplant bzw. geändert)"
              value={period}
              onChange={(v) => set({ zeitraum: v === 'alle' ? undefined : v })}
              options={[
                { value: 'alle', label: 'Alle' },
                { value: 'heute', label: 'Heute' },
                { value: 'woche', label: '7 Tage' },
              ]}
            />
          </View>
        </Row>
        <Row wrap>
          <FilterChips
            label="Abholbereit"
            value={params.abholbereit === 'ja' ? 'ja' : 'alle'}
            onChange={(v) => set({ abholbereit: v === 'ja' ? 'ja' : undefined })}
            options={[
              { value: 'alle', label: 'Alle' },
              { value: 'ja', label: 'Nur abholbereit' },
            ]}
          />
          {activeFilters > 0 ? (
            <Button
              label="Filter zurücksetzen"
              variant="quiet"
              icon="X"
              onPress={() => {
                setSearch('');
                set({ arbeit: undefined, freigabe: undefined, zahlung: undefined, mechaniker: undefined, abholbereit: undefined, suche: undefined, zeitraum: undefined });
              }}
            />
          ) : null}
        </Row>
      </View>
      <QueryView query={list}>
        {() =>
          rows.length === 0 ? (
            <EmptyState
              icon="ClipboardText"
              title="Keine Aufträge für diese Filter"
              message="Filter ändern oder einen neuen Auftrag anlegen."
              action={<Button label="Auftrag anlegen" icon="Plus" onPress={() => router.push(routes.workshop.newWorkOrder() as Href)} />}
            />
          ) : (
            <DataTable
              label="Aufträge"
              keyboardNav
              rows={rows}
              rowKey={(o) => o.id}
              rowTestID={(o) => `auftrag-${o.orderNumber}`}
              onRowPress={(o) => router.push(routes.workshop.workOrder(o.id) as Href)}
              mobileTitle={(o) => `${o.orderNumber}: ${o.title}`}
              mobileSubtitle={(o) => `${o.customerDisplayName}, ${keepPlates(o.licensePlate)}`}
              mobileMeta={(o) => (o.plannedStart ? `Geplant ${formatDateTime(o.plannedStart)}` : `Geändert ${formatDate(o.updatedAt)}`)}
              mobileRight={(o) => (device === 'phone' ? <StatusTriple status={o.status} compact /> : null)}
              columns={[
                { key: 'nr', header: 'Auftrag', render: (o) => <AppText variant="bodyStrong" numeric numberOfLines={1}>{o.orderNumber}</AppText>, sortValue: (o) => o.orderNumber, width: 128, flex: 0 },
                {
                  key: 'kunde',
                  header: 'Kunde, Fahrzeug',
                  render: (o) => (
                    <View>
                      <AppText numberOfLines={2}>{o.customerDisplayName}</AppText>
                      <AppText variant="small" tone="muted" code>
                        {keepPlates(o.licensePlate)}
                      </AppText>
                    </View>
                  ),
                  sortValue: (o) => o.customerDisplayName,
                  flex: 1.5,
                },
                { key: 'titel', header: 'Arbeit', render: (o) => <AppText numberOfLines={2}>{o.title}</AppText>, sortValue: (o) => o.title, flex: 1.5 },
                { key: 'mech', header: 'Mechaniker', render: (o) => <AppText variant="small" numberOfLines={2}>{o.assignees.map((a) => a.displayName).join(', ') || 'Nicht zugewiesen'}</AppText>, flex: 1 },
                { key: 'plan', header: 'Geplant', render: (o) => <AppText variant="small" numeric>{o.plannedStart ? formatDateTime(o.plannedStart) : 'offen'}</AppText>, sortValue: (o) => o.plannedStart ?? '9999', flex: 1 },
                { key: 'status', header: 'Arbeit, Freigabe, Zahlung', render: (o) => <StatusTriple status={o.status} compact />, flex: 3 },
              ]}
            />
          )
        }
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 12 },
  search: { maxWidth: 520 },
  select: { minWidth: 200, flexGrow: 1, flexBasis: 200 },
});
