/**
 * Öffentliche Zugänge ohne Anmeldung (docs/rollen-und-rechte.md, Abschnitt 4; R-QR-1 bis R-QR-4).
 *
 * - QR-Code: kein Generalschlüssel. Ohne Berechtigung nur Hinweis + Anmeldung; Kurzansicht
 *   nur, wenn der aktuelle Halter sie eingeschaltet hat (ohne Namen, Kennzeichen, FIN, Preise).
 * - Fahrzeugfreigabe für Kaufinteressenten: nur ausgewählte Einträge, befristet, widerrufbar,
 *   Zugriffe werden gezählt; Token nur als Hash gespeichert.
 *
 * Platzhalter für @werkstatt/domain; reine Funktionen.
 */
import type { PublicVehicleView, QrResolution } from '@werkstatt/contracts';
import { ApiError, ERROR_CODES } from '../../errors';
import type { DOwnership, DServiceEntry, DVehicle, DVehicleShare } from '../model';
import { currentOwnerId } from './access';
import { sha256Hex } from './hash';
import { visibleEntries } from './serviceHistory';

const MAX_SHARE_DAYS = 90;

function publicEntries(entries: readonly DServiceEntry[]) {
  return entries.map((e) => ({
    performedOn: e.performedOn,
    odometerKm: e.odometerKm,
    title: e.title,
    details: e.details,
    workshopName: e.workshopName,
    nextDueDate: e.nextDueDate,
    nextDueKm: e.nextDueKm,
    maintenanceTypeName: e.title,
    revisionNo: e.revisionNo,
  }));
}

export type QrViewer =
  | { kind: 'anonymous' }
  | { kind: 'customer'; customerId: string }
  | { kind: 'staff'; canReadVehicles: boolean; homePath: string };

export function resolveQr(args: {
  token: string;
  vehicles: readonly DVehicle[];
  ownerships: readonly DOwnership[];
  entries: readonly DServiceEntry[];
  viewer: QrViewer;
  workshopName: string;
}): QrResolution {
  const vehicle = args.vehicles.find((v) => v.qrToken === args.token && v.archivedAt === null);
  if (!vehicle) throw new ApiError(404, ERROR_CODES.tokenInvalid, 'Code nicht gefunden.');

  const viewer = args.viewer;
  if (viewer.kind === 'customer' && currentOwnerId(args.ownerships, vehicle.id) === viewer.customerId) {
    return { mode: 'authorized', vehicleId: vehicle.id, targetPath: `/kunde/fahrzeuge/${vehicle.id}` };
  }
  if (viewer.kind === 'staff' && viewer.canReadVehicles) {
    return { mode: 'authorized', vehicleId: vehicle.id, targetPath: `/werkstatt/fahrzeuge/${vehicle.id}` };
  }
  if (vehicle.qrPublicViewEnabled) {
    return {
      mode: 'public',
      view: {
        make: vehicle.make,
        model: vehicle.model,
        variant: vehicle.variant,
        vin: null,
        entries: publicEntries(visibleEntries(args.entries, vehicle.id)),
        source: 'qr_public_view',
        expiresAt: null,
        workshopName: args.workshopName,
      },
    };
  }
  return { mode: 'login_required', workshopName: args.workshopName };
}

export function hashShareToken(token: string): string {
  return sha256Hex(`share:${token}`);
}

