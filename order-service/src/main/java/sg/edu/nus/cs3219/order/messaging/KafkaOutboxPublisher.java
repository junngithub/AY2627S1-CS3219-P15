package sg.edu.nus.cs3219.order.messaging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.persistence.OutboxEntity;
import sg.edu.nus.cs3219.order.persistence.OutboxRepository;

import java.time.Clock;
import java.util.concurrent.TimeUnit;

@Component
public class KafkaOutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(KafkaOutboxPublisher.class);

    private final OutboxRepository outbox;
    private final KafkaTemplate<String, String> kafka;
    private final Clock clock;

    public KafkaOutboxPublisher(OutboxRepository outbox, KafkaTemplate<String, String> kafka, Clock clock) {
        this.outbox = outbox;
        this.kafka = kafka;
        this.clock = clock;
    }

    public void publishPending() {
        for (OutboxEntity row : outbox.findTop50ByPublishedAtIsNullOrderByCreatedAtAsc()) {
            try {
                kafka.send(row.getTopic(), row.getMessageKey(), row.getPayload()).get(5, TimeUnit.SECONDS);
                row.setPublishedAt(clock.instant());
                outbox.save(row);
            } catch (Exception exception) {
                log.warn("Kafka publish failed for outbox {}; it will be retried", row.getId(), exception);
            }
        }
    }
}
