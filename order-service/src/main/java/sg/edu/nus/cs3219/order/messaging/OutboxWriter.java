package sg.edu.nus.cs3219.order.messaging;

import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.persistence.OutboxEntity;
import sg.edu.nus.cs3219.order.persistence.OutboxRepository;

import java.time.Instant;
import java.util.UUID;

@Component
public class OutboxWriter {

    private final OutboxRepository outbox;

    public OutboxWriter(OutboxRepository outbox) {
        this.outbox = outbox;
    }

    public void append(UUID orderId, String topic, String payload, Instant createdAt) {
        OutboxEntity entity = new OutboxEntity();
        entity.setId(UUID.randomUUID());
        entity.setOrderId(orderId);
        entity.setTopic(topic);
        entity.setMessageKey(orderId.toString());
        entity.setPayload(payload);
        entity.setCreatedAt(createdAt);
        outbox.save(entity);
    }
}
