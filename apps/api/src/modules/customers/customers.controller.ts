import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type * as Dto from '@touchgrass/shared';
import { AppError } from '../../common/errors/app-error.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_SECTIONS,
  type CustomerView,
  InviteNetwork,
  InviteNetworkQuery,
  CustomerView as CustomerViewSchema,
  customerAccessFor,
} from '@touchgrass/shared';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { NetworkService } from './network.service.js';
import { CustomersService } from './customers.service.js';

/** Customer 360 (D-192). Admins see everything; support sees the lighter view; every view is audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly network: NetworkService,
  ) {}

  /** Who invited whom, from our first invitees to the nth generation (D-193). */
  @Get('network')
  @Roles(...ADMIN_SECTIONS.network)
  @ApiZodQuery(InviteNetworkQuery)
  @ApiZodResponse(200, InviteNetwork)
  invites(
    @Query(new ZodPipe(InviteNetworkQuery)) q: Dto.InviteNetworkQuery,
  ): Promise<Dto.InviteNetwork> {
    return this.network.network(q);
  }

  @Get('customers/:id')
  @Roles(...ADMIN_SECTIONS.customers)
  @ApiZodResponse(200, CustomerViewSchema)
  view(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerView> {
    const access = customerAccessFor(admin.roles);
    if (!access) throw AppError.forbidden();
    return this.customers.view(admin.userId, access, id);
  }
}
