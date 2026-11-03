import { useRouter } from 'expo-router';
import type { OnboardingStepName } from '../../../components/OnboardingStep';
import { nextStep, stepRoute } from './onboarding';

/** Advances to the next onboarding step (the last step completes onboarding itself). */
export function useStepNav(step: OnboardingStepName): () => void {
  const router = useRouter();
  return () => {
    const next = nextStep(step);
    if (next) router.push(stepRoute(next));
  };
}
