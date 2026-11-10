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
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface AlertRepository extends JpaRepository<AlertEntity, UUID> {

    @Query("""
            select a from AlertEntity a
            where (lower(a.requesterId) = lower(:userId) and a.notifyRequester = true)
               or (lower(a.courierId) = lower(:userId) and a.notifyCourier = true)
            order by a.createdAt desc
            """)
    Page<AlertEntity> findVisibleToUser(@Param("userId") String userId, Pageable pageable);
}
