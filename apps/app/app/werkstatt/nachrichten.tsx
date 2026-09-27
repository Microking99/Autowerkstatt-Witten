/**
 * Werkstatt, Nachrichten-Eingang: alle Gespräche (je Auftrag), ungelesene zuerst.
 * Gespräch → Chat im Auftrag.
 */
import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useApiQuery } from '../../src/data/hooks';
import { formatRelativeTime } from '../../src/lib/format';
import { QueryView } from '../../src/screens/common';
import { EmptyState, FilterChips, ListGroup, ListRow, Page, PageHeader, StatusChip } from '../../src/ui';

export default function WorkshopMessages() {
  const [filter, setFilter] = useState<'alle' | 'ungelesen'>('alle');
  const list = useApiQuery('werkstatt:nachrichten', (api) => api.listConversations(), { pollMs: 20_000 });
  return (
    <Page maxWidth={880} testID="werkstatt-nachrichten">
      <PageHeader title="Nachrichten" subtitle="Kunden-Chats aller Aufträge. Freigaben laufen nie über den Chat." crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Nachrichten' }]} />
      <FilterChips label="Anzeige" value={filter} onChange={setFilter} options={[{ value: 'alle', label: 'Alle' }, { value: 'ungelesen', label: 'Nur ungelesene' }]} />
      <QueryView query={list}>
        {(items) => {
          const sorted = [...items]
            .filter((c) => filter === 'alle' || c.unreadCount > 0)
            .sort((a, b) => b.unreadCount - a.unreadCount || ((b.lastMessage?.createdAt ?? '') > (a.lastMessage?.createdAt ?? '') ? 1 : -1));
          return sorted.length === 0 ? (
            <EmptyState icon="ChatCircleText" title={filter === 'ungelesen' ? 'Alles gelesen' : 'Noch keine Gespräche'} />
          ) : (
            <ListGroup>
              {sorted.map((c, i) => (
                <ListRow
                  key={c.workOrderId}
                  first={i === 0}
                  icon="ChatCircleText"
                  title={`${c.counterpartDisplayName}, ${c.orderNumber}`}
                  subtitle={c.lastMessage ? `${c.lastMessage.author.role === 'customer' ? '' : 'Werkstatt: '}${c.lastMessage.body || 'Foto'}` : c.title}
                  meta={c.lastMessage ? formatRelativeTime(c.lastMessage.createdAt) : null}
                  right={c.unreadCount > 0 ? <StatusChip status={{ label: `${c.unreadCount} neu`, tone: 'warning', icon: 'ChatCircleText' }} /> : undefined}
                  onPress={() => router.push(routes.workshop.workOrderTab(c.workOrderId, 'chat') as Href)}
                  testID={`gespraech-${c.orderNumber}`}
                />
              ))}
            </ListGroup>
          );
        }}
      </QueryView>
    </Page>
  );
}
