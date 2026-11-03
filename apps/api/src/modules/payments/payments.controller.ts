import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AdminPaymentsOverview,
  CheckoutBody,
  CheckoutPage,
  CheckoutResult,
  CreateHostAccountBody,
  HostAccount,
  PaginationQuery,
  PaymentList,
  PaymentView,
  PayoutLedger,
  Receipt,
  ReceiptEmailBody,
  RefundQuote,
  SimulateCheckoutBody,
} from '@touchgrass/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { FakePaymentsGateway } from '../../adapters/payments/fake.payments.js';
import { PaymentsGateway } from '../../adapters/payments/payments.port.js';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { PaymentsService } from './payments.service.js';
import { PayoutsService } from './payouts.service.js';
import { RefundsService } from './refunds.service.js';
import { WebhooksService } from './webhooks.service.js';

const CheckoutToken = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);

/** The buyer's payments and receipts (F-PAY-01, F-PAY-05). */
@ApiTags('payments')
@ApiBearerAuth()
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('receipt-email')
  @ApiZodResponse(200, ReceiptEmailBody)
  async receiptEmail(@CurrentUser() user: AuthPrincipal): Promise<Dto.ReceiptEmailBody> {
    return { email: await this.payments.receiptEmail(user.userId) };
  }

  @Put('receipt-email')
  @ApiZodBody(ReceiptEmailBody)
  @ApiZodResponse(200, ReceiptEmailBody)
  async setReceiptEmail(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(ReceiptEmailBody)) body: Dto.ReceiptEmailBody,
  ): Promise<Dto.ReceiptEmailBody> {
    await this.payments.setReceiptEmail(user.userId, body.email);
    return body;
  }

  @Get()
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, PaymentList)
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Dto.PaymentList> {
    return this.payments.list(user.userId, q.cursor, q.limit);
  }

  @Get(':id')
  @ApiZodResponse(200, PaymentView)
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.PaymentView> {
    return this.payments.payment(user.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.payments.cancelCheckout(user.userId, id);
  }

  @Get(':id/receipt')
  @ApiZodResponse(200, Receipt)
  receipt(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.Receipt> {
    return this.payments.receipt(user.userId, id);
  }
}

/** Starting checkout from a plan, and what cancelling would refund. */
@ApiTags('payments')
@ApiBearerAuth()
@Controller({ path: 'events', version: '1' })
export class EventCheckoutController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/checkout')
  @Idempotent()
  @RateLimit({ name: 'checkout', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(CheckoutBody)
  @ApiZodResponse(201, CheckoutResult)
  checkout(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CheckoutBody)) body: Dto.CheckoutBody,
  ): Promise<Dto.CheckoutResult> {
    return this.payments.checkout(user.userId, id, body);
  }

  @Get(':id/refund-quote')
  @ApiZodResponse(200, RefundQuote)
  refundQuote(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.RefundQuote> {
    return this.payments.refundQuote(user.userId, id);
  }
}

/** The web checkout page (opened from the app) reads its order by an unguessable token. */
@ApiTags('payments')
@Controller({ path: 'checkout', version: '1' })
export class CheckoutPageController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly webhooks: WebhooksService,
    private readonly gateway: PaymentsGateway,
  ) {}

  @Get(':token')
  @Public()
  @RateLimit({ name: 'checkout-page', limit: 120, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, CheckoutPage)
  page(@Param('token', new ZodPipe(CheckoutToken)) token: string): Promise<Dto.CheckoutPage> {
    return this.payments.checkoutPage(token);
  }

  /** Development only (fake gateway): the page plays the bank and the answer goes through the real webhook path. */
  @Post(':token/simulate')
  @Public()
  @HttpCode(204)
  @RateLimit({ name: 'checkout-simulate', limit: 30, windowSeconds: 3600, by: 'ip' })
  async simulate(
    @Param('token', new ZodPipe(CheckoutToken)) token: string,
    @Body(new ZodPipe(SimulateCheckoutBody)) body: Dto.SimulateCheckoutBody,
  ): Promise<void> {
    if (!this.payments.canSimulate() || !(this.gateway instanceof FakePaymentsGateway))
      throw new NotFoundException();
    const p = await this.payments.byToken(token);
    if (!p.providerOrderId) throw new NotFoundException();
    const webhook =
      body.outcome === 'success'
        ? this.gateway.simulatePaymentCaptured(p.providerOrderId, p.amountPaise)
        : this.gateway.simulatePaymentFailed(p.providerOrderId, p.amountPaise);
    await this.webhooks.ingest(webhook.rawBody, webhook.signature, webhook.eventId);
  }
}

/** Razorpay → us. Signature-verified, recorded once, processed by the worker. */
@ApiTags('payments')
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('razorpay')
  @Public()
  @HttpCode(200)
  async razorpay(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const signature = req.header('x-razorpay-signature') ?? '';
    const eventId = req.header('x-razorpay-event-id') ?? null;
    await this.webhooks.ingest(raw, signature, eventId);
    return { ok: true };
  }
}

/** Host payout setup and ledger (F-PAY-03). */
@ApiTags('hosting')
@ApiBearerAuth()
@Controller({ path: 'host', version: '1' })
export class HostPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('payouts')
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, PayoutLedger)
  ledger(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Dto.PayoutLedger> {
    return this.payouts.ledger(user.userId, q.cursor, q.limit);
  }

  @Post('account')
  @Idempotent()
  @RateLimit({ name: 'host-account', limit: 5, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CreateHostAccountBody)
  @ApiZodResponse(201, HostAccount)
  createAccount(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(CreateHostAccountBody)) body: Dto.CreateHostAccountBody,
  ): Promise<Dto.HostAccount> {
    return this.payouts.createAccount(user.userId, body);
  }
}

/** Payments, refunds and payouts overview + retries for the admin dashboard. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminPaymentsController {
  constructor(
    private readonly overviewService: AdminPaymentsService,
    private readonly refunds: RefundsService,
    private readonly payouts: PayoutsService,
    private readonly audit: AuditService,
  ) {}

  @Get('payments')
  @Roles('admin', 'support')
  @ApiZodResponse(200, AdminPaymentsOverview)
  overview(@CurrentUser() user: AuthPrincipal): Promise<Dto.AdminPaymentsOverview> {
    return this.overviewService.overview(user.userId);
  }

  @Post('refunds/:id/retry')
  @Roles('admin')
  @HttpCode(204)
  async retryRefund(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.refunds.adminRetry(id);
    await this.audit.record({
      adminUserId: user.userId,
      action: 'refund.retry',
      targetType: 'refund',
      targetId: id,
    });
  }

  @Post('payouts/:id/retry')
  @Roles('admin')
  @HttpCode(204)
  async retryPayout(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.payouts.adminRetry(id);
    await this.audit.record({
      adminUserId: user.userId,
      action: 'payout.retry',
      targetType: 'payout',
      targetId: id,
    });
  }
}
