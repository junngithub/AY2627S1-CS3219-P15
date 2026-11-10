/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service domain (state machine / ranking) under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.domain;

public enum OrderAction {
    CREATED,
    ACCEPTED,
    CANCELLED,
    RELEASED,
    COLLECTED,
    DELIVERED,
    ACKNOWLEDGED,
    ESCALATED,
    COLLECTION_WINDOW_EXPIRED,
    ACCEPTANCE_EXPIRED,
    DELIVERY_DEADLINE_MISSED,
    ACKNOWLEDGEMENT_WINDOW_EXPIRED,
    COMPLETION_WINDOW_ELAPSED,
    REVIEW_STARTED,
    CASE_RESOLVED
}
