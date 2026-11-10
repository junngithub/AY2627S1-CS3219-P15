/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service messaging/outbox under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.service.DeliveryPointService;

@Component
public class UserStatusEventListener {

    private static final Logger log = LoggerFactory.getLogger(UserStatusEventListener.class);

    private final ObjectMapper mapper;
    private final DeliveryPointService deliveryPoints;

    public UserStatusEventListener(ObjectMapper mapper, DeliveryPointService deliveryPoints) {
        this.mapper = mapper;
        this.deliveryPoints = deliveryPoints;
    }

    @KafkaListener(topics = KafkaTopics.USER_STATUS)
    public void onMessage(String payload) {
        try {
            JsonNode node = mapper.readTree(payload);
            String type = text(node, "type");
            if (!"UserDeleted".equals(type)) {
                return;
            }
            String eventId = text(node, "eventId");
            JsonNode data = node.path("data");
            String userId = text(data.isObject() ? data : node, "userId");
            if (userId == null) {
                return;
            }
            deliveryPoints.applyUserDeleted(eventId, userId);
        } catch (RuntimeException exception) {
            throw new IllegalStateException("User status event was not applied and will be retried", exception);
        } catch (Exception exception) {
            log.warn("User status event was ignored because it could not be read", exception);
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text.isBlank() ? null : text;
    }
}
