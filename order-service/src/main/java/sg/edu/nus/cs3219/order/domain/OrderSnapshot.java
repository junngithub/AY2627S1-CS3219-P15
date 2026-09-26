package sg.edu.nus.cs3219.order.domain;

import java.time.Instant;
import java.util.UUID;

public record OrderSnapshot(
        UUID id,
        OrderStatus status,
        String requesterEmail,
        String courierEmail,
        Instant acceptanceExpiry,
        Instant deliveryDeadline,
        Instant collectionDeadline,
        Instant acknowledgementDeadline,
        Instant settledAt
) {
}
