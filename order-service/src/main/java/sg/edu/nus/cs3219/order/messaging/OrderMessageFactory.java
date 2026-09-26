package sg.edu.nus.cs3219.order.messaging;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;

import java.time.Instant;
import java.util.UUID;

@Component
public class OrderMessageFactory {

    private final ObjectMapper mapper;

    public OrderMessageFactory(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public String statusChanged(OrderEntity order, OrderStatus from, OrderStatus to, boolean notify, Instant occurredAt) {
        ObjectNode node = envelope("order.status.changed", order.getId(), occurredAt);
        node.put("requesterEmail", order.getRequesterEmail());
        if (order.getCourierEmail() == null) {
            node.putNull("courierEmail");
        } else {
            node.put("courierEmail", order.getCourierEmail());
        }
        if (from == null) {
            node.putNull("fromStatus");
        } else {
            node.put("fromStatus", from.name());
        }
        node.put("toStatus", to.name());
        node.put("notifyRequester", notify);
        return write(node);
    }

    public String creditReturn(OrderEntity order, Instant occurredAt) {
        ObjectNode node = envelope("credit.reservation.return", order.getId(), occurredAt);
        node.put("requesterEmail", order.getRequesterEmail());
        node.put("amount", order.getAmount());
        node.put("reason", "EXPIRED");
        return write(node);
    }

    public String creditRelease(OrderEntity order, String reason, Instant occurredAt) {
        ObjectNode node = envelope("credit.reservation.release", order.getId(), occurredAt);
        node.put("requesterEmail", order.getRequesterEmail());
        node.put("courierEmail", order.getCourierEmail());
        node.put("amount", order.getAmount());
        node.put("reason", reason);
        return write(node);
    }

    public String ratingPermission(OrderEntity order, String raterEmail, String raterRole, String rateeEmail, String rateeRole, Instant occurredAt) {
        ObjectNode node = envelope("rating.permission.granted", order.getId(), occurredAt);
        node.put("raterEmail", raterEmail);
        node.put("raterRole", raterRole);
        node.put("rateeEmail", rateeEmail);
        node.put("rateeRole", rateeRole);
        return write(node);
    }

    public String escalationOpened(OrderEntity order, Instant occurredAt) {
        ObjectNode node = envelope("admin.escalation.opened", order.getId(), occurredAt);
        node.put("requesterEmail", order.getRequesterEmail());
        node.put("courierEmail", order.getCourierEmail());
        node.put("reason", "DELIVERY_DEADLINE_MISSED");
        node.put("status", OrderStatus.COLLECTED.name());
        node.put("itemDescription", order.getItemDescription());
        node.put("amount", order.getAmount());
        if (order.getCollectionPhotoRef() == null) {
            node.putNull("collectionPhotoRef");
        } else {
            node.put("collectionPhotoRef", order.getCollectionPhotoRef());
        }
        if (order.getDeliveryPhotoRef() == null) {
            node.putNull("deliveryPhotoRef");
        } else {
            node.put("deliveryPhotoRef", order.getDeliveryPhotoRef());
        }
        return write(node);
    }

    private ObjectNode envelope(String eventType, UUID orderId, Instant occurredAt) {
        ObjectNode node = mapper.createObjectNode();
        node.put("eventId", UUID.randomUUID().toString());
        node.put("eventType", eventType);
        node.put("schemaVersion", 1);
        node.put("occurredAt", occurredAt.toString());
        node.put("orderId", orderId.toString());
        return node;
    }

    private String write(ObjectNode node) {
        try {
            return mapper.writeValueAsString(node);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Could not write order event", exception);
        }
    }
}
