package sg.edu.nus.cs3219.order.domain;

import org.junit.jupiter.api.Test;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OrderStateMachineTest {

    private final Instant now = Instant.parse("2026-10-02T04:00:00Z");

    @Test
    void collectIsOnlyAllowedFromAcceptedByTheAssignedCourier() {
        OrderSnapshot order = snapshot(OrderStatus.ACCEPTED, "22222222-2222-2222-2222-222222222222", now.plusSeconds(60), now.plusSeconds(3600));
        assertDoesNotThrow(() -> OrderStateMachine.requireAccepted(order));
        assertDoesNotThrow(() -> OrderStateMachine.requireCourier(order, "22222222-2222-2222-2222-222222222222"));
        assertDoesNotThrow(() -> OrderStateMachine.requireBefore(order.collectionDeadline(), now, "closed"));
    }

    @Test
    void anotherCourierCannotCollect() {
        OrderSnapshot order = snapshot(OrderStatus.ACCEPTED, "22222222-2222-2222-2222-222222222222", now.plusSeconds(60), now.plusSeconds(3600));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCourier(order, "33333333-3333-3333-3333-333333333333"));
    }

    @Test
    void missedDeliveryEscalatesOnlyWhileCollected() {
        OrderSnapshot collected = snapshot(OrderStatus.COLLECTED, "22222222-2222-2222-2222-222222222222", now.minusSeconds(10), now.minusSeconds(1));
        assertTrue(OrderStateMachine.deliveryMissed(collected, now));
        OrderSnapshot delivered = snapshot(OrderStatus.DELIVERED, "22222222-2222-2222-2222-222222222222", now.minusSeconds(10), now.minusSeconds(1));
        assertFalse(OrderStateMachine.deliveryMissed(delivered, now));
    }

    @Test
    void acknowledgementClosesEscalation() {
        OrderSnapshot order = new OrderSnapshot(
                UUID.randomUUID(),
                OrderStatus.DELIVERED,
                "11111111-1111-1111-1111-111111111111",
                "22222222-2222-2222-2222-222222222222",
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
                "11111111-1111-1111-1111-111111111111",
                "22222222-2222-2222-2222-222222222222",
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
        OrderSnapshot accepted = snapshot(OrderStatus.ACCEPTED, "44444444-4444-4444-4444-444444444444", now, now);
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCreated(accepted));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireAccepted(created));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCollected(created));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCourier(created, "44444444-4444-4444-4444-444444444444"));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireRequester(created, "33333333-3333-3333-3333-333333333333"));
        OrderStateMachine.requireRequester(created, "11111111-1111-1111-1111-111111111111");
        assertThrows(ApiException.class, () -> OrderStateMachine.requireBefore(null, now, "closed"));
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCanAcknowledge(created, now));
        OrderSnapshot delivered = snapshot(OrderStatus.DELIVERED, "44444444-4444-4444-4444-444444444444", now, now.plusSeconds(60));
        OrderStateMachine.requireCanAcknowledge(delivered, now);
        OrderStateMachine.requireCanEscalate(delivered, now);
        assertThrows(ApiException.class, () -> OrderStateMachine.requireCanEscalate(created, now));
        assertTrue(OrderStateMachine.collectionWindowExpired(snapshot(OrderStatus.ACCEPTED, "44444444-4444-4444-4444-444444444444", now.minusSeconds(1), now), now));
        assertFalse(OrderStateMachine.collectionWindowExpired(created, now));
        OrderSnapshot expired = new OrderSnapshot(created.id(), OrderStatus.CREATED, created.requesterId(), null, now.minusSeconds(1), now, now, now, null);
        assertTrue(OrderStateMachine.acceptanceExpired(expired, now));
        assertFalse(OrderStateMachine.acceptanceExpired(created, now));
        assertFalse(OrderStateMachine.acknowledgementExpired(snapshot(OrderStatus.COLLECTED, "44444444-4444-4444-4444-444444444444", now, now.minusSeconds(1)), now.plusSeconds(90_000)));
        assertTrue(OrderStateMachine.acknowledgementExpired(snapshot(OrderStatus.DELIVERED, "44444444-4444-4444-4444-444444444444", now, now.minusSeconds(1)), now.plusSeconds(90_000)));
        assertFalse(OrderStateMachine.acknowledgementExpired(created, now));
    }

    private OrderSnapshot snapshot(OrderStatus status, String courier, Instant collectionDeadline, Instant deliveryDeadline) {
        return new OrderSnapshot(
                UUID.randomUUID(),
                status,
                "11111111-1111-1111-1111-111111111111",
                courier,
                now.plusSeconds(600),
                deliveryDeadline,
                collectionDeadline,
                deliveryDeadline.plusSeconds(86_400),
                null
        );
    }
}
