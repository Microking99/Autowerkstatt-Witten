/**
 * Einheitliche Fehler der Datenschicht (HttpApi und DemoApi).
 *
 * Codes: gemeinsame Liste für API und App in packages/contracts/src/errors.ts
 * (`API_ERROR_CODES`, dazu die reinen Client-Codes `network` und `response_invalid`).
 * status 0 = keine Verbindung. Für Kunden liefern fremde und nicht vorhandene Objekte
 * gleichermaßen 404 (keine Existenzpreisgabe, docs/rollen-und-rechte.md).
 */
import { API_ERROR_CODES, CLIENT_ERROR_CODES, isApprovalOutdatedCode } from '@werkstatt/contracts';

/** Codes, die die Oberfläche gezielt behandelt (Werte aus @werkstatt/contracts). */
export const ERROR_CODES = {
  ...API_ERROR_CODES,
  ...CLIENT_ERROR_CODES,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | (string & {});

export { isApprovalOutdatedCode };

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetwork(): boolean {
    return this.code === ERROR_CODES.network;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 403 und 404 werden in der Oberfläche gleich behandelt: "Nicht verfügbar". */
  get isNotAvailable(): boolean {
    return this.status === 404 || this.status === 403;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  static network(message = 'Keine Verbindung zum Server.'): ApiError {
    return new ApiError(0, ERROR_CODES.network, message);
  }

  static notFound(message = 'Nicht verfügbar.'): ApiError {
    return new ApiError(404, ERROR_CODES.notFound, message);
  }

  static forbidden(message = 'Keine Berechtigung.'): ApiError {
    return new ApiError(403, ERROR_CODES.forbidden, message);
  }

  static unauthorized(message = 'Bitte melden Sie sich an.'): ApiError {
    return new ApiError(401, ERROR_CODES.unauthorized, message);
  }

  static conflict(code: ErrorCode, message: string, details?: unknown): ApiError {
    return new ApiError(409, code, message, details);
  }

  /** Fachliche Ablehnung (422) mit Code aus der gemeinsamen Liste. */
  static unprocessable(code: ErrorCode, message: string, details?: unknown): ApiError {
    return new ApiError(422, code, message, details);
  }

  /** Ungültige Eingabe (400, `validation_failed`). */
  static validation(message: string, details?: unknown): ApiError {
    return new ApiError(400, ERROR_CODES.validationFailed, message, details);
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError(500, ERROR_CODES.internalError, error.message);
  return new ApiError(500, ERROR_CODES.internalError, 'Unbekannter Fehler');
}

/** Verständlicher Text für Fehlerzustände (Kunden werden gesiezt). */
export function describeError(error: unknown): { title: string; message: string } {
  const e = toApiError(error);
  if (e.isNetwork) {
    return {
      title: 'Keine Verbindung',
      message: 'Die Daten konnten nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
    };
  }
  if (e.status === 401) return { title: 'Sitzung abgelaufen', message: 'Bitte melden Sie sich erneut an.' };
  if (e.isNotAvailable) {
    return {
      title: 'Nicht verfügbar',
      message: 'Dieser Inhalt ist nicht vorhanden oder für Ihr Konto nicht freigegeben.',
    };
  }
  if (e.isConflict || e.status === 422 || e.status === 410 || e.status === 400) return { title: 'Nicht möglich', message: e.message };
  return {
    title: 'Etwas ist schiefgelaufen',
    message: 'Der Server hat einen Fehler gemeldet. Bitte versuchen Sie es in einigen Minuten erneut.',
  };
}
