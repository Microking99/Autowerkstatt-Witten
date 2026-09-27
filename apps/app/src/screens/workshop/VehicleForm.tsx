/**
 * Fahrzeug anlegen oder ändern. Der Halter wird beim Anlegen festgelegt; ein späterer
 * Halterwechsel läuft über die Fahrzeugakte (Datentrennung zum Vorbesitzer).
 */
import { VehicleInputSchema, type VehicleDetail } from '@werkstatt/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IS_DEMO } from '../../config';
import type { VehicleInputData } from '../../data/api';
import { useApiMutation } from '../../data/hooks';
import { AppText, Button, DateTimeField, Row, Select, TextField, useSaveShortcut } from '../../ui';
import { ActionError } from './shared';

const FUELS = ['Benzin', 'Diesel', 'Hybrid', 'Elektro', 'Erdgas', 'Autogas'];

export function VehicleForm({
  ownerCustomerId,
  ownerName,
  initial,
  onSaved,
  onCancel,
  inDialog,
  submitLabel,
}: {
  ownerCustomerId: string;
  ownerName?: string;
  initial?: VehicleDetail;
  onSaved: (vehicle: VehicleDetail) => void;
  onCancel?: () => void;
  inDialog?: boolean;
  submitLabel?: string;
}) {
  const [plate, setPlate] = useState(initial?.licensePlate ?? '');
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [variant, setVariant] = useState(initial?.variant ?? '');
  const [vin, setVin] = useState(initial?.vin ?? '');
  const [hsn, setHsn] = useState(initial?.hsn ?? '');
  const [tsn, setTsn] = useState(initial?.tsn ?? '');
  const [firstReg, setFirstReg] = useState<Date | null>(initial?.firstRegistration ? new Date(initial.firstRegistration) : null);
  const [fuel, setFuel] = useState<string | null>(initial?.fuelType ?? null);
  const [color, setColor] = useState(initial?.color ?? '');
  const [notes, setNotes] = useState(initial?.notesInternal ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation((api, input: VehicleInputData) => {
    if (!initial) return api.createVehicle(input);
    // Halter und Testdaten-Kennzeichen ändern sich nicht über die Bearbeitung (Halterwechsel: eigener Ablauf)
    const { ownerCustomerId: _owner, isTestData: _test, ...patch } = input;
    return api.updateVehicle(initial.id, patch);
  });
  const n = (v: string) => (v.trim() ? v.trim() : null);

  async function submit() {
    const date = firstReg ? `${firstReg.getFullYear()}-${String(firstReg.getMonth() + 1).padStart(2, '0')}-${String(firstReg.getDate()).padStart(2, '0')}` : null;
    const input = {
      licensePlate: plate.trim().toUpperCase(),
      vin: n(vin)?.toUpperCase() ?? null,
      hsn: n(hsn),
      tsn: n(tsn)?.toUpperCase() ?? null,
      make: make.trim(),
      model: model.trim(),
      variant: n(variant),
      firstRegistration: date,
      fuelType: fuel,
      color: n(color),
      notesInternal: n(notes),
      ownerCustomerId,
      isTestData: initial ? initial.isTestData : IS_DEMO,
    };
    const parsed = VehicleInputSchema.safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0] ?? 'form')] = issue.message === 'Pflichtfeld' ? 'Pflichtfeld' : issue.message;
      setErrors(e);
      return;
    }
    setErrors({});
    try {
      onSaved(await save.mutate(input));
    } catch {
      // Fehler unten (z. B. FIN bereits vergeben)
    }
  }

  useSaveShortcut(() => void submit(), true, inDialog ? 'dialog' : 'page');

  return (
    <View style={styles.form} testID="fahrzeugformular">
      {ownerName ? <AppText tone="muted">Halter: {ownerName}</AppText> : null}
      <Row wrap gap={12} style={styles.alignStart}>
        <View style={styles.col}>
          <TextField label="Kennzeichen" value={plate} onChangeText={setPlate} autoCapitalize="characters" required error={errors.licensePlate} placeholder="EN-AB 123" testID="fahrzeug-kennzeichen" />
        </View>
        <View style={styles.col}>
          <DateTimeField label="Erstzulassung" value={firstReg} onChange={setFirstReg} mode="date" maximumDate={new Date()} />
        </View>
      </Row>
      <Row wrap gap={12} style={styles.alignStart}>
        <View style={styles.col}>
          <TextField label="Hersteller" value={make} onChangeText={setMake} required error={errors.make} testID="fahrzeug-hersteller" />
        </View>
        <View style={styles.col}>
          <TextField label="Modell" value={model} onChangeText={setModel} required error={errors.model} testID="fahrzeug-modell" />
        </View>
        <View style={styles.col}>
          <TextField label="Ausführung" value={variant} onChangeText={setVariant} />
        </View>
      </Row>
      <TextField label="FIN (Fahrzeug-Identifizierungsnummer)" value={vin} onChangeText={setVin} autoCapitalize="characters" error={errors.vin} help="17 Zeichen, ohne I, O und Q." testID="fahrzeug-fin" />
      <Row wrap gap={12} style={styles.alignStart}>
        <View style={styles.col}>
          <TextField label="HSN" value={hsn} onChangeText={setHsn} keyboardType="number-pad" error={errors.hsn} />
        </View>
        <View style={styles.col}>
          <TextField label="TSN" value={tsn} onChangeText={setTsn} autoCapitalize="characters" error={errors.tsn} />
        </View>
        <View style={styles.col}>
          <Select label="Kraftstoff" value={fuel} onChange={setFuel} options={FUELS.map((x) => ({ value: x, label: x }))} placeholder="nicht angegeben" />
        </View>
        <View style={styles.col}>
          <TextField label="Farbe" value={color} onChangeText={setColor} />
        </View>
      </Row>
      <TextField label="Interne Notiz (nie für den Kunden)" value={notes} onChangeText={setNotes} multiline />
      <ActionError error={save.error} />
      <Row wrap>
        {onCancel ? <Button label="Abbrechen" onPress={onCancel} /> : null}
        <Button label={submitLabel ?? (initial ? 'Speichern' : 'Fahrzeug anlegen')} variant="primary" icon="Check" loading={save.pending} onPress={() => void submit()} testID="fahrzeug-speichern" />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  alignStart: { alignItems: 'flex-start' },
  col: { flexBasis: 180, flexGrow: 1, minWidth: 160 },
});
