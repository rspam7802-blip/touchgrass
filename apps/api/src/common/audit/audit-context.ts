import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request flag: did this admin write record an audit entry of its own? */
export interface AuditContextState {
  audited: boolean;
}

export const auditContext = new AsyncLocalStorage<AuditContextState>();

export function markAudited(): void {
  const state = auditContext.getStore();
  if (state) state.audited = true;
}
