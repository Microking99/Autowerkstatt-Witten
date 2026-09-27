import { describe, expect, it, vi } from 'vitest';
import type { WerkstattApi } from '../data/api';
import { DEMO_EMAILS, DEMO_PASSWORD } from '../data/demo/constants';
import { DemoApi } from '../data/demo/DemoApi';
import { IDS } from '../data/demo/seed';
import { ApiError, ERROR_CODES } from '../data/errors';
import { OfflineQueue, execute, type QueueStorage } from './OfflineQueue';
import {
  applyOutcome,
  classifyError,
  createEntry,
  discardEntry,
  idempotencyKeyOf,
  isDeviceTimeConflict,
  nextRunnable,
  occurredAtOf,
  parseStored,
  retryEntry,
  serialize,
  type QueueEntry,
} from './queueCore';

const NOW = new Date('2026-09-29T08:00:00.000Z');
let n = 0;
const uuid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;

function memoryStorage(): QueueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    load: async (k) => data.get(k) ?? null,
    save: async (k, v) => {
      data.set(k, v);
    },
  };
}

async function mechanicApi() {
  const api = new DemoApi({ latencyMs: 0, now: () => NOW });
  api.setToken((await api.login({ email: DEMO_EMAILS.mechanic, password: DEMO_PASSWORD })).token);
  return api;
}

