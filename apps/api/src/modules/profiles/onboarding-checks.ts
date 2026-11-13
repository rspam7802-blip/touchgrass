import { Injectable } from '@nestjs/common';

export type OnboardingCheck = (userId: string) => Promise<boolean>;

/**
 * Extra onboarding requirements owned by other modules (profiles never reads their tables). A module
 * registers a named check at start-up; onboarding is complete only when every check passes. Today:
 * `verification` (D-181).
 */
@Injectable()
export class OnboardingChecks {
  private readonly checks = new Map<string, OnboardingCheck>();

  register(name: string, check: OnboardingCheck): void {
    this.checks.set(name, check);
  }

  /** True when the named requirement is met, or when no module registered it. */
  async passes(name: string, userId: string): Promise<boolean> {
    const check = this.checks.get(name);
    return check ? check(userId) : true;
  }
}
