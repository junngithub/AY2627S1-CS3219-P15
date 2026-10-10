package sg.edu.nus.cs3219.order.rest;

import sg.edu.nus.cs3219.order.persistence.AlertEntity;

import java.time.Instant;
import java.util.UUID;

public record AlertResponse(
        UUID id,
        UUID orderId,
        String fromStatus,
        String toStatus,
        Instant createdAt
) {
    public static AlertResponse from(AlertEntity alert) {
        return new AlertResponse(alert.getId(), alert.getOrderId(), alert.getFromStatus(), alert.getToStatus(), alert.getCreatedAt());
    }
}
