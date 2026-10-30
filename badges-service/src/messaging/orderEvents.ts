/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the order.status.changed handler that keeps delivery and request counts
 *        up to date between daily runs.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { Value } from '@sinclair/typebox/value';
import { eq, sql } from 'drizzle-orm';
import { db, type Executor } from '../database/index.js';
import { countedOrder, disputedOrder, userMetrics } from '../database/schema.js';
import { evaluateUser } from '../services/badges.service.js';
import { ORDER_STATUS_CHANGED, OrderStatusChanged } from './messages.js';

export type OrderOutcome = 'counted' | 'uncounted' | 'duplicate' | 'disputed' | 'ignored' | 'invalid';

// An order counts once, the first time it reaches any of these (team decision
// 2026-10-30). The same list as Order Service's COMPLETED_DELIVERIES.
export const COUNTED_STATUSES = new Set(['DELIVERED', 'ACKNOWLEDGED', 'UNACKNOWLEDGED', 'COMPLETED']);

type Role = 'COURIER' | 'REQUESTER';

// COURIER rows feed completedDeliveries, REQUESTER rows completedOrders.
async function adjustCount(executor: Executor, userId: string, role: Role, delta: 1 | -1): Promise<void> {
  const initial = delta > 0 ? 1 : 0;
  const counts =
    role === 'COURIER'
      ? {
          insert: { completedDeliveries: initial },
          update: { completedDeliveries: sql`greatest(${userMetrics.completedDeliveries} + ${delta}, 0)` },
        }
      : {
          insert: { completedOrders: initial },
          update: { completedOrders: sql`greatest(${userMetrics.completedOrders} + ${delta}, 0)` },
        };
  await executor
    .insert(userMetrics)
    .values({ userId, ...counts.insert, lastOrderEventAt: new Date() })
    .onConflictDoUpdate({
      target: userMetrics.userId,
      set: { ...counts.update, lastOrderEventAt: sql`now()`, updatedAt: sql`now()` },
    });
}

/**
 * Handles one message from foc.order.status. Throws only on failures worth
 * retrying (e.g. the database is down); a malformed message is 'invalid' and skipped.
 */
export async function handleOrderEvent(raw: string): Promise<OrderOutcome> {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return 'invalid';
  }

  const eventType = (message as { eventType?: unknown } | null)?.eventType;
  if (eventType !== ORDER_STATUS_CHANGED) return 'ignored';
  if (!Value.Check(OrderStatusChanged, message)) return 'invalid';

  const { orderId, requesterId, courierId, toStatus } = message;

  return db.transaction(async (tx) => {
    // A disputed order never counts, whatever the admin decides: take back
    // anything already counted for it (team decision 2026-10-30).
    if (toStatus === 'ESCALATED') {
      await tx.insert(disputedOrder).values({ orderId }).onConflictDoNothing();
      const removed = await tx
        .delete(countedOrder)
        .where(eq(countedOrder.orderId, orderId))
        .returning({ userId: countedOrder.userId, role: countedOrder.role });
      for (const row of removed) {
        await adjustCount(tx, row.userId, row.role, -1);
      }
      for (const userId of new Set(removed.map((row) => row.userId))) {
        await evaluateUser(userId, tx);
      }
      return removed.length > 0 ? 'uncounted' : 'disputed';
    }

    if (!COUNTED_STATUSES.has(toStatus)) return 'ignored';

    const [dispute] = await tx.select().from(disputedOrder).where(eq(disputedOrder.orderId, orderId));
    if (dispute) return 'disputed';

    const rows: { orderId: string; role: Role; userId: string }[] = [
      { orderId, role: 'REQUESTER', userId: requesterId },
    ];
    if (courierId !== null) rows.push({ orderId, role: 'COURIER', userId: courierId });

    // The primary key makes a later status of the same order, or a redelivery, a no-op (NFR2.1).
    const added = await tx
      .insert(countedOrder)
      .values(rows)
      .onConflictDoNothing()
      .returning({ userId: countedOrder.userId, role: countedOrder.role });
    for (const row of added) {
      await adjustCount(tx, row.userId, row.role, 1);
    }
    for (const userId of new Set(added.map((row) => row.userId))) {
      await evaluateUser(userId, tx);
    }
    return added.length > 0 ? 'counted' : 'duplicate';
  });
}
