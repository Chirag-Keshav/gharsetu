import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Payment, PaymentRequirement } from '@prisma/client';
import type { UserActor } from '../../core/context';
import { AppError, notFound, validation } from '../../core/errors';
import { PrismaService, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { num } from '../../core/serialize';
import { PaymentsService } from '../payments/payments.service';
import { RequestsService } from './requests.service';
import { WorkOrdersService } from './work-orders.service';

/** Maintenance payment requirements (SPEC §8.9): what the owner owes and when. */
@Injectable()
export class RequirementsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly payments: PaymentsService,
    private readonly requests: RequestsService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  onModuleInit() {
    this.payments.registerSettlement('REQUIREMENT', { onSucceeded: (tx, p) => this.onPaid(tx, p) });
  }

  private async serialize(rows: Array<PaymentRequirement & { payments: Payment[] }>) {
    return {
      items: rows.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        workOrderId: r.workOrderId,
        purpose: r.purpose,
        amountPaise: num(r.amountPaise),
        paidPaise: r.payments.filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED').reduce((s, p) => s + num(p.amountPaise), 0),
        dueTrigger: r.dueTrigger,
        isDue: r.isDue,
        status: r.status,
      })),
    };
  }

  async forRequest(actor: UserActor, requestId: string) {
    await this.requests.findVisible(actor, requestId);
    return this.serialize(await this.prisma.paymentRequirement.findMany({ where: { requestId }, include: { payments: true }, orderBy: { createdAt: 'asc' } }));
  }

  async forWorkOrder(actor: UserActor, workOrderId: string) {
    await this.workOrders.findVisible(actor, workOrderId);
    return this.serialize(await this.prisma.paymentRequirement.findMany({ where: { workOrderId }, include: { payments: true }, orderBy: { createdAt: 'asc' } }));
  }

  async pay(actor: UserActor, id: string) {
    const r = await this.prisma.paymentRequirement.findUnique({ where: { id }, include: { request: true, payments: true } });
    if (!r || r.request.ownerUserId !== actor.userId) throw notFound();
    if (r.status !== 'PENDING') throw new AppError('INVALID_STATE_TRANSITION');
    if (!r.isDue) throw validation({ code: 'NOT_YET_DUE' });
    const paid = r.payments.filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + num(p.amountPaise), 0);
    return this.payments.initiate({
      payerUserId: actor.userId,
      amountPaise: num(r.amountPaise) - paid,
      requirementId: r.id,
      reference: r.request.reference,
      returnPath: `/owner/requests/${r.requestId}`,
    });
  }

  async waive(actor: UserActor, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const res = await tx.paymentRequirement.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'WAIVED' } });
      if (!res.count) throw notFound();
      await this.records.audit(tx, actor, { action: 'payment_requirement.waived', entityType: 'PAYMENT_REQUIREMENT', entityId: id, metadata: { reason } });
      return { id, status: 'WAIVED' };
    });
  }

  private async onPaid(tx: Tx, payment: Payment) {
    const r = await tx.paymentRequirement.findUniqueOrThrow({ where: { id: payment.requirementId! }, include: { payments: true } });
    const paid = r.payments.filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + p.amountPaise, 0n);
    if (paid >= r.amountPaise && r.status === 'PENDING') {
      await tx.paymentRequirement.update({ where: { id: r.id }, data: { status: 'PAID' } });
    }
  }
}
