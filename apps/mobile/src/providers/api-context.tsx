import { createContext, type ReactNode, useContext } from 'react';
import type { ApiClient } from '../lib/api-client';

export interface ApiContextValue {
  client: ApiClient;
  appVersion: string;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ value, children }: { value: ApiContextValue; children: ReactNode }) {
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi must be used inside ApiProvider');
  return value;
}
