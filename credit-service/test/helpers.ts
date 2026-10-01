import { randomUUID } from 'node:crypto';
import { db } from '../src/database/index.js';
import { creditOrder, creditUser } from '../src/database/schema.js';

export { db };
export { creditLog, creditOrder, creditUser } from '../src/database/schema.js';

// Insert a user with a known balance; returns the generated id.
export async function seedUser(balance = 20): Promise<string> {
  const userId = randomUUID();
  await db.insert(creditUser).values({ userId, balance });
  return userId;
}

// Insert an active reservation for an existing user; returns the order id.
export async function seedOrder(requesterId: string, reservedCredits = 5): Promise<string> {
  const orderId = randomUUID();
  await db.insert(creditOrder).values({ orderId, requesterId, reservedCredits });
  return orderId;
}
