/**
 * Datenschutz: Datenexport für Betroffene (DSGVO Art. 15/20), siehe services/dataExport.ts.
 * - GET /me/export: Kunde lädt seine in der App sichtbaren Daten herunter.
 * - GET /customers/:id/export: Werkstatt (customers.read + reports.export) erstellt einen
 *   vollständigen Export zur Prüfung vor der Herausgabe.
 */
import { eq } from 'drizzle-orm';
import { canViewCustomer, hasPermission } from '@werkstatt/domain';
import { customers } from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { forbidden } from '../lib/errors';
import { IdParamsSchema, ensure, ensureFound, requireActor } from '../lib/http';
import { buildCustomerExport } from '../services/dataExport';
import type { App } from '../types';

export async function privacyRoutes(app: App): Promise<void> {
  app.get('/me/export', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const actor = requireActor(request);
    if (actor.role !== 'customer' || !actor.customerId) {
      throw forbidden('Der Selbstexport ist für Kundenkonten vorgesehen. Mitarbeiterdaten stellt der Inhaber bereit.');
    }
    const result = await buildCustomerExport(app.deps, actor.customerId, 'self');
    await audit(app.deps.db, auditContextFrom(request), {
      action: 'export.customer_data',
      entityType: 'customer',
      entityId: actor.customerId,
      data: { scope: 'self', counts: result.counts },
    });
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="${result.fileName}"`)
      .header('cache-control', 'no-store')
      .send(Buffer.from(result.zip));
  });

  app.get('/customers/:id/export', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(canViewCustomer(actor, { id: request.params.id }));
    // Kunden scheitern bereits oben (404 für fremde, 403 für den eigenen Datensatz über /me/export)
    if (actor.role === 'customer') throw forbidden('Bitte den Selbstexport unter Konto verwenden.');
    ensure(hasPermission(actor, 'customers.read'));
    ensure(hasPermission(actor, 'reports.export'));
    const [row] = await app.deps.db.select({ id: customers.id }).from(customers).where(eq(customers.id, request.params.id));
    ensureFound(row);
    const result = await buildCustomerExport(app.deps, request.params.id, 'full');
    await audit(app.deps.db, auditContextFrom(request), {
      action: 'export.customer_data',
      entityType: 'customer',
      entityId: request.params.id,
      data: { scope: 'full', counts: result.counts },
    });
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="${result.fileName}"`)
      .header('cache-control', 'no-store')
      .send(Buffer.from(result.zip));
  });
}
