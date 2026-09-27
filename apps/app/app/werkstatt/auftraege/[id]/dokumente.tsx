/**
 * Werkstatt, Auftrag, Register Dokumente: Dokumente mit Versionen. Hochladen (neues Dokument
 * oder neue Version), öffnen, für den Kunden veröffentlichen bzw. zurückziehen (Bestätigung).
 * Rechnungsdokumente entstehen beim Stellen der Rechnung (Register Rechnung).
 */
import { documentKindLabels, type DocumentDto, type DocumentKind, type WorkOrderDetail } from '@werkstatt/contracts';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../../src/data/ApiProvider';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { formatDateTime, formatFileSize } from '../../../../src/lib/format';
import { pickDocument } from '../../../../src/lib/pickDocument';
import { newClientId, type PickedImage } from '../../../../src/lib/pickImage';
import { QueryView, openDownload } from '../../../../src/screens/common';
import { WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, useCan, visibilityLabels } from '../../../../src/screens/workshop/shared';
import { AppText, Banner, Button, ConfirmDialog, DataTable, EmptyState, Row, Select, Sheet, StatusChip, TextField, useSaveShortcut, useToast } from '../../../../src/ui';

export default function DocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="dokumente" testID="werkstatt-dokumente">
      {(order) => <Documents order={order} />}
    </WorkOrderFrame>
  );
}

function Documents({ order }: { order: WorkOrderDetail }) {
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const docs = useApiQuery(`werkstatt:dokumente:${order.id}`, (a) => a.listDocuments({ workOrderId: order.id }));
  const [upload, setUpload] = useState<{ versionOf: DocumentDto | null } | null>(null);
  const [publish, setPublish] = useState<DocumentDto | null>(null);
  const [selected, setSelected] = useState<DocumentDto | null>(null);
  const toggle = useApiMutation((a, d: DocumentDto) => (d.publishedAt ? a.unpublishDocument(d.id) : a.publishDocument(d.id)));

  async function open(d: DocumentDto) {
    try {
      const res = await openDownload(await api.downloadDocument(d.id), d.title);
      if (res === 'unsupported') toast.show('Auf diesem Gerät gibt es keine App zum Öffnen der Datei.', 'info');
    } catch {
      toast.show('Das Dokument konnte nicht geladen werden.', 'danger');
    }
  }

  return (
    <QueryView query={docs}>
      {(list) => (
        <>
          <Row wrap style={styles.between}>
            <AppText tone="muted">Kunden sehen nur veröffentlichte Dokumente. Interne Dokumente sehen Mechaniker nur mit Recht und nur bei laufender Zuweisung.</AppText>
            {can('documents.write') ? <Button label="Dokument hochladen" icon="UploadSimple" variant="primary" onPress={() => setUpload({ versionOf: null })} testID="dokument-hochladen" /> : null}
          </Row>
          {list.length === 0 ? (
            <EmptyState icon="FileText" title="Noch keine Dokumente" message="Angebote, Prüfprotokolle und Rechnungen erscheinen hier." />
          ) : (
            <DataTable
              label="Dokumente"
              rows={list}
              rowKey={(d) => d.id}
              onRowPress={(d) => setSelected(d)}
              mobileTitle={(d) => d.title}
              mobileSubtitle={(d) => `${documentKindLabels[d.kind]}, Version ${d.currentVersion.versionNo}, ${d.publishedAt ? 'veröffentlicht' : 'intern'}`}
              mobileMeta={(d) => formatDateTime(d.currentVersion.createdAt)}
              columns={[
                { key: 'titel', header: 'Dokument', render: (d) => <View><AppText variant="bodyStrong">{d.title}</AppText><AppText variant="small" tone="muted">{documentKindLabels[d.kind]}</AppText></View>, sortValue: (d) => d.title, flex: 2 },
                { key: 'version', header: 'Version', render: (d) => <AppText numeric>{`${d.currentVersion.versionNo} von ${d.versionCount}`}</AppText>, flex: 0.8 },
                { key: 'datei', header: 'Datei', render: (d) => <AppText variant="small" tone="muted" numberOfLines={1}>{`${d.currentVersion.file.originalName}, ${formatFileSize(d.currentVersion.file.sizeBytes)}`}</AppText>, flex: 1.6 },
                { key: 'sicht', header: 'Sichtbarkeit', render: (d) => <StatusChip status={d.publishedAt ? { ...visibilityLabels.customer, label: 'Veröffentlicht' } : visibilityLabels.internal} />, flex: 1.1 },
                {
                  key: 'aktionen',
                  header: 'Aktionen',
                  render: (d) => (
                    <Row wrap gap={8}>
                      {can('documents.write') && d.kind !== 'invoice' ? <Button label="Neue Version" variant="quiet" onPress={() => setUpload({ versionOf: d })} /> : null}
                      {can('documents.publish') && d.kind !== 'invoice' ? <Button label={d.publishedAt ? 'Zurückziehen' : 'Veröffentlichen'} variant="quiet" onPress={() => setPublish(d)} testID={`veroeffentlichen-${d.id}`} /> : null}
                    </Row>
                  ),
                  flex: 2,
                },
              ]}
            />
          )}
          <Sheet visible={selected !== null} onClose={() => setSelected(null)} title={selected?.title ?? 'Dokument'} width={480}>
            {selected ? (
              <>
                <AppText tone="muted">{`${documentKindLabels[selected.kind]}, Version ${selected.currentVersion.versionNo} vom ${formatDateTime(selected.currentVersion.createdAt)}`}</AppText>
                <StatusChip status={selected.publishedAt ? { ...visibilityLabels.customer, label: 'Veröffentlicht' } : visibilityLabels.internal} />
                <Button label="Öffnen" icon="ArrowSquareOut" variant="primary" fullWidth onPress={() => void open(selected)} />
                {can('documents.write') && selected.kind !== 'invoice' ? <Button label="Neue Version hochladen" icon="UploadSimple" fullWidth onPress={() => { setUpload({ versionOf: selected }); setSelected(null); }} /> : null}
                {can('documents.publish') && selected.kind !== 'invoice' ? <Button label={selected.publishedAt ? 'Für Kunden zurückziehen' : 'Für Kunden veröffentlichen'} icon={selected.publishedAt ? 'EyeSlash' : 'Eye'} fullWidth onPress={() => { setPublish(selected); setSelected(null); }} /> : null}
              </>
            ) : null}
          </Sheet>
          <UploadSheet order={order} state={upload} onClose={() => setUpload(null)} />
          <ConfirmDialog
            visible={publish !== null}
            title={publish?.publishedAt ? `"${publish?.title}" zurückziehen?` : `"${publish?.title}" für den Kunden veröffentlichen?`}
            message={publish?.publishedAt ? 'Der Kunde sieht das Dokument danach nicht mehr.' : 'Der Kunde sieht und lädt das Dokument danach in seinem Auftrag.'}
            confirmLabel={publish?.publishedAt ? 'Zurückziehen' : 'Veröffentlichen'}
            loading={toggle.pending}
            onCancel={() => setPublish(null)}
            onConfirm={async () => {
              if (!publish) return;
              try {
                await toggle.mutate(publish);
                toast.show(publish.publishedAt ? 'Dokument zurückgezogen.' : 'Dokument veröffentlicht.');
                setPublish(null);
              } catch {
                // Fehler im Dialog
              }
            }}
          >
            <ActionError error={toggle.error} />
          </ConfirmDialog>
        </>
      )}
    </QueryView>
  );
}

