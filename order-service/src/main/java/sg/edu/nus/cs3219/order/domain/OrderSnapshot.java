/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service domain (state machine / ranking) under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.domain;

import java.time.Instant;
import java.util.UUID;

public record OrderSnapshot(
        UUID id,
        OrderStatus status,
        String requesterId,
        String courierId,
        Instant acceptanceExpiry,
        Instant deliveryDeadline,
        Instant collectionDeadline,
        Instant acknowledgementDeadline,
        Instant settledAt
) {
}
