/**
 * Kundendaten anlegen oder ändern (Kundendatensatz, nicht App-Konto). Genutzt in
 * /werkstatt/kunden/neu, in der Kundenakte und im Seitendialog des Auftragsassistenten.
 * Validierung mit dem Schema aus @werkstatt/contracts; Fehler direkt am Feld.
 */
import { CustomerInputSchema, type CustomerDetail, type CustomerKind } from '@werkstatt/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IS_DEMO } from '../../config';
import type { CustomerInputData } from '../../data/api';
import { useApiMutation } from '../../data/hooks';
import { Button, Row, SegmentedControl, TextField, useSaveShortcut } from '../../ui';
import { ActionError } from './shared';

interface Fields {
  kind: CustomerKind;
  salutation: string;
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  mobile: string;
  street: string;
  postalCode: string;
  city: string;
  notesInternal: string;
}

function fromCustomer(c?: Partial<CustomerDetail>): Fields {
  return {
    kind: c?.kind ?? 'private',
    salutation: c?.salutation ?? '',
    firstName: c?.firstName ?? '',
    lastName: c?.lastName ?? '',
    companyName: c?.companyName ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    mobile: c?.mobile ?? '',
    street: c?.street ?? '',
    postalCode: c?.postalCode ?? '',
    city: c?.city ?? '',
    notesInternal: c?.notesInternal ?? '',
  };
}

export function CustomerForm({
  initial,
  onSaved,
  onCancel,
  submitLabel,
  compact,
  inDialog,
}: {
  initial?: CustomerDetail;
  onSaved: (customer: CustomerDetail) => void;
  onCancel?: () => void;
  submitLabel?: string;
  /** im Seitendialog: weniger Felder sichtbar (Adresse optional einklappbar wäre möglich) */
  compact?: boolean;
  /** Formular in einem Dialog (Strg+Enter gilt dann nur dort) */
  inDialog?: boolean;
}) {
  const [f, setF] = useState<Fields>(() => fromCustomer(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation((api, input: CustomerInputData) => (initial ? api.updateCustomer(initial.id, input) : api.createCustomer(input)));
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }));
  const n = (v: string) => (v.trim() ? v.trim() : null);

  async function submit() {
    const input = {
      kind: f.kind,
      salutation: n(f.salutation),
      firstName: n(f.firstName),
      lastName: n(f.lastName),
      companyName: n(f.companyName),
      email: n(f.email),
      phone: n(f.phone),
      mobile: n(f.mobile),
      street: n(f.street),
      postalCode: n(f.postalCode),
      city: n(f.city),
      country: 'DE',
      notesInternal: n(f.notesInternal),
      isTestData: initial ? initial.isTestData : IS_DEMO,
    };
    const parsed = CustomerInputSchema.safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        e[key === 'lastName' && f.kind === 'business' ? 'companyName' : key] = key === 'email' ? 'Bitte eine gültige E-Mail-Adresse eingeben.' : issue.message;
      }
      setErrors(e);
      return;
    }
    setErrors({});
    try {
      const saved = await save.mutate(input);
      onSaved(saved);
    } catch {
      // Fehler unten
    }
  }

  useSaveShortcut(() => void submit(), true, inDialog ? 'dialog' : 'page');

  return (
    <View style={styles.form} testID="kundenformular">
      <SegmentedControl
        label="Kundenart"
        value={f.kind}
        onChange={(kind) => set({ kind })}
        options={[
          { value: 'private', label: 'Privatkunde', icon: 'UserCircle' },
          { value: 'business', label: 'Geschäftskunde', icon: 'Storefront' },
        ]}
      />
      {f.kind === 'business' ? <TextField label="Firmenname" value={f.companyName} onChangeText={(companyName) => set({ companyName })} required error={errors.companyName} testID="kunde-firma" /> : null}
      <Row wrap gap={12} style={styles.alignStart}>
        <View style={styles.narrow}>
          <TextField label="Anrede" value={f.salutation} onChangeText={(salutation) => set({ salutation })} placeholder="Frau, Herr" />
        </View>
        <View style={styles.wide}>
          <TextField label="Vorname" value={f.firstName} onChangeText={(firstName) => set({ firstName })} testID="kunde-vorname" />
        </View>
        <View style={styles.wide}>
          <TextField label={f.kind === 'business' ? 'Nachname Ansprechpartner' : 'Nachname'} value={f.lastName} onChangeText={(lastName) => set({ lastName })} required={f.kind === 'private'} error={errors.lastName} testID="kunde-nachname" />
        </View>
      </Row>
      <Row wrap gap={12} style={styles.alignStart}>
        <View style={styles.wide}>
          <TextField label="Telefon" value={f.phone} onChangeText={(phone) => set({ phone })} keyboardType="phone-pad" autoComplete="tel" testID="kunde-telefon" />
        </View>
        <View style={styles.wide}>
          <TextField label="Mobil" value={f.mobile} onChangeText={(mobile) => set({ mobile })} keyboardType="phone-pad" />
        </View>
      </Row>
      <TextField label="E-Mail" value={f.email} onChangeText={(email) => set({ email })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email} testID="kunde-email" help="Für Einladung zur App und Benachrichtigungen. Der Kunde bekommt erst mit einer Einladung Zugang." />
      {!compact || f.street || f.city ? (
        <>
          <TextField label="Straße und Hausnummer" value={f.street} onChangeText={(street) => set({ street })} />
          <Row wrap gap={12} style={styles.alignStart}>
            <View style={styles.narrow}>
              <TextField label="PLZ" value={f.postalCode} onChangeText={(postalCode) => set({ postalCode })} keyboardType="number-pad" />
            </View>
            <View style={styles.wide}>
              <TextField label="Ort" value={f.city} onChangeText={(city) => set({ city })} />
            </View>
          </Row>
        </>
      ) : null}
      <TextField label="Interne Notiz (nie für den Kunden)" value={f.notesInternal} onChangeText={(notesInternal) => set({ notesInternal })} multiline />
      <ActionError error={save.error} />
      <Row wrap>
        {onCancel ? <Button label="Abbrechen" onPress={onCancel} /> : null}
        <Button label={submitLabel ?? (initial ? 'Speichern' : 'Kunde anlegen')} variant="primary" icon="Check" loading={save.pending} onPress={() => void submit()} testID="kunde-speichern" />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  alignStart: { alignItems: 'flex-start' },
  narrow: { flexBasis: 120, flexGrow: 1, minWidth: 110 },
  wide: { flexBasis: 200, flexGrow: 2, minWidth: 180 },
});
