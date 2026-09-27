/**
 * Werkstatt, Kalender: Tag oder Woche, gruppiert nach Hebebühne oder Mitarbeiter. Konflikte
 * (Doppelbelegung, fehlende Teile, außerhalb der Arbeits- bzw. Öffnungszeit) sind markiert,
 * immer mit Text und Symbol. Freie Zeit → Termin anlegen; Termin → Detail.
 * Ansicht, Datum und Gruppierung stehen in der URL.
 */
import { appointmentKindLabels, appointmentStatusLabels, routes, toQuery, type Appointment, type Resource, type SchedulingConflict } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useApiQuery } from '../../../src/data/hooks';
import { formatDate, formatTime, keepPlates, weekday } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { addDays, fromDateParam, hoursOf, sameDay, startOfWeek, toDateParam } from '../../../src/screens/workshop/calendarDates';
import { conflictLabels, resourceKindLabels, useCan } from '../../../src/screens/workshop/shared';
import { useStaffDirectory } from '../../../src/screens/workshop/staff';
import { useBreakpoint, useTheme } from '../../../src/theme';
import { AppText, Button, EmptyState, Icon, iconSize, ListGroup, ListRow, Page, PageHeader, Row, SegmentedControl, StatusChip, useHotkeys } from '../../../src/ui';

type PressState = PressableStateCallbackType & { hovered?: boolean };
type View_ = 'tag' | 'woche';
type Group = 'buehne' | 'mitarbeiter';

const START_HOUR = 7;
const END_HOUR = 19;
const HOUR_PX = 56;

interface Column {
  key: string;
  label: string;
  /** Art der Ressource, nur wenn der Name sie nicht schon nennt */
  hint?: string;
  match: (a: Appointment) => boolean;
  newParams: Record<string, string>;
}

