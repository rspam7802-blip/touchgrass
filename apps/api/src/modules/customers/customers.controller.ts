import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_SECTIONS,
  type CustomerView,
  CustomerView as CustomerViewSchema,
  customerAccessFor,
} from '@touchgrass/shared';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { CustomersService } from './customers.service.js';

/** Customer 360 (D-192). Admins see everything; support sees the lighter view; every view is audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get(':id')
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
