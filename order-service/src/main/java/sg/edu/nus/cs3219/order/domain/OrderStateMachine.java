package sg.edu.nus.cs3219.order.domain;

import sg.edu.nus.cs3219.order.rest.ApiException;

import java.time.Instant;

public final class OrderStateMachine {

    private OrderStateMachine() {
    }

    public static void requireCreated(OrderSnapshot order) {
        requireStatus(order, OrderStatus.CREATED, "This order can only change while it is still open");
    }

    public static void requireAccepted(OrderSnapshot order) {
        requireStatus(order, OrderStatus.ACCEPTED, "This order is not waiting for collection");
    }

    public static void requireCollected(OrderSnapshot order) {
        requireStatus(order, OrderStatus.COLLECTED, "This order has not been collected");
    }

    public static void requireCourier(OrderSnapshot order, String email) {
        if (order.courierEmail() == null || !order.courierEmail().equalsIgnoreCase(email)) {
            throw ApiException.conflict("Only the assigned courier can do that");
        }
    }

    public static void requireRequester(OrderSnapshot order, String email) {
        if (!order.requesterEmail().equalsIgnoreCase(email)) {
            throw ApiException.conflict("Only the requester can do that");
        }
    }

    public static void requireBefore(Instant deadline, Instant now, String message) {
        if (deadline == null || !now.isBefore(deadline)) {
            throw ApiException.conflict(message);
        }
    }

    public static void requireCanAcknowledge(OrderSnapshot order, Instant now) {
        if (order.status() != OrderStatus.COLLECTED && order.status() != OrderStatus.DELIVERED) {
            throw ApiException.conflict("This order cannot be acknowledged yet");
        }
        requireBefore(order.acknowledgementDeadline(), now, "The acknowledgement window has closed");
    }

    public static void requireCanEscalate(OrderSnapshot order, Instant now) {
        if (order.status() != OrderStatus.COLLECTED && order.status() != OrderStatus.DELIVERED) {
            throw ApiException.conflict("This order cannot be escalated");
        }
        if (order.acknowledgementDeadline() != null && !now.isBefore(order.acknowledgementDeadline())) {
            throw ApiException.conflict("The acknowledgement window has closed");
        }
    }

    public static boolean collectionWindowExpired(OrderSnapshot order, Instant now) {
        return order.status() == OrderStatus.ACCEPTED
                && order.collectionDeadline() != null
                && !now.isBefore(order.collectionDeadline());
    }

    public static boolean acceptanceExpired(OrderSnapshot order, Instant now) {
        return order.status() == OrderStatus.CREATED
                && order.acceptanceExpiry() != null
                && !now.isBefore(order.acceptanceExpiry());
    }

    public static boolean deliveryMissed(OrderSnapshot order, Instant now) {
        return order.status() == OrderStatus.COLLECTED
                && order.deliveryDeadline() != null
                && !now.isBefore(order.deliveryDeadline());
    }

    public static boolean acknowledgementExpired(OrderSnapshot order, Instant now) {
        return order.status() == OrderStatus.DELIVERED
                && order.acknowledgementDeadline() != null
                && !now.isBefore(order.acknowledgementDeadline());
    }

    public static boolean readyToComplete(OrderSnapshot order, Instant settledBefore) {
        return (order.status() == OrderStatus.ACKNOWLEDGED || order.status() == OrderStatus.UNACKNOWLEDGED)
                && order.settledAt() != null
                && !order.settledAt().isAfter(settledBefore);
    }

    public static boolean canReview(OrderSnapshot order) {
        return order.status() == OrderStatus.ESCALATED;
    }

    public static boolean canResolve(OrderSnapshot order) {
        return order.status() == OrderStatus.ESCALATED || order.status() == OrderStatus.UNDER_REVIEW;
    }

    private static void requireStatus(OrderSnapshot order, OrderStatus expected, String message) {
        if (order.status() != expected) {
            throw ApiException.conflict(message);
        }
    }
}
