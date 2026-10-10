package sg.edu.nus.cs3219.order.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import sg.edu.nus.cs3219.order.domain.OrderSnapshot;
import sg.edu.nus.cs3219.order.domain.OrderStatus;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "orders")
public class OrderEntity {

    @Id
    private UUID id;

    @Column(name = "requester_id", nullable = false)
    private String requesterId;

    @Column(name = "requester_telegram_handle")
    private String requesterTelegramHandle;

    @Column(name = "courier_id")
    private String courierId;

    @Column(name = "courier_telegram_handle")
    private String courierTelegramHandle;

    @Column(name = "courier_rating")
    private Double courierRating;

    @Column(name = "requester_rating")
    private Double requesterRating;

    @Column(name = "item_description", nullable = false)
    private String itemDescription;

    @Column(nullable = false)
    private int amount;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private OrderStatus status;

    @Column(name = "request_time", nullable = false)
    private Instant requestTime;

    @Column(name = "acceptance_expiry", nullable = false)
    private Instant acceptanceExpiry;

    @Column(name = "delivery_deadline", nullable = false)
    private Instant deliveryDeadline;

    @Column(name = "collection_deadline")
    private Instant collectionDeadline;

    @Column(name = "acknowledgement_deadline")
    private Instant acknowledgementDeadline;

    @Column(name = "settled_at")
    private Instant settledAt;

    @Column(name = "pickup_location_id", nullable = false)
    private String pickupLocationId;

    @Column(name = "pickup_name", nullable = false)
    private String pickupName;

    @Column(name = "pickup_lat", nullable = false)
    private double pickupLat;

    @Column(name = "pickup_lng", nullable = false)
    private double pickupLng;

    @Column(name = "dropoff_location_id", nullable = false)
    private String dropoffLocationId;

    @Column(name = "dropoff_name", nullable = false)
    private String dropoffName;

    @Column(name = "dropoff_lat", nullable = false)
    private double dropoffLat;

    @Column(name = "dropoff_lng", nullable = false)
    private double dropoffLng;

    @Column(name = "collection_photo_ref")
    private String collectionPhotoRef;

    @Column(name = "delivery_photo_ref")
    private String deliveryPhotoRef;

    @Column(name = "dispute_photo_ref")
    private String disputePhotoRef;

    @Column(name = "dispute_text")
    private String disputeText;

    @Column(name = "case_id")
    private String caseId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public OrderSnapshot snapshot() {
        return new OrderSnapshot(
                id,
                status,
                requesterId,
                courierId,
                acceptanceExpiry,
                deliveryDeadline,
                collectionDeadline,
                acknowledgementDeadline,
                settledAt
        );
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getRequesterId() {
        return requesterId;
    }

    public void setRequesterId(String requesterId) {
        this.requesterId = requesterId;
    }

    public String getRequesterTelegramHandle() {
        return requesterTelegramHandle;
    }

    public void setRequesterTelegramHandle(String requesterTelegramHandle) {
        this.requesterTelegramHandle = requesterTelegramHandle;
    }

    public String getCourierId() {
        return courierId;
    }

    public void setCourierId(String courierId) {
        this.courierId = courierId;
    }

    public String getCourierTelegramHandle() {
        return courierTelegramHandle;
    }

    public void setCourierTelegramHandle(String courierTelegramHandle) {
        this.courierTelegramHandle = courierTelegramHandle;
    }

    public Double getCourierRating() {
        return courierRating;
    }

    public void setCourierRating(Double courierRating) {
        this.courierRating = courierRating;
    }

    public Double getRequesterRating() {
        return requesterRating;
    }

    public void setRequesterRating(Double requesterRating) {
        this.requesterRating = requesterRating;
    }

    public String getItemDescription() {
        return itemDescription;
    }

    public void setItemDescription(String itemDescription) {
        this.itemDescription = itemDescription;
    }

    public int getAmount() {
        return amount;
    }

    public void setAmount(int amount) {
        this.amount = amount;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public void setStatus(OrderStatus status) {
        this.status = status;
    }

    public Instant getRequestTime() {
        return requestTime;
    }

    public void setRequestTime(Instant requestTime) {
        this.requestTime = requestTime;
    }

    public Instant getAcceptanceExpiry() {
        return acceptanceExpiry;
    }

    public void setAcceptanceExpiry(Instant acceptanceExpiry) {
        this.acceptanceExpiry = acceptanceExpiry;
    }

    public Instant getDeliveryDeadline() {
        return deliveryDeadline;
    }

    public void setDeliveryDeadline(Instant deliveryDeadline) {
        this.deliveryDeadline = deliveryDeadline;
    }

    public Instant getCollectionDeadline() {
        return collectionDeadline;
    }

    public void setCollectionDeadline(Instant collectionDeadline) {
        this.collectionDeadline = collectionDeadline;
    }

    public Instant getAcknowledgementDeadline() {
        return acknowledgementDeadline;
    }

    public void setAcknowledgementDeadline(Instant acknowledgementDeadline) {
        this.acknowledgementDeadline = acknowledgementDeadline;
    }

    public Instant getSettledAt() {
        return settledAt;
    }

    public void setSettledAt(Instant settledAt) {
        this.settledAt = settledAt;
    }

    public String getPickupLocationId() {
        return pickupLocationId;
    }

    public void setPickupLocationId(String pickupLocationId) {
        this.pickupLocationId = pickupLocationId;
    }

    public String getPickupName() {
        return pickupName;
    }

    public void setPickupName(String pickupName) {
        this.pickupName = pickupName;
    }

    public double getPickupLat() {
        return pickupLat;
    }

    public void setPickupLat(double pickupLat) {
        this.pickupLat = pickupLat;
    }

    public double getPickupLng() {
        return pickupLng;
    }

    public void setPickupLng(double pickupLng) {
        this.pickupLng = pickupLng;
    }

    public String getDropoffLocationId() {
        return dropoffLocationId;
    }

    public void setDropoffLocationId(String dropoffLocationId) {
        this.dropoffLocationId = dropoffLocationId;
    }

    public String getDropoffName() {
        return dropoffName;
    }

    public void setDropoffName(String dropoffName) {
        this.dropoffName = dropoffName;
    }

    public double getDropoffLat() {
        return dropoffLat;
    }

    public void setDropoffLat(double dropoffLat) {
        this.dropoffLat = dropoffLat;
    }

    public double getDropoffLng() {
        return dropoffLng;
    }

    public void setDropoffLng(double dropoffLng) {
        this.dropoffLng = dropoffLng;
    }

    public String getCollectionPhotoRef() {
        return collectionPhotoRef;
    }

    public void setCollectionPhotoRef(String collectionPhotoRef) {
        this.collectionPhotoRef = collectionPhotoRef;
    }

    public String getDeliveryPhotoRef() {
        return deliveryPhotoRef;
    }

    public void setDeliveryPhotoRef(String deliveryPhotoRef) {
        this.deliveryPhotoRef = deliveryPhotoRef;
    }

    public String getDisputePhotoRef() {
        return disputePhotoRef;
    }

    public void setDisputePhotoRef(String disputePhotoRef) {
        this.disputePhotoRef = disputePhotoRef;
    }

    public String getDisputeText() {
        return disputeText;
    }

    public void setDisputeText(String disputeText) {
        this.disputeText = disputeText;
    }

    public String getCaseId() {
        return caseId;
    }

    public void setCaseId(String caseId) {
        this.caseId = caseId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