describe('Offline-Warteschlange: reine Regeln', () => {
  const entry = (id: string, scope: string, extra: Partial<QueueEntry> = {}): QueueEntry => ({
    ...createEntry({ id, kind: 'startWorkItem', workOrderId: 'wo', scope, label: id, payload: {} }, NOW.toISOString()),
    ...extra,
  });

  it('überträgt in Erfassungsreihenfolge; ein Konflikt blockiert nur seinen Bereich', () => {
    const list = [entry('a', 'item:1', { state: 'conflict' }), entry('b', 'item:1'), entry('c', 'item:2')];
    expect(nextRunnable(list)?.id).toBe('c');
    expect(nextRunnable([entry('x', 'item:1'), entry('y', 'item:1')])?.id).toBe('x');
  });

  it('wartet auf Abhängigkeiten (Fotos vor der Feststellung)', () => {
    const list = [entry('f', 'order:1', { dependsOn: ['p'] }), entry('p', 'photo:1')];
    expect(nextRunnable(list)?.id).toBe('p');
    expect(nextRunnable([entry('f', 'order:1', { dependsOn: ['p'] })])?.id).toBe('f');
  });

  it('Verbindungsfehler: bleibt wartend; Ablehnung: Konflikt mit Grund', () => {
    const list = [entry('a', 's')];
    const net = applyOutcome(list, 'a', { type: 'network' }, NOW.toISOString());
    expect(net[0]).toMatchObject({ state: 'pending', attempts: 1 });
    const rejected = applyOutcome(net, 'a', { type: 'rejected', error: { status: 409, code: 'not_authorized', message: 'gesperrt' } }, NOW.toISOString());
    expect(rejected[0]).toMatchObject({ state: 'conflict', attempts: 2, lastError: { code: 'not_authorized' } });
    expect(applyOutcome(list, 'a', { type: 'done' }, NOW.toISOString())).toHaveLength(0);
  });

  it('ordnet Fehler ein: Verbindung, Server, Anmeldung später erneut; übrige 4xx sind Konflikte', () => {
    expect(classifyError(ApiError.network()).type).toBe('network');
    expect(classifyError({ status: 503, code: 'x', message: '' }).type).toBe('network');
    expect(classifyError({ status: 401, code: 'unauthorized', message: '' }).type).toBe('network');
    expect(classifyError({ status: 409, code: 'not_authorized', message: '' }).type).toBe('rejected');
    expect(classifyError({ status: 422, code: 'validation_failed', message: '' }).type).toBe('rejected');
  });

  it('Verwerfen nimmt abhängige Einträge mit; Neustart setzt "wird gesendet" zurück', () => {
    const list = [entry('p', 'photo:1'), entry('f', 'order:1', { dependsOn: ['p'] }), entry('r', 'order:1', { dependsOn: ['f'] }), entry('z', 'item:9')];
    const { entries, removed } = discardEntry(list, 'p');
    expect(removed.sort()).toEqual(['f', 'p', 'r']);
    expect(entries.map((e) => e.id)).toEqual(['z']);
    const restored = parseStored(serialize([entry('s', 'x', { state: 'sending' })]));
    expect(restored[0]?.state).toBe('pending');
    expect(parseStored('kaputt')).toEqual([]);
  });

  it('Gerätezeit: Start, Pause, Abschluss, "nicht durchgeführt" senden den Erfassungszeitpunkt, andere nicht', () => {
    const at = NOW.toISOString();
    for (const kind of ['startWorkItem', 'pauseWorkItem', 'finishWorkItem', 'notDoneWorkItem'] as const) {
      expect(occurredAtOf({ kind, createdAt: at })).toBe(at);
      expect(occurredAtOf({ kind, createdAt: at, withoutDeviceTime: true })).toBeUndefined();
    }
    for (const kind of ['addPart', 'createFinding', 'photo', 'addInternalNote', 'sendMessage', 'reportFinding'] as const) expect(occurredAtOf({ kind, createdAt: at })).toBeUndefined();
  });

  it('Erneut senden: neuer Idempotency-Key je Wiederholung; "ohne Gerätezeit" nur auf Wunsch', () => {
    const rejected = entry('a', 's', { state: 'conflict', lastError: { status: 422, code: ERROR_CODES.invalidOccurredAt, message: 'zu alt' } });
    expect(isDeviceTimeConflict(rejected)).toBe(true);
    expect(isDeviceTimeConflict({ ...rejected, lastError: { status: 409, code: 'not_authorized', message: '' } })).toBe(false);
    expect(idempotencyKeyOf(rejected)).toBe('a');
    const once = retryEntry([rejected], 'a');
    expect(once[0]).toMatchObject({ state: 'pending', lastError: null, revision: 1 });
    expect(once[0]?.withoutDeviceTime).toBeUndefined();
    expect(idempotencyKeyOf(once[0]!)).toBe('a.r1');
    const twice = retryEntry([{ ...once[0]!, state: 'conflict' }], 'a', { withoutDeviceTime: true });
    expect(twice[0]).toMatchObject({ revision: 2, withoutDeviceTime: true });
    expect(idempotencyKeyOf(twice[0]!)).toBe('a.r2');
    // Gespeicherte Einträge ohne die neuen Felder bleiben lesbar
    expect(parseStored(serialize([entry('alt', 's')]))[0]).toMatchObject({ id: 'alt', state: 'pending' });
  });

  it('execute übergibt Gerätezeit und Schlüssel an die Schnittstelle', async () => {
    const calls: unknown[][] = [];
    const record = (name: string) => vi.fn(async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return {};
    });
    const api = { startWorkItem: record('start'), pauseWorkItem: record('pause'), finishWorkItem: record('finish'), notDoneWorkItem: record('notDone'), addPart: record('part') } as unknown as WerkstattApi;
    const at = '2026-09-29T06:30:00.000Z';
    const base = (id: string, kind: QueueEntry['kind'], payload: Record<string, unknown>) => createEntry({ id, kind, workOrderId: 'wo', scope: 'item:1', label: id, payload: { itemId: 'i1', ...payload } }, at);
    await execute(api, base('s1', 'startWorkItem', {}));
    await execute(api, { ...base('p1', 'pauseWorkItem', {}), revision: 1, withoutDeviceTime: true });
    await execute(api, base('f1', 'finishWorkItem', { input: { odometerKm: 1000 } }));
    await execute(api, base('n1', 'notDoneWorkItem', { input: { reason: 'Kunde verzichtet' } }));
    await execute(api, { ...base('t1', 'addPart', { input: { description: 'Teil', quantity: 1 } }), revision: 2 });
    expect(calls).toEqual([
      ['start', 'i1', { occurredAt: at }, { idempotencyKey: 's1' }],
      ['pause', 'i1', {}, { idempotencyKey: 'p1.r1' }],
      ['finish', 'i1', { odometerKm: 1000, occurredAt: at }, { idempotencyKey: 'f1' }],
      ['notDone', 'i1', { reason: 'Kunde verzichtet', occurredAt: at }, { idempotencyKey: 'n1' }],
      ['part', 'i1', { description: 'Teil', quantity: 1 }, { idempotencyKey: 't1.r2' }],
    ]);
  });
});