export default function CalendarScreen() {
  const t = useTheme();
  const can = useCan();
  const { device } = useBreakpoint();
  const phone = device === 'phone';
  const params = useLocalSearchParams<{ ansicht?: string; datum?: string; gruppe?: string }>();
  const view: View_ = params.ansicht === 'woche' ? 'woche' : 'tag';
  const group: Group = params.gruppe === 'mitarbeiter' ? 'mitarbeiter' : 'buehne';
  const day = fromDateParam(params.datum, new Date());
  const from = view === 'woche' ? startOfWeek(day) : day;
  const to = view === 'woche' ? addDays(from, 6) : day;
  const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
  const { staff } = useStaffDirectory();

  const query = useApiQuery(`werkstatt:kalender:${toDateParam(from)}:${view}`, async (api) => {
    const [appointments, resources, requests] = await Promise.all([
      api.listAppointments({ from: from.toISOString(), to: toEnd.toISOString() }),
      api.listResources(),
      api.listAppointments({ status: 'requested' }),
    ]);
    const visible = appointments.filter((a) => a.status !== 'cancelled');
    // Konflikte je Termin (nur mit Terminrecht; bei fehlendem Recht ohne Markierung)
    const conflicts = new Map<string, SchedulingConflict[]>();
    await Promise.all(
      visible.slice(0, 60).map(async (a) => {
        try {
          const c = await api.checkConflicts({ id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, resourceId: a.resourceId ?? null, assigneeIds: a.assigneeIds ?? [], workOrderId: a.workOrderId });
          if (c.length > 0) conflicts.set(a.id, c);
        } catch {
          // ohne Recht keine Konfliktprüfung
        }
      }),
    );
    return { appointments: visible, resources: resources.filter((r) => r.active), conflicts, requests: requests.length };
  });

  const set = (patch: Record<string, string | undefined>) => router.setParams(patch);
  const go = (d: Date) => set({ datum: toDateParam(d) });
  const step = view === 'woche' ? 7 : 1;
  useHotkeys({ arrowleft: () => go(addDays(day, -step)), arrowright: () => go(addDays(day, step)), t: () => go(new Date()) });

  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.displayName])), [staff]);

  return (
    <Page maxWidth={1400} testID="werkstatt-kalender">
      <PageHeader
        title="Kalender"
        subtitle={view === 'woche' ? `Woche vom ${formatDate(from)} bis ${formatDate(to)}` : `${weekday(day)}, ${formatDate(day)}`}
        crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Kalender' }]}
        actions={
          <>
            <Button label={`Anfragen${query.data?.requests ? ` (${query.data.requests})` : ''}`} icon="CalendarPlus" onPress={() => router.push(routes.workshop.appointmentRequests() as Href)} testID="kalender-anfragen" />
            {can('appointments.write') ? <Button label="Termin anlegen" variant="primary" icon="Plus" onPress={() => router.push(`${routes.workshop.newAppointment()}?start=${encodeURIComponent(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8).toISOString())}` as Href)} testID="termin-anlegen" /> : null}
          </>
        }
      />
      <Row wrap gap={12} style={styles.toolbar}>
        <Row gap={8} wrap style={styles.navRow}>
          <Button label={view === 'woche' ? (phone ? 'Vorwoche' : 'Vorige Woche') : 'Vortag'} icon="CaretLeft" onPress={() => go(addDays(day, -step))} accessibilityHint="Pfeiltaste links" />
          <Button label="Heute" onPress={() => go(new Date())} accessibilityHint="Taste T" />
          <Button label={view === 'woche' ? (phone ? 'Folgewoche' : 'Nächste Woche') : phone ? 'Folgetag' : 'Nächster Tag'} iconRight="CaretRight" onPress={() => go(addDays(day, step))} accessibilityHint="Pfeiltaste rechts" />
        </Row>
        <View style={styles.segment}>
          <SegmentedControl label="Zeitraum" value={view} onChange={(v) => set({ ansicht: v })} options={[{ value: 'tag', label: 'Tag' }, { value: 'woche', label: 'Woche' }]} />
        </View>
        <View style={styles.segment}>
          <SegmentedControl label="Gruppierung" value={group} onChange={(v) => set({ gruppe: v })} options={[{ value: 'buehne', label: 'Hebebühne' }, { value: 'mitarbeiter', label: 'Mitarbeiter' }]} />
        </View>
      </Row>
      {phone ? null : <Legend />}
      <QueryView query={query} loading="cards">
        {({ appointments, resources, conflicts }) => {
          const columns: Column[] =
            group === 'buehne'
              ? [
                  ...resources.map((r: Resource) => ({ key: r.id, label: r.name, hint: r.name.toLowerCase().includes(resourceKindLabels[r.kind].toLowerCase()) ? undefined : resourceKindLabels[r.kind], match: (a: Appointment) => a.resourceId === r.id, newParams: { buehne: r.id } })),
                  { key: 'ohne', label: 'Ohne Bühne', match: (a: Appointment) => !a.resourceId, newParams: {} },
                ]
              : [
                  ...[...new Set(appointments.flatMap((a) => a.assigneeIds ?? []))].map((id) => ({ key: id, label: nameOf.get(id) ?? 'Mitarbeiter', match: (a: Appointment) => (a.assigneeIds ?? []).includes(id), newParams: { mitarbeiter: id } })),
                  { key: 'ohne', label: 'Nicht zugewiesen', match: (a: Appointment) => (a.assigneeIds ?? []).length === 0, newParams: {} },
                ];
          if (view === 'woche' || device === 'phone') {
            // Sonntag nur, wenn dort Termine liegen (Werkstatt geschlossen)
            const sunday = addDays(from, 6);
            const weekLength = appointments.some((a) => sameDay(new Date(a.startsAt), sunday)) ? 7 : 6;
            const days = view === 'woche' ? Array.from({ length: weekLength }, (_, i) => addDays(from, i)) : [day];
            return <DayLists days={days} appointments={appointments} conflicts={conflicts} columns={columns} nameOf={nameOf} />;
          }
          return <DayGrid day={day} appointments={appointments} conflicts={conflicts} columns={columns} nameOf={nameOf} canCreate={can('appointments.write')} />;
        }}
      </QueryView>
    </Page>
  );
}

