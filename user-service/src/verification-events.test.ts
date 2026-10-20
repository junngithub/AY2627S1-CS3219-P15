import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VerificationEventDispatcher, type PendingVerifiedEvent, type VerifiedEventStore } from "./verification-events";

describe("verification event retry", () => {
  it("keeps a failed event pending and retries with the same event ID and time", async () => {
    const event: PendingVerifiedEvent = {
      id: "event-a", userId: "user-a", email: "a@u.nus.edu", createdAt: new Date("2026-10-14T00:00:00Z"),
    };
    let published = false;
    const attempts: unknown[] = [];
    const store: VerifiedEventStore = {
      pending: async () => published ? [] : [event],
      markPublished: async (id) => { assert.equal(id, event.id); published = true; },
    };
    const dispatcher = new VerificationEventDispatcher({
      publishUserVerified: async (...args) => {
        attempts.push(args);
        if (attempts.length === 1) throw new Error("broker unavailable");
      },
    }, store);
    await assert.rejects(dispatcher.flush(), /broker unavailable/);
    assert.equal(published, false);
    await dispatcher.flush();
    assert.equal(published, true);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.deepEqual(attempts[1], [{ userId: "user-a", email: "a@u.nus.edu" }, "event-a", "2026-10-14T00:00:00.000Z"]);
  });

  it("shares an in-flight flush instead of sending twice", async () => {
    let sends = 0;
    const dispatcher = new VerificationEventDispatcher({ publishUserVerified: async () => { sends += 1; } }, {
      pending: async () => [{ id: "event-a", userId: "user-a", email: "a@u.nus.edu", createdAt: new Date() }],
      markPublished: async () => undefined,
    });
    await Promise.all([dispatcher.flush(), dispatcher.flush()]);
    assert.equal(sends, 1);
  });
});
