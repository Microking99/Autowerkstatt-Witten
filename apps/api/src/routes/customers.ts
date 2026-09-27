/**
 * Kunden (R-KUN): Liste mit Suche/Filter, Akte, Anlage, Änderung, Archiv, App-Zugang.
 * Kundendatensatz ≠ Kundenkonto: Das Konto entsteht erst über eine Einladung.
 */
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  CustomerDetailSchema,
  CustomerInputSchema,
  CustomerSummarySchema,
  InviteCustomerRequestSchema,
  PageSchema,
} from '@werkstatt/contracts';
import { canViewCustomer, hasPermission, licensePlateSearchKey } from '@werkstatt/domain';
import { customerAccounts, customers, invoices, payments, users, vehicleOwnerships, vehicles } from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { badRequest, conflict } from '../lib/errors';
import { patchSchema } from '../lib/schemas';
import { IdParamsSchema, PageQuerySchema, decodeCursor, ensure, ensureFound, page, requireActor } from '../lib/http';
import { createInvitation, invitationLink, sendInvitationMail } from '../auth/invitations';
import { revokeAllSessions } from '../auth/session';
import { customerStats, nextCustomerNumber, toCustomerDetail, toCustomerSummary } from '../services/customers';
import type { App } from '../types';

/** PATCH: nur übermittelte Felder ändern (ohne Standardwerte, sonst würden z. B. Testdaten-Kennzeichen gelöscht) */
const CustomerPatchSchema = patchSchema(CustomerInputSchema);

const ListQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  access: z.enum(['none', 'invited', 'active', 'disabled']).optional(),
  openItems: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false']).optional(),
});

