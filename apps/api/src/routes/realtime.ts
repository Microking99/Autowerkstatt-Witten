/**
 * WebSocket `/api/v1/realtime`.
 * Ablauf: erste Nachricht `{type:'auth', token}` (innerhalb von 10 s), danach
 * `{type:'subscribe', workOrderId}` – nur nach Rechteprüfung (canViewWorkOrder). Ereignisse:
 * neue Nachrichten (nur mit Chat-Sicht) und Statusänderungen. Die Sitzung wird regelmäßig neu
 * geprüft; widerrufene Sitzungen oder deaktivierte Konten werden getrennt.
 *
 * Prozessintern: bei mehreren API-Instanzen ist PostgreSQL LISTEN/NOTIFY nötig (siehe hub.ts).
 */
import { z } from 'zod';
import { canViewMessages, canViewWorkOrder, type Actor } from '@werkstatt/domain';
import { resolveSession } from '../auth/session';
import { loadWorkOrder } from '../services/access';
import type { RealtimeEvent, RealtimeSubscriber } from '../realtime/hub';
import type { App } from '../types';

const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(20).max(200) }),
  z.object({ type: z.literal('subscribe'), workOrderId: z.string().uuid() }),
  z.object({ type: z.literal('unsubscribe'), workOrderId: z.string().uuid() }),
  z.object({ type: z.literal('ping') }),
]);

export const WS_CLOSE_UNAUTHORIZED = 4401;
const AUTH_TIMEOUT_MS = 10_000;
const RECHECK_MS = 60_000;

export async function realtimeRoutes(app: App): Promise<void> {
  app.get('/realtime', { websocket: true }, (socket) => {
    const { db, realtime, now } = app.deps;
    let actor: Actor | null = null;
    let token: string | null = null;
    const chatVisible = new Map<string, boolean>();
    const send = (payload: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };
    const subscriber: RealtimeSubscriber = {
      userId: '',
      isStaff: false,
      canSeeMessages: (workOrderId) => chatVisible.get(workOrderId) === true,
      send: (event: RealtimeEvent) => send({ type: 'event', event }),
    };
    const authTimer = setTimeout(() => {
      if (!actor) socket.close(WS_CLOSE_UNAUTHORIZED, 'auth_timeout');
    }, AUTH_TIMEOUT_MS);
    const recheck = setInterval(() => {
      if (!token) return;
      void resolveSession(db, token, now()).then((resolved) => {
        if (!resolved) socket.close(WS_CLOSE_UNAUTHORIZED, 'session_ended');
        else actor = resolved.actor;
      });
    }, RECHECK_MS);

    let queue: Promise<void> = Promise.resolve();
    const handle = async (raw: string) => {
      let parsed: z.infer<typeof ClientMessageSchema>;
      try {
        parsed = ClientMessageSchema.parse(JSON.parse(raw));
      } catch {
        send({ type: 'error', code: 'bad_message', message: 'Ungültige Nachricht.' });
        return;
      }
      if (parsed.type === 'ping') {
        send({ type: 'pong' });
        return;
      }
      if (parsed.type === 'auth') {
        const resolved = await resolveSession(db, parsed.token, now());
        if (!resolved) {
          send({ type: 'error', code: 'unauthorized', message: 'Anmeldung ungültig.' });
          socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
          return;
        }
        clearTimeout(authTimer);
        actor = resolved.actor;
        token = parsed.token;
        subscriber.userId = actor.userId;
        subscriber.isStaff = actor.role !== 'customer';
        send({ type: 'auth_ok' });
        return;
      }
      if (!actor) {
        send({ type: 'error', code: 'unauthorized', message: 'Zuerst anmelden.' });
        socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
      if (parsed.type === 'unsubscribe') {
        realtime.unsubscribe(parsed.workOrderId, subscriber);
        chatVisible.delete(parsed.workOrderId);
        send({ type: 'unsubscribed', workOrderId: parsed.workOrderId });
        return;
      }
      // subscribe: gleiche Regeln wie GET /work-orders/:id; keine Existenzpreisgabe
      const loaded = await loadWorkOrder(db, parsed.workOrderId);
      const decision = loaded ? canViewWorkOrder(actor, loaded.access) : null;
      if (!loaded || !decision || !decision.allowed) {
        const code = !loaded || !decision || (!decision.allowed && decision.notFound) ? 'not_found' : 'forbidden';
        send({ type: 'error', code, workOrderId: parsed.workOrderId, message: 'Abonnement abgelehnt.' });
        return;
      }
      chatVisible.set(parsed.workOrderId, canViewMessages(actor, loaded.access).allowed);
      realtime.subscribe(parsed.workOrderId, subscriber);
      send({ type: 'subscribed', workOrderId: parsed.workOrderId });
    };

    socket.on('message', (data: Buffer) => {
      const raw = data.toString('utf8');
      queue = queue.then(() => handle(raw)).catch(() => send({ type: 'error', code: 'internal_error', message: 'Interner Fehler.' }));
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(recheck);
      realtime.unsubscribeAll(subscriber);
    });
  });
}
