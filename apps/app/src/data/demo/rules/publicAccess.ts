/**
 * Öffentliche Zugänge ohne Anmeldung (docs/rollen-und-rechte.md, Abschnitt 4; R-QR-1 bis R-QR-4).
 *
 * - QR-Code: kein Generalschlüssel. Ohne Berechtigung nur Hinweis + Anmeldung; Kurzansicht
 *   nur, wenn der aktuelle Halter sie eingeschaltet hat (Domain `publicViewFromQr`).
 * - Fahrzeugfreigabe für Kaufinteressenten: nur ausgewählte Einträge, befristet, widerrufbar,
 *   Zugriffe werden gezählt; Token nur als Hash gespeichert (Domain `hashToken`,
 *   `publicViewFromShare`).
 * Fehlercodes wie in der API: unbekannt 404, abgelaufen/widerrufen 410.
 */
import { API_ERROR_CODES, type PublicVehicleView, type QrResolution } from '@werkstatt/contracts';
import { hashToken, isShareActive, publicViewFromQr, publicViewFromShare } from '@werkstatt/domain';
import { ApiError } from '../../errors';
import type { DMaintenanceType, DOwnership, DServiceEntry, DVehicle, DVehicleShare } from '../model';
import { currentOwnerId } from './access';
import { visibleEntries } from './serviceHistory';

const MAX_SHARE_DAYS = 90;

function entrySources(entries: readonly DServiceEntry[], types: readonly DMaintenanceType[]) {
  return entries.map((e) => ({ ...e, maintenanceTypeName: e.maintenanceTypeId ? (types.find((t) => t.id === e.maintenanceTypeId)?.name ?? null) : null }));
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
  maintenanceTypes?: readonly DMaintenanceType[];
  viewer: QrViewer;
  workshopName: string;
}): QrResolution {
  const vehicle = args.vehicles.find((v) => v.qrToken === args.token && v.archivedAt === null);
  if (!vehicle) throw ApiError.notFound('Code nicht gefunden.');

  const viewer = args.viewer;
  if (viewer.kind === 'customer' && currentOwnerId(args.ownerships, vehicle.id) === viewer.customerId) {
    return { mode: 'authorized', vehicleId: vehicle.id, targetPath: `/kunde/fahrzeuge/${vehicle.id}` };
  }
  if (viewer.kind === 'staff' && viewer.canReadVehicles) {
    return { mode: 'authorized', vehicleId: vehicle.id, targetPath: `/werkstatt/fahrzeuge/${vehicle.id}` };
  }
  const view = publicViewFromQr(vehicle, entrySources(args.entries, args.maintenanceTypes ?? []), { workshopName: args.workshopName });
  if (view) return { mode: 'public', view };
  return { mode: 'login_required', workshopName: args.workshopName };
}

export function hashShareToken(token: string): string {
  return hashToken(token);
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
  if (args.input.serviceEntryIds.some((id) => !valid.has(id))) throw ApiError.unprocessable(API_ERROR_CODES.invalidEntries, 'Ungültige Auswahl.');
  const expires = Date.parse(args.input.expiresAt);
  const now = Date.parse(args.now);
  if (!(expires > now)) throw ApiError.unprocessable(API_ERROR_CODES.expiresInPast, 'Das Ablaufdatum muss in der Zukunft liegen.');
  if (expires - now > MAX_SHARE_DAYS * 86_400_000) {
    throw ApiError.unprocessable(API_ERROR_CODES.expiresTooLate, `Eine Freigabe kann höchstens ${MAX_SHARE_DAYS} Tage gelten.`);
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
  maintenanceTypes?: readonly DMaintenanceType[];
  now: string;
  workshopName: string;
}): { share: DVehicleShare; view: PublicVehicleView } {
  const hash = hashShareToken(args.token);
  const share = args.shares.find((s) => s.tokenHash === hash);
  if (!share) throw ApiError.notFound('Dieser Link ist ungültig.');
  if (share.revokedAt) throw new ApiError(410, API_ERROR_CODES.shareRevoked, 'Diese Freigabe wurde vom Halter widerrufen.');
  const now = new Date(args.now);
  if (!isShareActive(share, now)) throw new ApiError(410, API_ERROR_CODES.shareExpired, 'Diese Freigabe ist abgelaufen.');
  // Nach einem Halterwechsel gilt die Freigabe des Vorbesitzers nicht mehr.
  if (currentOwnerId(args.ownerships, share.vehicleId) !== share.customerId) {
    throw new ApiError(410, API_ERROR_CODES.shareRevoked, 'Diese Freigabe ist nicht mehr gültig.');
  }
  const vehicle = args.vehicles.find((v) => v.id === share.vehicleId);
  if (!vehicle) throw ApiError.notFound('Dieser Link ist ungültig.');
  const view = publicViewFromShare(vehicle, entrySources(args.entries, args.maintenanceTypes ?? []), share, { now, workshopName: args.workshopName });
  if (!view) throw new ApiError(410, API_ERROR_CODES.shareExpired, 'Diese Freigabe ist nicht mehr gültig.');
  return { share: { ...share, accessCount: share.accessCount + 1, lastAccessedAt: args.now }, view };
}
