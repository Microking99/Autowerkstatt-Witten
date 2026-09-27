/**
 * Datenabfragen für Oberflächen: Laden, Fehler, Erfolg, Neuladen nach Änderungen.
 * 401 → Sitzung beenden (Anmeldung mit Rückkehrziel), 403/404 → "Nicht verfügbar".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WerkstattApi } from './api';
import { useApi } from './ApiProvider';
import { ApiError, toApiError } from './errors';
import { invalidateAll, subscribeInvalidation } from './invalidation';

let unauthorizedHandler: (() => void) | null = null;

/** Wird von der Sitzung gesetzt; reagiert auf abgelaufene Anmeldung. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function handleError(error: ApiError) {
  if (error.status === 401) unauthorizedHandler?.();
}

export type QueryState<T> =
  | { status: 'loading'; data: undefined; error: null }
  | { status: 'error'; data: T | undefined; error: ApiError }
  | { status: 'success'; data: T; error: null };

export interface QueryResult<T> {
  status: QueryState<T>['status'];
  data: T | undefined;
  error: ApiError | null;
  /** Neuladen mit Anzeige des Ladezustands in Knöpfen (nicht der ganzen Seite) */
  refetch: () => Promise<void>;
  isRefreshing: boolean;
}

export interface QueryOptions {
  /** Hintergrundabfrage in Millisekunden (z. B. Zahlungsprüfung) */
  pollMs?: number;
  enabled?: boolean;
}

export function useApiQuery<T>(key: string | null, fetcher: (api: WerkstattApi) => Promise<T>, options: QueryOptions = {}): QueryResult<T> {
  const api = useApi();
  const enabled = options.enabled !== false && key !== null;
  const [state, setState] = useState<QueryState<T>>({ status: 'loading', data: undefined, error: null });
  const [isRefreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);
  const dataRef = useRef<T | undefined>(undefined);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'background') => {
      if (!enabled) return;
      const id = ++requestId.current;
      if (mode === 'initial') setState({ status: 'loading', data: undefined, error: null });
      if (mode === 'refresh') setRefreshing(true);
      try {
        const data = await fetcherRef.current(api);
        if (id !== requestId.current) return;
        dataRef.current = data;
        setState({ status: 'success', data, error: null });
      } catch (e) {
        if (id !== requestId.current) return;
        const error = toApiError(e);
        handleError(error);
        // Hintergrundfehler lassen vorhandene Daten stehen; die Seite zeigt einen Hinweis.
        setState({ status: 'error', data: mode === 'initial' ? undefined : dataRef.current, error });
      } finally {
        if (id === requestId.current && mode === 'refresh') setRefreshing(false);
      }
    },
    [api, enabled],
  );

  useEffect(() => {
    dataRef.current = undefined;
    void load('initial');
  }, [key, load]);

  useEffect(() => subscribeInvalidation(() => void load('background')), [load]);

  useEffect(() => {
    if (!options.pollMs || !enabled) return;
    const t = setInterval(() => void load('background'), options.pollMs);
    return () => clearInterval(t);
  }, [options.pollMs, enabled, load]);

  const refetch = useCallback(() => load('refresh'), [load]);
  return { status: state.status, data: state.data, error: state.error, refetch, isRefreshing };
}

export interface MutationResult<A extends unknown[], R> {
  mutate: (...args: A) => Promise<R>;
  pending: boolean;
  error: ApiError | null;
  reset: () => void;
}

/** Schreibende Aktion; bei Erfolg laden alle Abfragen neu. Fehler werden zurückgegeben (throw). */
export function useApiMutation<A extends unknown[], R>(action: (api: WerkstattApi, ...args: A) => Promise<R>): MutationResult<A, R> {
  const api = useApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutate = useCallback(
    async (...args: A) => {
      setPending(true);
      setError(null);
      try {
        const result = await actionRef.current(api, ...args);
        invalidateAll();
        return result;
      } catch (e) {
        const err = toApiError(e);
        handleError(err);
        if (mounted.current) setError(err);
        throw err;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [api],
  );

  return { mutate, pending, error, reset: () => setError(null) };
}

export { invalidateAll };