function Legend() {
  const t = useTheme();
  return (
    <View style={styles.legend} accessibilityLabel="Legende der Konfliktmarkierungen">
      {(['resource_double_booked', 'assignee_double_booked', 'parts_missing', 'outside_working_hours'] as const).map((k) => (
        <StatusChip key={k} status={conflictLabels[k]} />
      ))}
      <AppText variant="small" tone="subtle" style={{ alignSelf: 'center', color: t.colors.textSubtle }}>
        Pfeiltasten wechseln den Tag, T springt zu heute.
      </AppText>
    </View>
  );
}

function AppointmentBlock({ a, conflicts, nameOf, compact }: { a: Appointment; conflicts: SchedulingConflict[]; nameOf: Map<string, string>; compact?: boolean }) {
  const t = useTheme();
  const hasConflict = conflicts.length > 0;
  const severe = conflicts.some((c) => c.kind.endsWith('double_booked'));
  const tone = a.status === 'confirmed' ? t.colors.accent : a.status === 'requested' || a.status === 'proposed' ? t.colors.warning : t.colors.borderStrong;
  const names = (a.assigneeIds ?? []).map((id) => nameOf.get(id) ?? 'Mitarbeiter').join(', ');
  const label = `${formatTime(a.startsAt)} bis ${formatTime(a.endsAt)} Uhr, ${appointmentKindLabels[a.kind]}, ${a.customerDisplayName}, ${keepPlates(a.vehicleLabel)}, ${appointmentStatusLabels[a.status].label}${hasConflict ? `, Konflikt: ${conflicts.map((c) => conflictLabels[c.kind].label).join(', ')}` : ''}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => router.push(routes.workshop.appointment(a.id) as Href)}
      testID={`termin-${a.id}`}
      style={(s: PressState) => [
        styles.block,
        {
          backgroundColor: hasConflict ? t.colors.dangerSoft : t.colors.surface,
          borderColor: hasConflict ? t.colors.danger : t.colors.border,
          borderLeftColor: hasConflict ? t.colors.danger : tone,
          borderRadius: t.radius.control,
        },
        s.hovered ? { borderColor: t.colors.accent } : null,
        s.pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <AppText variant="small" numeric style={[styles.noShrink, { fontWeight: '600' }]} numberOfLines={1}>
        {formatTime(a.startsAt)}-{formatTime(a.endsAt)} {appointmentKindLabels[a.kind]}
      </AppText>
      <AppText variant="small" style={styles.noShrink} numberOfLines={compact ? 1 : 2}>
        {a.customerDisplayName}, {keepPlates(a.vehicleLabel)}
      </AppText>
      {!compact && names ? (
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {names}
        </AppText>
      ) : null}
      {a.status !== 'confirmed' ? (
        <AppText variant="caption" tone={a.status === 'requested' || a.status === 'proposed' ? 'warning' : 'muted'}>
          {appointmentStatusLabels[a.status].label}
        </AppText>
      ) : null}
      {compact && conflicts.length > 1 ? (
        // Schmal: eine Zeile mit Anzahl; die einzelnen Konflikte stehen im Termin
        <View style={styles.conflict}>
          <Icon name="Warning" size={iconSize.sm} color={severe ? t.colors.danger : t.colors.warning} />
          <AppText variant="caption" style={styles.conflictText} numberOfLines={1}>
            {conflicts.length} Konflikte
          </AppText>
        </View>
      ) : (
        conflicts.map((c, i) => (
          <View key={`${c.kind}-${i}`} style={styles.conflict}>
            <Icon name={conflictLabels[c.kind].icon} size={iconSize.sm} color={c.kind.endsWith('double_booked') ? t.colors.danger : t.colors.warning} />
            <AppText variant="caption" style={styles.conflictText} numberOfLines={compact ? 1 : 2}>
              {conflictLabels[c.kind].label}
            </AppText>
          </View>
        ))
      )}
    </Pressable>
  );
}

function DayGrid({ day, appointments, conflicts, columns, nameOf, canCreate }: { day: Date; appointments: Appointment[]; conflicts: Map<string, SchedulingConflict[]>; columns: Column[]; nameOf: Map<string, string>; canCreate: boolean }) {
  const t = useTheme();
  const todays = appointments.filter((a) => sameDay(new Date(a.startsAt), day));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const height = (END_HOUR - START_HOUR) * HOUR_PX;
  if (todays.length === 0 && !canCreate) return <EmptyState icon="CalendarBlank" title="Keine Termine an diesem Tag" />;
  return (
    <View style={[styles.grid, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID="kalender-tag">
      <View style={[styles.gridHead, { borderBottomColor: t.colors.border }]}>
        <View style={styles.timeCol} />
        {columns.map((c) => (
          <View key={c.key} style={styles.col}>
            <AppText variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
              {c.label}
            </AppText>
            {c.hint ? (
              <AppText variant="caption" tone="subtle" numberOfLines={1}>
                {c.hint}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
      <View style={[styles.gridBody, { height }]}>
        <View style={styles.timeCol}>
          {hours.map((h) => (
            <View key={h} style={[styles.hourLabel, { height: HOUR_PX }]}>
              <AppText variant="caption" tone="subtle" numeric>
                {String(h).padStart(2, '0')}:00
              </AppText>
            </View>
          ))}
        </View>
        {columns.map((c) => {
          const placed = layoutLanes(todays.filter(c.match));
          return (
            <View key={c.key} style={[styles.col, { borderLeftColor: t.colors.border }]}>
              {hours.map((h) => (
                <Pressable
                  key={h}
                  accessibilityRole="button"
                  accessibilityLabel={`Termin anlegen ${String(h).padStart(2, '0')}:00 Uhr, ${c.label}`}
                  disabled={!canCreate}
                  onPress={() => {
                    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h);
                    router.push(`${routes.workshop.newAppointment()}${toQuery({ start: start.toISOString(), ...c.newParams })}` as Href);
                  }}
                  style={(s: PressState) => [styles.slot, { height: HOUR_PX, borderTopColor: t.colors.border }, s.hovered && canCreate ? { backgroundColor: t.colors.accentSoft } : null]}
                />
              ))}
              {placed.map(({ a, lane, lanes }) => {
                const top = Math.max(0, (hoursOf(a.startsAt) - START_HOUR) * HOUR_PX);
                const bottom = Math.min(height, (hoursOf(a.endsAt) - START_HOUR) * HOUR_PX);
                return (
                  <View key={a.id} style={[styles.abs, { top, height: Math.max(40, bottom - top), left: `${(lane / lanes) * 100}%`, width: `${100 / lanes}%` }]}>
                    <AppointmentBlock a={a} conflicts={conflicts.get(a.id) ?? []} nameOf={nameOf} compact={bottom - top < 90 || lanes > 1} />
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Überlappende Termine nebeneinander (Doppelbelegung sichtbar). Nur Termine, die sich
 * tatsächlich überschneiden, teilen sich die Breite; alle anderen nutzen die volle Spalte.
 */
function layoutLanes(items: Appointment[]): { a: Appointment; lane: number; lanes: number }[] {
  const sorted = [...items].sort((x, y) => (x.startsAt < y.startsAt ? -1 : x.startsAt > y.startsAt ? 1 : x.endsAt < y.endsAt ? 1 : -1));
  const out: { a: Appointment; lane: number; lanes: number }[] = [];
  let cluster: { a: Appointment; lane: number }[] = [];
  let laneEnds: string[] = [];
  let clusterEnd = '';
  const close = () => {
    for (const c of cluster) out.push({ ...c, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const a of sorted) {
    if (cluster.length > 0 && a.startsAt >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= a.startsAt);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(a.endsAt);
    } else laneEnds[lane] = a.endsAt;
    cluster.push({ a, lane });
    clusterEnd = cluster.length === 1 || a.endsAt > clusterEnd ? a.endsAt : clusterEnd;
  }
  close();
  return out;
}

function DayLists({ days, appointments, conflicts, columns, nameOf }: { days: Date[]; appointments: Appointment[]; conflicts: Map<string, SchedulingConflict[]>; columns: Column[]; nameOf: Map<string, string> }) {
  const { device } = useBreakpoint();
  return (
    <View style={[styles.week, device === 'desktop' ? styles.weekRow : null]} testID="kalender-liste">
      {days.map((d) => {
        const items = appointments.filter((a) => sameDay(new Date(a.startsAt), d)).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
        return (
          <View key={toDateParam(d)} style={device === 'desktop' ? styles.weekDay : styles.phoneDay}>
            <AppText variant="bodyStrong">
              {weekday(d, true)}, {formatDate(d)}
            </AppText>
            {items.length === 0 ? (
              <AppText variant="small" tone="subtle">
                Keine Termine
              </AppText>
            ) : device === 'desktop' ? (
              items.map((a) => (
                <View key={a.id} style={styles.weekItem}>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {columns.filter((c) => c.key !== 'ohne' && c.match(a)).map((c) => c.label).join(', ') || 'ohne Zuordnung'}
                  </AppText>
                  <AppointmentBlock a={a} conflicts={conflicts.get(a.id) ?? []} nameOf={nameOf} />
                </View>
              ))
            ) : (
              <ListGroup>
                {items.map((a, i) => {
                  const c = conflicts.get(a.id) ?? [];
                  return (
                    <ListRow
                      key={a.id}
                      first={i === 0}
                      icon="CalendarBlank"
                      title={`${formatTime(a.startsAt)}-${formatTime(a.endsAt)} Uhr, ${appointmentKindLabels[a.kind]}`}
                      subtitle={`${a.customerDisplayName}, ${keepPlates(a.vehicleLabel)}`}
                      meta={columns.filter((col) => col.key !== 'ohne' && col.match(a)).map((col) => col.label).join(', ') || null}
                      onPress={() => router.push(routes.workshop.appointment(a.id) as Href)}
                      testID={`termin-${a.id}`}
                    >
                      <Row wrap gap={6}>
                        {a.status !== 'confirmed' ? <StatusChip status={appointmentStatusLabels[a.status]} /> : null}
                        {c.map((x, n) => (
                          <StatusChip key={`${x.kind}-${n}`} status={conflictLabels[x.kind]} />
                        ))}
                      </Row>
                    </ListRow>
                  );
                })}
              </ListGroup>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { alignItems: 'center' },
  navRow: { flexShrink: 1, maxWidth: '100%' },
  segment: { minWidth: 260, flexGrow: 1, maxWidth: 320 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { borderWidth: 1, overflow: 'hidden' },
  gridHead: { flexDirection: 'row', borderBottomWidth: 1, minHeight: 48, alignItems: 'center', paddingVertical: 6 },
  gridBody: { flexDirection: 'row' },
  timeCol: { width: 64 },
  hourLabel: { paddingHorizontal: 8, paddingTop: 2 },
  col: { flex: 1, minWidth: 0, borderLeftWidth: 1, borderLeftColor: 'transparent', paddingHorizontal: 6, position: 'relative' },
  slot: { borderTopWidth: 1 },
  abs: { position: 'absolute', paddingHorizontal: 3, paddingVertical: 2 },
  block: { flex: 1, borderWidth: 1, borderLeftWidth: 4, padding: 6, gap: 2, overflow: 'hidden' },
  conflict: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  conflictText: { flexShrink: 1 },
  noShrink: { flexShrink: 0 },
  week: { gap: 16 },
  weekRow: { flexDirection: 'row', alignItems: 'flex-start' },
  weekDay: { flex: 1, minWidth: 0, gap: 8 },
  weekItem: { gap: 2 },
  phoneDay: { gap: 8 },
});