describe('Offline-Warteschlange: Zeitpunkt vom Gerät', () => {
  const HOUR = 3_600_000;

  async function setup() {
    const clocks = { device: new Date(NOW), server: new Date(NOW) };
    const api = new DemoApi({ latencyMs: 0, now: () => clocks.server });
    api.setToken((await api.login({ email: DEMO_EMAILS.mechanic, password: DEMO_PASSWORD })).token);
    const queue = new OfflineQueue(api, memoryStorage(), 'q', () => clocks.device);
    const wo = await api.getWorkOrder(IDS.workOrders.yaris);
    const item = wo.items.find((i) => !i.maintenanceTypeId && i.executionStatus === 'planned') ?? wo.items.find((i) => i.executionStatus === 'planned')!;
    const entry = (kind: QueueEntry['kind'], payload: Record<string, unknown> = {}) => ({ id: uuid(), kind, workOrderId: wo.id, scope: `item:${item.id}`, label: kind, payload: { itemId: item.id, ...payload } });
    return { api, queue, clocks, item, entry, current: async () => (await api.getWorkOrder(wo.id)).items.find((i) => i.id === item.id)! };
  }

  it('offline erfasst, eine Stunde später übertragen: der Server bucht die Erfassungszeitpunkte', async () => {
    const { queue, clocks, entry, current } = await setup();
    await queue.submit([entry('startWorkItem')], { online: false });
    clocks.device = new Date(NOW.getTime() + 45 * 60_000);
    await queue.submit([entry('pauseWorkItem')], { online: false });
    clocks.device = clocks.server = new Date(NOW.getTime() + HOUR);
    await queue.flush();
    expect(queue.list()).toHaveLength(0);
    expect(await current()).toMatchObject({ executionStatus: 'paused', trackedMinutes: 45, runningSince: null });
  });

  it('Zeitpunkt älter als 72 Stunden: Konflikt; ohne Gerätezeit erneut senden bucht die Serverzeit', async () => {
    const { queue, clocks, entry, current } = await setup();
    const start = entry('startWorkItem');
    await queue.submit([start], { online: false });
    clocks.device = clocks.server = new Date(NOW.getTime() + 80 * HOUR);
    await queue.flush();
    const conflict = queue.list().find((e) => e.id === start.id)!;
    expect(conflict).toMatchObject({ state: 'conflict', lastError: { status: 422, code: ERROR_CODES.invalidOccurredAt } });
    expect(conflict.lastError?.message).toContain('72 Stunden');
    expect((await current()).executionStatus).toBe('planned');

    await queue.retry(start.id, { withoutDeviceTime: true });
    expect(queue.list()).toHaveLength(0);
    expect(await current()).toMatchObject({ executionStatus: 'in_progress', runningSince: clocks.server.toISOString() });
  });

  it('online sofort gesendet, Geräteuhr 10 Minuten vor: einmal ohne Gerätezeit, dann gilt die Serverzeit', async () => {
    const { queue, clocks, entry, current } = await setup();
    clocks.device = new Date(NOW.getTime() + 10 * 60_000);
    const result = await queue.submit([entry('startWorkItem')], { online: true });
    expect(result).toEqual({ type: 'done' });
    expect(queue.list()).toHaveLength(0);
    expect((await current()).runningSince).toBe(NOW.toISOString());
  });

  it('andere Ablehnungen werden online nicht mit Serverzeit wiederholt', async () => {
    const { api, queue } = await setup();
    const octavia = await api.getWorkOrder(IDS.workOrders.octaviaInspection);
    const locked = octavia.items.find((i) => i.authorization === 'pending_approval')!;
    const spy = vi.spyOn(api, 'startWorkItem');
    const result = await queue.submit([{ id: uuid(), kind: 'startWorkItem', workOrderId: octavia.id, scope: `item:${locked.id}`, label: 'Start', payload: { itemId: locked.id } }], { online: true });
    expect(result).toMatchObject({ type: 'rejected', error: { code: ERROR_CODES.notAuthorized } });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('Offline-Warteschlange mit DemoApi', () => {
  it('Feststellung mit Foto offline erfassen, später genau einmal übertragen', async () => {
    const api = await mechanicApi();
    const storage = memoryStorage();
    const queue = new OfflineQueue(api, storage, 'q:emre', () => NOW);
    const photoEntry = uuid();
    const photoId = uuid();
    const findingId = uuid();
    api.controls.setOffline(true);
    const result = await queue.submit(
      [
        { id: photoEntry, kind: 'photo', workOrderId: IDS.workOrders.yaris, scope: `photo:${photoId}`, label: 'Foto', payload: { photoId, uri: 'file:///beispiel.jpg', name: 'beispiel.jpg', mimeType: 'image/jpeg', context: 'finding', takenAt: NOW.toISOString() } },
        { id: findingId, kind: 'createFinding', workOrderId: IDS.workOrders.yaris, scope: `order:${IDS.workOrders.yaris}`, label: 'Feststellung', payload: { description: 'Querlenkerbuchse vorne links rissig', severity: 'recommended', photoIds: [photoId] }, dependsOn: [photoEntry] },
      ],
      { online: false },
    );
    expect(result.type).toBe('queued');
    expect(queue.list()).toHaveLength(2);
    expect(storage.data.get('q:emre')).toContain(findingId);

    // Flush ohne Verbindung ändert nichts
    await queue.flush();
    expect(queue.list()).toHaveLength(2);

    api.controls.setOffline(false);
    await queue.flush();
    expect(queue.list()).toHaveLength(0);
    const findings = await api.listFindings(IDS.workOrders.yaris);
    const created = findings.filter((f) => f.id === findingId);
    expect(created).toHaveLength(1);
    expect(created[0]?.photoIds).toEqual([photoId]);
  });

  it('Wiederholung nach verlorener Antwort erzeugt keine Dublette (Idempotenz)', async () => {
    const api = await mechanicApi();
    const photoId = uuid();
    const photo = createEntry(
      { id: uuid(), kind: 'photo', workOrderId: IDS.workOrders.yaris, scope: 's', label: 'Foto', payload: { photoId, uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', context: 'work', takenAt: NOW.toISOString() } },
      NOW.toISOString(),
    );
    const finding = createEntry({ id: uuid(), kind: 'createFinding', workOrderId: IDS.workOrders.yaris, scope: 's', label: 'F', payload: { description: 'Test', severity: 'info', photoIds: [] } }, NOW.toISOString());
    const note = createEntry({ id: uuid(), kind: 'addInternalNote', workOrderId: IDS.workOrders.yaris, scope: 's', label: 'N', payload: { body: 'Kunde hat angerufen' } }, NOW.toISOString());
    for (const e of [photo, finding, note]) {
      await execute(api, e);
      await execute(api, e);
    }
    expect((await api.listPhotos(IDS.workOrders.yaris)).filter((p) => p.id === photoId)).toHaveLength(1);
    expect((await api.listFindings(IDS.workOrders.yaris)).filter((f) => f.id === finding.id)).toHaveLength(1);
    expect((await api.listInternalNotes(IDS.workOrders.yaris)).filter((x) => x.body === 'Kunde hat angerufen')).toHaveLength(1);
  });

  it('Zeiten in Reihenfolge: Starten, Pausieren, Starten, Abschließen', async () => {
    const api = await mechanicApi();
    const wo = await api.getWorkOrder(IDS.workOrders.yaris);
    const item = wo.items.find((i) => i.maintenanceTypeId && i.executionStatus === 'planned')!;
    const queue = new OfflineQueue(api, memoryStorage(), 'q', () => NOW);
    api.controls.setOffline(true);
    const scope = `item:${item.id}`;
    const base = { workOrderId: wo.id, scope, label: 'x' };
    await queue.submit([{ ...base, id: uuid(), kind: 'startWorkItem', payload: { itemId: item.id } }], { online: false });
    await queue.submit([{ ...base, id: uuid(), kind: 'pauseWorkItem', payload: { itemId: item.id } }], { online: false });
    await queue.submit([{ ...base, id: uuid(), kind: 'startWorkItem', payload: { itemId: item.id } }], { online: false });
    await queue.submit([{ ...base, id: uuid(), kind: 'finishWorkItem', payload: { itemId: item.id, input: { odometerKm: 58_120, resultNotes: 'ohne Befund' } } }], { online: false });
    expect(queue.list()).toHaveLength(4);
    api.controls.setOffline(false);
    await queue.flush();
    expect(queue.list()).toHaveLength(0);
    const after = (await api.getWorkOrder(wo.id)).items.find((i) => i.id === item.id)!;
    expect(after.executionStatus).toBe('done');
    expect(after.doneOdometerKm).toBe(58_120);
  });

  it('vom Server abgelehnter Übergang wird Konflikt; dahinter Wartendes bleibt stehen, anderes läuft weiter', async () => {
    const api = await mechanicApi();
    const wo = await api.getWorkOrder(IDS.workOrders.octaviaInspection);
    const locked = wo.items.find((i) => i.authorization === 'pending_approval')!;
    const yaris = await api.getWorkOrder(IDS.workOrders.yaris);
    const free = yaris.items.find((i) => i.executionStatus === 'planned')!;
    const queue = new OfflineQueue(api, memoryStorage(), 'q', () => NOW);
    api.controls.setOffline(true);
    const startLocked = uuid();
    const finishLocked = uuid();
    await queue.submit(
      [
        { id: startLocked, kind: 'startWorkItem', workOrderId: wo.id, scope: `item:${locked.id}`, label: 'Start', payload: { itemId: locked.id } },
        { id: finishLocked, kind: 'finishWorkItem', workOrderId: wo.id, scope: `item:${locked.id}`, label: 'Fertig', payload: { itemId: locked.id, input: {} } },
        { id: uuid(), kind: 'startWorkItem', workOrderId: yaris.id, scope: `item:${free.id}`, label: 'Start', payload: { itemId: free.id } },
      ],
      { online: false },
    );
    api.controls.setOffline(false);
    await queue.flush();
    const list = queue.list();
    expect(list.find((e) => e.id === startLocked)).toMatchObject({ state: 'conflict', lastError: { status: 409, code: ERROR_CODES.notAuthorized } });
    expect(list.find((e) => e.id === finishLocked)?.state).toBe('pending');
    expect(list).toHaveLength(2);
    expect((await api.getWorkOrder(yaris.id)).items.find((i) => i.id === free.id)?.executionStatus).toBe('in_progress');

    // Erneut versuchen: weiterhin gesperrt; Verwerfen löst den Bereich
    await queue.retry(startLocked);
    expect(queue.list().find((e) => e.id === startLocked)?.state).toBe('conflict');
    await queue.discard(startLocked);
    await queue.flush();
    expect(queue.list().find((e) => e.id === finishLocked)?.state).toBe('conflict');
  });

  it('online abgelehnte Aktion wird direkt gemeldet und nicht gespeichert', async () => {
    const api = await mechanicApi();
    const wo = await api.getWorkOrder(IDS.workOrders.octaviaInspection);
    const locked = wo.items.find((i) => i.authorization === 'pending_approval')!;
    const queue = new OfflineQueue(api, memoryStorage(), 'q', () => NOW);
    const result = await queue.submit([{ id: uuid(), kind: 'startWorkItem', workOrderId: wo.id, scope: `item:${locked.id}`, label: 'Start', payload: { itemId: locked.id } }], { online: true });
    expect(result).toMatchObject({ type: 'rejected', error: { code: ERROR_CODES.notAuthorized } });
    expect(queue.list()).toHaveLength(0);
  });

  it('Verbindungsabbruch mitten im Durchlauf: Rest bleibt in Reihenfolge gespeichert', async () => {
    const demo = await mechanicApi();
    let calls = 0;
    // Nach dem ersten erfolgreichen Aufruf bricht die Verbindung ab
    const flaky = new Proxy(demo, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== 'function' || prop === 'controls') return value;
        return async (...args: unknown[]) => {
          calls++;
          if (calls > 1) throw ApiError.network();
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as unknown as WerkstattApi;
    const queue = new OfflineQueue(flaky, memoryStorage(), 'q', () => NOW);
    const ids = [uuid(), uuid()];
    await queue.enqueue(ids.map((id, i) => ({ id, kind: 'addInternalNote' as const, workOrderId: IDS.workOrders.yaris, scope: `order:${IDS.workOrders.yaris}`, label: `Notiz ${i}`, payload: { body: `Notiz ${i}` } })));
    await queue.flush();
    expect(queue.list().map((e) => e.id)).toEqual([ids[1]]);
    expect(queue.list()[0]).toMatchObject({ state: 'pending', attempts: 1 });
  });
});
