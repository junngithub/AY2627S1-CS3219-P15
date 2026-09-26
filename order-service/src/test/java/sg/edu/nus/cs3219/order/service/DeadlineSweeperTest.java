package sg.edu.nus.cs3219.order.service;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.messaging.KafkaOutboxPublisher;
import sg.edu.nus.cs3219.order.persistence.OrderRepository;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DeadlineSweeperTest {

    @Test
    void sweepContinuesWhenOneOrderOrThePublisherFails() {
        OrderRepository orders = mock(OrderRepository.class);
        OrderCommandService commands = mock(OrderCommandService.class);
        KafkaOutboxPublisher publisher = mock(KafkaOutboxPublisher.class);
        Instant now = Instant.parse("2026-10-02T04:00:00Z");
        Clock clock = Clock.fixed(now, ZoneOffset.UTC);
        DeadlineSweeper sweeper = new DeadlineSweeper(orders, commands, publisher, new OrderProperties(), clock);
        sweeper.configureTasks(new ScheduledTaskRegistrar());

        UUID failing = UUID.randomUUID();
        UUID fine = UUID.randomUUID();
        when(orders.findCollectionWindowExpired(any(), any())).thenReturn(List.of(failing, fine));
        when(orders.findAcceptanceExpired(any(), any())).thenReturn(List.of(fine));
        when(orders.findDeliveryMissed(any(), any())).thenReturn(List.of(fine));
        when(orders.findAcknowledgementExpired(any(), any())).thenReturn(List.of(fine));
        when(orders.findReadyToComplete(any(), any())).thenReturn(List.of(fine));
        doThrow(new IllegalStateException("locked")).when(commands).revertCollectionWindow(failing, now);
        doThrow(new IllegalStateException("kafka")).when(publisher).publishPending();

        sweeper.sweep();

        verify(commands).revertCollectionWindow(fine, now);
        verify(commands).expire(fine, now);
        verify(commands).escalateMissedDelivery(fine, now);
        verify(commands).unacknowledge(fine, now);
        verify(commands).completeSettled(fine, now);
        assertFalse(OrderStatus.values().length == 0);
    }
}
