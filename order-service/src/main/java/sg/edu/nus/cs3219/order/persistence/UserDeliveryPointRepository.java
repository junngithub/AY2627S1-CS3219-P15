/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service persistence under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.persistence;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface UserDeliveryPointRepository extends JpaRepository<UserDeliveryPointEntity, UserDeliveryPointId> {

    long countByDeliveryPointId(Long deliveryPointId);

    Optional<UserDeliveryPointEntity> findByUserIdAndDeliveryPointId(String userId, Long deliveryPointId);

    boolean existsByUserIdAndDeliveryPointId(String userId, Long deliveryPointId);

    Page<UserDeliveryPointEntity> findByUserIdOrderByUseCountDescLastUsedAtDesc(String userId, Pageable pageable);

    List<UserDeliveryPointEntity> findByUserId(String userId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            INSERT INTO user_delivery_point (user_id, delivery_point_id, use_count, last_used_at, created_at)
            VALUES (:userId, :pointId, 1, :usedAt, :usedAt)
            ON CONFLICT (user_id, delivery_point_id)
            DO UPDATE SET use_count = user_delivery_point.use_count + 1,
                          last_used_at = EXCLUDED.last_used_at
            """, nativeQuery = true)
    int upsertUsage(@Param("userId") String userId, @Param("pointId") long pointId, @Param("usedAt") Instant usedAt);
}