export function createShare(args: {
  id: string;
  token: string;
  vehicle: DVehicle;
  customerId: string;
  userId: string;
  ownerships: readonly DOwnership[];
  entries: readonly DServiceEntry[];
  input: { label: string; serviceEntryIds: string[]; includeVin?: boolean; expiresAt: string };
  now: string;
  baseUrl: string;
}): { share: DVehicleShare; shareUrl: string } {
  if (currentOwnerId(args.ownerships, args.vehicle.id) !== args.customerId) throw ApiError.notFound();
  const valid = new Set(visibleEntries(args.entries, args.vehicle.id).map((e) => e.id));
  if (args.input.serviceEntryIds.length === 0) throw ApiError.validation('Bitte mindestens einen Eintrag auswählen.');
  if (args.input.serviceEntryIds.some((id) => !valid.has(id))) throw ApiError.validation('Ungültige Auswahl.');
  const expires = Date.parse(args.input.expiresAt);
  const now = Date.parse(args.now);
  if (!(expires > now)) throw ApiError.validation('Das Ablaufdatum muss in der Zukunft liegen.');
  if (expires - now > MAX_SHARE_DAYS * 86_400_000) {
    throw ApiError.validation(`Eine Freigabe kann höchstens ${MAX_SHARE_DAYS} Tage gelten.`);
  }
  return {
    shareUrl: `${args.baseUrl}/f/${args.token}`,
    share: {
      id: args.id,
      vehicleId: args.vehicle.id,
      customerId: args.customerId,
      createdByUserId: args.userId,
      tokenHash: hashShareToken(args.token),
      label: args.input.label.trim(),
      includeVin: args.input.includeVin ?? false,
      serviceEntryIds: [...args.input.serviceEntryIds],
      expiresAt: new Date(expires).toISOString(),
      revokedAt: null,
      accessCount: 0,
      lastAccessedAt: null,
      createdAt: args.now,
    },
  };
}

export function revokeShare(share: DVehicleShare, customerId: string, ownerships: readonly DOwnership[], now: string): DVehicleShare {
  if (share.customerId !== customerId || currentOwnerId(ownerships, share.vehicleId) !== customerId) throw ApiError.notFound();
  if (share.revokedAt) return share;
  return { ...share, revokedAt: now };
}

/** Öffentlicher Abruf einer Freigabe; zählt den Zugriff. */
export function openShare(args: {
  token: string;
  shares: readonly DVehicleShare[];
  vehicles: readonly DVehicle[];
  ownerships: readonly DOwnership[];
  entries: readonly DServiceEntry[];
  now: string;
  workshopName: string;
}): { share: DVehicleShare; view: PublicVehicleView } {
  const hash = hashShareToken(args.token);
  const share = args.shares.find((s) => s.tokenHash === hash);
  if (!share) throw new ApiError(404, ERROR_CODES.tokenInvalid, 'Dieser Link ist ungültig.');
  if (share.revokedAt) throw new ApiError(410, ERROR_CODES.shareRevoked, 'Diese Freigabe wurde vom Halter widerrufen.');
  if (Date.parse(share.expiresAt) <= Date.parse(args.now)) {
    throw new ApiError(410, ERROR_CODES.shareExpired, 'Diese Freigabe ist abgelaufen.');
  }
  // Nach einem Halterwechsel gilt die Freigabe des Vorbesitzers nicht mehr.
  if (currentOwnerId(args.ownerships, share.vehicleId) !== share.customerId) {
    throw new ApiError(410, ERROR_CODES.shareRevoked, 'Diese Freigabe ist nicht mehr gültig.');
  }
  const vehicle = args.vehicles.find((v) => v.id === share.vehicleId);
  if (!vehicle) throw new ApiError(404, ERROR_CODES.tokenInvalid, 'Dieser Link ist ungültig.');
  const selected = new Set(share.serviceEntryIds);
  // Korrigierte Einträge: der aktuelle gültige Stand einer ausgewählten Revisionskette zählt.
  const entries = visibleEntries(args.entries, vehicle.id).filter(
    (e) => selected.has(e.id) || (e.revisionOfId !== null && rootSelected(e, args.entries, selected)),
  );
  return {
    share: { ...share, accessCount: share.accessCount + 1, lastAccessedAt: args.now },
    view: {
      make: vehicle.make,
      model: vehicle.model,
      variant: vehicle.variant,
      vin: share.includeVin ? vehicle.vin : null,
      entries: publicEntries(entries),
      source: 'share',
      expiresAt: share.expiresAt,
      workshopName: args.workshopName,
    },
  };
}

function rootSelected(entry: DServiceEntry, all: readonly DServiceEntry[], selected: Set<string>): boolean {
  let current: DServiceEntry | undefined = entry;
  while (current?.revisionOfId) {
    if (selected.has(current.revisionOfId)) return true;
    current = all.find((e) => e.id === current?.revisionOfId);
  }
  return false;
}
