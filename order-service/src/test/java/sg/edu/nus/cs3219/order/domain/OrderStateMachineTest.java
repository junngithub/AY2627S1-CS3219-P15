package sg.edu.nus.cs3219.order.domain;

import org.junit.jupiter.api.Test;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OrderStateMachineTest {

    private final Instant now = Instant.parse("2026-10-02T04:00:00Z");

    @Test
    void collectIsOnlyAllowedFromAcceptedByTheAssignedCourier() {
        OrderSnapshot order = snapshot(OrderStatus.ACCEPTED, "courier@u.nus.edu", now.plusSeconds(60), now.plusSeconds(3600));
        OrderStateMachine.requireAccepted(order);
        OrderStateMachine.requireCourier(order, "courier@u.nus.edu");
        OrderStateMachine.requireBefore(order.collectionDeadline(), now, "closed");
    }

    @Test
    void anotherCourierCannotCollect() {
        OrderSnapshot order = snapshot(OrderStatus.ACCEPTED, "courier@u.nus.edu", now.plusSeconds(60), now.plusSeconds(3600));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCourier(order, "other@u.nus.edu"));
    }

    @Test
    void missedDeliveryEscalatesOnlyWhileCollected() {
        OrderSnapshot collected = snapshot(OrderStatus.COLLECTED, "courier@u.nus.edu", now.minusSeconds(10), now.minusSeconds(1));
        assertTrue(OrderStateMachine.deliveryMissed(collected, now));
        OrderSnapshot delivered = snapshot(OrderStatus.DELIVERED, "courier@u.nus.edu", now.minusSeconds(10), now.minusSeconds(1));
        assertFalse(OrderStateMachine.deliveryMissed(delivered, now));
    }

    @Test
    void acknowledgementClosesEscalation() {
        OrderSnapshot order = new OrderSnapshot(
                UUID.randomUUID(),
                OrderStatus.DELIVERED,
                "requester@u.nus.edu",
                "courier@u.nus.edu",
                now.plusSeconds(600),
                now.minusSeconds(86_400),
                now.minusSeconds(86_500),
                now.minusSeconds(1),
                null
        );
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCanEscalate(order, now));
    }

    @Test
    void settledOrdersCompleteAfterTheWindow() {
        OrderSnapshot order = new OrderSnapshot(
                UUID.randomUUID(),
                OrderStatus.ACKNOWLEDGED,
                "requester@u.nus.edu",
                "courier@u.nus.edu",
                now,
                now,
                now,
                now,
                now.minusSeconds(10)
        );
        assertTrue(OrderStateMachine.readyToComplete(order, now));
        assertFalse(OrderStateMachine.readyToComplete(snapshot(OrderStatus.CREATED, null, now, now), now));
        assertEquals(OrderStatus.ESCALATED, snapshot(OrderStatus.ESCALATED, null, now, now).status());
        assertTrue(OrderStateMachine.canReview(snapshot(OrderStatus.ESCALATED, null, now, now)));
        assertFalse(OrderStateMachine.canReview(snapshot(OrderStatus.CREATED, null, now, now)));
        assertTrue(OrderStateMachine.canResolve(snapshot(OrderStatus.UNDER_REVIEW, null, now, now)));
        assertFalse(OrderStateMachine.canResolve(snapshot(OrderStatus.CREATED, null, now, now)));
    }

    @Test
    void everyGuardRejectsTheWrongState() {
        OrderSnapshot created = snapshot(OrderStatus.CREATED, null, now.plusSeconds(60), now.plusSeconds(3600));
        OrderStateMachine.requireCreated(created);
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCreated(snapshot(OrderStatus.ACCEPTED, "c@u.nus.edu", now, now)));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireAccepted(created));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCollected(created));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCourier(created, "c@u.nus.edu"));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireRequester(created, "other@u.nus.edu"));
        OrderStateMachine.requireRequester(created, "requester@u.nus.edu");
        assertThrows(ApiException.class, () -> OrderStateMachine.requireBefore(null, now, "closed"));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCanAcknowledge(created, now));
        OrderSnapshot delivered = snapshot(OrderStatus.DELIVERED, "c@u.nus.edu", now, now.plusSeconds(60));
        OrderStateMachine.requireCanAcknowledge(delivered, now);
        OrderStateMachine.requireCanEscalate(delivered, now);
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCanEscalate(created, now));
        assertTrue(OrderStateMachine.collectionWindowExpired(snapshot(OrderStatus.ACCEPTED, "c@u.nus.edu", now.minusSeconds(1), now), now));
        assertFalse(OrderStateMachine.collectionWindowExpired(created, now));
        OrderSnapshot expired = new OrderSnapshot(created.id(), OrderStatus.CREATED, created.requesterEmail(), null, now.minusSeconds(1), now, now, now, null);
        assertTrue(OrderStateMachine.acceptanceExpired(expired, now));
        assertFalse(OrderStateMachine.acceptanceExpired(created, now));
        assertTrue(OrderStateMachine.acknowledgementExpired(snapshot(OrderStatus.COLLECTED, "c@u.nus.edu", now, now.minusSeconds(1)), now.plusSeconds(90_000)));
        assertFalse(OrderStateMachine.acknowledgementExpired(created, now));
    }

    private OrderSnapshot snapshot(OrderStatus status, String courier, Instant collectionDeadline, Instant deliveryDeadline) {
        return new OrderSnapshot(
                UUID.randomUUID(),
                status,
                "requester@u.nus.edu",
                courier,
                now.plusSeconds(600),
                deliveryDeadline,
                collectionDeadline,
                deliveryDeadline.plusSeconds(86_400),
                null
        );
    }
}
