import { z } from 'zod';

/**
 * Teil-Schema für PATCH: alle Felder optional und OHNE Standardwerte. In zod 4 greifen
 * `.default()`-Werte auch innerhalb von `.partial()`; ein PATCH ohne ein Feld würde es sonst
 * auf den Standardwert zurücksetzen (z. B. Zuweisungen leeren, Testdaten-Kennzeichen löschen).
 */
export function patchSchema<S extends z.ZodObject>(schema: S): ReturnType<S['partial']> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    let t: z.ZodType = value;
    if (t instanceof z.ZodOptional) t = t.unwrap() as z.ZodType;
    if (t instanceof z.ZodDefault) t = t.removeDefault() as z.ZodType;
    shape[key] = t.optional();
  }
  return z.object(shape) as unknown as ReturnType<S['partial']>;
}
