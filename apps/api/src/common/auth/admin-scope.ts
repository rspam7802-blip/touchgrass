import { Injectable } from '@nestjs/common';
import { ALL_CITY_ROLES } from '@touchgrass/shared';
import { UsersService } from '../../modules/users/users.service.js';
import { AppError } from '../errors/app-error.js';
import type { AuthPrincipal } from '../http/request-context.js';

/** 'all' or the cities a person may act in from the admin dashboard. */
export type CityScope = 'all' | readonly string[];

/**
 * Pure policy (D-118): admins act everywhere; a city curator acts only in the cities they curate. Other
 * staff roles (moderator, support) aren't city-bound, but their sections hold no city content either.
 */
export function cityScopeFor(
  roles: readonly string[],
  curatedCities: readonly string[],
): CityScope {
  if (roles.some((r) => ALL_CITY_ROLES.includes(r as (typeof ALL_CITY_ROLES)[number])))
    return 'all';
  if (roles.includes('city_curator')) return curatedCities;
  return 'all';
}

export function inScope(scope: CityScope, cityId: string | null): boolean {
  return scope === 'all' || (cityId !== null && scope.includes(cityId));
}

@Injectable()
export class AdminScopeService {
  constructor(private readonly users: UsersService) {}

  async scope(principal: Pick<AuthPrincipal, 'userId' | 'roles'>): Promise<CityScope> {
    const curated = principal.roles.includes('city_curator')
      ? await this.users.curatorCities(principal.userId)
      : [];
    return cityScopeFor(principal.roles, curated);
  }

  /** Throws unless the caller may act in this city. */
  async assertCity(
    principal: Pick<AuthPrincipal, 'userId' | 'roles'>,
    cityId: string | null,
  ): Promise<CityScope> {
    const scope = await this.scope(principal);
    if (!inScope(scope, cityId))
      throw new AppError('FORBIDDEN', 'That belongs to a city you do not curate', {
        reason: 'OTHER_CITY',
      });
    return scope;
  }
}
