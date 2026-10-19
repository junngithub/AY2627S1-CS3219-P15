import { isNull } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { type MessageSender, relayOutboxBatch, startOutboxRelay } from '../src/messaging/outbox.js';
import { db, outbox } from './helpers.js';

function fakeSender(failOn?: number) {
  const sent: { topic: string; key: string; value: unknown }[] = [];
  const sender: MessageSender = {
    send: vi.fn(async ({ topic, messages }) => {
      if (failOn !== undefined && sent.length === failOn) throw new Error('broker down');
      for (const m of messages) sent.push({ topic, key: m.key, value: JSON.parse(m.value) });
    }),
  };
  return { sender, sent };
}

async function queue(n: number) {
  for (let i = 0; i < n; i += 1) {
    await db.insert(outbox).values({ topic: 'foc.user.rating', messageKey: `user-${i}`, payload: { i } });
  }
}

describe('relayOutboxBatch', () => {
  it('sends unsent rows in order and marks them sent', async () => {
    await queue(3);
    const { sender, sent } = fakeSender();

    expect(await relayOutboxBatch(sender)).toBe(3);
    expect(sent.map((s) => s.value)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
    expect(sent[0]).toMatchObject({ topic: 'foc.user.rating', key: 'user-0' });
    expect(await db.select().from(outbox).where(isNull(outbox.sentAt))).toHaveLength(0);

    expect(await relayOutboxBatch(sender)).toBe(0);
  });

  it('respects the batch limit', async () => {
    await queue(3);
    const { sender } = fakeSender();
    expect(await relayOutboxBatch(sender, 2)).toBe(2);
    expect(await db.select().from(outbox).where(isNull(outbox.sentAt))).toHaveLength(1);
  });

  it('leaves the whole batch unsent when a send fails', async () => {
    await queue(3);
    const { sender } = fakeSender(1);
    await expect(relayOutboxBatch(sender)).rejects.toThrow('broker down');
    expect(await db.select().from(outbox).where(isNull(outbox.sentAt))).toHaveLength(3);
  });
});

describe('startOutboxRelay', () => {
  it('drains the outbox and reports errors without stopping', async () => {
    await queue(2);
    const { sender, sent } = fakeSender();
    const onError = vi.fn();
    const stop = startOutboxRelay(sender, 10, onError);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    stop();
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when a pass fails', async () => {
    await queue(1);
    const { sender } = fakeSender(0);
    const onError = vi.fn();
    const stop = startOutboxRelay(sender, 10, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    stop();
  });
});
