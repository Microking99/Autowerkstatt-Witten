/**
 * Werkstatt, Auftrag, Register Chat: Kunden-Chat und interne Notizen deutlich getrennt
 * (eigene Fläche, Kennzeichnung "Intern, nie für Kunden"). Ein "Ja" im Chat ist keine
 * Freigabe; dafür gibt es die Freigabeanfrage. Anhänge im Chat sind Fotos.
 */
import { routes, type WorkOrderDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../../../src/auth/session';
import { useApi } from '../../../../src/data/ApiProvider';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { useIsOffline } from '../../../../src/data/network';
import { formatDate, formatDateTime } from '../../../../src/lib/format';
import { newClientId, pickImage, type PickedImage } from '../../../../src/lib/pickImage';
import { authorRoleLabel } from '../../../../src/screens/customer/labels';
import { WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, useCan } from '../../../../src/screens/workshop/shared';
import { useBreakpoint, useTheme } from '../../../../src/theme';
import { AppText, Banner, Button, ChatBubble, Columns, EmptyState, IconButton, Row, SegmentedControl, StatusChip, TextField, useSaveShortcut, useToast } from '../../../../src/ui';

export default function WorkshopChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="chat" testID="werkstatt-chat">
      {(order) => <Chat order={order} />}
    </WorkOrderFrame>
  );
}

function Chat({ order }: { order: WorkOrderDetail }) {
  const { device } = useBreakpoint();
  const [pane, setPane] = useState<'kunde' | 'intern'>('kunde');
  if (device === 'phone') {
    return (
      <>
        <SegmentedControl
          label="Bereich"
          value={pane}
          onChange={setPane}
          options={[
            { value: 'kunde', label: 'Kunden-Chat', icon: 'ChatCircleText' },
            { value: 'intern', label: 'Intern', icon: 'Lock' },
          ]}
        />
        {pane === 'kunde' ? <CustomerChat order={order} /> : <InternalNotes order={order} />}
      </>
    );
  }
  return (
    <Columns ratio={[1.4, 1]}>
      <CustomerChat order={order} />
      <InternalNotes order={order} />
    </Columns>
  );
}

