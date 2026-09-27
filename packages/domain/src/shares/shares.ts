/**
 * Öffentliche Ansichten ohne Anmeldung (docs/rollen-und-rechte.md, Abschnitt 4; R-QR-1 bis R-QR-4).
 *
 * Der QR-Code ist kein Generalschlüssel: Die öffentlichen Ansichten werden hier aus erlaubten
 * Feldern NEU aufgebaut (kein Kopieren ganzer Datensätze), damit Kundennamen, Kontaktdaten,
 * Kennzeichen, Preise, Rechnungen, Dokumente, Nachrichten und Auftragsbezüge nie enthalten sind.
 */
import type { PublicServiceEntry, PublicVehicleView, ServiceEntryStatus } from '@werkstatt/contracts';
import { toDate, type IsoDate } from '../common/dates';
import { sha256Hex } from '../common/hash';

/** SHA-256 (hex) eines Tokens (Freigabe-Link, Sitzung, Einladung). Gespeichert wird nur der Hash. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Fahrzeugfreigabe für Dritte (Tabelle `vehicle_shares`). */
export interface ShareState {
  includeVin: boolean;
  serviceEntryIds: readonly string[];
  expiresAt: string;
  revokedAt: string | null;
}

/** Aktiv, wenn nicht widerrufen und noch nicht abgelaufen. */
export function isShareActive(share: Pick<ShareState, 'expiresAt' | 'revokedAt'>, now: Date): boolean {
  return share.revokedAt === null && toDate(share.expiresAt).getTime() > now.getTime();
}

/** Fahrzeugdaten, aus denen öffentliche Ansichten gebaut werden dürfen. */
export interface PublicVehicleSource {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  vin: string | null;
  qrPublicViewEnabled: boolean;
}

/** Serviceeintrag als Quelle (nur benötigte Felder). */
export interface PublicEntrySource {
  id: string;
  vehicleId: string;
  status: ServiceEntryStatus;
  revisionOfId: string | null;
  performedOn: IsoDate;
  odometerKm: number | null;
  title: string;
  details: string | null;
  workshopName: string;
  nextDueDate: IsoDate | null;
  nextDueKm: number | null;
  maintenanceTypeName: string | null;
  revisionNo: number;
}

function toPublicEntry(e: PublicEntrySource): PublicServiceEntry {
  return {
    performedOn: e.performedOn,
    odometerKm: e.odometerKm,
    title: e.title,
    details: e.details,
    workshopName: e.workshopName,
    nextDueDate: e.nextDueDate,
    nextDueKm: e.nextDueKm,
    maintenanceTypeName: e.maintenanceTypeName,
    revisionNo: e.revisionNo,
  };
}

function byDateDesc(a: PublicEntrySource, b: PublicEntrySource): number {
  return a.performedOn < b.performedOn ? 1 : a.performedOn > b.performedOn ? -1 : 0;
}

/**
 * Ansicht für eine Fahrzeugfreigabe `/f/<token>`: nur die ausgewählten, gültigen Einträge
 * dieses Fahrzeugs (wurde ein ausgewählter Eintrag später korrigiert, erscheint seine gültige
 * Revision), Marke/Modell, FIN nur mit `includeVin`. Keine Preise, Kundendaten oder
 * Auftrags-IDs. Liefert `null`, wenn die Freigabe widerrufen oder abgelaufen ist.
 */
export function publicViewFromShare(
  vehicle: PublicVehicleSource,
  entries: readonly PublicEntrySource[],
  share: ShareState,
  options: { now: Date; workshopName: string },
): PublicVehicleView | null {
  if (!isShareActive(share, options.now)) return null;
  const selected = new Set(share.serviceEntryIds);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const isSelected = (entry: PublicEntrySource): boolean => {
    let current: PublicEntrySource | undefined = entry;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (selected.has(current.id)) return true;
      seen.add(current.id);
      current = current.revisionOfId ? byId.get(current.revisionOfId) : undefined;
    }
    return false;
  };
  const visible = entries.filter((e) => e.vehicleId === vehicle.id && e.status === 'valid' && isSelected(e)).sort(byDateDesc);
  return {
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    vin: share.includeVin ? vehicle.vin : null,
    entries: visible.map(toPublicEntry),
    source: 'share',
    expiresAt: toDate(share.expiresAt).toISOString(),
    workshopName: options.workshopName,
  };
}

/**
 * Öffentliche QR-Kurzansicht `/q/<token>` ohne Anmeldung: nur wenn der aktuelle Halter sie
 * eingeschaltet hat (`qrPublicViewEnabled`), sonst `null` (dann nur Hinweis und Anmeldung).
 * Zeigt Marke, Modell und gültige Serviceeinträge; nie FIN, nie Kennzeichen.
 */
export function publicViewFromQr(
  vehicle: PublicVehicleSource,
  entries: readonly PublicEntrySource[],
  options: { workshopName: string },
): PublicVehicleView | null {
  if (!vehicle.qrPublicViewEnabled) return null;
  const visible = entries.filter((e) => e.vehicleId === vehicle.id && e.status === 'valid').sort(byDateDesc);
  return {
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    vin: null,
    entries: visible.map(toPublicEntry),
    source: 'qr_public_view',
    expiresAt: null,
    workshopName: options.workshopName,
  };
}
