import type { DbOrTx } from '../db/index';
import { workshopSettings } from '../db/schema/index';

export type SettingsRow = typeof workshopSettings.$inferSelect;

export const DEFAULT_WORKSHOP_NAME = 'Autowerkstatt Witten';

/** Werkstatt-Einstellungen (genau eine Zeile, id = 1); legt die Zeile bei Bedarf an. */
export async function loadSettings(db: DbOrTx): Promise<SettingsRow> {
  const [row] = await db.select().from(workshopSettings).limit(1);
  if (row) return row;
  await db.insert(workshopSettings).values({ id: 1, name: DEFAULT_WORKSHOP_NAME }).onConflictDoNothing();
  const [created] = await db.select().from(workshopSettings).limit(1);
  return created!;
}
