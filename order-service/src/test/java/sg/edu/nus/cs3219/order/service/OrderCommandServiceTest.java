package sg.edu.nus.cs3219.order.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.client.AdminClient;
import sg.edu.nus.cs3219.order.client.CreditClient;
import sg.edu.nus.cs3219.order.client.Place;
import sg.edu.nus.cs3219.order.client.RatingClient;
import sg.edu.nus.cs3219.order.client.SupplierClient;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.client.UserClient;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.messaging.KafkaTopics;
import sg.edu.nus.cs3219.order.messaging.OrderMessageFactory;
import sg.edu.nus.cs3219.order.messaging.OutboxWriter;
import sg.edu.nus.cs3219.order.persistence.AlertEntity;
import sg.edu.nus.cs3219.order.persistence.AlertRepository;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;
import sg.edu.nus.cs3219.order.persistence.OrderRepository;
import sg.edu.nus.cs3219.order.persistence.OutboxEntity;
import sg.edu.nus.cs3219.order.persistence.OutboxRepository;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventEntity;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventRepository;
import sg.edu.nus.cs3219.order.photo.PhotoStore;
import sg.edu.nus.cs3219.order.rest.ApiException;
import sg.edu.nus.cs3219.order.rest.CreateOrderRequest;
import sg.edu.nus.cs3219.order.rest.OrderResponse;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OrderCommandServiceTest {

    private final Instant now = Instant.parse("2026-10-02T04:00:00Z");
    private final UUID id = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    @Mock private OrderRepository orders;
    @Mock private AlertRepository alerts;
    @Mock private ProcessedEventRepository processedEvents;
    @Mock private UserClient users;
    @Mock private CreditClient credits;
    @Mock private SupplierClient suppliers;
    @Mock private RatingClient ratings;
    @Mock private AdminClient admins;
    @Mock private OutboxRepository outboxRepository;
    @Mock private PhotoStore photos;

    private OrderCommandService service;

    @BeforeEach
    void setUp() {
        service = new OrderCommandService(
                orders,
                alerts,
                processedEvents,
                users,
                credits,
                suppliers,
                ratings,
                admins,
                new OrderMessageFactory(new ObjectMapper()),
                new OutboxWriter(outboxRepository),
                photos,
                new OrderProperties(),
                Clock.fixed(now, ZoneOffset.UTC)
        );
    }

    @Test
    void createReservesCreditsAndStoresTheOrder() {
        when(users.authenticate("Bearer stub:requester@u.nus.edu"))
                .thenReturn(new UserAccount("requester@u.nus.edu", "requester@u.nus.edu", "requester"));
        when(suppliers.requirePlace(eq("nus-coop"), any())).thenReturn(new Place("nus-coop", "NUS Co-op", 1.29, 103.77));
        when(suppliers.requirePlace(eq("cool-spot"), any())).thenReturn(new Place("cool-spot", "Cool Spot", 1.30, 103.78));
        when(ratings.ratingFor(eq("requester@u.nus.edu"), any())).thenReturn(4.5);
        when(orders.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        OrderEntity created = service.create("Bearer stub:requester@u.nus.edu", new CreateOrderRequest(
                "  Print notes  ",
                8,
                now.plusSeconds(3600),
                now.plusSeconds(7200),
                "nus-coop",
                "cool-spot"
        ));

        assertEquals(OrderStatus.CREATED, created.getStatus());
        assertEquals("Print notes", created.getItemDescription());
        assertEquals("requester", created.getRequesterTelegramHandle());
        assertEquals(4.5, created.getRequesterRating());
        assertEquals(now, created.getRequestTime());
        OrderResponse response = OrderResponse.from(created);
        assertEquals("NUS Co-op", response.pickupName());
        assertEquals("Cool Spot", response.dropoffName());
        verify(credits).reserve(created.getId(), "requester@u.nus.edu", 8, "Bearer stub:requester@u.nus.edu");
        verify(alerts).save(any(AlertEntity.class));
        verify(outboxRepository).save(any(OutboxEntity.class));
    }

    @Test
    void createRejectsDeadlinesThatAreNotInTheFuture() {
        assertThrows(ApiException.class, () -> service.create("auth", request(now.minusSeconds(1), now.plusSeconds(10))));
        assertThrows(ApiException.class, () -> service.create("auth", request(now.plusSeconds(10), now.plusSeconds(10))));
        verify(credits, never()).reserve(any(), any(), anyInt(), any());
    }

    @Test
    void createReturnsCreditsWhenSavingFails() {
        when(users.authenticate(any())).thenReturn(new UserAccount("requester@u.nus.edu", "requester@u.nus.edu", "requester"));
        when(suppliers.requirePlace(any(), any())).thenReturn(new Place("nus-coop", "NUS Co-op", 1.0, 103.0));
        when(ratings.ratingFor(any(), any())).thenReturn(5.0);
        when(orders.save(any())).thenThrow(new IllegalStateException("db down"));

        assertThrows(IllegalStateException.class, () -> service.create("auth", request(now.plusSeconds(60), now.plusSeconds(120))));
        verify(credits).returnReserved(any(), any());
    }

    @Test
    void createKeepsTheOriginalFailureWhenCompensationAlsoFails() {
        when(users.authenticate(any())).thenReturn(new UserAccount("requester@u.nus.edu", "requester@u.nus.edu", "requester"));
        when(suppliers.requirePlace(any(), any())).thenReturn(new Place("nus-coop", "NUS Co-op", 1.0, 103.0));
        when(ratings.ratingFor(any(), any())).thenReturn(5.0);
        when(orders.save(any())).thenThrow(new IllegalStateException("db down"));
        org.mockito.Mockito.doThrow(new IllegalStateException("credit down")).when(credits).returnReserved(any(), any());

        IllegalStateException failure = assertThrows(IllegalStateException.class,
                () -> service.create("auth", request(now.plusSeconds(60), now.plusSeconds(120))));
        assertEquals(1, failure.getSuppressed().length);
    }

    @Test
    void acceptClaimsAnOpenOrder() {
        when(users.authenticate(any())).thenReturn(new UserAccount("courier@u.nus.edu", "courier@u.nus.edu", "courier"));
        when(ratings.ratingFor(eq("courier@u.nus.edu"), any())).thenReturn(4.0);
        when(orders.acceptIfOpen(eq(id), eq(OrderStatus.CREATED), eq(OrderStatus.ACCEPTED), eq("courier@u.nus.edu"), eq("courier"), eq(4.0), any(), eq(now)))
                .thenReturn(1);
        OrderEntity order = openOrder();
        order.setStatus(OrderStatus.ACCEPTED);
        order.setCourierEmail("courier@u.nus.edu");
        order.setCourierRating(4.0);
        when(orders.findById(id)).thenReturn(Optional.of(order));

        OrderEntity accepted = service.accept("auth", id);

        assertEquals(OrderStatus.ACCEPTED, accepted.getStatus());
        assertEquals(4.0, accepted.getCourierRating());
    }

    @Test
    void acceptReportsAMissingOrderAndAClaimedOrder() {
        when(users.authenticate(any())).thenReturn(new UserAccount("courier@u.nus.edu", "courier@u.nus.edu", "courier"));
        when(ratings.ratingFor(any(), any())).thenReturn(5.0);
        when(orders.acceptIfOpen(any(), any(), any(), any(), any(), anyDouble(), any(), any())).thenReturn(0);
        when(orders.existsById(id)).thenReturn(false);
        assertThrows(ApiException.class, () -> service.accept("auth", id));

        when(orders.existsById(id)).thenReturn(true);
        assertThrows(ApiException.class, () -> service.accept("auth", id));
    }

    @Test
    void acceptFailsWhenTheRowDisappearsAfterTheClaim() {
        when(users.authenticate(any())).thenReturn(new UserAccount("courier@u.nus.edu", "courier@u.nus.edu", "courier"));
        when(ratings.ratingFor(any(), any())).thenReturn(5.0);
        when(orders.acceptIfOpen(any(), any(), any(), any(), any(), anyDouble(), any(), any())).thenReturn(1);
        when(orders.findById(id)).thenReturn(Optional.empty());
        assertThrows(ApiException.class, () -> service.accept("auth", id));
    }

    @Test
    void requesterCancelsAnOpenOrderAndCourierReturnsAnAcceptedOne() {
        when(users.authenticate("requester")).thenReturn(new UserAccount("requester@u.nus.edu", "requester@u.nus.edu", "requester"));
        OrderEntity open = openOrder();
        when(orders.lockById(id)).thenReturn(Optional.of(open));
        assertEquals(OrderStatus.CANCELLED, service.cancel("requester", id).getStatus());
        verify(credits).returnReserved(id, "requester");

        when(users.authenticate("courier")).thenReturn(new UserAccount("courier@u.nus.edu", "courier@u.nus.edu", "courier"));
        OrderEntity accepted = openOrder();
        accepted.setStatus(OrderStatus.ACCEPTED);
        accepted.setCourierEmail("courier@u.nus.edu");
        accepted.setCourierRating(5.0);
        accepted.setCollectionDeadline(now.plusSeconds(60));
        when(orders.lockById(id)).thenReturn(Optional.of(accepted));
        OrderEntity returned = service.cancel("courier", id);
        assertEquals(OrderStatus.CREATED, returned.getStatus());
        assertNull(returned.getCourierEmail());
        assertNull(returned.getCourierRating());
        assertNull(returned.getCollectionDeadline());
    }

    @Test
    void cancelRejectsTheWrongActorAClosedWindowAndAMissingOrder() {
        when(users.authenticate(any())).thenReturn(new UserAccount("other@u.nus.edu", "other@u.nus.edu", "other"));
        when(orders.lockById(id)).thenReturn(Optional.of(openOrder()));
        assertThrows(ApiException.class, () -> service.cancel("auth", id));

        OrderEntity late = openOrder();
        late.setStatus(OrderStatus.ACCEPTED);
        late.setCourierEmail("other@u.nus.edu");
        late.setCollectionDeadline(now.minusSeconds(1));
        when(orders.lockById(id)).thenReturn(Optional.of(late));
        assertThrows(ApiException.class, () -> service.cancel("auth", id));

        when(orders.lockById(id)).thenReturn(Optional.empty());
        assertThrows(ApiException.class, () -> service.cancel("auth", id));
    }

    @Test
    void collectAndDeliverStorePhotosForTheAssignedCourier() {
        when(users.authenticate(any())).thenReturn(new UserAccount("courier@u.nus.edu", "courier@u.nus.edu", "courier"));
        OrderEntity accepted = openOrder();
        accepted.setStatus(OrderStatus.ACCEPTED);
        accepted.setCourierEmail("courier@u.nus.edu");
        accepted.setCollectionDeadline(now.plusSeconds(30));
        when(orders.lockById(id)).thenReturn(Optional.of(accepted));
        when(photos.store(id, "collection", null)).thenReturn(id + "/collection.png");

        OrderEntity collected = service.collect("auth", id, null);
        assertEquals(OrderStatus.COLLECTED, collected.getStatus());
        assertEquals(id + "/collection.png", collected.getCollectionPhotoRef());
        assertEquals(accepted.getDeliveryDeadline().plusSeconds(86_400), collected.getAcknowledgementDeadline());

        when(photos.store(id, "delivery", null)).thenReturn(id + "/delivery.png");
        OrderEntity delivered = service.deliver("auth", id, null);
        assertEquals(OrderStatus.DELIVERED, delivered.getStatus());
        assertEquals(id + "/delivery.png", delivered.getDeliveryPhotoRef());
        verify(outboxRepository, org.mockito.Mockito.atLeastOnce()).save(any(OutboxEntity.class));
    }

    @Test
    void collectRejectsTheWrongCourier() {
        when(users.authenticate(any())).thenReturn(new UserAccount("other@u.nus.edu", "other@u.nus.edu", "other"));
        OrderEntity accepted = openOrder();
        accepted.setStatus(OrderStatus.ACCEPTED);
        accepted.setCourierEmail("courier@u.nus.edu");
        accepted.setCollectionDeadline(now.plusSeconds(30));
        when(orders.lockById(id)).thenReturn(Optional.of(accepted));
        assertThrows(ApiException.class, () -> service.collect("auth", id, org.mockito.Mockito.mock(MultipartFile.class)));
    }

    @Test
    void requesterAcknowledgesAndEscalates() {
        when(users.authenticate(any())).thenReturn(new UserAccount("requester@u.nus.edu", "requester@u.nus.edu", "requester"));
        OrderEntity collected = openOrder();
        collected.setStatus(OrderStatus.COLLECTED);
        collected.setCourierEmail("courier@u.nus.edu");
        collected.setAcknowledgementDeadline(now.plusSeconds(60));
        when(orders.lockById(id)).thenReturn(Optional.of(collected));

        OrderEntity acknowledged = service.acknowledge("auth", id);
        assertEquals(OrderStatus.ACKNOWLEDGED, acknowledged.getStatus());
        assertEquals(now, acknowledged.getSettledAt());

        OrderEntity delivered = openOrder();
        delivered.setStatus(OrderStatus.DELIVERED);
        delivered.setCourierEmail("courier@u.nus.edu");
        delivered.setAcknowledgementDeadline(now.plusSeconds(60));
        when(orders.lockById(id)).thenReturn(Optional.of(delivered));
        OrderEntity withoutPhoto = service.escalate("auth", id, "  wrong item  ", new MockMultipartFile("photo", new byte[0]));
        assertEquals(OrderStatus.ESCALATED, withoutPhoto.getStatus());
        assertEquals("wrong item", withoutPhoto.getDisputeText());
        assertNull(withoutPhoto.getDisputePhotoRef());

        OrderEntity pictured = openOrder();
        pictured.setStatus(OrderStatus.DELIVERED);
        pictured.setCourierEmail("courier@u.nus.edu");
        pictured.setAcknowledgementDeadline(now.plusSeconds(60));
        when(orders.lockById(id)).thenReturn(Optional.of(pictured));
        MultipartFile photo = new MockMultipartFile("photo", "a.png", "image/png", new byte[]{1});
        when(photos.store(id, "dispute", photo)).thenReturn(id + "/dispute.png");
        OrderEntity escalated = service.escalate("auth", id, "wrong item", photo);
        assertEquals(id + "/dispute.png", escalated.getDisputePhotoRef());
        verify(admins).escalate(org.mockito.ArgumentMatchers.argThat(context ->
                context.orderId().equals(id)
                        && "wrong item".equals(context.comment())
                        && "DELIVERED".equals(context.status())
                        && "courier@u.nus.edu".equals(context.courierEmail())
                        && (id + "/dispute.png").equals(context.disputePhotoRef())), eq("auth"));
    }

    @Test
    void acknowledgeAndEscalateRejectTheWrongPerson() {
        when(users.authenticate(any())).thenReturn(new UserAccount("courier@u.nus.edu", "courier@u.nus.edu", "courier"));
        OrderEntity delivered = openOrder();
        delivered.setStatus(OrderStatus.DELIVERED);
        delivered.setAcknowledgementDeadline(now.plusSeconds(60));
        when(orders.lockById(id)).thenReturn(Optional.of(delivered));
        assertThrows(ApiException.class, () -> service.acknowledge("auth", id));
        assertThrows(ApiException.class, () -> service.escalate("auth", id, "dispute", null));
    }

    @Test
    void deadlineSweepChangesOnlyTheOrdersThatQualify() {
        OrderEntity accepted = openOrder();
        accepted.setStatus(OrderStatus.ACCEPTED);
        accepted.setCourierEmail("courier@u.nus.edu");
        accepted.setCollectionDeadline(now.minusSeconds(1));
        when(orders.lockById(id)).thenReturn(Optional.of(accepted));
        service.revertCollectionWindow(id, now);
        assertEquals(OrderStatus.CREATED, accepted.getStatus());

        OrderEntity stillOpen = openOrder();
        when(orders.lockById(id)).thenReturn(Optional.of(stillOpen));
        service.revertCollectionWindow(id, now);
        assertEquals(OrderStatus.CREATED, stillOpen.getStatus());

        OrderEntity expiring = openOrder();
        expiring.setAcceptanceExpiry(now.minusSeconds(1));
        when(orders.lockById(id)).thenReturn(Optional.of(expiring));
        service.expire(id, now);
        assertEquals(OrderStatus.EXPIRED, expiring.getStatus());

        OrderEntity fresh = openOrder();
        when(orders.lockById(id)).thenReturn(Optional.of(fresh));
        service.expire(id, now);
        assertEquals(OrderStatus.CREATED, fresh.getStatus());

        OrderEntity missed = openOrder();
        missed.setStatus(OrderStatus.COLLECTED);
        missed.setCourierEmail("courier@u.nus.edu");
        missed.setDeliveryDeadline(now.minusSeconds(1));
        missed.setCollectionPhotoRef(id + "/collection.png");
        missed.setDeliveryPhotoRef(id + "/delivery.png");
        when(orders.lockById(id)).thenReturn(Optional.of(missed));
        service.escalateMissedDelivery(id, now);
        assertEquals(OrderStatus.ESCALATED, missed.getStatus());

        OrderEntity onTime = openOrder();
        onTime.setStatus(OrderStatus.COLLECTED);
        when(orders.lockById(id)).thenReturn(Optional.of(onTime));
        service.escalateMissedDelivery(id, now);
        assertEquals(OrderStatus.COLLECTED, onTime.getStatus());

        OrderEntity quiet = openOrder();
        quiet.setStatus(OrderStatus.COLLECTED);
        quiet.setDeliveryDeadline(now.minusSeconds(1));
        when(orders.lockById(id)).thenReturn(Optional.of(quiet));
        service.unacknowledge(id, now);
        assertEquals(OrderStatus.COLLECTED, quiet.getStatus());

        OrderEntity waiting = openOrder();
        waiting.setStatus(OrderStatus.DELIVERED);
        waiting.setAcknowledgementDeadline(now.plusSeconds(60));
        when(orders.lockById(id)).thenReturn(Optional.of(waiting));
        service.unacknowledge(id, now);
        assertEquals(OrderStatus.DELIVERED, waiting.getStatus());

        OrderEntity forgotten = openOrder();
        forgotten.setStatus(OrderStatus.DELIVERED);
        forgotten.setCourierEmail("courier@u.nus.edu");
        forgotten.setAcknowledgementDeadline(now.minusSeconds(1));
        when(orders.lockById(id)).thenReturn(Optional.of(forgotten));
        service.unacknowledge(id, now);
        assertEquals(OrderStatus.UNACKNOWLEDGED, forgotten.getStatus());

        OrderEntity done = openOrder();
        done.setStatus(OrderStatus.ACKNOWLEDGED);
        done.setSettledAt(now.minusSeconds(8 * 86_400));
        done.setCollectionPhotoRef("a");
        done.setDeliveryPhotoRef("b");
        done.setDisputePhotoRef("c");
        when(orders.lockById(id)).thenReturn(Optional.of(done));
        service.completeSettled(id, now);
        assertEquals(OrderStatus.COMPLETED, done.getStatus());
        assertNull(done.getCollectionPhotoRef());
        assertNull(done.getDeliveryPhotoRef());
        assertNull(done.getDisputePhotoRef());
        verify(photos).delete("a");
        verify(photos).delete("b");
        verify(photos).delete("c");

        OrderEntity recent = openOrder();
        recent.setStatus(OrderStatus.ACKNOWLEDGED);
        recent.setSettledAt(now);
        when(orders.lockById(id)).thenReturn(Optional.of(recent));
        service.completeSettled(id, now);
        assertEquals(OrderStatus.ACKNOWLEDGED, recent.getStatus());
    }

    @Test
    void adminEventsMoveOnlyTheAllowedStatuses() {
        service.applyAdminEvent(null, "admin.review.started", id, "case-1");
        service.applyAdminEvent("event-1", "admin.review.started", id, " ");
        verify(processedEvents, never()).save(any());

        when(processedEvents.existsById("event-2")).thenReturn(true);
        service.applyAdminEvent("event-2", "admin.review.started", id, "case-1");
        verify(orders, never()).lockById(any());

        when(processedEvents.existsById("event-3")).thenReturn(false);
        when(orders.lockById(id)).thenReturn(Optional.empty());
        service.applyAdminEvent("event-3", "admin.review.started", id, "case-1");

        OrderEntity escalated = openOrder();
        escalated.setStatus(OrderStatus.ESCALATED);
        escalated.setCollectionPhotoRef("photo");
        when(processedEvents.existsById("event-4")).thenReturn(false);
        when(orders.lockById(id)).thenReturn(Optional.of(escalated));
        service.applyAdminEvent("event-4", "admin.review.started", id, "case-1");
        assertEquals(OrderStatus.UNDER_REVIEW, escalated.getStatus());
        assertEquals("case-1", escalated.getCaseId());

        OrderEntity created = openOrder();
        when(processedEvents.existsById("event-5")).thenReturn(false);
        when(orders.lockById(id)).thenReturn(Optional.of(created));
        service.applyAdminEvent("event-5", "admin.review.started", id, "case-2");
        assertEquals(OrderStatus.CREATED, created.getStatus());
        assertEquals("case-2", created.getCaseId());

        OrderEntity review = openOrder();
        review.setStatus(OrderStatus.UNDER_REVIEW);
        review.setDeliveryPhotoRef("delivery");
        when(processedEvents.existsById("event-6")).thenReturn(false);
        when(orders.lockById(id)).thenReturn(Optional.of(review));
        service.applyAdminEvent("event-6", "admin.case.resolved", id, "case-3");
        assertEquals(OrderStatus.COMPLETED, review.getStatus());
        assertNull(review.getDeliveryPhotoRef());

        ArgumentCaptor<ProcessedEventEntity> processed = ArgumentCaptor.forClass(ProcessedEventEntity.class);
        verify(processedEvents, org.mockito.Mockito.atLeastOnce()).save(processed.capture());
        assertEquals("event-6", processed.getValue().getEventId());
        assertEquals(now, processed.getValue().getProcessedAt());
    }

    private CreateOrderRequest request(Instant expiry, Instant delivery) {
        return new CreateOrderRequest("Print notes", 8, expiry, delivery, "nus-coop", "cool-spot");
    }

    private OrderEntity openOrder() {
        OrderEntity order = new OrderEntity();
        order.setId(id);
        order.setRequesterEmail("requester@u.nus.edu");
        order.setRequesterTelegramHandle("requester");
        order.setRequesterRating(5.0);
        order.setItemDescription("Print notes");
        order.setAmount(8);
        order.setStatus(OrderStatus.CREATED);
        order.setRequestTime(now);
        order.setAcceptanceExpiry(now.plusSeconds(3600));
        order.setDeliveryDeadline(now.plusSeconds(7200));
        order.setPickupLocationId("nus-coop");
        order.setPickupName("NUS Co-op");
        order.setPickupLat(1.29);
        order.setPickupLng(103.77);
        order.setDropoffLocationId("cool-spot");
        order.setDropoffName("Cool Spot");
        order.setDropoffLat(1.30);
        order.setDropoffLng(103.78);
        order.setCreatedAt(now);
        order.setUpdatedAt(now);
        return order;
    }
}
