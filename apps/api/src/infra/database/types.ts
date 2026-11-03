import type { Database, Tx } from './database.module.js';

/** Services accept either the root connection or an open transaction so callers can compose atomic units. */
export type DbOrTx = Database | Tx;
