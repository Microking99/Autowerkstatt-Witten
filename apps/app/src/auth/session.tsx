/**
 * Sitzungskontext: Anmeldung, Abmeldung, Wiederherstellung beim Start, Reaktion auf 401.
 * Die Oberfläche blendet nur aus; Rechte prüft immer die API (bzw. DemoApi).
 */
import { SessionUserSchema, type LoginResponse, type SessionUser } from '@werkstatt/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../data/ApiProvider';
import { setUnauthorizedHandler } from '../data/hooks';
import { invalidateAll } from '../data/invalidation';
import { toApiError } from '../data/errors';
import { tokenStorage } from './tokenStorage';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  /** true, wenn die Sitzung abgelaufen ist (Hinweis auf der Anmeldeseite) */
  expired: boolean;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  /** Nach Einladung/Passwort-Link oder Rollenwechsel im Demo-Modus */
  adopt: (response: LoginResponse) => Promise<SessionUser>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [expired, setExpired] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const clear = useCallback(
    async (wasExpired: boolean) => {
      api.setToken(null);
      await tokenStorage.clear().catch(() => undefined);
      setUser(null);
      setExpired(wasExpired);
      setStatus('signedOut');
    },
    [api],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const { token, userJson } = await tokenStorage.load();
      if (!token) {
        if (active) setStatus('signedOut');
        return;
      }
      api.setToken(token);
      try {
        const me = await api.me();
        if (!active) return;
        await tokenStorage.saveUser(JSON.stringify(me)).catch(() => undefined);
        setUser(me);
        setStatus('signedIn');
      } catch (e) {
        const err = toApiError(e);
        if (!active) return;
        const cached = userJson ? SessionUserSchema.safeParse(JSON.parse(userJson)) : null;
        if (err.isNetwork && cached?.success) {
          // Ohne Verbindung mit den zuletzt bekannten Kontodaten starten (Offline-Hinweis zeigt die App).
          setUser(cached.data);
          setStatus('signedIn');
        } else {
          await clear(err.status === 401);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [api, clear]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current === 'signedIn') void clear(true);
    });
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const adopt = useCallback(
    async (response: LoginResponse) => {
      api.setToken(response.token);
      await tokenStorage.save(response.token, JSON.stringify(response.user)).catch(() => undefined);
      setUser(response.user);
      setExpired(false);
      setStatus('signedIn');
      invalidateAll();
      return response.user;
    },
    [api],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const response = await api.login({ email, password });
      return adopt(response);
    },
    [api, adopt],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Abmelden gelingt lokal auch ohne Verbindung
    }
    await clear(false);
  }, [api, clear]);

  const value = useMemo(() => ({ status, user, expired, signIn, adopt, signOut }), [status, user, expired, signIn, adopt, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession außerhalb von SessionProvider');
  return ctx;
}
