/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service REST layer under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.rest;

import sg.edu.nus.cs3219.order.persistence.AlertEntity;

import java.time.Instant;
import java.util.UUID;

public record AlertResponse(
        UUID id,
        UUID orderId,
        String fromStatus,
        String toStatus,
        /** True when this row is in the caller's list because they are the courier. */
        boolean asCourier,
        Instant createdAt
) {
    public static AlertResponse from(AlertEntity alert, String viewerId) {
        boolean asCourier = alert.isNotifyCourier()
                && alert.getCourierId() != null
                && viewerId != null
                && alert.getCourierId().equalsIgnoreCase(viewerId);
        return new AlertResponse(
                alert.getId(),
                alert.getOrderId(),
                alert.getFromStatus(),
                alert.getToStatus(),
                asCourier,
                alert.getCreatedAt()
        );
    }
}
