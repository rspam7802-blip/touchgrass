import type { OnboardingState } from '@touchgrass/shared';
import { ONBOARDING_STEPS, type OnboardingStepName } from '../../../components/OnboardingStep';

/** Where to resume: the first required step not done yet, else the optional permission steps. */
export function resumeStep(state: OnboardingState): OnboardingStepName {
  if (!state.name) return 'name';
  if (!state.photos) return 'photos';
  if (!state.dateOfBirth) return 'birthday';
  if (!state.city) return 'city';
  if (!state.interests) return 'interests';
  return 'notifications';
}

export function nextStep(step: OnboardingStepName): OnboardingStepName | null {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[i + 1] ?? null;
}

export function stepRoute(step: OnboardingStepName): `/${OnboardingStepName}` {
  return `/${step}`;
}
