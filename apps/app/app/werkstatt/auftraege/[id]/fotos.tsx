/**
 * Werkstatt, Auftrag, Register Fotos: alle Fotos mit Anlass und Sichtbarkeit (intern oder
 * für den Kunden). Sichtbarkeit ändern nur mit Bestätigung. Fotos einer gesendeten
 * Freigabeanfrage sind automatisch für den Kunden sichtbar.
 */
import type { Photo, WorkOrderDetail } from '@werkstatt/contracts';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../../src/data/ApiProvider';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { formatDateTime } from '../../../../src/lib/format';
import { newClientId, pickImage } from '../../../../src/lib/pickImage';
import { QueryView } from '../../../../src/screens/common';
import { WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, photoContextLabels, useCan, visibilityLabels } from '../../../../src/screens/workshop/shared';
import { useBreakpoint, useTheme } from '../../../../src/theme';
import { AppText, Button, ConfirmDialog, EmptyState, FilterChips, PhotoView, Row, Section, StatusChip, useToast } from '../../../../src/ui';

export default function PhotosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="fotos" testID="werkstatt-fotos">
      {(order) => <Photos order={order} />}
    </WorkOrderFrame>
  );
}

function Photos({ order }: { order: WorkOrderDetail }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const { device } = useBreakpoint();
  const [filter, setFilter] = useState<'alle' | 'intern' | 'kunde'>('alle');
  const [change, setChange] = useState<Photo | null>(null);
  const [uploading, setUploading] = useState(false);
  const photos = useApiQuery(`werkstatt:fotos:${order.id}`, (a) => a.listPhotos(order.id));
  const setVisibility = useApiMutation((a, p: Photo) => a.setPhotoVisibility(p.id, p.visibility === 'internal' ? 'customer' : 'internal'));
  const canChange = can('documents.publish') || can('workOrders.write');

  async function upload() {
    const picked = await pickImage(device === 'desktop' ? 'library' : 'camera');
    if (picked.type === 'denied' || picked.type === 'failed') return toast.show(picked.message, 'danger');
    if (picked.type !== 'picked') return;
    setUploading(true);
    try {
      const file = await api.uploadFile(picked.image, { idempotencyKey: newClientId() });
      await api.attachPhoto(order.id, { id: newClientId(), fileId: file.id, context: 'work', caption: null });
      toast.show('Foto hinzugefügt (intern).');
      void photos.refetch();
    } catch {
      toast.show('Das Foto konnte nicht hochgeladen werden.', 'danger');
    } finally {
      setUploading(false);
    }
  }

  return (
    <QueryView query={photos}>
      {(list) => {
        const shown = list.filter((p) => (filter === 'alle' ? true : filter === 'intern' ? p.visibility === 'internal' : p.visibility === 'customer'));
        return (
          <>
            <Row wrap style={styles.between}>
              <FilterChips
                label="Sichtbarkeit"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'alle', label: `Alle (${list.length})` },
                  { value: 'intern', label: `Intern (${list.filter((p) => p.visibility === 'internal').length})` },
                  { value: 'kunde', label: `Für Kunden (${list.filter((p) => p.visibility === 'customer').length})` },
                ]}
              />
              {can('workOrders.write') ? <Button label="Foto hinzufügen" icon="Camera" loading={uploading} onPress={() => void upload()} /> : null}
            </Row>
            {shown.length === 0 ? (
              <EmptyState icon="ImageSquare" title="Keine Fotos" message="Fotos entstehen bei der Annahme, bei Feststellungen der Mechaniker und im Chat." />
            ) : (
              <Section>
                <View style={styles.grid}>
                  {shown.map((p) => (
                    <View key={p.id} style={[styles.card, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface, flexBasis: device === 'phone' ? '100%' : device === 'tablet' ? '46%' : '30%' }]} testID={`foto-${p.id}`}>
                      <PhotoView source={api.imageSource(p.contentUrl)} caption={p.caption} height={170} />
                      <Row wrap gap={6}>
                        <StatusChip status={visibilityLabels[p.visibility]} />
                        <AppText variant="small" tone="subtle">{photoContextLabels[p.context]}</AppText>
                      </Row>
                      {p.caption ? <AppText>{p.caption}</AppText> : null}
                      <AppText variant="small" tone="subtle" numeric>{formatDateTime(p.takenAt)}</AppText>
                      {canChange ? (
                        <Button
                          label={p.visibility === 'internal' ? 'Für Kunden sichtbar machen' : 'Nur intern zeigen'}
                          icon={p.visibility === 'internal' ? 'Eye' : 'EyeSlash'}
                          onPress={() => setChange(p)}
                          testID={`foto-sichtbarkeit-${p.id}`}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
              </Section>
            )}
            <ConfirmDialog
              visible={change !== null}
              title={change?.visibility === 'internal' ? 'Foto für den Kunden sichtbar machen?' : 'Foto nur noch intern zeigen?'}
              message={change?.visibility === 'internal' ? 'Der Kunde sieht das Foto danach in seinem Auftrag.' : 'Der Kunde sieht das Foto danach nicht mehr. Bereits gesendete Freigabeanfragen bleiben unverändert.'}
              confirmLabel={change?.visibility === 'internal' ? 'Sichtbar machen' : 'Intern machen'}
              loading={setVisibility.pending}
              onCancel={() => setChange(null)}
              onConfirm={async () => {
                if (!change) return;
                try {
                  await setVisibility.mutate(change);
                  setChange(null);
                  toast.show('Sichtbarkeit geändert.');
                } catch {
                  // Fehler im Dialog
                }
              }}
            >
              <ActionError error={setVisibility.error} />
            </ConfirmDialog>
          </>
        );
      }}
    </QueryView>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { borderWidth: 1, padding: 12, gap: 8, flexGrow: 1 },
});
