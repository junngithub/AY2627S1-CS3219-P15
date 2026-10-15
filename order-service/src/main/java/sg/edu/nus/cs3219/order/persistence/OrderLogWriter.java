package sg.edu.nus.cs3219.order.persistence;

import org.springframework.stereotype.Component;
import sg.edu.nus.cs3219.order.domain.OrderAction;
import sg.edu.nus.cs3219.order.domain.OrderStatus;

import java.time.Instant;
import java.util.UUID;

@Component
public class OrderLogWriter {

    private final OrderLogRepository log;

    public OrderLogWriter(OrderLogRepository log) {
        this.log = log;
    }

    public void append(
            UUID orderId,
            OrderAction action,
            OrderStatus from,
            OrderStatus to,
            String actorId,
            Instant occurredAt
    ) {
        OrderLogEntity entry = new OrderLogEntity();
        entry.setId(UUID.randomUUID());
        entry.setOrderId(orderId);
        entry.setAction(action.name());
        entry.setFromStatus(from == null ? null : from.name());
        entry.setToStatus(to.name());
        entry.setActorId(actorId);
        entry.setOccurredAt(occurredAt);
        log.save(entry);
    }
}
