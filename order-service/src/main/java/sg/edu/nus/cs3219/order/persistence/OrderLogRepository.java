/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service persistence under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.persistence;

import org.springframework.data.repository.Repository;

import java.util.UUID;

public interface OrderLogRepository extends Repository<OrderLogEntity, UUID> {

    OrderLogEntity save(OrderLogEntity entry);
}
