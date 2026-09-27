/**
 * Chat zum Auftrag: Text und Fotos. Bei Verbindungsfehler bleibt die Nachricht mit
 * "Nicht gesendet" stehen und kann erneut gesendet werden (gleiche clientMessageId, keine
 * Dublette). Ein "Ja" im Chat ist keine Freigabe; darauf weist die Ansicht hin.
 */
import { routes } from '@werkstatt/contracts';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../../../src/auth/session';
import { IS_DEMO } from '../../../../src/config';
import { useApi } from '../../../../src/data/ApiProvider';
import { useApiQuery } from '../../../../src/data/hooks';
import { invalidateAll } from '../../../../src/data/invalidation';
import { useIsOffline } from '../../../../src/data/network';
import { formatDate } from '../../../../src/lib/format';
import { authorRoleLabel } from '../../../../src/screens/customer/labels';
import { NotAvailableView } from '../../../../src/screens/common';
import { platformFont, useBreakpoint, useTheme } from '../../../../src/theme';
import { AppText, Banner, ChatBubble, EmptyState, ErrorState, IconButton, LoadingState, PageHeader, useToast, type PhotoItem } from '../../../../src/ui';

interface Outgoing {
  clientMessageId: string;
  body: string;
  photo: { uri: string; name: string; mimeType: string; sizeBytes?: number } | null;
  state: 'sending' | 'failed';
  createdAt: string;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workOrderId = String(id);
  const api = useApi();
  const t = useTheme();
  const toast = useToast();
  const { user } = useSession();
  const { pagePadding } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const offline = useIsOffline();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<Outgoing['photo']>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const scroll = useRef<ScrollView>(null);

  const query = useApiQuery(
    `kunde:chat:${workOrderId}`,
    async (a) => {
      const [order, messages] = await Promise.all([a.getWorkOrder(workOrderId), a.listMessages(workOrderId)]);
      return { order, messages };
    },
    { pollMs: IS_DEMO ? undefined : 15_000 },
  );

