import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WerkstattApi } from './api';
import { createApi } from './createApi';

const ApiContext = createContext<WerkstattApi | null>(null);

export function ApiProvider({ children, api }: { children: ReactNode; api?: WerkstattApi }) {
  const value = useMemo(() => api ?? createApi(), [api]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): WerkstattApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi außerhalb von ApiProvider');
  return api;
}
