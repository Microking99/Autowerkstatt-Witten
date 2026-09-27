/**
 * Gemeinsame Ergebnis- und Fehlertypen der Geschäftslogik.
 *
 * Fachliche Ablehnungen (z. B. "Erstattung übersteigt den erstattbaren Betrag") werden als
 * Ergebnis zurückgegeben, nicht geworfen. Geworfen wird nur bei Programmierfehlern bzw.
 * ungültigen Eingaben, die vorher per Schema hätten abgewiesen werden müssen ({@link DomainError}).
 */

/** Fachlicher Fehler mit maschinenlesbarem Code und deutscher Meldung. */
export interface DomainIssue<C extends string = string> {
  code: C;
  message: string;
}

/** Erfolgreiches Ergebnis. */
export interface Ok<T> {
  ok: true;
  value: T;
}

/** Fehlgeschlagenes Ergebnis. */
export interface Err<E> {
  ok: false;
  error: E;
}

/** Ergebnis einer fachlichen Prüfung oder Berechnung. */
export type Result<T, E> = Ok<T> | Err<E>;

/** Erzeugt ein erfolgreiches Ergebnis. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Erzeugt ein fehlgeschlagenes Ergebnis. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Erzeugt einen fehlgeschlagenen {@link DomainIssue}. */
export function fail<C extends string>(code: C, message: string): Err<DomainIssue<C>> {
  return { ok: false, error: { code, message } };
}

/**
 * Wird bei ungültigen Eingaben geworfen, die die aufrufende Schicht (API, App) vorher hätte
 * abweisen müssen, z. B. ein nicht zuweisbares Recht in gespeicherten Overrides.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