export async function customerRoutes(app: App): Promise<void> {
  app.get('/customers', { schema: { querystring: ListQuerySchema, response: { 200: PageSchema(CustomerSummarySchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const q = request.query;
    const conditions: (SQL | undefined)[] = [];
    if (actor.role === 'customer') {
      // Kunden sehen nur den eigenen Datensatz
      conditions.push(actor.customerId ? eq(customers.id, actor.customerId) : sql`false`);
    } else {
      ensure(hasPermission(actor, 'customers.read'));
      if (q.archived !== 'true') conditions.push(isNull(customers.archivedAt));
    }
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const plateKey = licensePlateSearchKey(q.q);
      conditions.push(
        or(
          ilike(customers.lastName, like),
          ilike(customers.firstName, like),
          ilike(customers.companyName, like),
          ilike(customers.customerNumber, like),
          sql`${customers.email}::text ILIKE ${like}`,
          ilike(customers.phone, like),
          ilike(customers.mobile, like),
          plateKey.length >= 2
            ? sql`EXISTS (SELECT 1 FROM ${vehicleOwnerships} o JOIN ${vehicles} v ON v.id = o.vehicle_id
                 WHERE o.customer_id = ${customers.id} AND o.ended_at IS NULL AND v.license_plate_normalized LIKE ${`%${plateKey}%`})`
            : undefined,
        ),
      );
    }
    if (q.access) {
      conditions.push(
        q.access === 'none'
          ? sql`NOT EXISTS (SELECT 1 FROM ${customerAccounts} ca WHERE ca.customer_id = ${customers.id})`
          : sql`EXISTS (SELECT 1 FROM ${customerAccounts} ca JOIN ${users} u ON u.id = ca.user_id WHERE ca.customer_id = ${customers.id} AND u.status = ${q.access})`,
      );
    }
    if (q.openItems === 'true') {
      conditions.push(sql`EXISTS (SELECT 1 FROM ${invoices} i WHERE i.customer_id = ${customers.id} AND i.status = 'issued'
        AND i.total_gross_cents > COALESCE((SELECT sum(p.amount_cents) FROM ${payments} p WHERE p.invoice_id = i.id), 0))`);
    }
    const offset = decodeCursor(q.cursor);
    const rows = await db
      .select()
      .from(customers)
      .where(and(...conditions))
      .orderBy(asc(customers.lastName), asc(customers.companyName), asc(customers.customerNumber))
      .limit(q.limit + 1)
      .offset(offset);
    const stats = await customerStats(db, rows.map((r) => r.id));
    return page(
      rows.map((r) => toCustomerSummary(r, stats.get(r.id)!, actor)),
      offset,
      q.limit,
    );
  });

  app.post('/customers', { schema: { body: CustomerInputSchema, response: { 201: CustomerDetailSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'customers.write'));
    const { db } = app.deps;
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({ ...request.body, customerNumber: await nextCustomerNumber(tx) })
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'customer.created', entityType: 'customer', entityId: row!.id });
      return row!;
    });
    return reply.code(201).send(await toCustomerDetail(db, created, actor));
  });

  app.get('/customers/:id', { schema: { params: IdParamsSchema, response: { 200: CustomerDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    ensure(canViewCustomer(actor, { id: request.params.id }));
    const [row] = await db.select().from(customers).where(eq(customers.id, request.params.id));
    return toCustomerDetail(db, ensureFound(row), actor);
  });

  app.patch(
    '/customers/:id',
    { schema: { params: IdParamsSchema, body: CustomerPatchSchema, response: { 200: CustomerDetailSchema } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'customers.write'));
      const { db } = app.deps;
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(customers).where(eq(customers.id, request.params.id)).for('update');
        ensureFound(current);
        // Ergebnis muss weiterhin dem Vertrag entsprechen (z. B. Nachname bzw. Firmenname)
        const merged = CustomerInputSchema.safeParse({ ...current, ...request.body });
        if (!merged.success) {
          throw badRequest('Die Eingaben sind ungültig.', merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })), 'validation_failed');
        }
        const [row] = await tx.update(customers).set(request.body).where(eq(customers.id, request.params.id)).returning();
        await audit(tx, auditContextFrom(request), { action: 'customer.updated', entityType: 'customer', entityId: row!.id, data: { fields: Object.keys(request.body) } });
        return row!;
      });
      return toCustomerDetail(db, updated, actor);
    },
  );

  app.post('/customers/:id/archive', { schema: { params: IdParamsSchema, response: { 200: CustomerDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'customers.write'));
    const { db, now } = app.deps;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(customers).set({ archivedAt: now() }).where(eq(customers.id, request.params.id)).returning();
      ensureFound(row);
      await audit(tx, auditContextFrom(request), { action: 'customer.archived', entityType: 'customer', entityId: row!.id });
      return row!;
    });
    return toCustomerDetail(db, updated, actor);
  });

  app.post(
    '/customers/:id/account/invite',
    { schema: { params: IdParamsSchema, body: InviteCustomerRequestSchema, response: { 200: CustomerDetailSchema } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'customerAccounts.manage'));
      const { db, now: clock, config, mailer } = app.deps;
      const now = clock();
      const result = await db.transaction(async (tx) => {
        const [customer] = await tx.select().from(customers).where(eq(customers.id, request.params.id)).for('update');
        ensureFound(customer);
        const [link] = await tx
          .select({ userId: customerAccounts.userId, status: users.status, email: users.email })
          .from(customerAccounts)
          .innerJoin(users, eq(users.id, customerAccounts.userId))
          .where(eq(customerAccounts.customerId, customer!.id));
        let userId: string;
        if (link) {
          if (link.status !== 'invited') {
            throw conflict('account_exists', 'Der Kunde hat bereits einen Zugang. Gesperrte Zugänge bitte über "Zugang sperren" verwalten.');
          }
          userId = link.userId;
          if (link.email.toLowerCase() !== request.body.email.toLowerCase()) {
            const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, request.body.email));
            if (taken && taken.id !== userId) throw conflict('email_taken', 'Für diese E-Mail-Adresse gibt es bereits ein Konto.');
            await tx.update(users).set({ email: request.body.email }).where(eq(users.id, userId));
          }
        } else {
          const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, request.body.email));
          if (taken) throw conflict('email_taken', 'Für diese E-Mail-Adresse gibt es bereits ein Konto.');
          const [user] = await tx
            .insert(users)
            .values({ email: request.body.email, displayName: [customer!.firstName, customer!.lastName].filter(Boolean).join(' ') || customer!.companyName || 'Kunde', role: 'customer', status: 'invited' })
            .returning();
          await tx.insert(customerAccounts).values({ customerId: customer!.id, userId: user!.id });
          userId = user!.id;
        }
        const invitation = await createInvitation(tx, { userId, purpose: 'customer', createdBy: actor.userId, ttlDays: config.INVITATION_TTL_DAYS, now });
        await audit(tx, auditContextFrom(request), { action: 'customer_account.invited', entityType: 'customer', entityId: customer!.id, data: { userId } });
        return { customer: customer!, invitation };
      });
      await sendInvitationMail(mailer, request.log, {
        to: request.body.email,
        displayName: '',
        purpose: 'customer',
        link: invitationLink(config.APP_BASE_URL, result.invitation.token),
        expiresAt: result.invitation.expiresAt,
      });
      return toCustomerDetail(db, result.customer, actor);
    },
  );

  app.post('/customers/:id/account/disable', { schema: { params: IdParamsSchema, response: { 200: CustomerDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'customerAccounts.manage'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const customer = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(customers).where(eq(customers.id, request.params.id));
      ensureFound(row);
      const [link] = await tx.select().from(customerAccounts).where(eq(customerAccounts.customerId, row!.id));
      if (!link) throw conflict('no_account', 'Der Kunde hat keinen App-Zugang.');
      await tx.update(users).set({ status: 'disabled' }).where(eq(users.id, link.userId));
      await revokeAllSessions(tx, link.userId, now);
      await audit(tx, auditContextFrom(request), { action: 'customer_account.disabled', entityType: 'customer', entityId: row!.id, data: { userId: link.userId } });
      return row!;
    });
    return toCustomerDetail(db, customer, actor);
  });
}
