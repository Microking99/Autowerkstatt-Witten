/**
 * Mechaniker, Feststellung erfassen: Beschreibung (optional diktiert über die Tastatur des
 * Geräts, O-9), Dringlichkeit, Fotos (Kamera oder Galerie), Bezug zu einer Position.
 * "Speichern" bzw. "An Service melden"; beides geht offline über die Warteschlange.
 * Es gibt bewusst keinen Freigabeknopf: Ob der Kunde gefragt wird, entscheidet der Service.
 */
import { FINDING_SEVERITIES, findingSeverityLabels, routes, type FindingSeverity } from '@werkstatt/contracts';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { newClientId, pickImage, type PickedImage } from '../../../../src/lib/pickImage';
import { useOfflineQueue } from '../../../../src/offline/OfflineQueueProvider';
import { persistUri } from '../../../../src/offline/persistUri';
import type { NewQueueEntry } from '../../../../src/offline/queueCore';
import { useCachedQuery } from '../../../../src/offline/useCachedQuery';
import { useTheme } from '../../../../src/theme';
import { AppText, Banner, Button, Checkbox, Icon, IconButton, iconSize, Page, PageHeader, Row, Section, Select, TextField, toneColors, useToast } from '../../../../src/ui';

interface LocalPhoto extends PickedImage {
  photoId: string;
}

