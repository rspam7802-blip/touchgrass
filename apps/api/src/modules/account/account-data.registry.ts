import { Injectable } from '@nestjs/common';
import type { Tx } from '../../infra/database/database.module.js';

/**
 * Each module that stores personal data registers how to export it and how to erase it (DPDP Act 2023).
 * Later phases (social graph, events, chat, …) add contributors, so export and deletion stay complete.
 */
export interface AccountDataContributor {
  name: string;
  export(userId: string): Promise<unknown>;
  /** Runs inside the purge transaction; may return storage cleanup to run after commit. */
  erase(userId: string, tx: Tx): Promise<(() => Promise<void>) | undefined>;
}

@Injectable()
export class AccountDataRegistry {
  private readonly contributors: AccountDataContributor[] = [];

  register(contributor: AccountDataContributor): void {
    if (this.contributors.some((c) => c.name === contributor.name))
      throw new Error(`Duplicate contributor ${contributor.name}`);
    this.contributors.push(contributor);
  }

  all(): readonly AccountDataContributor[] {
    return this.contributors;
  }
}
