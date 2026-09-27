import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/index';
import { customerAccounts, users } from '../db/schema/index';

/** Aktives Kundenkonto zum Kundendatensatz (null, wenn der Kunde keinen App-Zugang hat). */
export async function customerUserId(db: DbOrTx, customerId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: customerAccounts.userId })
    .from(customerAccounts)
    .innerJoin(users, eq(users.id, customerAccounts.userId))
    .where(and(eq(customerAccounts.customerId, customerId), eq(users.status, 'active')));
  return row?.userId ?? null;
}
