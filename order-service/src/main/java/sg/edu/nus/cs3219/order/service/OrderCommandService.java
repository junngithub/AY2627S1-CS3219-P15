package sg.edu.nus.cs3219.order.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.client.AdminClient;
import sg.edu.nus.cs3219.order.client.CreditClient;
import sg.edu.nus.cs3219.order.client.OrderContext;
import sg.edu.nus.cs3219.order.client.Place;
import sg.edu.nus.cs3219.order.client.RatingClient;
import sg.edu.nus.cs3219.order.client.SupplierClient;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStateMachine;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.messaging.KafkaTopics;
import sg.edu.nus.cs3219.order.messaging.OrderMessageFactory;
import sg.edu.nus.cs3219.order.messaging.OutboxWriter;
import sg.edu.nus.cs3219.order.persistence.AlertEntity;
import sg.edu.nus.cs3219.order.persistence.AlertRepository;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;
import sg.edu.nus.cs3219.order.persistence.OrderRepository;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventEntity;
import sg.edu.nus.cs3219.order.persistence.ProcessedEventRepository;
import sg.edu.nus.cs3219.order.photo.PhotoStore;
import sg.edu.nus.cs3219.order.rest.ApiException;
import sg.edu.nus.cs3219.order.rest.CreateOrderRequest;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Service
public class OrderCommandService {

    private static final String ORDER_NOT_FOUND = "Order not found";

    private final OrderRepository orders;
    private final AlertRepository alerts;
    private final ProcessedEventRepository processedEvents;
    private final CreditClient credits;
    private final SupplierClient suppliers;
    private final RatingClient ratings;
    private final AdminClient admins;
    private final OrderMessageFactory messages;
    private final OutboxWriter outbox;
    private final PhotoStore photos;
    private final OrderProperties properties;
    private final Clock clock;

    public OrderCommandService(
            OrderRepository orders,
            AlertRepository alerts,
            ProcessedEventRepository processedEvents,
            CreditClient credits,
            SupplierClient suppliers,
            RatingClient ratings,
            AdminClient admins,
            OrderMessageFactory messages,
            OutboxWriter outbox,
            PhotoStore photos,
            OrderProperties properties,
            Clock clock
    ) {
        this.orders = orders;
        this.alerts = alerts;
        this.processedEvents = processedEvents;
        this.credits = credits;
        this.suppliers = suppliers;
        this.ratings = ratings;
        this.admins = admins;
        this.messages = messages;
        this.outbox = outbox;
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
        Place pickup = suppliers.requirePlace(request.fromLocation(), requester);
        Place dropoff = suppliers.requirePlace(request.toLocation(), requester);
        double requesterRating = ratings.ratingFor(requester.userId(), requester);

        UUID id = UUID.randomUUID();
        credits.reserve(id, requester.userId(), request.credits(), requester);
        try {
            OrderEntity order = new OrderEntity();
            order.setId(id);
            order.setRequesterEmail(requester.email());
            order.setRequesterTelegramHandle(requester.telegramHandle());
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
            order.setDropoffLocationId(dropoff.id());
            order.setDropoffName(dropoff.name());
            order.setDropoffLat(dropoff.latitude());
            order.setDropoffLng(dropoff.longitude());
            order.setCreatedAt(now);
            order.setUpdatedAt(now);
            orders.save(order);
            publishStatus(order, null, OrderStatus.CREATED, true, now);
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
        double courierRating = ratings.ratingFor(courier.userId(), courier);
        Instant now = clock.instant();
        Instant collectionDeadline = now.plus(properties.getDeadlines().getCollectionWindow());
        int updated = orders.acceptIfOpen(
                orderId,
                courier.email(),
                courier.telegramHandle(),
                courierRating,
                collectionDeadline,
                now
        );
        if (updated == 0) {
            if (!orders.existsById(orderId)) {
                throw ApiException.notFound(ORDER_NOT_FOUND);
            }
            throw ApiException.conflict("This task was already claimed");
        }
        OrderEntity order = require(orderId);
        publishStatus(order, OrderStatus.CREATED, OrderStatus.ACCEPTED, true, now);
        return order;
    }

    @Transactional
    public OrderEntity cancel(UserAccount actor, UUID orderId) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        if (order.getRequesterEmail().equalsIgnoreCase(actor.email()) && order.getStatus() == OrderStatus.CREATED) {
            credits.returnReserved(orderId, actor);
            transition(order, OrderStatus.CANCELLED, true, now);
            return order;
        }
        if (order.getStatus() == OrderStatus.ACCEPTED && actor.email().equalsIgnoreCase(order.getCourierEmail())) {
            OrderStateMachine.requireBefore(order.getCollectionDeadline(), now, "The 5 minute collection window has closed");
            clearCourier(order);
            transition(order, OrderStatus.CREATED, true, now);
            return order;
        }
        throw ApiException.conflict("This order cannot be cancelled");
    }

