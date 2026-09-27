/**
 * Werkstatt-Einstellungen (settings.manage): Werkstattdaten, Wartungsarten mit Intervallen,
 * Hebebühnen/Arbeitsplätze. API-Schlüssel stehen nie in der Datenbank.
 */
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { MaintenanceTypeSchema, ResourceSchema, WorkshopSettingsSchema, type WorkshopSettings } from '@werkstatt/contracts';
import { hasPermission } from '@werkstatt/domain';
import { maintenanceTypes, resources, workshopSettings } from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { conflict, forbidden } from '../lib/errors';
import { IdParamsSchema, ensure, requireActor } from '../lib/http';
import { loadSettings, type SettingsRow } from '../services/settings';
import type { App } from '../types';

const SettingsInputSchema = WorkshopSettingsSchema.omit({ paymentProviderConfigured: true });
const MaintenanceTypeInputSchema = MaintenanceTypeSchema.omit({ id: true });
const ResourceInputSchema = ResourceSchema.omit({ id: true });

export async function settingsRoutes(app: App): Promise<void> {
  const toDto = (s: SettingsRow): WorkshopSettings => ({
    name: s.name,
    legalName: s.legalName,
    street: s.street,
    postalCode: s.postalCode,
    city: s.city,
    phone: s.phone,
    email: s.email,
    website: s.website,
    vatId: s.vatId,
    iban: s.iban,
    bic: s.bic,
    bankName: s.bankName,
    openingHours: s.openingHours,
    paymentTermDays: s.paymentTermDays,
    paymentProvider: s.paymentProvider,
    sumupMerchantCode: s.sumupMerchantCode,
    paymentProviderConfigured: app.deps.payments !== null,
  });

  app.get('/settings/workshop', { schema: { response: { 200: WorkshopSettingsSchema } } }, async (request) => {
    ensure(hasPermission(requireActor(request), 'settings.manage'));
    return toDto(await loadSettings(app.deps.db));
  });

  app.put('/settings/workshop', { schema: { body: SettingsInputSchema, response: { 200: WorkshopSettingsSchema } } }, async (request) => {
    ensure(hasPermission(requireActor(request), 'settings.manage'));
    const { db } = app.deps;
    const updated = await db.transaction(async (tx) => {
      const before = await loadSettings(tx);
      const [row] = await tx.update(workshopSettings).set(request.body).where(eq(workshopSettings.id, 1)).returning();
      const changed = Object.keys(request.body).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((request.body as Record<string, unknown>)[k]));
      await audit(tx, auditContextFrom(request), { action: 'settings.updated', entityType: 'settings', entityId: '1', data: { changed } });
      return row!;
    });
    return toDto(updated);
  });

  app.get('/settings/maintenance-types', { schema: { response: { 200: z.array(MaintenanceTypeSchema) } } }, async (request) => {
    const actor = requireActor(request);
    if (actor.role === 'customer') throw forbidden();
    const rows = await app.deps.db.select().from(maintenanceTypes).orderBy(asc(maintenanceTypes.sortOrder), asc(maintenanceTypes.name));
    return rows.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      defaultIntervalKm: t.defaultIntervalKm,
      defaultIntervalMonths: t.defaultIntervalMonths,
      intervalOptions: t.intervalOptions,
      active: t.active,
    }));
  });

  app.put(
    '/settings/maintenance-types/:id',
    { schema: { params: IdParamsSchema, body: MaintenanceTypeInputSchema, response: { 200: MaintenanceTypeSchema } } },
    async (request) => {
      ensure(hasPermission(requireActor(request), 'settings.manage'));
      const { db } = app.deps;
      const row = await db.transaction(async (tx) => {
        const [sameKey] = await tx.select({ id: maintenanceTypes.id }).from(maintenanceTypes).where(eq(maintenanceTypes.key, request.body.key));
        if (sameKey && sameKey.id !== request.params.id) throw conflict('key_taken', 'Dieser Schlüssel wird bereits verwendet.');
        const [saved] = await tx
          .insert(maintenanceTypes)
          .values({ id: request.params.id, ...request.body })
          .onConflictDoUpdate({ target: maintenanceTypes.id, set: request.body })
          .returning();
        await audit(tx, auditContextFrom(request), { action: 'maintenance_type.saved', entityType: 'maintenance_type', entityId: saved!.id, data: { key: saved!.key } });
        return saved!;
      });
      return {
        id: row.id,
        key: row.key,
        name: row.name,
        defaultIntervalKm: row.defaultIntervalKm,
        defaultIntervalMonths: row.defaultIntervalMonths,
        intervalOptions: row.intervalOptions,
        active: row.active,
      };
    },
  );

  app.put('/settings/resources/:id', { schema: { params: IdParamsSchema, body: ResourceInputSchema, response: { 200: ResourceSchema } } }, async (request) => {
    ensure(hasPermission(requireActor(request), 'settings.manage'));
    const { db } = app.deps;
    const row = await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(resources)
        .values({ id: request.params.id, ...request.body })
        .onConflictDoUpdate({ target: resources.id, set: request.body })
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'resource.saved', entityType: 'resource', entityId: saved!.id, data: { name: saved!.name } });
      return saved!;
    });
    return { id: row.id, name: row.name, kind: row.kind, active: row.active };
  });
}
