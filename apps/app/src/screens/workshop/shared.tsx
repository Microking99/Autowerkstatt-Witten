/**
 * Gemeinsame Bausteine der Werkstattansichten: Rechte in der Oberfläche (nur Anzeige, die
 * API prüft verbindlich), Eingabe-Umrechnungen, Statusbezeichnungen, Fehleranzeige.
 */
import type {
  CustomerAccessStatus,
  FindingStatus,
  InvoiceStatus,
  Permission,
  PhotoContext,
  ResourceKind,
  SchedulingConflict,
  StatusLabel,
  UserStatus,
  Visibility,
} from '@werkstatt/contracts';
import { Pressable } from 'react-native';
import { useSession } from '../../auth/session';
import type { ApiError } from '../../data/errors';
import { AppText, Banner } from '../../ui';

/** Hat der angemeldete Mitarbeiter das Recht? Aktionen ohne Recht werden nicht angeboten. */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useSession();
  return (permission) => !!user?.permissions.includes(permission);
}

/** "1.234,56" oder "1234.5" → Cent; leer → null; ungültig → NaN */
export function parseEuro(text: string): number | null {
  const s = text.trim().replace(/\s|€/g, '');
  if (!s) return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Ganze Zahl (km, Minuten); Tausenderpunkte erlaubt. */
export function parseInteger(text: string): number | null {
  const s = text.trim().replace(/\./g, '').replace(/\s|km/gi, '');
  if (!s) return null;
  if (!/^\d+$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Menge mit Komma ("1,5") */
export function parseQuantity(text: string): number {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
}

export const customerAccessLabels: Record<CustomerAccessStatus, StatusLabel> = {
  none: { label: 'Kein App-Zugang', tone: 'neutral', icon: 'Minus' },
  invited: { label: 'Eingeladen', tone: 'info', icon: 'EnvelopeSimple' },
  active: { label: 'App-Zugang aktiv', tone: 'success', icon: 'CheckCircle' },
  disabled: { label: 'Zugang gesperrt', tone: 'danger', icon: 'Lock' },
};

export const userStatusLabels: Record<UserStatus, StatusLabel> = {
  invited: { label: 'Eingeladen', tone: 'info', icon: 'EnvelopeSimple' },
  active: { label: 'Aktiv', tone: 'success', icon: 'CheckCircle' },
  disabled: { label: 'Deaktiviert', tone: 'neutral', icon: 'Prohibit' },
};

export const invoiceStatusLabels: Record<InvoiceStatus, StatusLabel> = {
  draft: { label: 'Entwurf', tone: 'neutral', icon: 'PencilSimple' },
  issued: { label: 'Gestellt', tone: 'info', icon: 'Receipt' },
  cancelled: { label: 'Storniert', tone: 'neutral', icon: 'XCircle' },
};

export const findingStatusLabels: Record<FindingStatus, StatusLabel> = {
  new: { label: 'Neu, noch nicht gemeldet', tone: 'neutral', icon: 'NotePencil' },
  reported: { label: 'An Service gemeldet', tone: 'warning', icon: 'Bell' },
  converted: { label: 'In Freigabeanfrage übernommen', tone: 'success', icon: 'CheckCircle' },
  dismissed: { label: 'Verworfen', tone: 'neutral', icon: 'Prohibit' },
};

export const visibilityLabels: Record<Visibility, StatusLabel> = {
  internal: { label: 'Intern', tone: 'neutral', icon: 'Lock' },
  customer: { label: 'Für Kunden sichtbar', tone: 'info', icon: 'Eye' },
};

export const photoContextLabels: Record<PhotoContext, string> = {
  intake: 'Annahme',
  finding: 'Feststellung',
  work: 'Arbeit',
  chat: 'Chat',
  approval: 'Freigabe',
};

export const resourceKindLabels: Record<ResourceKind, string> = {
  lift: 'Hebebühne',
  bay: 'Stellplatz',
  diagnosis: 'Diagnoseplatz',
  other: 'Sonstiges',
};

export const conflictLabels: Record<SchedulingConflict['kind'], StatusLabel> = {
  resource_double_booked: { label: 'Hebebühne doppelt belegt', tone: 'danger', icon: 'Warning' },
  assignee_double_booked: { label: 'Mitarbeiter doppelt eingeplant', tone: 'danger', icon: 'Warning' },
  outside_working_hours: { label: 'Außerhalb der Arbeitszeit', tone: 'warning', icon: 'Clock' },
  outside_opening_hours: { label: 'Außerhalb der Öffnungszeiten', tone: 'warning', icon: 'Clock' },
  parts_missing: { label: 'Teile fehlen', tone: 'warning', icon: 'Package' },
};

/** Fehler einer Aktion direkt in der Ansicht anzeigen (Text vom Server, deutsch). */
export function ActionError({ error, title = 'Nicht gespeichert' }: { error: ApiError | null; title?: string }) {
  if (!error) return null;
  const message = error.isNetwork ? 'Keine Verbindung. Bitte prüfen Sie die Internetverbindung und versuchen Sie es erneut.' : error.message;
  return <Banner tone="danger" title={title} message={message} testID="aktion-fehler" />;
}

/** Freie Suche in mehreren Feldern (Kleinbuchstaben, Kennzeichen ohne Leerzeichen). */
export function matchesQuery(q: string, ...values: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const compact = needle.replace(/[\s-]/g, '');
  return values.some((v) => {
    if (!v) return false;
    const hay = v.toLowerCase();
    return hay.includes(needle) || hay.replace(/[\s-]/g, '').includes(compact);
  });
}

/** Verweis im Fließtext bzw. in Schlüssel-Wert-Listen (links ausgerichtet, unterstrichen). */
export function InlineLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} testID={testID} style={({ pressed }) => [{ minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' }, pressed ? { opacity: 0.7 } : null]}>
      <AppText tone="accent" style={{ textDecorationLine: 'underline', fontWeight: '600' }}>
        {label}
      </AppText>
    </Pressable>
  );
}
