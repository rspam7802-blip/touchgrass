import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CityList, NeighbourhoodList } from '@touchgrass/shared';
import type { z } from 'zod';
import { AllowOnboarding, Public } from '../../common/auth/decorators.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { CitiesService } from './cities.service.js';

@ApiTags('catalog')
@Public()
@AllowOnboarding()
@Controller({ path: 'cities', version: '1' })
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  @ApiZodResponse(200, CityList)
  async list(): Promise<z.infer<typeof CityList>> {
    return { items: await this.cities.list() };
  }

  @Get(':cityId/neighbourhoods')
  @ApiZodResponse(200, NeighbourhoodList)
  async neighbourhoods(
    @Param('cityId', new ParseUUIDPipe()) cityId: string,
  ): Promise<z.infer<typeof NeighbourhoodList>> {
    return { items: await this.cities.neighbourhoods(cityId) };
  }
}
