/**
 * Versionen einer Freigabeanfrage (docs/datenmodell.md, Abschnitt 6).
 *
 * - Eine Version ist nach dem Senden unveränderlich. Jede inhaltliche Änderung (Umfang, Preis,
 *   Terminänderung, Fotos, Dokumentversion) erzeugt eine neue Version mit neuem Hash; die
 *   bisherige wird `superseded`.
 * - Eine frühere Entscheidung verfällt nicht rückwirkend (sie bleibt an ihrer Version
 *   protokolliert), gilt aber nicht für die neue Version: Diese braucht eine neue Entscheidung.
 * - Bei identischem Inhalt (gleicher Hash) entsteht keine neue Version.
 * - Ein noch nicht gesendeter Entwurf darf überschrieben werden (keine neue Versionsnummer).
 *
 * Es gibt bewusst keine Funktion, die aus Chatnachrichten ("Ja") eine Freigabe ableitet.
 */
import type { ApprovalRequestStatus } from '@werkstatt/contracts';
import { fail, ok, type DomainIssue, type Result } from '../common/result';
import { canonicalApprovalContent, computeContentHash, type ApprovalContentInput, type CanonicalApprovalContent } from './content';

/** Neue (noch nicht gespeicherte) Version; die ID vergibt die Datenbank. */
export interface NewApprovalVersion {
  versionNo: number;
  content: CanonicalApprovalContent;
  contentHash: string;
  totalNetCents: number;
  totalGrossCents: number;
  currency: 'EUR';
  createdAt: string;
  /** `null` = Entwurf, noch nicht an den Kunden gesendet. */
  sentAt: string | null;
  supersededAt: null;
}

/** Gespeicherte Version (nur die für die Logik nötigen Felder). */
export interface ApprovalVersionState {
  id: string;
  versionNo: number;
  contentHash: string;
  sentAt: string | null;
  supersededAt: string | null;
}

/** Gespeicherte Anfrage (nur die für die Logik nötigen Felder). */
export interface ApprovalRequestState {
  id: string;
  status: ApprovalRequestStatus;
}

function buildVersion(input: ApprovalContentInput, versionNo: number, now: Date, sent: boolean): NewApprovalVersion {
  const content = canonicalApprovalContent(input);
  return {
    versionNo,
    content,
    contentHash: computeContentHash(content),
    totalNetCents: content.totalNetCents,
    totalGrossCents: content.totalGrossCents,
    currency: 'EUR',
    createdAt: now.toISOString(),
    sentAt: sent ? now.toISOString() : null,
    supersededAt: null,
  };
}

/** Erste Version einer neuen Anfrage (Entwurf, `versionNo` 1, nicht gesendet). */
export function createInitialVersion(input: ApprovalContentInput, now: Date): NewApprovalVersion {
  return buildVersion(input, 1, now, false);
}

export type ReviseApprovalCode = 'REQUEST_WITHDRAWN' | 'VERSION_NOT_CURRENT';

export type ReviseApprovalOutcome =
  /** Inhalt identisch: nichts zu tun, keine neue Version. */
  | { kind: 'unchanged'; contentHash: string }
  /** Ungesendeter Entwurf: aktuelle Version wird ersetzt (gleiche Versionsnummer). */
  | { kind: 'draft_updated'; versionId: string; version: NewApprovalVersion }
  /** Gesendete Version: neue Version (sofort an den Kunden gesendet), alte wird `superseded`. */
  | {
      kind: 'new_version';
      newVersion: NewApprovalVersion;
      supersede: { versionId: string; supersededAt: string };
      /** Die Anfrage wartet wieder auf den Kunden; eine frühere Entscheidung gilt nicht für die neue Version. */
      requestStatus: 'pending_customer';
    };

/**
 * Überarbeitet eine Freigabeanfrage.
 * Nach einer neuen Version sind die betroffenen Positionen mit {@link resetItemsForNewVersion}
 * wieder auf `pending_approval` zu setzen.
 */
export function reviseApproval(
  request: ApprovalRequestState,
  currentVersion: ApprovalVersionState,
  input: ApprovalContentInput,
  now: Date,
): Result<ReviseApprovalOutcome, DomainIssue<ReviseApprovalCode>> {
  if (request.status === 'withdrawn') {
    return fail('REQUEST_WITHDRAWN', 'Die Anfrage wurde zurückgezogen. Bitte eine neue Anfrage anlegen.');
  }
  if (currentVersion.supersededAt !== null) {
    return fail('VERSION_NOT_CURRENT', 'Die übergebene Version ist nicht mehr aktuell.');
  }
  const isUnsentDraft = request.status === 'draft' && currentVersion.sentAt === null;
  const candidate = buildVersion(input, isUnsentDraft ? currentVersion.versionNo : currentVersion.versionNo + 1, now, !isUnsentDraft);
  if (candidate.contentHash === currentVersion.contentHash) {
    return ok({ kind: 'unchanged', contentHash: currentVersion.contentHash });
  }
  if (isUnsentDraft) {
    return ok({ kind: 'draft_updated', versionId: currentVersion.id, version: candidate });
  }
  return ok({
    kind: 'new_version',
    newVersion: candidate,
    supersede: { versionId: currentVersion.id, supersededAt: now.toISOString() },
    requestStatus: 'pending_customer',
  });
}

/** Entwurf an den Kunden senden: `draft` → `pending_customer`; die Version wird unveränderlich. */
export function sendApproval(
  request: ApprovalRequestState,
  currentVersion: ApprovalVersionState,
  now: Date,
): Result<{ requestStatus: 'pending_customer'; versionId: string; sentAt: string }, DomainIssue<'NOT_DRAFT'>> {
  if (request.status !== 'draft' || currentVersion.sentAt !== null || currentVersion.supersededAt !== null) {
    return fail('NOT_DRAFT', 'Nur ein ungesendeter Entwurf kann gesendet werden.');
  }
  return ok({ requestStatus: 'pending_customer', versionId: currentVersion.id, sentAt: now.toISOString() });
}
