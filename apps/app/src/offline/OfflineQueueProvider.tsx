/**
 * Offline-Warteschlange in der Oberfläche (Mechanikerbereich): je angemeldetem Konto ein
 * eigener Speicher (AsyncStorage; im Browser localStorage), automatische Übertragung, sobald
 * eine Verbindung besteht (NetInfo bzw. Demo-Steuerung), und alle 20 Sekunden erneut,
 * solange etwas wartet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useSession } from '../auth/session';
import { useApi } from '../data/ApiProvider';
import { invalidateAll } from '../data/invalidation';
import { useIsOffline } from '../data/network';
import { OfflineQueue, type QueueStorage, type SubmitResult } from './OfflineQueue';
import { summarize, type NewQueueEntry, type QueueEntry, type QueueSummary } from './queueCore';

const storage: QueueStorage = {
  load: (key) => AsyncStorage.getItem(key),
  save: (key, value) => AsyncStorage.setItem(key, value),
};

interface QueueContextValue {
  entries: QueueEntry[];
  summary: QueueSummary;
  online: boolean;
  submit: (items: NewQueueEntry[]) => Promise<SubmitResult>;
  flush: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  discard: (id: string) => Promise<string[]>;
}

const QueueContext = createContext<QueueContextValue | null>(null);
const EMPTY: QueueEntry[] = [];

export function OfflineQueueProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { user } = useSession();
  const offline = useIsOffline();
  const queue = useMemo(() => (user ? new OfflineQueue(api, storage, `werkstatt.offline.v1:${user.id}`) : null), [api, user?.id]);
  const entries = useSyncExternalStore(
    (cb) => (queue ? queue.subscribe(cb) : () => undefined),
    () => (queue ? queue.list() : EMPTY),
    () => EMPTY,
  );
  const online = !offline;
  const onlineRef = useRef(online);
  onlineRef.current = online;

  // Laden und bei Verbindung übertragen; danach Ansichten neu laden
  useEffect(() => {
    if (!queue) return;
    void queue.init().then(async () => {
      if (onlineRef.current && queue.list().length > 0) {
        await queue.flush();
        invalidateAll();
      }
    });
  }, [queue]);

  useEffect(() => {
    if (!queue || !online) return;
    let active = true;
    const run = async () => {
      if (queue.list().some((e) => e.state === 'pending')) {
        await queue.flush();
        if (active) invalidateAll();
      }
    };
    void run();
    const timer = setInterval(() => void run(), 20_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [queue, online]);

  const value = useMemo<QueueContextValue>(
    () => ({
      entries,
      summary: summarize(entries),
      online,
      submit: async (items) => {
        if (!queue) return { type: 'rejected', error: { status: 401, code: 'unauthorized', message: 'Bitte melden Sie sich an.' } };
        const result = await queue.submit(items, { online: onlineRef.current });
        invalidateAll();
        return result;
      },
      flush: async () => {
        if (!queue) return;
        await queue.flush();
        invalidateAll();
      },
      retry: async (id) => {
        if (!queue) return;
        await queue.retry(id);
        invalidateAll();
      },
      discard: async (id) => (queue ? queue.discard(id) : []),
    }),
    [entries, online, queue],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useOfflineQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error('useOfflineQueue außerhalb von OfflineQueueProvider');
  return ctx;
}

/** Einträge eines Auftrags bzw. einer Position, die noch nicht übertragen sind. */
export function usePendingFor(filter: { workOrderId?: string; scope?: string }): QueueEntry[] {
  const { entries } = useOfflineQueue();
  return useMemo(
    () => entries.filter((e) => (filter.workOrderId ? e.workOrderId === filter.workOrderId : true) && (filter.scope ? e.scope === filter.scope : true)),
    [entries, filter.workOrderId, filter.scope],
  );
}