    @Transactional
    public OrderEntity collect(UserAccount courier, UUID orderId, MultipartFile photo) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireAccepted(order.snapshot());
        OrderStateMachine.requireCourier(order.snapshot(), courier.email());
        OrderStateMachine.requireBefore(order.getCollectionDeadline(), now, "The 5 minute collection window has closed");
        order.setCollectionPhotoRef(photos.store(orderId, "collection", photo));
        order.setAcknowledgementDeadline(order.getDeliveryDeadline().plus(properties.getDeadlines().getAcknowledgementWindow()));
        transition(order, OrderStatus.COLLECTED, true, now);
        return order;
    }

    @Transactional
    public OrderEntity deliver(UserAccount courier, UUID orderId, MultipartFile photo) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireCollected(order.snapshot());
        OrderStateMachine.requireCourier(order.snapshot(), courier.email());
        OrderStateMachine.requireBefore(order.getDeliveryDeadline(), now, "The delivery deadline has passed");
        order.setDeliveryPhotoRef(photos.store(orderId, "delivery", photo));
        transition(order, OrderStatus.DELIVERED, true, now);
        outbox.append(
                order.getId(),
                KafkaTopics.RATING,
                messages.ratingPermission(order, courier.email(), "COURIER", order.getRequesterEmail(), "REQUESTER", now),
                now
        );
        return order;
    }

    @Transactional
    public OrderEntity acknowledge(UserAccount requester, UUID orderId) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireRequester(order.snapshot(), requester.email());
        OrderStateMachine.requireCanAcknowledge(order.snapshot(), now);
        order.setSettledAt(now);
        transition(order, OrderStatus.ACKNOWLEDGED, true, now);
        releaseAndAllowRequesterRating(order, "ACKNOWLEDGED", now);
        return order;
    }

    @Transactional
    public OrderEntity escalate(UserAccount requester, UUID orderId, String disputeText, MultipartFile photo) {
        Instant now = clock.instant();
        OrderEntity order = lock(orderId);
        OrderStateMachine.requireRequester(order.snapshot(), requester.email());
        OrderStateMachine.requireCanEscalate(order.snapshot(), now);
        String comment = requireComment(disputeText);
        if (photo != null && !photo.isEmpty()) {
            order.setDisputePhotoRef(photos.store(orderId, "dispute", photo));
        }
        admins.escalate(orderContext(order, comment), requester);
        order.setDisputeText(comment);
        transition(order, OrderStatus.ESCALATED, true, now);
        return order;
    }

    @Transactional
    public void revertCollectionWindow(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.collectionWindowExpired(order.snapshot(), now)) {
            return;
        }
        clearCourier(order);
        transition(order, OrderStatus.CREATED, true, now);
    }

    @Transactional
    public void expire(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.acceptanceExpired(order.snapshot(), now)) {
            return;
        }
        transition(order, OrderStatus.EXPIRED, true, now);
        outbox.append(order.getId(), KafkaTopics.CREDIT, messages.creditReturn(order, now), now);
    }

    @Transactional
    public void escalateMissedDelivery(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.deliveryMissed(order.snapshot(), now)) {
            return;
        }
        transition(order, OrderStatus.ESCALATED, true, now);
        outbox.append(order.getId(), KafkaTopics.ADMIN_COMMANDS, messages.escalationOpened(order, now), now);
    }

    @Transactional
    public void unacknowledge(UUID orderId, Instant now) {
        OrderEntity order = lock(orderId);
        if (!OrderStateMachine.acknowledgementExpired(order.snapshot(), now)) {
            return;
        }
        order.setSettledAt(now);
        transition(order, OrderStatus.UNACKNOWLEDGED, true, now);
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
        transition(order, OrderStatus.COMPLETED, false, now);
    }

    @Transactional
    public void applyAdminEvent(String eventId, String eventType, UUID orderId, String caseId) {
        if (eventId == null || eventType == null || orderId == null || caseId == null || caseId.isBlank()) {
            return;
        }
        if (processedEvents.existsById(eventId)) {
            return;
        }
        ProcessedEventEntity processed = new ProcessedEventEntity();
        processed.setEventId(eventId);
        processed.setProcessedAt(clock.instant());
        processedEvents.save(processed);

        OrderEntity order = orders.lockById(orderId).orElse(null);
        if (order == null) {
            return;
        }
        Instant now = clock.instant();
        order.setCaseId(caseId);
        if ("admin.review.started".equals(eventType) && OrderStateMachine.canReview(order.snapshot())) {
            transition(order, OrderStatus.UNDER_REVIEW, true, now);
            return;
        }
        if ("admin.case.resolved".equals(eventType) && OrderStateMachine.canResolve(order.snapshot())) {
            deletePhotos(order);
            transition(order, OrderStatus.COMPLETED, true, now);
        }
    }

    private void releaseAndAllowRequesterRating(OrderEntity order, String reason, Instant now) {
        outbox.append(order.getId(), KafkaTopics.CREDIT, messages.creditRelease(order, reason, now), now);
        outbox.append(
                order.getId(),
                KafkaTopics.RATING,
                messages.ratingPermission(order, order.getRequesterEmail(), "REQUESTER", order.getCourierEmail(), "COURIER", now),
                now
        );
    }

    private void transition(OrderEntity order, OrderStatus to, boolean notifyRequester, Instant now) {
        OrderStatus from = order.getStatus();
        order.setStatus(to);
        order.setUpdatedAt(now);
        publishStatus(order, from, to, notifyRequester, now);
    }

    private void publishStatus(OrderEntity order, OrderStatus from, OrderStatus to, boolean notifyRequester, Instant now) {
        AlertEntity alert = new AlertEntity();
        alert.setId(UUID.randomUUID());
        alert.setOrderId(order.getId());
        alert.setRequesterEmail(order.getRequesterEmail());
        alert.setFromStatus(from == null ? null : from.name());
        alert.setToStatus(to.name());
        alert.setNotifyRequester(notifyRequester);
        alert.setCreatedAt(now);
        alerts.save(alert);
        outbox.append(
                order.getId(),
                KafkaTopics.ORDER_STATUS,
                messages.statusChanged(order, from, to, notifyRequester, now),
                now
        );
    }

    private static OrderContext orderContext(OrderEntity order, String comment) {
        return new OrderContext(
                order.getId(),
                order.getStatus().name(),
                order.getItemDescription(),
                order.getAmount(),
                order.getRequesterEmail(),
                order.getRequesterTelegramHandle(),
                order.getRequesterRating(),
                order.getCourierEmail(),
                order.getCourierTelegramHandle(),
                order.getCourierRating(),
                order.getRequestTime(),
                order.getAcceptanceExpiry(),
                order.getDeliveryDeadline(),
                order.getCollectionDeadline(),
                order.getAcknowledgementDeadline(),
                order.getPickupLocationId(),
                order.getPickupName(),
                order.getPickupLat(),
                order.getPickupLng(),
                order.getDropoffLocationId(),
                order.getDropoffName(),
                order.getDropoffLat(),
                order.getDropoffLng(),
                order.getCollectionPhotoRef(),
                order.getDeliveryPhotoRef(),
                order.getDisputePhotoRef(),
                comment
        );
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
        order.setCourierEmail(null);
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
