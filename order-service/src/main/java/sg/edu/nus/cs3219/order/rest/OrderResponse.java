package sg.edu.nus.cs3219.order.rest;

import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;

import java.time.Instant;
import java.util.UUID;

public record OrderResponse(
        UUID id,
        String requesterId,
        String requesterTelegramHandle,
        String courierId,
        String courierTelegramHandle,
        Double requesterRating,
        Double courierRating,
        String itemDescription,
        int amount,
        OrderStatus status,
        Instant requestTime,
        Instant acceptanceExpiry,
        Instant deliveryDeadline,
        Instant collectionDeadline,
        Instant acknowledgementDeadline,
        String pickupLocationId,
        String pickupName,
        double pickupLat,
        double pickupLng,
        String dropoffLocationId,
        String dropoffName,
        double dropoffLat,
        double dropoffLng,
        String collectionPhotoRef,
        String deliveryPhotoRef,
        String disputePhotoRef,
        String disputeText
) {
    public static OrderResponse from(OrderEntity order) {
        return new OrderResponse(
                order.getId(),
                order.getRequesterId(),
                order.getRequesterTelegramHandle(),
                order.getCourierId(),
                order.getCourierTelegramHandle(),
                order.getRequesterRating(),
                order.getCourierRating(),
                order.getItemDescription(),
                order.getAmount(),
                order.getStatus(),
                order.getRequestTime(),
                order.getAcceptanceExpiry(),
                order.getDeliveryDeadline(),
                order.getCollectionDeadline(),
                order.getAcknowledgementDeadline(),
                order.getPickupLocationId(),
                order.getPickupName(),
                order.getPickupLat(),
                order.getPickupLng(),
                order.getDropoffLocationId(),
                order.getDropoffName(),
                order.getDropoffLat(),
                order.getDropoffLng(),
                order.getCollectionPhotoRef(),
                order.getDeliveryPhotoRef(),
                order.getDisputePhotoRef(),
                order.getDisputeText()
        );
    }
}
