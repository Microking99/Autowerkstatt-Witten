/**
 * Lesecache für die Mechanikeransicht: Zuletzt geladene Aufträge bleiben auf dem Gerät
 * (AsyncStorage, im Browser localStorage), damit ohne Verbindung weitergearbeitet werden
 * kann. Angezeigt wird dann ausdrücklich "Stand vom …". Nur Daten, die der Mechaniker
 * ohnehin sehen darf; beim Abmelden bleibt der Cache dem Konto zugeordnet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useSession } from '../auth/session';
import type { WerkstattApi } from '../data/api';
import { useApiQuery, type QueryResult } from '../data/hooks';

export interface CachedQuery<T> extends QueryResult<T> {
  /** Zeitpunkt des angezeigten Standes, wenn er aus dem Gerätespeicher stammt */
  cachedAt: string | null;
}

export function useCachedQuery<T>(key: string, fetcher: (api: WerkstattApi) => Promise<T>): CachedQuery<T> {
  const { user } = useSession();
  const storageKey = `werkstatt.lesecache.v1:${user?.id ?? 'unbekannt'}:${key}`;
  const query = useApiQuery(key, fetcher);
  const [cached, setCached] = useState<{ at: string; data: T } | null>(null);

  useEffect(() => {
    if (query.status === 'success' && query.data !== undefined) {
      void AsyncStorage.setItem(storageKey, JSON.stringify({ at: new Date().toISOString(), data: query.data })).catch(() => undefined);
      setCached(null);
    }
  }, [query.status, query.data, storageKey]);

  useEffect(() => {
    if (query.status !== 'error' || query.data !== undefined || !query.error?.isNetwork) return;
    let active = true;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (active && raw) setCached(JSON.parse(raw) as { at: string; data: T });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [query.status, query.data, query.error, storageKey]);

  if (query.data === undefined && cached) {
    return { ...query, status: 'success', data: cached.data, error: null, cachedAt: cached.at };
  }
  return { ...query, cachedAt: null };
}
