/**
 * Werkstatt, Auftrag, Register Verlauf: Chronologie aus dem Änderungsprotokoll (wer hat wann
 * was getan), neueste zuerst.
 */
import type { TimelineEntry, WorkOrderDetail } from '@werkstatt/contracts';
import { useLocalSearchParams } from 'expo-router';
import { useApiQuery } from '../../../../src/data/hooks';
import { formatDateTime } from '../../../../src/lib/format';
import { QueryView } from '../../../../src/screens/common';
import { WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { EmptyState, Timeline, type TimelineItem } from '../../../../src/ui';

function tone(action: string): TimelineItem['tone'] {
  if (action.includes('rejected') || action.includes('cancel') || action.includes('withdrawn')) return 'danger';
  if (action.includes('approval') || action.includes('finding')) return 'warning';
  if (action.includes('completed') || action.includes('payment') || action.includes('confirmed') || action.includes('service_entry')) return 'success';
  if (action.includes('status') || action.includes('work_item')) return 'info';
  return 'neutral';
}

function icon(action: string): TimelineItem['icon'] {
  if (action.startsWith('approval')) return 'HourglassMedium';
  if (action.startsWith('work_item')) return 'Wrench';
  if (action.startsWith('payment') || action.startsWith('invoice') || action.startsWith('refund')) return 'Receipt';
  if (action.startsWith('intake')) return 'Signature';
  if (action.startsWith('message') || action.startsWith('note')) return 'ChatCircleText';
  if (action.startsWith('photo')) return 'Camera';
  if (action.startsWith('finding')) return 'NotePencil';
  if (action.startsWith('service_entry')) return 'SealCheck';
  return 'Circle';
}

export default function HistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="verlauf" maxWidth={880} testID="werkstatt-verlauf">
      {(order) => <History order={order} />}
    </WorkOrderFrame>
  );
}

function History({ order }: { order: WorkOrderDetail }) {
  const timeline = useApiQuery(`werkstatt:verlauf:${order.id}`, (a) => a.timeline(order.id));
  return (
    <QueryView query={timeline}>
      {(entries: TimelineEntry[]) =>
        entries.length === 0 ? (
          <EmptyState icon="ClockCounterClockwise" title="Noch kein Verlauf" />
        ) : (
          <Timeline items={entries.map((e) => ({ id: e.id, title: e.summary, detail: e.actorDisplayName, time: formatDateTime(e.occurredAt), tone: tone(e.action), icon: icon(e.action) }))} />
        )
      }
    </QueryView>
  );
}
