import type { Interest } from '@touchgrass/shared';
import type { TFunction } from 'i18next';
import { localized } from '../src/features/catalog/api';
import type { PickOption } from './PickList';

const GROUPS = ['food', 'active', 'games', 'culture', 'creative', 'learning', 'community'];

/** Interests as rows for a pick list, grouped under their category (unknown categories go under "More"). */
export function interestOptions(items: Interest[], t: TFunction, language: string): PickOption[] {
  const rank = (category: string): number => {
    const i = GROUPS.indexOf(category);
    return i === -1 ? GROUPS.length : i;
  };
  return [...items]
    .sort((a, b) => rank(a.category) - rank(b.category))
    .map((i) => ({
      id: i.id,
      label: localized(i.name, language),
      group: t(`onboarding.interestGroups.${GROUPS.includes(i.category) ? i.category : 'other'}`),
    }));
}
