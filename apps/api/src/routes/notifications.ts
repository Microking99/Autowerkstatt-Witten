/**
 * Benachrichtigungen (in-app), Geräte für Push, persönliche Einstellungen je Ereignis/Kanal.
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  NOTIFICATION_EVENTS,
  NotificationPreferencesRequestSchema,
  NotificationSchema,
  RegisterDeviceRequestSchema,
} from '@werkstatt/contracts';
import { devices, notificationPreferences, notifications } from '../db/schema/index';
import { IdParamsSchema, ensureFound, requireActor } from '../lib/http';
import { loadSettings } from '../services/settings';
import type { App } from '../types';

export async function notificationRoutes(app: App): Promise<void> {
  app.get(
    '/notifications',
    { schema: { querystring: z.object({ unread: z.enum(['true', 'false']).optional() }), response: { 200: z.array(NotificationSchema) } } },
    async (request) => {
      const actor = requireActor(request);
      const rows = await app.deps.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, actor.userId), eq(notifications.channel, 'in_app')))
        .orderBy(desc(notifications.createdAt))
        .limit(200);
      return rows
        .filter((r) => request.query.unread !== 'true' || r.readAt === null)
        .map((r) => ({
          id: r.id,
          eventType: r.eventType as (typeof NOTIFICATION_EVENTS)[number],
          title: r.title,
          body: r.body,
          targetPath: r.targetPath,
          createdAt: r.createdAt.toISOString(),
          readAt: r.readAt ? r.readAt.toISOString() : null,
        }));
    },
  );

  app.post('/notifications/:id/read', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    const [row] = await app.deps.db
      .update(notifications)
      .set({ readAt: app.deps.now() })
      .where(and(eq(notifications.id, request.params.id), eq(notifications.userId, actor.userId)))
      .returning({ id: notifications.id });
    ensureFound(row);
    return reply.code(204).send();
  });

  app.post('/devices', { schema: { body: RegisterDeviceRequestSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    const now = app.deps.now();
    // Ein Push-Token gehört immer genau einem Konto (Gerät kann den Besitzer wechseln)
    await app.deps.db
      .insert(devices)
      .values({ userId: actor.userId, platform: request.body.platform, pushToken: request.body.pushToken, lastSeenAt: now })
      .onConflictDoUpdate({ target: devices.pushToken, set: { userId: actor.userId, platform: request.body.platform, lastSeenAt: now, disabledAt: null } });
    return reply.code(204).send();
  });

  const loadPreferences = async (userId: string) => {
    const { db } = app.deps;
    const stored = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    const settings = await loadSettings(db);
    const preferences = NOTIFICATION_EVENTS.flatMap((eventType) =>
      (['push', 'email'] as const).map((channel) => {
        const own = stored.find((p) => p.eventType === eventType && p.channel === channel);
        const fallback = settings.notificationDefaults?.[eventType]?.[channel] ?? true;
        return { eventType, channel, enabled: own ? own.enabled : fallback };
      }),
    );
    return { preferences };
  };

  app.get('/notification-preferences', { schema: { response: { 200: NotificationPreferencesRequestSchema } } }, async (request) => {
    const actor = requireActor(request);
    return loadPreferences(actor.userId);
  });

  app.put(
    '/notification-preferences',
    { schema: { body: NotificationPreferencesRequestSchema, response: { 200: NotificationPreferencesRequestSchema } } },
    async (request) => {
      const actor = requireActor(request);
      const { db } = app.deps;
      for (const p of request.body.preferences) {
        await db
          .insert(notificationPreferences)
          .values({ userId: actor.userId, eventType: p.eventType, channel: p.channel, enabled: p.enabled })
          .onConflictDoUpdate({
            target: [notificationPreferences.userId, notificationPreferences.eventType, notificationPreferences.channel],
            set: { enabled: p.enabled },
          });
      }
      return loadPreferences(actor.userId);
    },
  );
}
