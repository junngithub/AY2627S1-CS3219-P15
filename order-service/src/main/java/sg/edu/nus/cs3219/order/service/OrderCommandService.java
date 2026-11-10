/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service application services under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.client.AdminClient;
import sg.edu.nus.cs3219.order.client.CreditClient;
import sg.edu.nus.cs3219.order.client.Place;
import sg.edu.nus.cs3219.order.client.RatingClient;
import sg.edu.nus.cs3219.order.client.SupplierClient;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.client.UserClient;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderAction;
import sg.edu.nus.cs3219.order.domain.OrderStateMachine;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.domain.PreparedDropoff;
import sg.edu.nus.cs3219.order.domain.ResolvedDropoff;
import sg.edu.nus.cs3219.order.messaging.KafkaTopics;
import sg.edu.nus.cs3219.order.messaging.OrderMessageFactory;
import sg.edu.nus.cs3219.order.messaging.OutboxWriter;
import sg.edu.nus.cs3219.order.persistence.AlertEntity;
import sg.edu.nus.cs3219.order.persistence.AlertRepository;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;
import sg.edu.nus.cs3219.order.persistence.OrderLogWriter;
import sg.edu.nus.cs3219.order.persistence.OrderRepository;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventEntity;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventRepository;
import sg.edu.nus.cs3219.order.photo.PhotoStore;
import sg.edu.nus.cs3219.order.rest.ApiException;
import sg.edu.nus.cs3219.order.rest.CreateOrderRequest;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class OrderCommandService {

    private static final String ORDER_NOT_FOUND = "Order not found";
    private static final String ROLE_COURIER = "COURIER";
    private static final String ROLE_REQUESTER = "REQUESTER";
    private static final String REASON_CASE_RESOLVED = "CASE_RESOLVED";

    private record StatusExtras(boolean notifyRequester, String faultParty) {
        static StatusExtras notifyOnly(boolean notifyRequester) {
            return new StatusExtras(notifyRequester, null);
        }

        static StatusExtras withFault(String faultParty) {
            return new StatusExtras(true, faultParty);
        }
    }

    private final OrderRepository orders;
    private final AlertRepository alerts;
    private final ProcessedEventRepository processedEvents;
    private final CreditClient credits;
    private final SupplierClient suppliers;
    private final UserClient users;
    private final RatingClient ratings;
    private final AdminClient admins;
    private final DeliveryPointService deliveryPoints;
    private final OrderMessageFactory messages;
    private final OutboxWriter outbox;
    private final OrderLogWriter orderLog;
    private final PhotoStore photos;
    private final OrderProperties properties;
    private final Clock clock;

    public OrderCommandService(
            OrderRepository orders,
            AlertRepository alerts,
            ProcessedEventRepository processedEvents,
            CreditClient credits,
            SupplierClient suppliers,
            UserClient users,
            RatingClient ratings,
            AdminClient admins,
            DeliveryPointService deliveryPoints,
            OrderMessageFactory messages,
            OutboxWriter outbox,
            OrderLogWriter orderLog,
            PhotoStore photos,
            OrderProperties properties,
            Clock clock
    ) {
        this.orders = orders;
        this.alerts = alerts;
        this.processedEvents = processedEvents;
        this.credits = credits;
        this.suppliers = suppliers;
        this.users = users;
        this.ratings = ratings;
        this.admins = admins;
        this.deliveryPoints = deliveryPoints;
        this.messages = messages;
        this.outbox = outbox;
        this.orderLog = orderLog;
        this.photos = photos;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional
    public OrderEntity create(UserAccount requester, CreateOrderRequest request) {
        Instant now = clock.instant();
        if (!request.expiryTime().isAfter(now)) {
            throw ApiException.badRequest("Acceptance expiry must be after the current time");
        }
        if (!request.deliveryTime().isAfter(now) || !request.deliveryTime().isAfter(request.expiryTime())) {
            throw ApiException.badRequest("Delivery deadline must be after the current time and after acceptance expiry");
        }
        String requesterTelegram = users.telegramHandle(requester.userId());
        Place pickup = suppliers.requirePlace(request.fromLocation(), requester);
        PreparedDropoff preparedDropoff = deliveryPoints.prepareForCreate(requester, request);
        Double requesterRating = ratings.ratingFor(requester.userId(), requester);

        UUID id = UUID.randomUUID();
        credits.reserve(id, requester.userId(), request.credits(), requester);
        try {
            ResolvedDropoff dropoff = deliveryPoints.persistPrepared(preparedDropoff);
            OrderEntity order = new OrderEntity();
            order.setId(id);
            order.setRequesterId(requester.userId());
            order.setRequesterTelegramHandle(requesterTelegram);
            order.setRequesterRating(requesterRating);
            order.setItemDescription(request.itemDescription().trim());
            order.setAmount(request.credits());
            order.setStatus(OrderStatus.CREATED);
            order.setRequestTime(now);
            order.setAcceptanceExpiry(request.expiryTime());
            order.setDeliveryDeadline(request.deliveryTime());
            order.setPickupLocationId(pickup.id());
            order.setPickupName(pickup.name());
            order.setPickupLat(pickup.latitude());
            order.setPickupLng(pickup.longitude());
            order.setDropoffLocationId(Long.toString(dropoff.id()));
            order.setDropoffName(dropoff.name());
            order.setDropoffBuilding(dropoff.building());
            order.setDropoffDescription(dropoff.description());
            order.setDropoffLat(dropoff.latitude());
            order.setDropoffLng(dropoff.longitude());
            order.setCreatedAt(now);
            order.setUpdatedAt(now);
            orders.save(order);
            deliveryPoints.recordSuccessfulUse(requester.userId(), dropoff.id());
            publishStatus(order, null, OrderStatus.CREATED, true, now, OrderAction.CREATED, requester.userId());
            return order;
        } catch (RuntimeException exception) {
            try {
                credits.returnReserved(id, requester);
            } catch (RuntimeException compensate) {
                exception.addSuppressed(compensate);
            }
            throw exception;
        }
    }

    @Transactional
    public OrderEntity accept(UserAccount courier, UUID orderId) {
        orders.findById(orderId).ifPresent(existing -> {
            if (existing.getRequesterId().equalsIgnoreCase(courier.userId())) {
                throw ApiException.conflict("You cannot accept your own order");
            }
        });
        Double courierRating = ratings.ratingFor(courier.userId(), courier);
        String courierTelegram = users.telegramHandle(courier.userId());
        Instant now = clock.instant();
        Instant collectionDeadline = now.plus(properties.getDeadlines().getCollectionWindow());
        int updated = orders.acceptIfOpen(
                orderId,
                courier.userId(),
                courierTelegram,
                courierRating,
                collectionDeadline,
                now
        );
        if (updated == 0) {
            OrderEntity existing = orders.findById(orderId).orElseThrow(() -> ApiException.notFound(ORDER_NOT_FOUND));
            if (existing.getRequesterId().equalsIgnoreCase(courier.userId())) {
                throw ApiException.conflict("You cannot accept your own order");
            }
            throw ApiException.conflict("This task was already claimed");
        }
        OrderEntity order = require(orderId);
        publishStatus(order, OrderStatus.CREATED, OrderStatus.ACCEPTED, true, now, OrderAction.ACCEPTED, courier.userId());
        return order;
    }

    @Transactional
    public OrderEntity cancel(UserAccount actor, UUID orderId) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        if (order.getRequesterId().equalsIgnoreCase(actor.userId()) && order.getStatus() == OrderStatus.CREATED) {
            credits.returnReserved(orderId, actor);
            transition(order, OrderStatus.CANCELLED, true, now, OrderAction.CANCELLED, actor.userId());
            return order;
        }
        if (order.getStatus() == OrderStatus.ACCEPTED && actor.userId().equalsIgnoreCase(order.getCourierId())) {
            OrderStateMachine.requireBefore(order.getCollectionDeadline(), now, "The 5 minute collection window has closed");
            clearCourier(order);
            transition(order, OrderStatus.CREATED, true, now, OrderAction.RELEASED, actor.userId());
            return order;
        }
        throw ApiException.conflict("This order cannot be cancelled");
    }

    @Transactional
    public OrderEntity collect(UserAccount courier, UUID orderId, MultipartFile photo) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireAccepted(order.snapshot());
        OrderStateMachine.requireCourier(order.snapshot(), courier.userId());
        OrderStateMachine.requireBefore(order.getCollectionDeadline(), now, "The 5 minute collection window has closed");
        order.setCollectionPhotoRef(photos.store(orderId, "collection", photo));
        order.setAcknowledgementDeadline(order.getDeliveryDeadline().plus(properties.getDeadlines().getAcknowledgementWindow()));
        transition(order, OrderStatus.COLLECTED, true, now, OrderAction.COLLECTED, courier.userId());
        return order;
    }

    @Transactional
    public OrderEntity deliver(UserAccount courier, UUID orderId, MultipartFile photo) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireCollected(order.snapshot());
        OrderStateMachine.requireCourier(order.snapshot(), courier.userId());
        OrderStateMachine.requireBefore(order.getDeliveryDeadline(), now, "The delivery deadline has passed");
        order.setDeliveryPhotoRef(photos.store(orderId, "delivery", photo));
        transition(order, OrderStatus.DELIVERED, true, now, OrderAction.DELIVERED, courier.userId());
        outbox.append(
                order.getId(),
                KafkaTopics.RATING,
                messages.ratingPermission(order, courier.userId(), ROLE_COURIER, order.getRequesterId(), ROLE_REQUESTER, now),
                now
        );
        return order;
    }

    @Transactional
    public OrderEntity acknowledge(UserAccount requester, UUID orderId) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireRequester(order.snapshot(), requester.userId());
        OrderStateMachine.requireCanAcknowledge(order.snapshot(), now);
        order.setSettledAt(now);
        transition(order, OrderStatus.ACKNOWLEDGED, true, now, OrderAction.ACKNOWLEDGED, requester.userId());
        releaseAndAllowRequesterRating(order, "ACKNOWLEDGED", now);
        return order;
    }

    @Transactional
    public OrderEntity escalate(UserAccount requester, UUID orderId, String disputeText, MultipartFile photo) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireRequester(order.snapshot(), requester.userId());
        OrderStateMachine.requireCanEscalate(order.snapshot(), now);
        String comment = requireComment(disputeText);
        if (photo != null && !photo.isEmpty()) {
            order.setDisputePhotoRef(photos.store(orderId, "dispute", photo));
        }
        admins.openConflict(order.getId(), requester.userId(), comment, evidence(order));
        order.setDisputeText(comment);
        transition(order, OrderStatus.ESCALATED, true, now, OrderAction.ESCALATED, requester.userId());
        return order;
    }

    @Transactional
    public void revertCollectionWindow(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.collectionWindowExpired(order.snapshot(), now)) {
            return;
        }
        clearCourier(order);
        transition(order, OrderStatus.CREATED, true, now, OrderAction.COLLECTION_WINDOW_EXPIRED, null);
    }

    @Transactional
    public void expire(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.acceptanceExpired(order.snapshot(), now)) {
            return;
        }
        transition(order, OrderStatus.EXPIRED, true, now, OrderAction.ACCEPTANCE_EXPIRED, null);
        outbox.append(order.getId(), KafkaTopics.CREDIT, messages.creditReturn(order, now), now);
    }

    @Transactional
    public void escalateMissedDelivery(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.deliveryMissed(order.snapshot(), now)) {
            return;
        }
        admins.openConflict(order.getId(), order.getRequesterId(), "Delivery deadline missed", evidence(order));
        transition(order, OrderStatus.ESCALATED, true, now, OrderAction.DELIVERY_DEADLINE_MISSED, null);
    }

    @Transactional
    public void unacknowledge(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.acknowledgementExpired(order.snapshot(), now)) {
            return;
        }
        order.setSettledAt(now);
        transition(order, OrderStatus.UNACKNOWLEDGED, true, now, OrderAction.ACKNOWLEDGEMENT_WINDOW_EXPIRED, null);
        releaseAndAllowRequesterRating(order, "UNACKNOWLEDGED", now);
    }

    @Transactional
    public void completeSettled(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        Instant settledBefore = now.minus(properties.getDeadlines().getCompletionWindow());
        if (!OrderStateMachine.readyToComplete(order.snapshot(), settledBefore)) {
            return;
        }
        deletePhotos(order);
        transition(order, OrderStatus.COMPLETED, false, now, OrderAction.COMPLETION_WINDOW_ELAPSED, null);
    }

    @Transactional
    public void applyAdminEvent(String eventId, String eventType, UUID orderId, String caseId, String faultParty) {
        if (eventId == null || eventType == null || orderId == null || caseId == null || caseId.isBlank()) {
            return;
        }
        if (processedEvents.existsById(eventId)) {
            return;
        }

        OrderEntity order = orders.lockById(orderId).orElse(null);
        boolean resolving = "admin.case.resolved".equals(eventType)
                && order != null
                && OrderStateMachine.canResolve(order.snapshot());
        if (resolving && !knownFaultParty(faultParty)) {
            // Do not mark processed: Admin must republish a valid verdict; retrying a poison
            // COMPLETED-without-settlement would stick the reservation.
            throw new IllegalStateException("admin.case.resolved requires faultParty requester|courier|no-fault");
        }

        ProcessedEventEntity processed = new ProcessedEventEntity();
        processed.setEventId(eventId);
        processed.setProcessedAt(clock.instant());
        processedEvents.save(processed);
        if (order == null) {
            return;
        }
        Instant now = clock.instant();
        order.setCaseId(caseId);
        if ("admin.review.started".equals(eventType) && OrderStateMachine.canReview(order.snapshot())) {
            transition(order, OrderStatus.UNDER_REVIEW, true, now, OrderAction.REVIEW_STARTED, null);
            return;
        }
        if (resolving) {
            deletePhotos(order);
            order.setSettledAt(now);
            order.setFaultParty(faultParty);
            transition(order, OrderStatus.COMPLETED, now, OrderAction.CASE_RESOLVED, null, StatusExtras.withFault(faultParty));
            settleResolvedCase(order, faultParty, now);
        }
    }

    private static boolean knownFaultParty(String faultParty) {
        return "courier".equals(faultParty) || "requester".equals(faultParty) || "no-fault".equals(faultParty);
    }

    private static List<String> evidence(OrderEntity order) {
        List<String> refs = new ArrayList<>();
        addEvidence(refs, order.getCollectionPhotoRef());
        addEvidence(refs, order.getDeliveryPhotoRef());
        addEvidence(refs, order.getDisputePhotoRef());
        return refs;
    }

    private static void addEvidence(List<String> refs, String ref) {
        if (ref != null && !ref.isBlank()) {
            refs.add(ref);
        }
    }

    private void settleResolvedCase(OrderEntity order, String faultParty, Instant now) {
        // no-fault = inconclusive / neither party clearly wrong → treat like a completed
        // delivery: pay the courier (same release path as acknowledge).
        if ("courier".equals(faultParty)) {
            outbox.append(order.getId(), KafkaTopics.CREDIT, messages.creditReturn(order, REASON_CASE_RESOLVED, now), now);
            allowRequesterRatesCourier(order, now);
            return;
        }
        if (order.getCourierId() == null) {
            outbox.append(order.getId(), KafkaTopics.CREDIT, messages.creditReturn(order, REASON_CASE_RESOLVED, now), now);
            return;
        }
        releaseAndAllowRequesterRating(order, REASON_CASE_RESOLVED, now);
        allowCourierRatesRequester(order, now);
    }

    private void releaseAndAllowRequesterRating(OrderEntity order, String reason, Instant now) {
        outbox.append(order.getId(), KafkaTopics.CREDIT, messages.creditRelease(order, reason, now), now);
        allowRequesterRatesCourier(order, now);
    }

    private void allowRequesterRatesCourier(OrderEntity order, Instant now) {
        if (order.getCourierId() == null) {
            return;
        }
        outbox.append(
                order.getId(),
                KafkaTopics.RATING,
                messages.ratingPermission(order, order.getRequesterId(), ROLE_REQUESTER, order.getCourierId(), ROLE_COURIER, now),
                now
        );
    }

    private void allowCourierRatesRequester(OrderEntity order, Instant now) {
        if (order.getCourierId() == null) {
            return;
        }
        outbox.append(
                order.getId(),
                KafkaTopics.RATING,
                messages.ratingPermission(order, order.getCourierId(), ROLE_COURIER, order.getRequesterId(), ROLE_REQUESTER, now),
                now
        );
    }

    private void transition(
            OrderEntity order,
            OrderStatus to,
            boolean notifyRequester,
            Instant now,
            OrderAction action,
            String actorId
    ) {
        transition(order, to, now, action, actorId, StatusExtras.notifyOnly(notifyRequester));
    }

    private void transition(
            OrderEntity order,
            OrderStatus to,
            Instant now,
            OrderAction action,
            String actorId,
            StatusExtras extras
    ) {
        OrderStatus from = order.getStatus();
        order.setStatus(to);
        order.setUpdatedAt(now);
        publishStatus(order, from, to, now, action, actorId, extras);
    }

    private void publishStatus(
            OrderEntity order,
            OrderStatus from,
            OrderStatus to,
            boolean notifyRequester,
            Instant now,
            OrderAction action,
            String actorId
    ) {
        publishStatus(order, from, to, now, action, actorId, StatusExtras.notifyOnly(notifyRequester));
    }

    private void publishStatus(
            OrderEntity order,
            OrderStatus from,
            OrderStatus to,
            Instant now,
            OrderAction action,
            String actorId,
            StatusExtras extras
    ) {
        orderLog.append(order.getId(), action, from, to, actorId, now);
        boolean notifyCourier = notifyCourier(order, to, extras);
        AlertEntity alert = new AlertEntity();
        alert.setId(UUID.randomUUID());
        alert.setOrderId(order.getId());
        alert.setRequesterId(order.getRequesterId());
        alert.setCourierId(order.getCourierId());
        alert.setFromStatus(from == null ? null : from.name());
        alert.setToStatus(to.name());
        alert.setNotifyRequester(extras.notifyRequester());
        alert.setNotifyCourier(notifyCourier);
        alert.setCreatedAt(now);
        alerts.save(alert);
        outbox.append(
                order.getId(),
                KafkaTopics.ORDER_STATUS,
                messages.statusChanged(
                        order, from, to, extras.notifyRequester(), notifyCourier, extras.faultParty(), now),
                now
        );
    }

    /** Dispute lifecycle: Escalated → Under review → case-resolved Completed. */
    private static boolean notifyCourier(OrderEntity order, OrderStatus to, StatusExtras extras) {
        if (order.getCourierId() == null || order.getCourierId().isBlank()) {
            return false;
        }
        return to == OrderStatus.ESCALATED
                || to == OrderStatus.UNDER_REVIEW
                || extras.faultParty() != null;
    }

    private static String requireComment(String disputeText) {
        if (disputeText == null || disputeText.isBlank()) {
            throw ApiException.badRequest("disputeText must not be blank");
        }
        String comment = disputeText.trim();
        if (comment.length() > 2000) {
            throw ApiException.badRequest("disputeText size must be between 0 and 2000");
        }
        return comment;
    }

    private void deletePhotos(OrderEntity order) {
        photos.delete(order.getCollectionPhotoRef());
        photos.delete(order.getDeliveryPhotoRef());
        photos.delete(order.getDisputePhotoRef());
        order.setCollectionPhotoRef(null);
        order.setDeliveryPhotoRef(null);
        order.setDisputePhotoRef(null);
    }

    private void clearCourier(OrderEntity order) {
        order.setCourierId(null);
        order.setCourierTelegramHandle(null);
        order.setCourierRating(null);
        order.setCollectionDeadline(null);
    }

    private OrderEntity lock(UUID orderId) {
        return orders.lockById(orderId).orElseThrow(() -> ApiException.notFound(ORDER_NOT_FOUND));
    }

    private OrderEntity require(UUID orderId) {
        return orders.findById(orderId).orElseThrow(() -> ApiException.notFound(ORDER_NOT_FOUND));
    }
}