function CustomerChat({ order }: { order: WorkOrderDetail }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const { user } = useSession();
  const offline = useIsOffline();
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const messages = useApiQuery(`werkstatt:chat:${order.id}`, (a) => a.listMessages(order.id), { pollMs: 15_000 });
  useEffect(() => {
    void api.markRead(order.id).catch(() => undefined);
  }, [api, order.id, messages.data?.length]);
  const send = useApiMutation(async (a) => {
    const fileIds = photo ? [(await a.uploadFile(photo, { idempotencyKey: newClientId() })).id] : [];
    return a.sendMessage(order.id, { clientMessageId: newClientId(), body: body.trim(), fileIds });
  });
  const allowed = can('messages.customerChat');
  async function submit() {
    if (!body.trim() && !photo) return;
    try {
      await send.mutate();
      setBody('');
      setPhoto(null);
    } catch {
      // Fehler unten; Text bleibt stehen
    }
  }
  useSaveShortcut(() => void submit(), allowed && !offline);
  return (
    <View style={styles.pane} testID="kunden-chat">
      <Row style={styles.between}>
        <AppText variant="heading">Kunden-Chat</AppText>
        <StatusChip status={{ label: 'Kunde liest mit', tone: 'info', icon: 'Eye' }} />
      </Row>
      <View style={[styles.thread, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
        {messages.status === 'loading' ? <AppText tone="muted">Nachrichten werden geladen</AppText> : null}
        {messages.data && messages.data.length === 0 ? <EmptyState icon="ChatCircleText" title="Noch keine Nachrichten" message="Rückfragen und Hinweise an den Kunden. Freigaben laufen immer über eine Freigabeanfrage." /> : null}
        {(messages.data ?? []).map((m, i, list) => {
          const day = formatDate(m.createdAt);
          const showDay = i === 0 || formatDate(list[i - 1]!.createdAt) !== day;
          return (
            <View key={m.id} style={styles.messageGap}>
              {showDay ? (
                <AppText variant="caption" tone="subtle" align="center">
                  {day}
                </AppText>
              ) : null}
              <ChatBubble
                own={m.author.role !== 'customer'}
                author={m.author.userId === user?.id ? 'Sie' : m.author.displayName}
                roleLabel={m.author.role !== 'customer' && m.author.userId !== user?.id ? authorRoleLabel[m.author.role] : undefined}
                body={m.body}
                createdAt={m.createdAt}
                photos={m.attachments.map((att) => ({ id: att.fileId, source: api.imageSource(att.contentUrl), caption: null }))}
              />
            </View>
          );
        })}
      </View>
      {allowed ? (
        <>
          {offline ? <Banner tone="info" message="Ohne Verbindung können keine Nachrichten gesendet werden." /> : null}
          <TextField label="Nachricht an den Kunden" value={body} onChangeText={setBody} multiline maxLength={4000} testID="chat-eingabe" help="Strg+Enter sendet." />
          <Row wrap style={styles.between}>
            <Row gap={8}>
              <IconButton
                icon="Camera"
                accessibilityLabel="Foto anhängen"
                onPress={async () => {
                  const r = await pickImage('library');
                  if (r.type === 'picked') setPhoto(r.image);
                  else if (r.type === 'denied' || r.type === 'failed') toast.show(r.message, 'danger');
                }}
              />
              {photo ? (
                <Row gap={4}>
                  <AppText variant="small" numberOfLines={1}>{photo.name}</AppText>
                  <IconButton icon="X" size={36} accessibilityLabel="Anhang entfernen" onPress={() => setPhoto(null)} />
                </Row>
              ) : null}
            </Row>
            <Button label="Senden" variant="primary" icon="PaperPlaneRight" loading={send.pending} disabled={offline || (!body.trim() && !photo)} onPress={() => void submit()} testID="chat-senden" />
          </Row>
          <ActionError error={send.error} title="Nicht gesendet" />
        </>
      ) : (
        <AppText tone="muted">Für den Kunden-Chat fehlt Ihnen das Recht.</AppText>
      )}
      <Button label="Alle Gespräche" variant="quiet" iconRight="CaretRight" onPress={() => router.push(routes.workshop.messages() as Href)} />
    </View>
  );
}

function InternalNotes({ order }: { order: WorkOrderDetail }) {
  const t = useTheme();
  const offline = useIsOffline();
  const [body, setBody] = useState('');
  const notes = useApiQuery(`werkstatt:notizen:${order.id}`, (a) => a.listInternalNotes(order.id));
  const add = useApiMutation((a) => a.addInternalNote(order.id, { body: body.trim() }, { idempotencyKey: newClientId() }));
  return (
    <View style={[styles.pane, styles.internal, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.panel }]} testID="interne-notizen">
      <Row style={styles.between}>
        <AppText variant="heading">Interne Notizen</AppText>
        <StatusChip status={{ label: 'Intern, nie für Kunden', tone: 'neutral', icon: 'Lock' }} />
      </Row>
      {(notes.data ?? []).length === 0 && notes.status === 'success' ? <AppText tone="muted">Noch keine internen Notizen.</AppText> : null}
      {(notes.data ?? []).map((n) => (
        <View key={n.id} style={[styles.note, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.control }]}>
          <AppText variant="small" tone="muted" numeric>
            {n.author.displayName}, {formatDateTime(n.createdAt)}
          </AppText>
          <AppText>{n.body}</AppText>
        </View>
      ))}
      <TextField label="Interne Notiz" value={body} onChangeText={setBody} multiline maxLength={4000} testID="notiz-eingabe" />
      <Button
        label="Notiz speichern"
        icon="Lock"
        disabled={!body.trim() || offline}
        loading={add.pending}
        onPress={async () => {
          try {
            await add.mutate();
            setBody('');
          } catch {
            // Fehler unten
          }
        }}
        testID="notiz-speichern"
      />
      <ActionError error={add.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { gap: 12 },
  between: { justifyContent: 'space-between' },
  thread: { borderWidth: 1, padding: 12, gap: 12, minHeight: 200 },
  messageGap: { gap: 6 },
  internal: { borderWidth: 1, borderStyle: 'dashed', padding: 16 },
  note: { borderWidth: 1, padding: 12, gap: 4 },
});
