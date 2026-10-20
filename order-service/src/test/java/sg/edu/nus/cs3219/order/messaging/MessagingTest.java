package sg.edu.nus.cs3219.order.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;
import sg.edu.nus.cs3219.order.persistence.OutboxEntity;
import sg.edu.nus.cs3219.order.persistence.OutboxRepository;
import sg.edu.nus.cs3219.order.service.OrderCommandService;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MessagingTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final Instant now = Instant.parse("2026-10-02T04:00:00Z");
    private final OrderMessageFactory messages = new OrderMessageFactory(mapper);

    @Test
    void messagesCarryTheOrderAndOptionalFields() throws Exception {
        OrderEntity order = order();
        JsonNode created = mapper.readTree(messages.statusChanged(order, null, OrderStatus.CREATED, true, now));
        assertTrue(created.get("courierId").isNull());
        assertTrue(created.get("fromStatus").isNull());
        assertEquals("CREATED", created.get("toStatus").asText());

        order.setCourierId("22222222-2222-2222-2222-222222222222");
        JsonNode accepted = mapper.readTree(messages.statusChanged(order, OrderStatus.CREATED, OrderStatus.ACCEPTED, true, now));
        assertEquals("22222222-2222-2222-2222-222222222222", accepted.get("courierId").asText());

        JsonNode returned = mapper.readTree(messages.creditReturn(order, now));
        assertEquals("EXPIRED", returned.get("reason").asText());
        JsonNode released = mapper.readTree(messages.creditRelease(order, "ACKNOWLEDGED", now));
        assertEquals("22222222-2222-2222-2222-222222222222", released.get("courierId").asText());
        JsonNode rating = mapper.readTree(messages.ratingPermission(order, "22222222-2222-2222-2222-222222222222", "COURIER", order.getRequesterId(), "REQUESTER", now));
        assertEquals("REQUESTER", rating.get("rateeRole").asText());

        JsonNode withoutPhotos = mapper.readTree(messages.escalationOpened(order, now));
        assertTrue(withoutPhotos.get("collectionPhotoRef").isNull());
        order.setCollectionPhotoRef("collection");
        order.setDeliveryPhotoRef("delivery");
        JsonNode withPhotos = mapper.readTree(messages.escalationOpened(order, now));
        assertEquals("delivery", withPhotos.get("deliveryPhotoRef").asText());
    }

    @Test
    void outboxRowsArePublishedAndRetried() {
        OutboxRepository repository = mock(OutboxRepository.class);
        @SuppressWarnings("unchecked")
        KafkaTemplate<String, String> kafka = mock(KafkaTemplate.class);
        Clock clock = Clock.fixed(now, ZoneOffset.UTC);
        KafkaOutboxPublisher publisher = new KafkaOutboxPublisher(repository, kafka, clock);
        OutboxWriter writer = new OutboxWriter(repository);
        UUID orderId = UUID.randomUUID();
        writer.append(orderId, KafkaTopics.ORDER_STATUS, "{}", now);

        OutboxEntity row = new OutboxEntity();
        row.setId(UUID.randomUUID());
        row.setOrderId(orderId);
        row.setTopic(KafkaTopics.ORDER_STATUS);
        row.setMessageKey(orderId.toString());
        row.setPayload("{}");
        row.setCreatedAt(now);
        when(repository.findTop50ByPublishedAtIsNullOrderByCreatedAtAsc()).thenReturn(List.of(row));
        when(kafka.send(any(), any(), any())).thenReturn(CompletableFuture.completedFuture(null));
        publisher.publishPending();
        assertEquals(now, row.getPublishedAt());
        assertEquals(orderId, row.getOrderId());
        assertEquals(now, row.getCreatedAt());

        CompletableFuture<SendResult<String, String>> failed = new CompletableFuture<>();
        failed.completeExceptionally(new IllegalStateException("down"));
        when(kafka.send(any(), any(), any())).thenReturn(failed);
        row.setPublishedAt(null);
        publisher.publishPending();
        assertEquals(null, row.getPublishedAt());
        verify(repository, org.mockito.Mockito.atLeastOnce()).save(any(OutboxEntity.class));
    }

    @Test
    void publishStopsWhenInterrupted() throws Exception {
        OutboxRepository repository = mock(OutboxRepository.class);
        @SuppressWarnings("unchecked")
        KafkaTemplate<String, String> kafka = mock(KafkaTemplate.class);
        KafkaOutboxPublisher publisher = new KafkaOutboxPublisher(repository, kafka, Clock.fixed(now, ZoneOffset.UTC));
        OutboxEntity first = new OutboxEntity();
        first.setId(UUID.randomUUID());
        first.setTopic(KafkaTopics.ORDER_STATUS);
        first.setMessageKey("one");
        first.setPayload("{}");
        OutboxEntity second = new OutboxEntity();
        second.setId(UUID.randomUUID());
        second.setTopic(KafkaTopics.ORDER_STATUS);
        second.setMessageKey("two");
        second.setPayload("{}");
        when(repository.findTop50ByPublishedAtIsNullOrderByCreatedAtAsc()).thenReturn(List.of(first, second));
        @SuppressWarnings("unchecked")
        CompletableFuture<SendResult<String, String>> pending = mock(CompletableFuture.class);
        when(pending.get(anyLong(), any())).thenThrow(new InterruptedException("stop"));
        when(kafka.send(any(), any(), any())).thenReturn(pending);

        try {
            publisher.publishPending();
            assertTrue(Thread.currentThread().isInterrupted());
            verify(kafka, times(1)).send(any(), any(), any());
            assertEquals(null, first.getPublishedAt());
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void adminListenerAppliesReadableEventsAndDropsTheRest() {
        OrderCommandService commands = mock(OrderCommandService.class);
        AdminEventListener listener = new AdminEventListener(mapper, commands);
        UUID orderId = UUID.randomUUID();
        listener.onMessage("{\"eventId\":\"e1\",\"eventType\":\"admin.review.started\",\"orderId\":\"" + orderId + "\",\"caseId\":\"case-1\"}");
        verify(commands).applyAdminEvent("e1", "admin.review.started", orderId, "case-1");

        listener.onMessage("{");
        listener.onMessage("{\"eventId\":\"e2\",\"eventType\":\"admin.review.started\",\"orderId\":\"not-a-uuid\",\"caseId\":\"case-1\"}");
        listener.onMessage("{\"eventId\":\" \",\"eventType\":\"admin.review.started\",\"orderId\":\"" + orderId + "\",\"caseId\":null}");
        doThrow(new IllegalStateException("retry")).when(commands)
                .applyAdminEvent("e3", "admin.case.resolved", orderId, "case-2");
        assertThrows(IllegalStateException.class, () -> listener.onMessage(
                "{\"eventId\":\"e3\",\"eventType\":\"admin.case.resolved\",\"orderId\":\"" + orderId + "\",\"caseId\":\"case-2\"}"));
    }

    @Test
    void topicBeansUseTheConfiguredPartitions() {
        OrderProperties properties = new OrderProperties();
        properties.getKafka().setPartitions(3);
        properties.getKafka().setReplicas(1);
        KafkaTopicConfig config = new KafkaTopicConfig();
        assertEquals(KafkaTopics.CREDIT, config.creditTopic(properties).name());
        assertEquals(KafkaTopics.RATING, config.ratingTopic(properties).name());
        assertEquals(KafkaTopics.ADMIN_COMMANDS, config.adminCommandTopic(properties).name());
        assertEquals(KafkaTopics.ORDER_STATUS, config.orderStatusTopic(properties).name());
        assertEquals(3, config.adminEventTopic(properties).numPartitions());
        assertEquals(KafkaTopics.ADMIN_EVENTS, config.adminEventTopic(properties).name());
    }

    private OrderEntity order() {
        OrderEntity order = new OrderEntity();
        order.setId(UUID.randomUUID());
        order.setRequesterId("11111111-1111-1111-1111-111111111111");
        order.setAmount(8);
        order.setItemDescription("Print notes");
        return order;
    }
}
