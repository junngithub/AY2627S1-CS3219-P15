package sg.edu.nus.cs3219.order.persistence;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import sg.edu.nus.cs3219.order.domain.OrderStatus;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OrderRepository extends JpaRepository<OrderEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from OrderEntity o where o.id = :id")
    Optional<OrderEntity> lockById(@Param("id") UUID id);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update OrderEntity o
            set o.status = sg.edu.nus.cs3219.order.domain.OrderStatus.ACCEPTED,
                o.courierEmail = :courierEmail,
                o.courierTelegramHandle = :courierTelegramHandle,
                o.courierRating = :courierRating,
                o.collectionDeadline = :collectionDeadline,
                o.updatedAt = :updatedAt
            where o.id = :id
              and o.status = sg.edu.nus.cs3219.order.domain.OrderStatus.CREATED
              and o.courierEmail is null
            """)
    int acceptIfOpen(
            @Param("id") UUID id,
            @Param("courierEmail") String courierEmail,
            @Param("courierTelegramHandle") String courierTelegramHandle,
            @Param("courierRating") Double courierRating,
            @Param("collectionDeadline") Instant collectionDeadline,
            @Param("updatedAt") Instant updatedAt
    );

    @Query("""
            select o from OrderEntity o
            where o.status = :status
              and o.requesterEmail <> :email
              and o.pickupLat between :minLat and :maxLat
              and o.pickupLng between :minLng and :maxLng
            """)
    List<OrderEntity> findOpenInBox(
            @Param("status") OrderStatus status,
            @Param("email") String email,
            @Param("minLat") double minLat,
            @Param("maxLat") double maxLat,
            @Param("minLng") double minLng,
            @Param("maxLng") double maxLng
    );

    @Query("""
            select o from OrderEntity o
            where o.status = :status
              and o.requesterEmail <> :email
              and (:pickupId is null or o.pickupLocationId = :pickupId)
              and (:dropoffId is null or o.dropoffLocationId = :dropoffId)
            """)
    Page<OrderEntity> searchOpen(
            @Param("status") OrderStatus status,
            @Param("email") String email,
            @Param("pickupId") String pickupId,
            @Param("dropoffId") String dropoffId,
            Pageable pageable
    );

    Page<OrderEntity> findByRequesterEmailOrderByRequestTimeDesc(String requesterEmail, Pageable pageable);

    @Query("select o.id from OrderEntity o where o.status = :status and o.collectionDeadline <= :now")
    List<UUID> findCollectionWindowExpired(@Param("status") OrderStatus status, @Param("now") Instant now);

    @Query("select o.id from OrderEntity o where o.status = :status and o.acceptanceExpiry <= :now")
    List<UUID> findAcceptanceExpired(@Param("status") OrderStatus status, @Param("now") Instant now);

    @Query("select o.id from OrderEntity o where o.status = :status and o.deliveryDeadline <= :now")
    List<UUID> findDeliveryMissed(@Param("status") OrderStatus status, @Param("now") Instant now);

    @Query("""
            select o.id from OrderEntity o
            where o.status in :statuses and o.acknowledgementDeadline <= :now
            """)
    List<UUID> findAcknowledgementExpired(@Param("statuses") List<OrderStatus> statuses, @Param("now") Instant now);

    @Query("""
            select o.id from OrderEntity o
            where o.status in :statuses and o.settledAt <= :settledBefore
            """)
    List<UUID> findReadyToComplete(
            @Param("statuses") List<OrderStatus> statuses,
            @Param("settledBefore") Instant settledBefore
    );
}
