package sg.edu.nus.cs3219.order.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.SchedulingConfigurer;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.messaging.KafkaOutboxPublisher;
import sg.edu.nus.cs3219.order.persistence.OrderRepository;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Configuration
@EnableScheduling
public class DeadlineSweeper implements SchedulingConfigurer {

    private static final Logger log = LoggerFactory.getLogger(DeadlineSweeper.class);

    private final OrderRepository orders;
    private final OrderCommandService commands;
    private final KafkaOutboxPublisher publisher;
    private final OrderProperties properties;
    private final Clock clock;

    public DeadlineSweeper(
            OrderRepository orders,
            OrderCommandService commands,
            KafkaOutboxPublisher publisher,
            OrderProperties properties,
            Clock clock
    ) {
        this.orders = orders;
        this.commands = commands;
        this.publisher = publisher;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public void configureTasks(ScheduledTaskRegistrar registrar) {
        registrar.addFixedDelayTask(this::sweep, properties.getDeadlines().getSweepInterval());
    }

    public void sweep() {
        Instant now = clock.instant();
        runEach(orders.findCollectionWindowExpired(OrderStatus.ACCEPTED, now), id -> commands.revertCollectionWindow(id, now));
        runEach(orders.findAcceptanceExpired(OrderStatus.CREATED, now), id -> commands.expire(id, now));
        runEach(orders.findDeliveryMissed(OrderStatus.COLLECTED, now), id -> commands.escalateMissedDelivery(id, now));
        runEach(orders.findAcknowledgementExpired(List.of(OrderStatus.DELIVERED), now), id -> commands.unacknowledge(id, now));
        Instant settledBefore = now.minus(properties.getDeadlines().getCompletionWindow());
        runEach(orders.findReadyToComplete(List.of(OrderStatus.ACKNOWLEDGED, OrderStatus.UNACKNOWLEDGED), settledBefore), id -> commands.completeSettled(id, now));
        try {
            publisher.publishPending();
        } catch (RuntimeException exception) {
            log.warn("Outbox publish pass failed", exception);
        }
    }

    private void runEach(List<UUID> ids, java.util.function.Consumer<UUID> action) {
        for (UUID id : ids) {
            try {
                action.accept(id);
            } catch (RuntimeException exception) {
                log.warn("Deadline action failed for order {}", id, exception);
            }
        }
    }
}
