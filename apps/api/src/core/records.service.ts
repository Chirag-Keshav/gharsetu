/**
 * Cross-cutting record writers used inside business transactions: audit events (§8.12), status
 * events with transition validation (§6.2), the transactional outbox (§14.3), references and alerts.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canTransition, type StateMachine } from '@propcare/shared';
import { CLOCK, type Clock } from './clock';
import { actorKind, requestStore, type Actor } from './context';
import { invalidTransition } from './errors';
import type { Db } from './prisma.service';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  onBehalfOf?: { type: 'OWNER' | 'CUSTOMER' | 'PROVIDER'; id: string } | null;
  /** Identifiers and changed field names only — no unnecessary personal data. */
  metadata?: Record<string, unknown>;
}

export type ReferencePrefix = 'REQ' | 'QUO' | 'WO' | 'ISS' | 'LST' | 'BKG' | 'PYT' | 'INV';

@Injectable()
export class RecordsService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  async audit(db: Db, actor: Actor, input: AuditInput): Promise<void> {
    const store = requestStore.getStore();
    await db.auditEvent.create({
      data: {
        actorId: actor.userId,
        actorRole: actor.role,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        onBehalfOfType: input.onBehalfOf?.type ?? null,
        onBehalfOfId: input.onBehalfOf?.id ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        ipHash: store?.ipHash ?? null,
        requestId: store?.requestId ?? null,
      },
    });
  }

  /** Validates a transition against the shared table and appends a status event. */
  async transition<S extends string>(
    db: Db,
    machine: StateMachine<S>,
    params: { entityId: string; from: S | null; to: S; actor: Actor; reason?: string | null; ownerVisible?: boolean },
  ): Promise<void> {
    if (!canTransition(machine, params.from, params.to, actorKind(params.actor))) {
      throw invalidTransition(params.from, params.to);
    }
    await db.statusEvent.create({
      data: {
        entityType: machine.entity,
        entityId: params.entityId,
        fromStatus: params.from,
        toStatus: params.to,
        actorId: params.actor.userId,
        actorRole: params.actor.role,
        reason: params.reason ?? null,
        ownerVisible: params.ownerVisible ?? true,
      },
    });
  }

  /** Writes a domain event in the same transaction as the business change. */
  async emit(db: Db, type: string, payload: Record<string, unknown>): Promise<void> {
    await db.outboxEvent.create({ data: { type, payload: payload as Prisma.InputJsonValue, nextAttemptAt: this.clock.now() } });
  }

  async nextReference(db: Db, prefix: ReferencePrefix): Promise<string> {
    const rows = await db.$queryRaw<Array<{ ref: string }>>`SELECT next_reference(${prefix}) AS ref`;
    return rows[0].ref;
  }

  async alert(db: Db, type: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
    await db.adminAlert.create({ data: { type, entityType, entityId, metadata: metadata as Prisma.InputJsonValue } });
    await this.emit(db, 'admin.alert', { alertType: type, entityType, entityId, ...metadata });
  }
}
