package sg.edu.nus.cs3219.order.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.service.OrderCommandService;

import java.util.UUID;

@Component
public class AdminEventListener {

    private static final Logger log = LoggerFactory.getLogger(AdminEventListener.class);

    private final ObjectMapper mapper;
    private final OrderCommandService commands;

    public AdminEventListener(ObjectMapper mapper, OrderCommandService commands) {
        this.mapper = mapper;
        this.commands = commands;
    }

    @KafkaListener(topics = KafkaTopics.ADMIN_EVENTS)
    public void onMessage(String payload) {
        try {
            JsonNode node = mapper.readTree(payload);
            String eventId = text(node, "eventId");
            String eventType = text(node, "eventType");
            String orderId = text(node, "orderId");
            String caseId = text(node, "caseId");
            if (orderId == null) {
                return;
            }
            commands.applyAdminEvent(eventId, eventType, UUID.fromString(orderId), caseId);
        } catch (IllegalArgumentException exception) {
            log.warn("Admin event was ignored because the order id was not a UUID");
        } catch (RuntimeException exception) {
            log.warn("Admin event was not applied and will be retried", exception);
            throw exception;
        } catch (Exception exception) {
            log.warn("Admin event was ignored because it could not be read", exception);
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