  const messageCount = query.data?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 0) api.markRead(workOrderId).then(invalidateAll).catch(() => undefined);
  }, [api, workOrderId, messageCount]);

  const send = async (item: Outgoing) => {
    setOutgoing((list) => list.map((o) => (o.clientMessageId === item.clientMessageId ? { ...o, state: 'sending' } : o)));
    try {
      const fileIds: string[] = [];
      if (item.photo) fileIds.push((await api.uploadFile(item.photo)).id);
      await api.sendMessage(workOrderId, { clientMessageId: item.clientMessageId, body: item.body, fileIds });
      setOutgoing((list) => list.filter((o) => o.clientMessageId !== item.clientMessageId));
      invalidateAll();
    } catch {
      setOutgoing((list) => list.map((o) => (o.clientMessageId === item.clientMessageId ? { ...o, state: 'failed' } : o)));
    }
  };

  const submit = () => {
    const body = text.trim();
    if (!body && !photo) return;
    const item: Outgoing = { clientMessageId: Crypto.randomUUID(), body, photo, state: 'sending', createdAt: new Date().toISOString() };
    setOutgoing((list) => [...list, item]);
    setText('');
    setPhoto(null);
    void send(item);
  };

  const pickPhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          toast.show('Ohne Zugriff auf Ihre Fotos können Sie kein Bild anhängen. Sie können das in den Einstellungen des Geräts ändern.', 'info');
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: false });
      const asset = res.canceled ? undefined : res.assets[0];
      if (asset) setPhoto({ uri: asset.uri, name: asset.fileName ?? 'foto.jpg', mimeType: asset.mimeType ?? 'image/jpeg', sizeBytes: asset.fileSize });
    } catch {
      toast.show('Das Foto konnte nicht geladen werden.', 'danger');
    }
  };

  const order = query.data?.order;
  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: t.colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
      <View style={[styles.header, { paddingHorizontal: pagePadding }]}>
        <View style={styles.inner}>
          <PageHeader
            title="Nachrichten"
            subtitle={order ? `${order.orderNumber}: ${order.title}` : undefined}
            backHref={routes.customer.workOrder(workOrderId) as Href}
            backLabel="Auftrag"
            crumbs={[
              { label: 'Nachrichten', href: routes.customer.messages() as Href },
              { label: order?.orderNumber ?? 'Auftrag', href: routes.customer.workOrder(workOrderId) as Href },
              { label: 'Chat' },
            ]}
          />
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={styles.fill}
        contentContainerStyle={[styles.list, { paddingHorizontal: pagePadding }]}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        testID="chat-verlauf"
      >
        <View style={[styles.inner, styles.gap]}>
          {query.status === 'loading' ? (
            <LoadingState variant="list" rows={3} />
          ) : query.status === 'error' && !query.data ? (
            query.error?.isNotAvailable ? <NotAvailableView /> : <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefreshing} />
          ) : (
            <>
              <Banner tone="info" message="Freigaben erteilen Sie über den Knopf „Freigeben“ im Auftrag. Eine Zusage im Chat gilt nicht als Freigabe." />
              {query.data!.messages.length === 0 && outgoing.length === 0 ? (
                <EmptyState icon="ChatCircleText" title="Noch keine Nachrichten" message="Schreiben Sie der Werkstatt eine Rückfrage zu diesem Auftrag." />
              ) : null}
              {query.data!.messages.map((m, i, all) => {
                const own = m.author.userId === user?.id;
                const photos: PhotoItem[] = m.attachments.map((a) => ({ id: a.fileId, source: api.imageSource(a.contentUrl), caption: null }));
                const newDay = i === 0 || formatDate(all[i - 1]!.createdAt) !== formatDate(m.createdAt);
                return (
                  <View key={m.id} style={styles.gap}>
                    {newDay ? (
                      <AppText variant="caption" tone="subtle" align="center" numeric>
                        {formatDate(m.createdAt)}
                      </AppText>
                    ) : null}
                    <ChatBubble own={own} author={m.author.displayName} roleLabel={own ? undefined : authorRoleLabel[m.author.role]} body={m.body} createdAt={m.createdAt} photos={photos} />
                  </View>
                );
              })}
              {outgoing.map((o) => (
                <ChatBubble
                  key={o.clientMessageId}
                  own
                  author="Sie"
                  body={o.body}
                  createdAt={o.createdAt}
                  photos={o.photo ? [{ id: o.clientMessageId, source: { uri: o.photo.uri }, caption: null }] : undefined}
                  state={o.state}
                  onRetry={() => void send(o)}
                />
              ))}
            </>
          )}
        </View>
      </ScrollView>
      <View style={[styles.composerWrap, { borderTopColor: t.colors.border, backgroundColor: t.colors.surface, paddingHorizontal: pagePadding, paddingBottom: 12 }]}>
        <View style={[styles.inner, styles.gap]}>
          {offline ? (
            <AppText variant="small" tone="muted">
              Ohne Verbindung können keine Nachrichten gesendet werden.
            </AppText>
          ) : null}
          {photo ? (
            <View style={styles.attachment}>
              <AppText variant="small" tone="muted" style={styles.fill} numberOfLines={1}>
                Foto angehängt: {photo.name}
              </AppText>
              <IconButton icon="X" accessibilityLabel="Foto entfernen" onPress={() => setPhoto(null)} size={44} />
            </View>
          ) : null}
          <View style={styles.composer}>
            <IconButton icon="Camera" accessibilityLabel="Foto anhängen" onPress={() => void pickPhoto()} disabled={offline} testID="foto-anhaengen" />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Nachricht an die Werkstatt"
              placeholderTextColor={t.colors.textSubtle}
              accessibilityLabel="Nachricht an die Werkstatt"
              multiline
              maxLength={4000}
              style={[
                styles.input,
                platformFont,
                t.typography.body,
                { color: t.colors.text, backgroundColor: t.colors.bg, borderColor: t.colors.borderStrong, borderRadius: t.radius.control },
              ]}
              testID="nachricht-eingabe"
            />
            <IconButton icon="PaperPlaneRight" tone="accent" accessibilityLabel="Nachricht senden" onPress={submit} disabled={offline || (!text.trim() && !photo)} testID="nachricht-senden" />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingTop: 16, paddingBottom: 8 },
  inner: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  list: { paddingVertical: 12 },
  gap: { gap: 12 },
  composerWrap: { borderTopWidth: 1, paddingTop: 10 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 48, maxHeight: 140, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