function UploadSheet({ order, state, onClose }: { order: WorkOrderDetail; state: { versionOf: DocumentDto | null } | null; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [file, setFile] = useState<PickedImage | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DocumentKind>('report');
  const [note, setNote] = useState('');
  const versionOf = state?.versionOf ?? null;
  const save = useApiMutation(async (a) => {
    if (!file) throw new Error('Keine Datei');
    const ref = await a.uploadFile(file, { idempotencyKey: newClientId() });
    if (versionOf) return a.addDocumentVersion(versionOf.id, { fileId: ref.id, note: note.trim() || null });
    return a.createDocument({ kind, title: title.trim(), fileId: ref.id, workOrderId: order.id, customerId: order.customerId, vehicleId: order.vehicleId });
  });
  const valid = !!file && (versionOf ? true : !!title.trim());
  async function submit() {
    if (!valid) return;
    try {
      await save.mutate();
      toast.show(versionOf ? 'Neue Version gespeichert (intern, bis sie veröffentlicht ist).' : 'Dokument gespeichert (intern).');
      setFile(null);
      setTitle('');
      setNote('');
      onClose();
    } catch {
      // Fehler unten
    }
  }
  useSaveShortcut(() => void submit(), state !== null, 'dialog');
  return (
    <Sheet
      visible={state !== null}
      onClose={onClose}
      title={versionOf ? `Neue Version: ${versionOf.title}` : 'Dokument hochladen'}
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button label="Speichern" variant="primary" disabled={!valid} loading={save.pending} onPress={() => void submit()} />
        </>
      }
    >
      <Button
        label={file ? `Datei: ${file.name}` : 'Datei auswählen (PDF oder Bild)'}
        icon="Paperclip"
        onPress={async () => {
          try {
            setFile(await pickDocument(['application/pdf', 'image/jpeg', 'image/png']));
          } catch {
            toast.show('Die Datei konnte nicht gewählt werden.', 'danger');
          }
        }}
      />
      {!versionOf ? (
        <>
          <TextField label="Titel" value={title} onChangeText={setTitle} required />
          <Select label="Art" value={kind} onChange={setKind} options={(['report', 'offer', 'intake_protocol', 'other'] as DocumentKind[]).map((k) => ({ value: k, label: documentKindLabels[k] }))} />
        </>
      ) : (
        <TextField label="Notiz zur Version (freiwillig)" value={note} onChangeText={setNote} />
      )}
      <Banner tone="info" message="Neue Dokumente und Versionen sind zunächst intern. Der Kunde sieht sie erst nach dem Veröffentlichen." />
      <ActionError error={save.error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between', alignItems: 'flex-start' },
});
