package sg.edu.nus.cs3219.order.client;

import java.time.Instant;
import java.util.UUID;

public record OrderContext(
        UUID orderId,
        String status,
        String itemDescription,
        int credits,
        String requesterId,
        String requesterTelegramHandle,
        Double requesterRating,
        String courierId,
        String courierTelegramHandle,
        Double courierRating,
        Instant requestTime,
        Instant expiryTime,
        Instant deliveryTime,
        Instant collectionDeadline,
        Instant acknowledgementDeadline,
        String fromLocation,
        String fromName,
        double fromLatitude,
        double fromLongitude,
        String toLocation,
        String toName,
        double toLatitude,
        double toLongitude,
        String collectionPhotoRef,
        String deliveryPhotoRef,
        String disputePhotoRef,
        String comment
) {
}