export default function FindingScreen() {
  const { id, position } = useLocalSearchParams<{ id: string; position?: string }>();
  const orderId = String(id);
  const t = useTheme();
  const toast = useToast();
  const { submit, online } = useOfflineQueue();
  const order = useCachedQuery(`mechaniker:auftrag:${orderId}:feststellung`, (api) => api.getWorkOrder(orderId));
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FindingSeverity>('recommended');
  const [dictated, setDictated] = useState(false);
  const [itemId, setItemId] = useState<string>(position ?? 'none');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(source: 'camera' | 'library') {
    const picked = await pickImage(source);
    if (picked.type === 'denied' || picked.type === 'failed') return toast.show(picked.message, 'danger');
    if (picked.type !== 'picked') return;
    const uri = await persistUri(picked.image.uri, picked.image.name);
    setPhotos((l) => [...l, { ...picked.image, uri, photoId: newClientId() }]);
  }

  async function save(report: boolean) {
    if (!description.trim()) return setError('Bitte beschreiben, was Sie festgestellt haben.');
    setError(null);
    setBusy(true);
    const findingId = newClientId();
    const now = new Date().toISOString();
    const photoEntries: NewQueueEntry[] = photos.map((p) => ({
      id: newClientId(),
      kind: 'photo',
      workOrderId: orderId,
      scope: `photo:${p.photoId}`,
      label: `Foto zur Feststellung`,
      payload: { photoId: p.photoId, uri: p.uri, name: p.name, mimeType: p.mimeType, sizeBytes: p.sizeBytes, context: 'finding', caption: description.trim().slice(0, 120), takenAt: now },
    }));
    const items: NewQueueEntry[] = [
      ...photoEntries,
      {
        id: findingId,
        kind: 'createFinding',
        workOrderId: orderId,
        scope: `order:${orderId}`,
        label: 'Feststellung',
        payload: { description: description.trim(), severity, dictated, workItemId: itemId === 'none' ? null : itemId, photoIds: photos.map((p) => p.photoId) },
        dependsOn: photoEntries.map((e) => e.id),
      },
      ...(report ? [{ id: newClientId(), kind: 'reportFinding' as const, workOrderId: orderId, scope: `order:${orderId}`, label: 'An Service melden', payload: { findingId }, dependsOn: [findingId] }] : []),
    ];
    try {
      const result = await submit(items);
      if (result.type === 'rejected') return setError(result.error.message);
      toast.show(
        result.type === 'queued'
          ? 'Gespeichert. Wird übertragen, sobald eine Verbindung besteht (Nicht synchronisiert).'
          : report
            ? 'An den Service gemeldet. Der Service entscheidet, ob der Kunde gefragt wird.'
            : 'Feststellung gespeichert.',
        result.type === 'queued' ? 'info' : 'success',
      );
      router.replace(routes.mechanic.workOrder(orderId) as Href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page maxWidth={760} testID="mechaniker-feststellung">
      <PageHeader
        title="Feststellung"
        subtitle={order.data ? `${order.data.orderNumber}, ${order.data.licensePlate}` : undefined}
        backHref={routes.mechanic.workOrder(orderId) as Href}
        backLabel="Auftrag"
        crumbs={[{ label: 'Heute', href: routes.mechanic.home() as Href }, { label: order.data?.orderNumber ?? 'Auftrag', href: routes.mechanic.workOrder(orderId) as Href }, { label: 'Feststellung' }]}
      />
      {!online ? <Banner tone="info" title="Ohne Verbindung" message="Die Feststellung und die Fotos werden auf dem Gerät gespeichert und später übertragen." /> : null}
      <Section title="Was ist aufgefallen?">
        <TextField label="Beschreibung" value={description} onChangeText={setDescription} multiline required error={error} testID="feststellung-text" help="Tipp: Mikrofontaste der Gerätetastatur zum Diktieren. Die Software selbst nutzt dafür keinen Cloud-Dienst (O-9)." />
        <Checkbox label="Text wurde diktiert" checked={dictated} onChange={setDictated} description="Hilft dem Service beim Lesen (Diktierfehler möglich)." />
      </Section>
      <Section title="Dringlichkeit">
        <View accessibilityRole="radiogroup" aria-label="Dringlichkeit" style={styles.severities}>
          {FINDING_SEVERITIES.map((s) => {
            const selected = s === severity;
            return (
              <Pressable
                key={s}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={findingSeverityLabels[s].label}
                onPress={() => setSeverity(s)}
                testID={`dringlichkeit-${s}`}
                style={({ pressed }) => [styles.severity, { borderColor: selected ? t.colors.accent : t.colors.border, borderWidth: selected ? 2 : 1, backgroundColor: selected ? t.colors.accentSoft : t.colors.surface, borderRadius: t.radius.control }, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={styles.severityRow}>
                  <Icon name={findingSeverityLabels[s].icon} size={iconSize.md} color={toneColors(t, findingSeverityLabels[s].tone).fg} />
                  <AppText variant="bodyStrong" style={styles.severityText}>
                    {findingSeverityLabels[s].label}
                  </AppText>
                  {selected ? <Icon name="Check" size={iconSize.md} color={t.colors.accent} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {severity === 'safety' ? <Banner tone="danger" message="Sicherheitsrelevant: Bitte zusätzlich sofort den Service ansprechen." /> : null}
      </Section>
      {order.data ? (
        <Select label="Betrifft Position (freiwillig)" value={itemId} onChange={setItemId} options={[{ value: 'none', label: 'Keine bestimmte Position' }, ...order.data.items.map((i) => ({ value: i.id, label: i.title }))]} />
      ) : null}
      <Section title={`Fotos (${photos.length})`}>
        <View style={styles.photos}>
          {photos.map((p) => (
            <View key={p.photoId} style={[styles.photo, { borderColor: t.colors.border, borderRadius: t.radius.control }]}>
              <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" accessibilityLabel={`Foto ${p.name}`} />
              <IconButton icon="Trash" tone="danger" accessibilityLabel="Foto entfernen" onPress={() => setPhotos((l) => l.filter((x) => x.photoId !== p.photoId))} />
            </View>
          ))}
        </View>
        <Row wrap gap={12}>
          <View style={styles.grow}>
            <Button label="Foto aufnehmen" size="lg" icon="Camera" fullWidth onPress={() => void add('camera')} testID="foto-aufnehmen" />
          </View>
          <View style={styles.grow}>
            <Button label="Aus Galerie" size="lg" icon="ImageSquare" fullWidth onPress={() => void add('library')} testID="foto-galerie" />
          </View>
        </Row>
      </Section>
      <View style={styles.actions}>
        <Button label="An Service melden" size="lg" variant="primary" icon="Bell" fullWidth loading={busy} onPress={() => void save(true)} testID="an-service-melden" />
        <Button label="Nur speichern" size="lg" icon="Check" fullWidth loading={busy} onPress={() => void save(false)} testID="feststellung-speichern" />
        <AppText variant="small" tone="subtle">Eine Feststellung ist keine Freigabe. Der Service fragt den Kunden bei Bedarf mit Preis an; erst nach dessen Freigabe wird gearbeitet.</AppText>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photo: { borderWidth: 1, padding: 6, alignItems: 'center', gap: 4 },
  thumb: { width: 120, height: 90, borderRadius: 6 },
  grow: { flexGrow: 1, flexBasis: 200 },
  actions: { gap: 12 },
  severities: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Breite reicht für "Sicherheitsrelevant" (ein Wort, nicht umbrechbar); am Telefon eine Option je Zeile
  severity: { minHeight: 56, paddingHorizontal: 12, justifyContent: 'center', flexGrow: 1, flexBasis: 220 },
  severityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  severityText: { flexShrink: 1 },
});
