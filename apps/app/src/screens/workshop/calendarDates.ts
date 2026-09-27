/**
 * Datumshilfen für den Werkstattkalender (Ortszeit des Geräts; die Werkstatt liegt in
 * Europe/Berlin, die Geräte der Mitarbeiter ebenfalls).
 */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes());
}

/** Montag der Woche */
export function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  return startOfDay(addDays(d, -day));
}

export function toDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromDateParam(value: string | undefined, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfDay(fallback);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Stunden als Dezimalzahl seit Mitternacht (Ortszeit) */
export function hoursOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}
