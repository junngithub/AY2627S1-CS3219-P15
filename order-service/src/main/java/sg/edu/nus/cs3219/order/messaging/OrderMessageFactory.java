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

    private static final String REQUESTER_ID = "requesterId";
    private static final String COURIER_ID = "courierId";
    private static final String AMOUNT = "amount";
    private static final String REASON = "reason";

    private final ObjectMapper mapper;

    public OrderMessageFactory(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public String statusChanged(OrderEntity order, OrderStatus from, OrderStatus to, boolean notify, Instant occurredAt) {
        ObjectNode node = envelope("order.status.changed", order.getId(), occurredAt);
        node.put(REQUESTER_ID, order.getRequesterId());
        if (order.getCourierId() == null) {
            node.putNull(COURIER_ID);
        } else {
            node.put(COURIER_ID, order.getCourierId());
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
        node.put(REQUESTER_ID, order.getRequesterId());
        node.put(AMOUNT, order.getAmount());
        node.put(REASON, "EXPIRED");
        return write(node);
    }

    public String creditRelease(OrderEntity order, String reason, Instant occurredAt) {
        ObjectNode node = envelope("credit.reservation.release", order.getId(), occurredAt);
        node.put(REQUESTER_ID, order.getRequesterId());
        node.put(COURIER_ID, order.getCourierId());
        node.put(AMOUNT, order.getAmount());
        node.put(REASON, reason);
        return write(node);
    }

    public String ratingPermission(OrderEntity order, String raterId, String raterRole, String rateeId, String rateeRole, Instant occurredAt) {
        ObjectNode node = envelope("rating.permission.granted", order.getId(), occurredAt);
        node.put("raterId", raterId);
        node.put("raterRole", raterRole);
        node.put("rateeId", rateeId);
        node.put("rateeRole", rateeRole);
        return write(node);
    }

    public String escalationOpened(OrderEntity order, Instant occurredAt) {
        ObjectNode node = envelope("admin.escalation.opened", order.getId(), occurredAt);
        node.put(REQUESTER_ID, order.getRequesterId());
        node.put(COURIER_ID, order.getCourierId());
        node.put(REASON, "DELIVERY_DEADLINE_MISSED");
        node.put("status", OrderStatus.COLLECTED.name());
        node.put("itemDescription", order.getItemDescription());
        node.put(AMOUNT, order.getAmount());
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
