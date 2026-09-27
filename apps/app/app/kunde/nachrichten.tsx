/** Gespräche je Auftrag, ungelesen zuerst → Chat des Auftrags. */
import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { View } from 'react-native';
import { useApiQuery } from '../../src/data/hooks';
import { formatRelativeTime } from '../../src/lib/format';
import { QueryView } from '../../src/screens/common';
import { useTheme } from '../../src/theme';
import { AppText, EmptyState, ListGroup, ListRow, Page, PageHeader } from '../../src/ui';

export default function MessagesScreen() {
  const t = useTheme();
  const query = useApiQuery('kunde:nachrichten', (api) => api.listConversations());
  return (
    <Page testID="kunde-nachrichten">
      <PageHeader title="Nachrichten" crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Nachrichten' }]} />
      <QueryView query={query} loading="list">
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="ChatCircleText" title="Noch keine Nachrichten" message="Zu jedem Auftrag können Sie der Werkstatt schreiben. Öffnen Sie dazu den Auftrag." />
          ) : (
            <ListGroup>
              {list.map((c, i) => (
                <ListRow
                  key={c.workOrderId}
                  first={i === 0}
                  icon="ChatCircleText"
                  title={`${c.orderNumber}: ${c.title}`}
                  subtitle={c.lastMessage ? `${c.lastMessage.author.displayName}: ${c.lastMessage.body || 'Foto'}` : 'Noch keine Nachricht'}
                  meta={c.lastMessage ? formatRelativeTime(c.lastMessage.createdAt) : null}
                  accessibilityLabel={`${c.orderNumber}, ${c.title}${c.unreadCount ? `, ${c.unreadCount} ungelesen` : ''}`}
                  onPress={() => router.push(routes.customer.chat(c.workOrderId) as Href)}
                  testID={`gespraech-${c.orderNumber}`}
                  right={
                    c.unreadCount > 0 ? (
                      <View style={{ minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                        <AppText variant="caption" numeric style={{ color: t.colors.accentText }}>
                          {c.unreadCount}
                        </AppText>
                      </View>
                    ) : null
                  }
                />
              ))}
            </ListGroup>
          )
        }
      </QueryView>
    </Page>
  );
}
